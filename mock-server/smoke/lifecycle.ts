// Service lifecycle: port probes, build/start/stop/wait helpers. Only the
// helpers actually used by the entry are exported; the rest stays local.

import { createConnection } from "node:net";
import { join } from "node:path";

import { f, timeoutMs, workerDir, workerPort, WORKER_UPSTREAM_URL } from "./config.ts";
import { SYM } from "../src/log.ts";

const children: Bun.Subprocess[] = [];
// Wrangler runs workerd as a separate process, so the Cloudflare child must be
// reaped as a tree (see `forceKillTree`) instead of a SIGTERM/SIGKILL to the
// wrapper. Everything else keeps the graceful SIGTERM -> SIGKILL path.
const treeKillChildren = new WeakSet<Bun.Subprocess>();
const KILL_GRACE_MS = 3000;

// Windows-only: kill the whole process tree rooted at `child`. Bun's
// SIGTERM/SIGKILL map to TerminateProcess, which would leave descendants such
// as workerd behind; `taskkill /T /F` reaps them. `taskkill` lives in System32
// and is always on PATH. An already-exited PID, a missing `taskkill` or a
// non-zero exit are all non-fatal — the child is treated as gone.
export async function forceKillTree(child: Bun.Subprocess): Promise<void> {
  try {
    const killer = Bun.spawn(["taskkill", "/PID", String(child.pid), "/T", "/F"], {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });
    await killer.exited;
  } catch {
    /* already gone */
  }
}

// A listening process on the target port makes spawning a false positive: the
// child would die with EADDRINUSE while the smoke test waits for a *different*
// server. Probe with a TCP connect — a bind probe is unreliable on Windows,
// where SO_REUSEADDR lets a second bind succeed on a busy port.
function isPortFree(port: number, hostname = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: hostname });
    socket.setTimeout(1000);
    const done = (free: boolean) => {
      socket.destroy();
      resolve(free);
    };
    socket.once("connect", () => done(false));
    socket.once("timeout", () => done(false)); // unknown state: fail closed
    socket.once("error", (error: NodeJS.ErrnoException) => done(error.code === "ECONNREFUSED"));
  });
}

export async function assertPortsFree(ports: Array<[number, string]>): Promise<void> {
  for (const [port, name] of ports) {
    if (!(await isPortFree(port))) {
      throw new Error(
        `127.0.0.1:${port} (${name}) is already in use; stop that process or run with --no-spawn`,
      );
    }
  }
}

// Propagate the shared formatter's color decision to spawned services: when the
// smoke output is plain (non-TTY/CI/pipe/TERM=dumb/NO_COLOR), their own logs
// should be plain too. Axum tracing honors NO_COLOR. Service-specific env wins.
function serviceEnv(env: Record<string, string>): Record<string, string> {
  return { ...process.env, ...(f.color ? {} : { NO_COLOR: "1" }), ...env };
}

export function startService(
  name: string,
  cwd: string,
  env: Record<string, string>,
): Bun.Subprocess {
  console.log(
    `${f.accent(SYM.arrow)} ${f.accent("smoke")} starting ${name} ${f.dim(`in ${cwd}`)}`,
  );
  const child = Bun.spawn([process.execPath, "src/index.ts"], {
    cwd,
    env: serviceEnv(env),
    stdout: "inherit",
    stderr: "inherit",
    stdin: "ignore",
  });
  children.push(child);
  return child;
}

// Build the Axum worker from the current sources before starting it, then run
// the produced debug binary directly. `cargo run` would wrap the server in a
// `cargo` process, so cleanup on Windows could kill the wrapper and leave the
// actual `vot-worker` binary behind. The build runs synchronously, ahead of the
// HTTP startup wait, so it never eats into the short startup timeout.
export function buildAxum(): void {
  console.log(
    `${f.accent(SYM.arrow)} ${f.accent("smoke")} building axum ` +
      `${f.dim(`cargo build --quiet in ${workerDir}`)}`,
  );
  let exitCode: number | null;
  try {
    exitCode = Bun.spawnSync(["cargo", "build", "--quiet"], {
      cwd: workerDir,
      stdout: "inherit",
      stderr: "inherit",
    }).exitCode;
  } catch (error) {
    throw new Error(`failed to run cargo build in ${workerDir}: ${(error as Error).message}`);
  }
  if (exitCode !== 0) {
    throw new Error(
      `cargo build failed in ${workerDir} (exit code ${String(exitCode)}); ` +
        "install Rust (https://rustup.rs) and fix the errors above",
    );
  }
}

export function startAxumWorker(env: Record<string, string>): Bun.Subprocess {
  const binary = join(
    workerDir,
    "target",
    "debug",
    `vot-worker${process.platform === "win32" ? ".exe" : ""}`,
  );
  console.log(`${f.accent(SYM.arrow)} ${f.accent("smoke")} starting axum worker ${f.dim(binary)}`);
  const child = Bun.spawn([binary], {
    cwd: workerDir,
    env: withLoopbackNoProxy(serviceEnv(env)),
    stdout: "inherit",
    stderr: "inherit",
    stdin: "ignore",
  });
  children.push(child);
  return child;
}

