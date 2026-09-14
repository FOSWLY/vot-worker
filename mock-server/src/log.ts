// Small dependency-free CLI formatter shared by mock-server and the worker
// smoke test, so ANSI sequences live in one place. Color is opt-in: emitted
// only on an interactive TTY, never when NO_COLOR is set (any value) or
// TERM=dumb, and never when `console` has been replaced (test spies) — this
// keeps piped/test output parseable and free of escape codes.

export const SYM = {
  node: "◆",
  arrow: "→",
  ok: "✓",
  fail: "✗",
  skip: "–",
} as const;

export interface Palette {
  accent(s: string): string;
  success(s: string): string;
  failure(s: string): string;
  skip(s: string): string;
  dim(s: string): string;
  /** Orange (ANSI 256-color 208) for worker names. */
  worker(s: string): string;
}

export interface Formatter extends Palette {
  readonly color: boolean;
  /** HTTP status: green 2xx, cyan 3xx, red 4xx/5xx. */
  status(status: number): string;
}

const id = (s: string): string => s;
const ansi = (code: number | string) => (s: string): string => `\u001b[${code}m${s}\u001b[0m`;

// Captured before any test spy installs itself; a swapped `console` disables
// color so plain machine-readable output is preserved.
const nativeLog = console.log;
const nativeError = console.error;

function consoleIntercepted(): boolean {
  return console.log !== nativeLog || console.error !== nativeError;
}

export function useColor(stream: { isTTY?: boolean } = process.stdout): boolean {
  if (process.env.NO_COLOR !== undefined) return false;
  if (process.env.TERM === "dumb") return false;
  return Boolean(stream.isTTY) && !consoleIntercepted();
}

function paintStatus(
  status: number,
  f: Pick<Palette, "accent" | "success" | "failure">,
): string {
  if (status >= 400) return f.failure(String(status));
  if (status >= 300) return f.accent(String(status));
  return f.success(String(status));
}

export function formatter(stream: { isTTY?: boolean } = process.stdout): Formatter {
  if (!useColor(stream)) {
    const plain: Formatter = {
      color: false,
      accent: id,
      success: id,
      failure: id,
      skip: id,
      dim: id,
      worker: id,
      status: (status) => String(status),
    };
    return plain;
  }
  const f: Formatter = {
    color: true,
    accent: ansi(36),
    success: ansi(32),
    failure: ansi(31),
    skip: ansi(33),
    dim: ansi(2),
    worker: ansi("38;5;208"),
    status: (status) => paintStatus(status, f),
  };
  return f;
}
