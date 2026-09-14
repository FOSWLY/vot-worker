import { Elysia } from "elysia";
import { ProtoValidationError } from "elysia-protobuf/error";
import { getSecYaHeaders, getSignature } from "@vot.js/shared/secure";
import type { ClientSession } from "@vot.js/shared/types/secure";
import { formatter, SYM } from "./log.ts";

export const PROTOBUF = "application/x-protobuf";

// Logs an actual runtime exception with minimal request context. Only method
// and pathname are recorded: bodies, signatures, tokens, SK values, cookies,
// and full headers must never reach the logs.
export function logRequestError(context: string, request: Request, error: unknown): void {
  if (!(error instanceof Error)) return;
  const pathname = new URL(request.url).pathname;
  const f = formatter(process.stderr);
  if (!f.color) {
    console.error(`[mock-server] ${context} ${request.method} ${pathname}`, error);
    return;
  }
  console.error(
    `${f.failure(SYM.fail)} ${f.accent("mock-server")} ${f.dim(context)} ` +
      `${f.dim(`${request.method} ${pathname}`)}`,
    error,
  );
}

type SecType = "Vtrans" | "Vsubs";

export type SecRequirement = { secType: SecType } | { signatureOnly: true };

// Yandex balancer rejection: 415 for a non-protobuf Content-Type, 400 for an
// empty/unreadable/undecodable protobuf body, 402 for invalid sec headers. The
// id is regenerated per response; fixed 16/19-digit widths keep the body length
// stable.
const BALANCER_SUFFIX = "rtc-balancer-api-browser-yandex-net-1337-BAL";

function randomDigits(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let digits = "";
  for (const byte of bytes) digits += byte % 10;
  return digits;
}

function yandexReqId(): string {
  return `${randomDigits(16)}-${randomDigits(19)}-${BALANCER_SUFFIX}`;
}

// 60..180 inclusive, sampled fresh per response.
export function randomRemainingTime(): number {
  return 60 + Math.floor(Math.random() * 121);
}

export function serverError(status = 415): Response {
  const requestId = yandexReqId();
  const body = `(error_id:${requestId}) see logs for details`;
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/plain",
      "content-length": String(body.length),
      "x-yandex-req-id": requestId,
    },
  });
}

// Minimal media-type parse: a missing header is not protobuf. The type is
// case-insensitive and may carry MIME parameters
// (`application/x-protobuf; charset=utf-8`).
function isProtobufContentType(request: Request): boolean {
  const header = request.headers.get("content-type");
  return header !== null && header.split(";")[0]!.trim().toLowerCase() === PROTOBUF;
}

// `SKIP_SEC_VALIDATION=true` (case-insensitive) disables sec-header validation
// for local mock use. Any other/unset value keeps the checks. The flag only
// bypasses 402: protobuf Content-Type (415) and body decoding (400) still run.
function isSecValidationSkipped(): boolean {
  return process.env.SKIP_SEC_VALIDATION?.toLowerCase() === "true";
}

// Recomputes the full expected header set with shared `getSecYaHeaders`
// (same function the real client uses) and requires every header to match.
// Header names compare case-insensitively via `Headers.get`; values exactly.
// The UUID is taken from the sec token (`sign:uuid:path:version`), so an
// unknown/unissued UUID, a wrong path/version, a wrong secret, a tampered
// body, or a cross-type (Vtrans vs Vsubs) token all fail the comparison.
// Query strings never affect the signed path: only `pathname` is used.
async function checkSecHeaders(
  secType: SecType,
  sessions: Map<string, ClientSession>,
  request: Request,
  body: Uint8Array,
): Promise<boolean> {
  const sig = request.headers.get(`${secType}-Signature`);
  const sk = request.headers.get(`Sec-${secType}-Sk`);
  const token = request.headers.get(`Sec-${secType}-Token`);
  if (!sig || !sk || !token) return false;
  const parts = token.split(":");
  if (parts.length < 4) return false;
  const uuid = parts[1];
  if (!uuid) return false;
  const session = sessions.get(uuid);
  if (!session) return false;
  const pathname = new URL(request.url).pathname;
  const expected: Record<string, string> = await getSecYaHeaders(secType, session, body, pathname);
  return (
    sig === expected[`${secType}-Signature`] &&
    sk === expected[`Sec-${secType}-Sk`] &&
    token === expected[`Sec-${secType}-Token`]
  );
}

