#!/usr/bin/env bun
/**
 * Smoke test for the Elysia (`elysia/`), Axum (`axum/`) and Cloudflare
 * (`cloudflare/`) workers backed by `mock-server`.
 *
 * Functional requests go through `@vot.js/node` (`VOTClient` with
 * `VOTWorkerProvider`): the worker is a thin proxy that accepts the worker
 * envelope and forwards raw bytes + headers to the Yandex API, mocked by
 * `mock-server` at 127.0.0.1:3001. Raw `fetch`/`workerCall` is kept only for
 * `health` and intentionally negative transport checks (unknown route,
 * invalid payload, unsigned request): the package provides no health/fallback
 * API and intentionally cannot send malformed/unsigned requests. An unsigned
 * check needs a valid (decodable) protobuf body — an empty envelope body `[]`
 * is rejected by the mock with 400 before sec validation, so it cannot
 * produce the expected 402 (verified against the mock).
 *
 * Select one worker with `--worker elysia|axum|cloudflare` (or `SMOKE_WORKER`).
 * With no explicit worker the script orchestrates all three sequentially by
 * re-running itself three times as child processes (`--worker elysia`, then
 * `--worker axum`, then `--worker cloudflare`), so each child keeps its own
 * defaults and mock/worker lifecycle untouched. The scenarios are shared, only
 * the invalid-payload header differs.
 *
 * By default each run starts its services itself and stops them afterwards.
 * Pass `--no-spawn` (or `NO_SPAWN=1`) to test already-running instances instead.
 */

import {
  WORKERS,
  WORKER_UPSTREAM_PORT,
  WORKER_UPSTREAM_URL,
  explicitWorker,
  f,
  mockDir,
  mockPort,
  mockUrl,
  setting,
  spawnMode,
  workerDir,
  workerKind,
  workerPort,
  workerUrl,
  type WorkerKind,
} from "./config.ts";
import { SYM } from "../src/log.ts";
import {
  assertPortsFree,
  buildAxum,
  forceKillTree,
  startAxumWorker,
  startCloudflareWorker,
  startService,
  stopChildren,
  waitFor,
} from "./lifecycle.ts";
import {
  assert,
  checkAudioGatedFlow,
  checkCache,
  checkFailureFlow,
  checkHealth,
  checkNegativeRoutes,
  checkNormalVideoFlow,
  checkStreamAndPing,
  checkSubtitles,
  client,
  failures,
  scenario,
  secValidationEnabled,
} from "./scenarios.ts";

// No explicit worker: run all three sequentially, each as a child of this same
// script. It must stay a separate process per worker so per-worker defaults
// (`elysia` :5000, `axum` :7674, `cloudflare` :8787) and the spawn/stop
// lifecycle are reused as-is. Never returns — exits the process with the
// aggregate result.
async function orchestrateAll(): Promise<never> {
  // A single shared worker endpoint is ambiguous across the workers (different
  // defaults, and in spawn mode the URL must match that worker's port). Rather
  // than silently mis-target one of them, reject it here.
  const sharedEndpoint =
    setting("worker-url", "WORKER_URL") ?? setting("worker-port", "WORKER_PORT");
  if (sharedEndpoint !== undefined) {
    console.error(
      `${f.failure(SYM.fail)} ${f.accent("smoke")} fatal: all-workers mode has no single ` +
        "worker endpoint; select one with --worker/SMOKE_WORKER, or run --worker elysia / " +
        "--worker axum / --worker cloudflare separately for a custom " +
        "--worker-url/WORKER_URL or --worker-port/WORKER_PORT",
    );
    process.exit(1);
  }

  const baseArgs = process.argv.slice(2);
  const runs: Array<{ worker: WorkerKind; code: number }> = [];
  let active: Bun.Subprocess | undefined;
  let interrupted = false;

  async function stopActiveChild(): Promise<void> {
    const child = active;
    if (!child || child.exitCode !== null) return;
    if (process.platform === "win32") {
      // Bun's SIGTERM on Windows is TerminateProcess, which kills only the
      // child smoke and orphans its services (notably wrangler's workerd).
      // Reap the whole subtree at once instead.
      await forceKillTree(child);
    } else {
      try {
        child.kill("SIGTERM");
      } catch {
        /* already gone */
      }
    }
    // The child runs its own cleanup, which can take up to ~4s to stop its
    // services; wait 5s before the hard kill.
    const timedOut = await Promise.race([
      child.exited.then(() => false),
      Bun.sleep(5000).then(() => true),
    ]);
    if (timedOut && child.exitCode === null) {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    }
  }

  // Ctrl+C must not leave the active child smoke and its services behind: the
  // child handles its own SIGTERM cleanup, we just wait and then hard-exit.
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      interrupted = true;
      console.error(
        `${f.skip(SYM.skip)} ${f.accent("smoke")} received ${signal}, stopping orchestrated smoke`,
      );
      void stopActiveChild().finally(() => process.exit(1));
    });
  }

  console.log(
    `${f.accent(SYM.node)} ${f.accent("smoke")} all-workers mode: ${WORKERS.join(", then ")}`,
  );
  for (const worker of WORKERS) {
    console.log(
      `\n${f.accent(SYM.node)} ${f.accent("smoke")} ${f.worker(worker)} ` +
        f.dim("─".repeat(34)),
    );
    const running = Bun.spawn(
      [process.execPath, import.meta.path, ...baseArgs, "--worker", worker],
      {
        cwd: process.cwd(),
        env: process.env,
        stdout: "inherit",
        stderr: "inherit",
        stdin: "inherit",
      },
    );
    active = running;
    const code = await running.exited;
    active = undefined;
    runs.push({ worker, code });
    if (interrupted) break;
  }

  console.log(`\n${f.accent(SYM.node)} ${f.accent("smoke")} all-workers summary:`);
  let failed = 0;
  for (const { worker, code } of runs) {
    const outcome =
      code === 0
        ? f.success(`${SYM.ok} passed`)
        : f.failure(`${SYM.fail} failed (exit ${code})`);
    console.log(`  ${f.worker(worker.padEnd(10))} ${outcome}`);
    if (code !== 0) failed += 1;
  }
  if (interrupted || failed > 0 || runs.length !== WORKERS.length) {
    console.error(
      `${f.failure(SYM.fail)} ${f.accent("smoke")} ${failed} of ${WORKERS.length} ` +
        "worker run(s) failed",
    );
    process.exit(1);
  }
  console.log(
    `${f.success(SYM.ok)} ${f.accent("smoke")} all-workers passed ` +
      `(${WORKERS.length}/${WORKERS.length})`,
  );
  process.exit(0);
}

