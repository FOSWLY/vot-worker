// CLI flags/env, worker kinds, shared constants, paths and CLI style.
// Imported by the entry (`worker-smoke.ts`), `lifecycle.ts` and
// `scenarios.ts`. Each child smoke process (`--worker elysia|axum|cloudflare`)
// evaluates this module with its own explicit worker, so module-level values
// are per-process and never leak between all-workers runs.

import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { formatter, SYM } from "../src/log.ts";

// --- configuration (env vars + `--key=value` / `--key value` flags) --------

const parsed = parseArgs({
  args: process.argv.slice(2),
  options: {
    "no-spawn": { type: "boolean" },
    worker: { type: "string" },
    "mock-port": { type: "string" },
    "worker-port": { type: "string" },
    "mock-url": { type: "string" },
    "worker-url": { type: "string" },
    "server-id": { type: "string" },
  },
  strict: true,
});

export function setting(flag: keyof typeof parsed.values, env: string): string | undefined {
  const value = parsed.values[flag];
  return (typeof value === "string" ? value : undefined) ?? Bun.env[env];
}

export const WORKER_DEFAULT_PORTS = { elysia: 5000, axum: 7674, cloudflare: 8787 } as const;
export type WorkerKind = keyof typeof WORKER_DEFAULT_PORTS;
export const WORKERS: readonly WorkerKind[] = ["elysia", "axum", "cloudflare"];

// Shared CLI formatter; plain (no ANSI) when not an interactive TTY.
export const f = formatter();

export const explicitWorker = setting("worker", "SMOKE_WORKER");
if (explicitWorker !== undefined && !(WORKERS as readonly string[]).includes(explicitWorker)) {
  console.error(
    `${f.failure(SYM.fail)} ${f.accent("smoke")} fatal: unknown worker "${explicitWorker}"; ` +
      `expected ${WORKERS.map((worker) => `"${worker}"`).join(", ")}`,
  );
  process.exit(1);
}

// In all-workers mode (no explicit `--worker`) this process only orchestrates
// children and never uses the worker-specific values below; the fallback keeps
// module evaluation total, while every child has an explicit worker.
export const workerKind: WorkerKind = (explicitWorker ?? "elysia") as WorkerKind;

export const spawnMode = !parsed.values["no-spawn"] && Bun.env.NO_SPAWN !== "1";
export const mockPort = Number(setting("mock-port", "MOCK_PORT") ?? 3001);
export const workerPort = Number(
  setting("worker-port", "WORKER_PORT") ?? WORKER_DEFAULT_PORTS[workerKind],
);
export const workerUrl = setting("worker-url", "WORKER_URL") ?? `http://127.0.0.1:${workerPort}`;
export const mockUrl = setting("mock-url", "MOCK_URL") ?? `http://127.0.0.1:${mockPort}`;
export const timeoutMs = Number(Bun.env.SMOKE_TIMEOUT_MS ?? 15000);

// `X-VOT-SERVER-ID` scenario: spawn mode starts every worker with this id, so
// the header is asserted on success and error responses. With `--no-spawn` the
// running worker decides: pass `--server-id`/`SERVER_ID` to assert a value,
// otherwise absence is asserted.
export const spawnServerId = "smoke-server-id";
export const expectedServerId =
  setting("server-id", "SERVER_ID") ?? (spawnMode ? spawnServerId : undefined);

// Workers read their Yandex upstream from `YANDEX_API_URL` (production
// default `https://api.browser.yandex.ru`), so a spawned mock must listen
// exactly there.
export const WORKER_UPSTREAM_PORT = 3001;
export const WORKER_UPSTREAM_URL = `http://127.0.0.1:${WORKER_UPSTREAM_PORT}`;

export const smokeDir = resolve(import.meta.dir);
export const mockDir = resolve(smokeDir, "..");
export const workerDir = resolve(mockDir, "..", workerKind);

export const invalidPayloadStatus = "error-request";

export const FAILED_MESSAGE = "Возникла ошибка при переводе, попробуйте позже";