// `/session/create` has no session yet, so only the raw-body HMAC is checked:
// the client sends `Vtrans-Signature` (`getSignature(body)`) and neither
// `Sec-Vtrans-Sk` nor `Sec-Vtrans-Token` is required.
async function checkSignature(request: Request, body: Uint8Array): Promise<boolean> {
  const sig = request.headers.get("Vtrans-Signature");
  if (!sig) return false;
  return sig === (await getSignature(body));
}

// The seven protobuf method+pathname pairs. Single source of truth for which
// requests get raw-byte stashing, Content-Type normalization, and package
// error mapping. Every other route (health, fail-audio-js, assets) bypasses
// protobuf plumbing entirely, keeping its exact prior behavior (e.g. the
// fail-audio-js handler keeps catching its own malformed-JSON errors).
const PROTOBUF_ROUTE_KEYS = new Set([
  "POST /session/create",
  "POST /video-translation/translate",
  "PUT /video-translation/audio",
  "POST /video-translation/cache",
  "POST /video-subtitles/get-subtitles",
  "POST /stream-translation/translate-stream",
  "POST /stream-translation/ping-stream",
]);

function isProtobufRoute(request: Request): boolean {
  let pathname: string;
  try {
    pathname = new URL(request.url).pathname;
  } catch {
    return false;
  }
  return PROTOBUF_ROUTE_KEYS.has(`${request.method} ${pathname}`);
}