if (explicitWorker === undefined) {
  await orchestrateAll();
}

async function run(): Promise<void> {
  console.log(
    `${f.accent(SYM.node)} ${f.accent("smoke")} worker ${f.worker(workerKind)} ${f.dim(workerUrl)}`,
  );
  console.log(
    `${f.accent(SYM.node)} ${f.accent("smoke")} mock ${f.dim(mockUrl)}` +
      `${spawnMode ? f.dim(" (spawned)") : ""}`,
  );

  let mockChild: Bun.Subprocess | undefined;
  let workerChild: Bun.Subprocess | undefined;
  if (spawnMode) {
    if (mockPort !== WORKER_UPSTREAM_PORT) {
      throw new Error(
        `spawn mode requires mock port ${WORKER_UPSTREAM_PORT} (workers use ` +
          `YANDEX_API_URL=${WORKER_UPSTREAM_URL}); got ${mockPort}. ` +
          `Use --no-spawn to test a separately started mock`,
      );
    }
    if (workerPort === mockPort) {
      throw new Error(`worker port and mock port are both ${mockPort}`);
    }
    await assertPortsFree([
      [mockPort, "mock-server"],
      [workerPort, "worker"],
    ]);
    if (workerKind === "axum") buildAxum();
    mockChild = startService("mock-server", mockDir, {
      PORT: String(mockPort),
      SKIP_SEC_VALIDATION: "false",
    });
    if (workerKind === "axum") {
      workerChild = startAxumWorker({
        SERVICE_HOST: "127.0.0.1",
        SERVICE_PORT: String(workerPort),
        YANDEX_API_URL: WORKER_UPSTREAM_URL,
      });
    } else if (workerKind === "cloudflare") {
      workerChild = startCloudflareWorker();
    } else {
      workerChild = startService("worker", workerDir, {
        SERVICE_PORT: String(workerPort),
        NODE_ENV: "production",
        YANDEX_API_URL: WORKER_UPSTREAM_URL,
      });
    }
  }

  await waitFor(`${mockUrl}/health`, "mock-server", mockChild);
  await waitFor(`${workerUrl}/health`, "worker", workerChild);

  console.log(`${f.accent(SYM.arrow)} ${f.accent("smoke")} running scenarios`);

  await scenario("health", checkHealth);

  let sessionReady = false;
  await scenario("session: create + decode", async () => {
    const session = await client.provider.getSession("video-translation");
    assert(session.uuid.length > 0, "session uuid is present");
    assert(session.secretKey.length > 10, "session secretKey looks valid");
    assert(session.expires === 3600, `session expires is ${session.expires}, expected 3600`);
    sessionReady = true;
  });
  // In spawn mode the mock is started with `SKIP_SEC_VALIDATION=false`, so the
  // signature probe would be redundant; only a --no-spawn mock needs probing.
  const secEnabled = spawnMode ? true : await secValidationEnabled().catch(() => false);

  if (sessionReady) {
    await scenario("video flow: processing -> done", checkNormalVideoFlow);
    await scenario("video flow: waiting -> upload -> processing -> done", checkAudioGatedFlow);
    await scenario("cache: default ready + cloning waiting", checkCache);
    await scenario("failure flow: fail-audio-js -> failed translate", checkFailureFlow);
    await scenario("subtitles: get-subtitles", checkSubtitles);
    await scenario("stream: translate-stream + ping-stream", checkStreamAndPing);
  } else {
    console.error(
      `${f.skip(SYM.skip)} ${f.accent("smoke")} skip dependent scenarios: session was not created`,
    );
  }
  await scenario("negative: unknown route + invalid payload", () =>
    checkNegativeRoutes(secEnabled),
  );
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    console.error(`${f.skip(SYM.skip)} ${f.accent("smoke")} received ${signal}, stopping services`);
    void stopChildren().finally(() => process.exit(1));
  });
}

let exitCode = 0;
try {
  await run();
} catch (error) {
  console.error(`${f.failure(SYM.fail)} ${f.accent("smoke")} fatal: ${(error as Error).message}`);
  exitCode = 1;
} finally {
  await stopChildren();
}

if (failures > 0) {
  console.error(`${f.failure(SYM.fail)} ${f.accent("smoke")} ${failures} scenario(s) failed`);
} else if (exitCode === 0) {
  console.log(`${f.success(SYM.ok)} ${f.accent("smoke")} all scenarios passed`);
}
process.exit(exitCode || (failures > 0 ? 1 : 0));