// Loopback must bypass any ambient forward proxy: reqwest honors NO_PROXY
// (including for the Windows system proxy), and without it the mock upstream
// at 127.0.0.1:3001 is routed through the proxy (HTTP 502). Scoped to the
// Axum worker: other spawned services keep the ambient proxy (notably
// Cloudflare, where npx may need it to download wrangler).
function withLoopbackNoProxy(env: Record<string, string>): Record<string, string> {
  const out = { ...env };
  for (const key of ["NO_PROXY", "no_proxy"]) {
    const parts = (out[key] ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    for (const host of ["127.0.0.1", "localhost"]) {
      if (!parts.includes(host)) parts.push(host);
    }
    out[key] = parts.join(",");
  }
  return out;
}

// Cloudflare is a Module Worker served by `wrangler dev` (it has no standalone
// binary). Wrangler is run through `npx --yes wrangler` (no pinned local
// devDependency): `--yes` keeps the smoke non-interactive, and `npx` is
// resolved via `Bun.which` so a missing Node/npm gives a clear error. Bun on
// Windows spawns the resolved `npx.cmd` directly. Run from the cloudflare
// config/cwd, bound to loopback in a non-interactive session, and inject the
// mock address as `env.YANDEX_API_URL` (`--var KEY:VALUE`, so the `:` in the
// URL survives).
export function startCloudflareWorker(serverId?: string): Bun.Subprocess {
  const npx = Bun.which("npx");
  if (!npx) {
    const node = Bun.which("node");
    throw new Error(
      "npx not found on PATH; the Cloudflare worker smoke runs `npx wrangler dev` and " +
        `${node ? "" : "(Node.js is not installed) "}` +
        "needs Node.js/npm. Install Node.js (https://nodejs.org) and make sure `npx` " +
        "and `node` are on PATH",
    );
  }
  console.log(
    `${f.accent(SYM.arrow)} ${f.accent("smoke")} starting cloudflare worker ` +
      `${f.dim(`npx wrangler dev in ${workerDir}`)}`,
  );
  // `wrangler dev --local` only reaches 127.0.0.1 (workerd + the mock upstream),
  // but proxy vars are kept: `npx` may need a configured proxy to download
  // wrangler on a cold cache. Wrangler's global proxy warning is acceptable.
  const child = Bun.spawn(
    [
      npx,
      "--yes",
      "wrangler",
      "dev",
      "--config",
      join(workerDir, "wrangler.toml"),
      "--local",
      "--ip",
      "127.0.0.1",
      "--port",
      String(workerPort),
      "--show-interactive-dev-session=false",
      "--log-level",
      "error",
      "--var",
      `YANDEX_API_URL:${WORKER_UPSTREAM_URL}`,
      ...(serverId === undefined ? [] : ["--var", `SERVER_ID:${serverId}`]),
    ],
    {
      cwd: workerDir,
      env: serviceEnv({}),
      stdout: "inherit",
      stderr: "inherit",
      stdin: "ignore",
    },
  );
  children.push(child);
  treeKillChildren.add(child);
  return child;
}

// Idempotent so the `finally` cleanup and a signal handler can both await it.
let stopping: Promise<void> | undefined;

export function stopChildren(): Promise<void> {
  stopping ??= (async () => {
    const running = children.filter((child) => child.exitCode === null);
    for (const child of running) {
      if (process.platform === "win32" && treeKillChildren.has(child)) {
        // Wrangler's workerd grandchild would survive a plain SIGTERM.
        await forceKillTree(child);
      } else {
        try {
          child.kill("SIGTERM");
        } catch {
          /* already gone */
        }
      }
    }
    const exited = Promise.all(running.map((child) => child.exited));
    const timedOut = await Promise.race([
      exited.then(() => false),
      Bun.sleep(KILL_GRACE_MS).then(() => true),
    ]);
    if (!timedOut) return;
    for (const child of running) {
      if (child.exitCode !== null) continue;
      if (process.platform === "win32" && treeKillChildren.has(child)) {
        await forceKillTree(child);
      } else {
        try {
          child.kill("SIGKILL");
        } catch {
          /* already gone */
        }
      }
    }
    await Promise.race([exited, Bun.sleep(1000)]);
  })();
  return stopping;
}

export async function waitFor(url: string, name: string, child?: Bun.Subprocess): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child && child.exitCode !== null) {
      throw new Error(`${name} exited with code ${child.exitCode} before ${url} became ready`);
    }
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {
      /* not up yet */
    }
    // Wake as soon as the child exits instead of polling the full interval.
    await Promise.race([Bun.sleep(200), child?.exited ?? Bun.sleep(200)]);
  }
  throw new Error(`timed out waiting for ${name} at ${url}`);
}