// Package-native protobuf plumbing for every protobuf route. `protobuf()` (the
// elysia-protobuf parser) is registered on the root instance in `app.ts`; this
// factory owns everything around it that the package cannot model:
//
// - the exact incoming raw bytes per request (signature validation must run on
//   the received bytes, never on a re-encoded message),
// - case/parameter-tolerant Content-Type handling (the package parser matches
//   the media type exactly),
// - the strict 415 -> 400 -> 402 error precedence with balancer bodies,
// - sec validation against `@vot.js/shared/secure` (Yandex sessions, not a
//   static package secret).
//
// The raw store is created per `buildApp` call. Entries are keyed by the live
// `Request` object (verified identical across onRequest/parse/beforeHandle/
// onError) and vanish with it; bodies and secrets are never logged.
export function createProtobufProtocol(sessions: Map<string, ClientSession>): {
  plugin: (app: Elysia) => Elysia;
  guard: (sec: SecRequirement) => (context: { request: Request }) => Promise<void>;
} {
  // Read once when this factory runs (i.e. once per `buildApp` instance), so
  // toggling the env later cannot change an app already built.
  const skipSec = isSecValidationSkipped();
  // Exact received bytes for signature validation. Only non-empty bodies are
  // stored: a missing entry means empty/unreadable, which is a 400.
  const rawBodies = new WeakMap<Request, Uint8Array>();
  // Requests whose body decoded successfully (the guard only runs after the
  // package decoded the body). A `ProtoValidationError` for one of these can
  // only come from response encoding, which is a server bug, not a 400.
  const decodedBodies = new WeakSet<Request>();

  // Centralized pre-parse hook, scoped to protobuf routes: snapshot the raw
  // bytes from a clone so the package parser stream stays intact, then
  // normalize an accepted Content-Type to the exact media type the package
  // parser matches. Other routes are untouched (their bodies stay unread).
  async function stashRequest({ request }: { request: Request }): Promise<void> {
    if (!isProtobufRoute(request)) return;
    try {
      const bytes = new Uint8Array(await request.clone().arrayBuffer());
      if (bytes.length) rawBodies.set(request, bytes);
    } catch (error) {
      logRequestError("failed to read request body", request, error);
    }
    if (isProtobufContentType(request)) request.headers.set("content-type", PROTOBUF);
  }

  // Maps package/parser failures to the balancer errors, scoped to protobuf
  // routes: other routes keep Elysia's default error behavior (and their own
  // handler-caught errors). Runs before the guard, so decode problems are 400
  // even with valid sec headers (and sec problems never surface here:
  // undecodable bodies never reach the guard). Thrown balancer `Response`s
  // (see `guard`) also pass through here with code UNKNOWN: they are returned
  // as-is, never logged, never remapped.
  // The parameter is a structural subset of Elysia's error context (which also
  // carries `set`/`store`/derive state we never touch); it is wired through a
  // contextually-typed inline closure in `plugin` below so this stays
  // decoupled from Elysia's generic hook types.
  function protobufError({
    code,
    error,
    request,
  }: {
    code: unknown;
    error: unknown;
    request: Request;
  }): Response | void {
    if (error instanceof Response) return;
    // Scoped to protobuf routes: anything else (fail-audio-js JSON parsing,
    // asset errors, 404s) keeps Elysia's default handling.
    if (!isProtobufRoute(request)) {
      if (code === "UNKNOWN" || code === "INTERNAL_SERVER_ERROR") {
        logRequestError("unhandled error", request, error);
      }
      return;
    }
    if (code === "PARSE" || code === "VALIDATION" || error instanceof ProtoValidationError) {
      if (error instanceof ProtoValidationError && decodedBodies.has(request)) return;
      if (!isProtobufContentType(request)) return serverError(415);
      // The package parser only throws for an unreadable body, which was
      // already logged while stashing: stay silent to log once.
      if (code === "PARSE") return serverError(400);
      const cause = (error as { cause?: unknown }).cause;
      logRequestError(
        "failed to decode protobuf body",
        request,
        cause instanceof Error ? cause : error,
      );
      return serverError(400);
    }
    if (code === "UNKNOWN" || code === "INTERNAL_SERVER_ERROR") {
      logRequestError("unhandled error", request, error);
    }
  }

  // Shared guard for every protobuf route, run as `beforeHandle` after the
  // package decoded `body`. Ordering is strict: a non-protobuf Content-Type is
  // 415, then an empty/unreadable body is 400, then sec headers are 402.
  // Security runs on the exact raw bytes stashed before parsing.
  // Rejections are THROWN, not returned: Elysia's route `beforeHandle` public
  // typings only accept the decoded response shape (or void) as a return, so a
  // returned balancer `Response` does not typecheck. A thrown `Response` is
  // used verbatim as the final response (status/headers/body preserved, still
  // mapped for CORS and logged once by `onAfterResponse`), while the `void`
  // return keeps this assignable to the hook type.
  function guard(sec: SecRequirement) {
    return async ({ request }: { request: Request }): Promise<void> => {
      if (!isProtobufContentType(request)) throw serverError(415);
      const raw = rawBodies.get(request);
      // Empty/unreadable: even a signed malformed body is 400, never 402.
      if (!raw) throw serverError(400);
      decodedBodies.add(request);
      // Sec validation runs on the exact raw bytes, only for valid protobuf.
      if (!skipSec) {
        const ok =
          "signatureOnly" in sec
            ? await checkSignature(request, raw)
            : await checkSecHeaders(sec.secType, sessions, request, raw);
        if (!ok) throw serverError(402);
      }
    };
  }

  // A function plugin (not a nested instance): `use()` applies it to the root
  // instance itself, so the hooks below run for the root routes. Hooks of a
  // nested Elysia instance would stay scoped to that instance and never see
  // the root's parse/validation errors. The inline `onError` closure only
  // forwards to `protobufError`, gaining full contextual typing while the
  // logic itself stays unit-decoupled from Elysia generics. It destructures
  // `code`/`error`/`request` instead of forwarding the whole context: Elysia's
  // sucrose analyzes hook sources per route, and a whole-context forward would
  // mark `body` as used everywhere, switching on default body parsing for
  // schemaless routes (e.g. fail-audio-js would get its JSON pre-parsed).
  function plugin(app: Elysia): Elysia {
    return app
      .onRequest(stashRequest)
      .onError(({ code, error, request }) => protobufError({ code, error, request }));
  }
  return { plugin, guard };
}
