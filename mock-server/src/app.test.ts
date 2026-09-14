import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { protos } from "@vot.js/shared";
import { getSecYaHeaders, getSignature, getUUID } from "@vot.js/shared/secure";
import type { ClientSession } from "@vot.js/shared/types/secure";
import type { MessageFns } from "@vot.js/shared/protos";
import { buildApp } from "./app.ts";

const ORIGIN = "http://localhost";

// Capture console.error and console.log for every test so intentional
// error-path requests and access logs do not spam the test output, and restore
// the real ones afterwards. The two spies are independent: error-logging tests
// assert against `errorCalls`, access-logging tests against `logCalls`.
const realConsoleError = console.error;
const realConsoleLog = console.log;
let errorCalls: unknown[][] = [];
let logCalls: unknown[][] = [];
beforeEach(async () => {
  console.error = (...args: unknown[]) => {
    errorCalls.push(args);
  };
  console.log = (...args: unknown[]) => {
    logCalls.push(args);
  };
  // Drain access-log callbacks left pending by the previous test before
  // clearing the captured calls, so they cannot leak into this test.
  await flushAccessLog();
  errorCalls = [];
  logCalls = [];
});
afterEach(() => {
  console.error = realConsoleError;
  console.log = realConsoleLog;
  delete process.env.SKIP_SEC_VALIDATION;
});
// `SKIP_SEC_VALIDATION` is read when `buildApp()` registers its routes, so it
// must be cleared before every test as well: a leaked value would silently
// disable sec validation for unrelated apps.
beforeEach(() => {
  delete process.env.SKIP_SEC_VALIDATION;
});

// Elysia schedules `onAfterResponse` with `setImmediate`, after `app.handle`
// has already resolved, so wait one macrotask before asserting on `logCalls`.
async function flushAccessLog(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

// Access lines logged during a call, one string per console.log invocation.
function accessLines(): string[] {
  return logCalls.map((args) => args.map(String).join(" "));
}

// Send one request and return its response plus the access lines it produced.
async function handleAndLog(
  app: ReturnType<typeof buildApp>,
  request: Request,
): Promise<{ res: Response; lines: string[] }> {
  logCalls = [];
  const res = await app.handle(request);
  await flushAccessLog();
  return { res, lines: accessLines() };
}

type ReqBody = ConstructorParameters<typeof Request>[1] extends { body?: infer B }
  ? NonNullable<B>
  : never;

function pbRequest(path: string, message: MessageFns<any>, value: any, method = "POST"): Request {
  const bytes = message.encode(message.fromPartial(value)).finish();
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: { "content-type": "application/x-protobuf" },
    body: bytes as unknown as ReqBody,
  });
}

async function decode<T>(res: Response, message: MessageFns<T>): Promise<T> {
  expect(res.headers.get("content-type")).toBe("application/x-protobuf");
  return message.decode(new Uint8Array(await res.arrayBuffer()));
}

// A session issued by this app instance, plus enough ClientSession fields to
// sign with the same public shared `getSecYaHeaders` the real client uses.
async function sessionBytes(uuid = getUUID()): Promise<Uint8Array> {
  return protos.YandexSessionRequest.encode(
    protos.YandexSessionRequest.fromPartial({ uuid, module: "video-translation" }),
  ).finish();
}

// `/session/create` only requires the raw-body `Vtrans-Signature`.
function sessionRequest(bytes: Uint8Array, signature?: string): Request {
  return rawSignedRequest(
    "/session/create",
    bytes,
    signature === undefined ? {} : { "Vtrans-Signature": signature },
  );
}

async function createSession(
  app: ReturnType<typeof buildApp>,
  uuid = getUUID(),
): Promise<ClientSession> {
  const bytes = await sessionBytes(uuid);
  const res = await app.handle(sessionRequest(bytes, await getSignature(bytes)));
  expect(res.status).toBe(200);
  const body = await decode(res, protos.YandexSessionResponse);
  return {
    uuid,
    secretKey: body.secretKey,
    expires: body.expires,
    timestamp: Math.floor(Date.now() / 1000),
  };
}

async function signedRequest(
  path: string,
  message: MessageFns<any>,
  value: any,
  secType: "Vtrans" | "Vsubs",
  session: ClientSession,
  method = "POST",
  query = "",
): Promise<Request> {
  const bytes = message.encode(message.fromPartial(value)).finish();
  const secHeaders = await getSecYaHeaders(secType, session, bytes, path);
  return new Request(`${ORIGIN}${path}${query}`, {
    method,
    headers: { "content-type": "application/x-protobuf", ...secHeaders },
    body: bytes as unknown as ReqBody,
  });
}

function rawSignedRequest(
  path: string,
  bytes: Uint8Array,
  secHeaders: Record<string, string>,
  method = "POST",
): Request {
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: { "content-type": "application/x-protobuf", ...secHeaders },
    body: bytes as unknown as ReqBody,
  });
}

function expectRemainingTime(value: number | undefined): void {
  expect(Number.isInteger(value)).toBe(true);
  expect(value).toBeGreaterThanOrEqual(60);
  expect(value).toBeLessThanOrEqual(180);
}

async function audioUpload(
  session: ClientSession,
  translationId: string,
  url: string,
  value: Record<string, unknown>,
): Promise<Request> {
  return signedRequest(
    "/video-translation/audio",
    protos.VideoTranslationAudioRequest,
    { translationId, url, ...value },
    "Vtrans",
    session,
    "PUT",
  );
}

// One partial chunk carrying a buffer at the given zero-based id.
function partialChunk(audioPartsLength: number, chunkId: number): Record<string, unknown> {
  return {
    partialAudioInfo: {
      audioPartsLength,
      audioBuffer: { chunkId, audioFile: new Uint8Array([1]) },
    },
  };
}

const REQ_ID_RE = /^\d{16}-\d{19}-rtc-balancer-api-browser-yandex-net-1337-BAL$/;
const ERROR_BODY_RE = /^\(error_id:(\S+)\) see logs for details$/;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const AUDIO_URL_RE = new RegExp(`^${ORIGIN}/tts/prod/${UUID}\\.mp3$`, "i");
const AUDIO_PATH_RE = new RegExp(`/tts/prod/${UUID}\\.mp3`, "i");
const SOURCE_URL_RE = new RegExp(`^${ORIGIN}/vtrans/${UUID}$`, "i");
const TRANSLATED_URL_RE = new RegExp(`^${ORIGIN}/vtrans/translated/${UUID}$`, "i");
const TEST_UUID = "123e4567-e89b-12d3-a456-426614174000";

interface ProtoRoute {
  path: string;
  method: string;
  message: MessageFns<any>;
  value: any;
  // undefined => signature-only `/session/create`
  secType?: "Vtrans" | "Vsubs";
}

const PROTOBUF_ROUTES: ProtoRoute[] = [
  {
    path: "/session/create",
    method: "POST",
    message: protos.YandexSessionRequest,
    value: { uuid: TEST_UUID, module: "video-translation" },
  },
  {
    path: "/video-translation/translate",
    method: "POST",
    message: protos.VideoTranslationRequest,
    value: {
      url: "https://youtu.be/x",
      firstRequest: true,
      duration: 60,
      language: "en",
      responseLanguage: "ru",
    },
    secType: "Vtrans",
  },
  {
    path: "/video-translation/audio",
    method: "PUT",
    message: protos.VideoTranslationAudioRequest,
    value: { translationId: "1", url: "https://youtu.be/x" },
    secType: "Vtrans",
  },
  {
    path: "/video-translation/cache",
    method: "POST",
    message: protos.VideoTranslationCacheRequest,
    value: { url: "https://youtu.be/x", duration: 10, language: "en", responseLanguage: "ru" },
    secType: "Vtrans",
  },
  {
    path: "/video-subtitles/get-subtitles",
    method: "POST",
    message: protos.SubtitlesRequest,
    value: { url: "https://youtu.be/x", language: "en" },
    secType: "Vsubs",
  },
  {
    path: "/stream-translation/translate-stream",
    method: "POST",
    message: protos.StreamTranslationRequest,
    value: { url: "https://example.com/live.m3u8", language: "en", responseLanguage: "ru" },
    secType: "Vtrans",
  },
  {
    path: "/stream-translation/ping-stream",
    method: "POST",
    message: protos.StreamPingRequest,
    value: { pingId: 1 },
    secType: "Vtrans",
  },
];

const PROTECTED_ROUTES = PROTOBUF_ROUTES.filter(
  (route): route is ProtoRoute & { secType: "Vtrans" | "Vsubs" } => route.secType !== undefined,
);

const MALFORMED_PROTOBUF = new Uint8Array([255, 255, 255, 255, 255]) as unknown as ReqBody;
const MALFORMED_BYTES = new Uint8Array([255, 255, 255, 255, 255]);

async function expectCapturedError(res: Response, status = 415): Promise<string> {
  expect(res.status).toBe(status);
  expect(res.headers.get("content-type")).toBe("text/plain");
  const requestId = res.headers.get("x-yandex-req-id") ?? "";
  expect(requestId).toMatch(REQ_ID_RE);
  const body = await res.text();
  const match = ERROR_BODY_RE.exec(body);
  expect(match?.[1]).toBe(requestId);
  // Length derives from the current format/suffix, not a hardcoded constant.
  const expectedBody = `(error_id:${requestId}) see logs for details`;
  expect(body).toBe(expectedBody);
  expect(res.headers.get("content-length")).toBe(
    String(new TextEncoder().encode(expectedBody).byteLength),
  );
  return requestId;
}

async function expectForbidden(res: Response): Promise<void> {
  await expectCapturedError(res, 402);
}

describe("protobuf content type and parsing errors", () => {
  test("application/json body that is not protobuf -> 415", async () => {
    const app = buildApp();
    const res = await app.handle(
      new Request(`${ORIGIN}/session/create`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ not: "protobuf" }),
      }),
    );
    await expectCapturedError(res, 415);
  });

  test("two invalid requests get different request ids", async () => {
    const app = buildApp();
    const req = () =>
      app.handle(
        new Request(`${ORIGIN}/session/create`, {
          method: "POST",
          headers: { "content-type": "application/x-protobuf" },
          body: MALFORMED_PROTOBUF,
        }),
      );
    const first = await expectCapturedError(await req(), 400);
    const second = await expectCapturedError(await req(), 400);
    expect(first).not.toBe(second);
  });

  for (const route of PROTOBUF_ROUTES) {
    const label = `${route.method} ${route.path}`;
    const bytes = (): Uint8Array =>
      route.message.encode(route.message.fromPartial(route.value)).finish();

    for (const contentType of ["application/json", "text/plain"]) {
      test(`${label} ${contentType} content type -> 415`, async () => {
        const app = buildApp();
        const res = await app.handle(
          new Request(`${ORIGIN}${route.path}`, {
            method: route.method,
            headers: { "content-type": contentType },
            body: bytes() as unknown as ReqBody,
          }),
        );
        await expectCapturedError(res, 415);
      });
    }

    test(`${label} missing content type -> 415`, async () => {
      const app = buildApp();
      const res = await app.handle(
        new Request(`${ORIGIN}${route.path}`, {
          method: route.method,
          body: bytes() as unknown as ReqBody,
        }),
      );
      await expectCapturedError(res, 415);
    });

    test(`${label} protobuf malformed bytes -> 400`, async () => {
      const app = buildApp();
      const res = await app.handle(
        new Request(`${ORIGIN}${route.path}`, {
          method: route.method,
          headers: { "content-type": "application/x-protobuf" },
          body: MALFORMED_PROTOBUF,
        }),
      );
      await expectCapturedError(res, 400);
    });

    test(`${label} protobuf empty body -> 400`, async () => {
      const app = buildApp();
      const res = await app.handle(
        new Request(`${ORIGIN}${route.path}`, {
          method: route.method,
          headers: { "content-type": "application/x-protobuf" },
        }),
      );
      await expectCapturedError(res, 400);
    });

    test(`${label} valid protobuf without sec -> 402`, async () => {
      const app = buildApp();
      const res = await app.handle(pbRequest(route.path, route.message, route.value, route.method));
      await expectCapturedError(res, 402);
    });
  }

  test("protobuf content type is case-insensitive and allows MIME parameters", async () => {
    const app = buildApp();
    const session = await createSession(app);
    const cacheBytes = protos.VideoTranslationCacheRequest.encode(
      protos.VideoTranslationCacheRequest.fromPartial({
        url: "https://youtu.be/x",
        duration: 10,
        language: "en",
        responseLanguage: "ru",
      }),
    ).finish();
    const cacheSec = await getSecYaHeaders(
      "Vtrans",
      session,
      cacheBytes,
      "/video-translation/cache",
    );
    for (const contentType of [
      "Application/X-Protobuf",
      "application/x-protobuf; charset=utf-8",
      "  APPLICATION/X-PROTOBUF ;charset=binary  ",
    ]) {
      const res = await app.handle(
        new Request(`${ORIGIN}/video-translation/cache`, {
          method: "POST",
          headers: { "content-type": contentType, ...cacheSec },
          body: cacheBytes as unknown as ReqBody,
        }),
      );
      expect(res.status).toBe(200);
      await decode(res, protos.VideoTranslationCacheResponse);
    }

    const sessionBody = await sessionBytes();
    const sessionRes = await app.handle(
      new Request(`${ORIGIN}/session/create`, {
        method: "POST",
        headers: {
          "content-type": "Application/X-Protobuf; charset=utf-8",
          "Vtrans-Signature": await getSignature(sessionBody),
        },
        body: sessionBody as unknown as ReqBody,
      }),
    );
    expect(sessionRes.status).toBe(200);
    await decode(sessionRes, protos.YandexSessionResponse);
  });
});

describe("sec header validation", () => {
  for (const route of PROTECTED_ROUTES) {
    test(`${route.method} ${route.path} without sec headers -> 402`, async () => {
      const app = buildApp();
      await createSession(app);
      const res = await app.handle(pbRequest(route.path, route.message, route.value, route.method));
      await expectForbidden(res);
    });

    test(`${route.method} ${route.path} with valid sec headers -> 200`, async () => {
      const app = buildApp();
      const session = await createSession(app);
      const res = await app.handle(
        await signedRequest(
          route.path,
          route.message,
          route.value,
          route.secType,
          session,
          route.method,
        ),
      );
      expect(res.status).toBe(200);
    });
  }

  test("query string does not affect the signed path", async () => {
    const app = buildApp();
    const session = await createSession(app);
    const res = await app.handle(
      await signedRequest(
        "/video-translation/translate",
        protos.VideoTranslationRequest,
        {
          url: "https://youtu.be/x",
          firstRequest: true,
          duration: 60,
          language: "en",
          responseLanguage: "ru",
        },
        "Vtrans",
        session,
        "POST",
        "?foo=bar&x=1",
      ),
    );
    expect(res.status).toBe(200);
  });

  test("lowercase sec header names are accepted", async () => {
    const app = buildApp();
    const session = await createSession(app);
    const bytes = protos.StreamPingRequest.encode(
      protos.StreamPingRequest.fromPartial({ pingId: 1 }),
    ).finish();
    const secHeaders = await getSecYaHeaders(
      "Vtrans",
      session,
      bytes,
      "/stream-translation/ping-stream",
    );
    const lowered: Record<string, string> = {};
    for (const [k, v] of Object.entries(secHeaders)) lowered[k.toLowerCase()] = v;
    const res = await app.handle(
      rawSignedRequest("/stream-translation/ping-stream", bytes, lowered),
    );
    expect(res.status).toBe(200);
  });

  test("bad signature -> 402", async () => {
    const app = buildApp();
    const session = await createSession(app);
    const bytes = protos.VideoTranslationCacheRequest.encode(
      protos.VideoTranslationCacheRequest.fromPartial({
        url: "https://youtu.be/x",
        duration: 10,
        language: "en",
        responseLanguage: "ru",
      }),
    ).finish();
    const secHeaders = await getSecYaHeaders("Vtrans", session, bytes, "/video-translation/cache");
    const tampered = {
      ...secHeaders,
      "Vtrans-Signature": `0${secHeaders["Vtrans-Signature"].slice(1)}`,
    };
    const res = await app.handle(rawSignedRequest("/video-translation/cache", bytes, tampered));
    await expectForbidden(res);
  });

  test("bad secret key -> 402", async () => {
    const app = buildApp();
    const session = await createSession(app);
    const bytes = protos.VideoTranslationCacheRequest.encode(
      protos.VideoTranslationCacheRequest.fromPartial({
        url: "https://youtu.be/x",
        duration: 10,
        language: "en",
        responseLanguage: "ru",
      }),
    ).finish();
    const secHeaders = await getSecYaHeaders("Vtrans", session, bytes, "/video-translation/cache");
    const res = await app.handle(
      rawSignedRequest("/video-translation/cache", bytes, {
        ...secHeaders,
        "Sec-Vtrans-Sk": "deadbeef:0:3600",
      }),
    );
    await expectForbidden(res);
  });

  test("token signed for a different path -> 402", async () => {
    const app = buildApp();
    const session = await createSession(app);
    const bytes = protos.VideoTranslationRequest.encode(
      protos.VideoTranslationRequest.fromPartial({
        url: "https://youtu.be/x",
        firstRequest: true,
        duration: 60,
        language: "en",
        responseLanguage: "ru",
      }),
    ).finish();
    const secHeaders = await getSecYaHeaders("Vtrans", session, bytes, "/video-translation/cache");
    const res = await app.handle(
      rawSignedRequest("/video-translation/translate", bytes, secHeaders),
    );
    await expectForbidden(res);
  });

  test("token with wrong version -> 402", async () => {
    const app = buildApp();
    const session = await createSession(app);
    const bytes = protos.VideoTranslationCacheRequest.encode(
      protos.VideoTranslationCacheRequest.fromPartial({
        url: "https://youtu.be/x",
        duration: 10,
        language: "en",
        responseLanguage: "ru",
      }),
    ).finish();
    const secHeaders = await getSecYaHeaders("Vtrans", session, bytes, "/video-translation/cache");
    const parts = secHeaders["Sec-Vtrans-Token"].split(":");
    const tampered = {
      ...secHeaders,
      "Sec-Vtrans-Token": `${parts[0]}:${parts[1]}:${parts[2]}:0.0.0.0`,
    };
    const res = await app.handle(rawSignedRequest("/video-translation/cache", bytes, tampered));
    await expectForbidden(res);
  });

  test("Vtrans headers do not authorize Vsubs and vice versa -> 402", async () => {
    const app = buildApp();
    const session = await createSession(app);
    const subBytes = protos.SubtitlesRequest.encode(
      protos.SubtitlesRequest.fromPartial({ url: "https://youtu.be/x", language: "en" }),
    ).finish();
    const vtransHeaders = await getSecYaHeaders(
      "Vtrans",
      session,
      subBytes,
      "/video-subtitles/get-subtitles",
    );
    const vsubsRes = await app.handle(
      rawSignedRequest("/video-subtitles/get-subtitles", subBytes, vtransHeaders),
    );
    await expectForbidden(vsubsRes);

    const cacheBytes = protos.VideoTranslationCacheRequest.encode(
      protos.VideoTranslationCacheRequest.fromPartial({
        url: "https://youtu.be/x",
        duration: 10,
        language: "en",
        responseLanguage: "ru",
      }),
    ).finish();
    const vsubsHeaders = await getSecYaHeaders(
      "Vsubs",
      session,
      cacheBytes,
      "/video-translation/cache",
    );
    const vtransRes = await app.handle(
      rawSignedRequest("/video-translation/cache", cacheBytes, vsubsHeaders),
    );
    await expectForbidden(vtransRes);
  });

  test("unknown session uuid -> 402", async () => {
    const app = buildApp();
    await createSession(app);
    const stranger: ClientSession = {
      uuid: getUUID(),
      secretKey: "deadbeef:0:3600",
      expires: 3600,
      timestamp: Math.floor(Date.now() / 1000),
    };
    const res = await app.handle(
      await signedRequest(
        "/video-translation/cache",
        protos.VideoTranslationCacheRequest,
        { url: "https://youtu.be/x", duration: 10, language: "en", responseLanguage: "ru" },
        "Vtrans",
        stranger,
      ),
    );
    await expectForbidden(res);
  });

  test("session from another app instance is unknown -> 402", async () => {
    const app = buildApp();
    const otherSession = await createSession(buildApp());
    const res = await app.handle(
      await signedRequest(
        "/video-translation/cache",
        protos.VideoTranslationCacheRequest,
        { url: "https://youtu.be/x", duration: 10, language: "en", responseLanguage: "ru" },
        "Vtrans",
        otherSession,
      ),
    );
    await expectForbidden(res);
  });

  test("malformed token -> 402", async () => {
    const app = buildApp();
    const session = await createSession(app);
    const bytes = protos.StreamPingRequest.encode(
      protos.StreamPingRequest.fromPartial({ pingId: 1 }),
    ).finish();
    const secHeaders = await getSecYaHeaders(
      "Vtrans",
      session,
      bytes,
      "/stream-translation/ping-stream",
    );
    const res = await app.handle(
      rawSignedRequest("/stream-translation/ping-stream", bytes, {
        ...secHeaders,
        "Sec-Vtrans-Token": "not-a-token",
      }),
    );
    await expectForbidden(res);
  });

  test("tampered body -> 402", async () => {
    const app = buildApp();
    const session = await createSession(app);
    const signedBytes = protos.VideoTranslationCacheRequest.encode(
      protos.VideoTranslationCacheRequest.fromPartial({
        url: "https://youtu.be/original",
        duration: 10,
        language: "en",
        responseLanguage: "ru",
      }),
    ).finish();
    const secHeaders = await getSecYaHeaders(
      "Vtrans",
      session,
      signedBytes,
      "/video-translation/cache",
    );
    const tamperedBytes = protos.VideoTranslationCacheRequest.encode(
      protos.VideoTranslationCacheRequest.fromPartial({
        url: "https://youtu.be/tampered",
        duration: 10,
        language: "en",
        responseLanguage: "ru",
      }),
    ).finish();
    const res = await app.handle(
      rawSignedRequest("/video-translation/cache", tamperedBytes, secHeaders),
    );
    await expectForbidden(res);
  });

  test("malformed protobuf with valid sec headers still returns 400", async () => {
    const app = buildApp();
    const session = await createSession(app);
    const secHeaders = await getSecYaHeaders(
      "Vtrans",
      session,
      MALFORMED_BYTES,
      "/video-translation/translate",
    );
    const res = await app.handle(
      rawSignedRequest("/video-translation/translate", MALFORMED_BYTES, secHeaders),
    );
    await expectCapturedError(res, 400);
  });

  test("malformed protobuf with garbage sec headers still returns 400", async () => {
    const app = buildApp();
    await createSession(app);
    const res = await app.handle(
      rawSignedRequest("/video-subtitles/get-subtitles", MALFORMED_BYTES, {
        "Vsubs-Signature": "garbage",
        "Sec-Vsubs-Sk": "garbage",
        "Sec-Vsubs-Token": "garbage",
      }),
    );
    await expectCapturedError(res, 400);
  });
});

describe("session/create signature validation", () => {
  test("valid Vtrans-Signature without Sec-Vtrans-Sk/Token -> 200", async () => {
    const app = buildApp();
    const bytes = await sessionBytes();
    const res = await app.handle(sessionRequest(bytes, await getSignature(bytes)));
    expect(res.status).toBe(200);
    const body = await decode(res, protos.YandexSessionResponse);
    expect(body.secretKey.length).toBeGreaterThan(10);
    expect(body.expires).toBe(3600);
  });

  test("lowercase vtrans-signature is accepted", async () => {
    const app = buildApp();
    const bytes = await sessionBytes();
    const res = await app.handle(
      rawSignedRequest("/session/create", bytes, {
        "vtrans-signature": await getSignature(bytes),
      }),
    );
    expect(res.status).toBe(200);
  });

  test("missing Vtrans-Signature -> 402", async () => {
    const app = buildApp();
    const res = await app.handle(sessionRequest(await sessionBytes()));
    await expectForbidden(res);
  });

  test("wrong Vtrans-Signature -> 402", async () => {
    const app = buildApp();
    const bytes = await sessionBytes();
    const res = await app.handle(sessionRequest(bytes, "0".repeat(64)));
    await expectForbidden(res);
  });

  test("body tampered after signing (still decodable) -> 402", async () => {
    const app = buildApp();
    const signed = await sessionBytes("11111111-1111-1111-1111-111111111111");
    const signature = await getSignature(signed);
    const tampered = await sessionBytes("22222222-2222-2222-2222-222222222222");
    const res = await app.handle(sessionRequest(tampered, signature));
    await expectForbidden(res);
  });

  test("malformed protobuf -> 400 regardless of signature", async () => {
    const app = buildApp();
    const res = await app.handle(
      rawSignedRequest("/session/create", MALFORMED_BYTES, {
        "Vtrans-Signature": await getSignature(MALFORMED_BYTES),
      }),
    );
    await expectCapturedError(res, 400);
  });
});

describe("unprotected routes", () => {
  test("fail-audio-js ignores bogus sec headers", async () => {
    const app = buildApp();
    const res = await app.handle(
      new Request(`${ORIGIN}/video-translation/fail-audio-js`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "Vtrans-Signature": "bogus",
          "Sec-Vtrans-Sk": "bogus",
          "Sec-Vtrans-Token": "bogus",
        },
        body: JSON.stringify({ video_url: "https://youtu.be/x" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 1 });
  });
});

describe("health", () => {
  test("GET /health", async () => {
    const app = buildApp();
    const res = await app.handle(new Request(`${ORIGIN}/health`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});

describe("session", () => {
  test("returns plausible secret and expires", async () => {
    const app = buildApp();
    const bytes = await sessionBytes("abc");
    const res = await app.handle(sessionRequest(bytes, await getSignature(bytes)));
    expect(res.status).toBe(200);
    const body = await decode(res, protos.YandexSessionResponse);
    expect(body.secretKey.length).toBeGreaterThan(10);
    expect(body.secretKey).toContain(":");
    expect(body.expires).toBe(3600);
  });
});

describe("video translation progression", () => {
  test("6 -> audio 1/2 -> poll 2 -> translated 1 with local audio url", async () => {
    const app = buildApp();
    const session = await createSession(app);
    const url = "https://youtu.be/3gcgF2kAr9w";
    const first = await app.handle(
      await signedRequest(
        "/video-translation/translate",
        protos.VideoTranslationRequest,
        {
          url,
          firstRequest: true,
          duration: 60,
          language: "en",
          responseLanguage: "ru",
        },
        "Vtrans",
        session,
      ),
    );
    expect(first.status).toBe(200);
    const firstBody = await decode(first, protos.VideoTranslationResponse);
    expect(firstBody.status).toBe(6);
    expectRemainingTime(firstBody.remainingTime);
    expect(firstBody.translationId.length).toBeGreaterThan(0);
    const id = firstBody.translationId;

    const put1 = await app.handle(
      await audioUpload(session, id, url, partialChunk(2, 0)),
    );
    expect((await decode(put1, protos.VideoTranslationAudioResponse)).status).toBe(1);

    const put2 = await app.handle(
      await audioUpload(session, id, url, partialChunk(2, 1)),
    );
    expect((await decode(put2, protos.VideoTranslationAudioResponse)).status).toBe(2);

    const poll1 = await app.handle(
      await signedRequest(
        "/video-translation/translate",
        protos.VideoTranslationRequest,
        {
          url,
          firstRequest: false,
          duration: 60,
          language: "en",
          responseLanguage: "ru",
        },
        "Vtrans",
        session,
      ),
    );
    expect((await decode(poll1, protos.VideoTranslationResponse)).status).toBe(2);

    const poll2 = await app.handle(
      await signedRequest(
        "/video-translation/translate",
        protos.VideoTranslationRequest,
        {
          url,
          firstRequest: false,
          duration: 60,
          language: "en",
          responseLanguage: "ru",
        },
        "Vtrans",
        session,
      ),
    );
    const done = await decode(poll2, protos.VideoTranslationResponse);
    expect(done.status).toBe(1);
    expect(done.url ?? "").toMatch(AUDIO_URL_RE);

    const audio = await app.handle(new Request(done.url as string));
    expect(audio.status).toBe(200);
    expect(audio.headers.get("content-type")).toBe("audio/mpeg");
  });
});

describe("audio completion", () => {
  const url = "https://youtu.be/audio-completion";

  async function translate(
    app: ReturnType<typeof buildApp>,
    session: ClientSession,
    firstRequest: boolean,
  ) {
    const res = await app.handle(
      await signedRequest(
        "/video-translation/translate",
        protos.VideoTranslationRequest,
        { url, firstRequest, duration: 60, language: "en", responseLanguage: "ru" },
        "Vtrans",
        session,
      ),
    );
    return decode(res, protos.VideoTranslationResponse);
  }

  async function start(
    app: ReturnType<typeof buildApp>,
    session: ClientSession,
  ): Promise<string> {
    const first = await translate(app, session, true);
    expect(first.status).toBe(6);
    expectRemainingTime(first.remainingTime);
    return first.translationId;
  }

  test("intermediate chunks (audioPartsLength 0 / nonfinal) keep translate at 6", async () => {
    const app = buildApp();
    const session = await createSession(app);
    const id = await start(app, session);

    const zero = await app.handle(await audioUpload(session, id, url, partialChunk(0, 0)));
    expect((await decode(zero, protos.VideoTranslationAudioResponse)).status).toBe(1);

    const nonfinal = await app.handle(await audioUpload(session, id, url, partialChunk(3, 0)));
    expect((await decode(nonfinal, protos.VideoTranslationAudioResponse)).status).toBe(1);

    const waiting = await translate(app, session, false);
    expect(waiting.status).toBe(6);
    expectRemainingTime(waiting.remainingTime);
  });

  test("final chunk (chunkId === audioPartsLength - 1) completes audio 2, translate 2 -> 1", async () => {
    const app = buildApp();
    const session = await createSession(app);
    const id = await start(app, session);

    const final = await app.handle(await audioUpload(session, id, url, partialChunk(3, 2)));
    expect((await decode(final, protos.VideoTranslationAudioResponse)).status).toBe(2);

    const poll1 = await translate(app, session, false);
    expect(poll1.status).toBe(2);
    expectRemainingTime(poll1.remainingTime);

    const poll2 = await translate(app, session, false);
    expect(poll2.status).toBe(1);
    expect(poll2.url ?? "").toMatch(AUDIO_URL_RE);
  });

  test("wrong chunk id stays audio 1 and translate 6", async () => {
    const app = buildApp();
    const session = await createSession(app);
    const id = await start(app, session);

    const wrong = await app.handle(await audioUpload(session, id, url, partialChunk(3, 1)));
    expect((await decode(wrong, protos.VideoTranslationAudioResponse)).status).toBe(1);

    const waiting = await translate(app, session, false);
    expect(waiting.status).toBe(6);
    expectRemainingTime(waiting.remainingTime);
  });

  test("audioInfo completes immediately: audio 2 then translate 2 -> 1", async () => {
    const app = buildApp();
    const session = await createSession(app);
    const id = await start(app, session);

    const full = await app.handle(
      await audioUpload(session, id, url, {
        audioInfo: { audioFile: new Uint8Array([1]), fileId: "file" },
      }),
    );
    expect((await decode(full, protos.VideoTranslationAudioResponse)).status).toBe(2);

    const poll1 = await translate(app, session, false);
    expect(poll1.status).toBe(2);
    expectRemainingTime(poll1.remainingTime);

    const poll2 = await translate(app, session, false);
    expect(poll2.status).toBe(1);
    expect(poll2.url ?? "").toMatch(AUDIO_URL_RE);
  });

  test("missing audioBuffer / no audio info does not complete", async () => {
    const app = buildApp();
    const session = await createSession(app);
    const id = await start(app, session);

    const noBuffer = await app.handle(
      await audioUpload(session, id, url, {
        partialAudioInfo: { audioPartsLength: 2, fileId: "file", version: 0 },
      }),
    );
    expect((await decode(noBuffer, protos.VideoTranslationAudioResponse)).status).toBe(1);

    const empty = await app.handle(await audioUpload(session, id, url, {}));
    expect((await decode(empty, protos.VideoTranslationAudioResponse)).status).toBe(1);

    const waiting = await translate(app, session, false);
    expect(waiting.status).toBe(6);
    expectRemainingTime(waiting.remainingTime);
  });

  test("both audioInfo and partialAudioInfo: audioInfo completes", async () => {
    const app = buildApp();
    const session = await createSession(app);
    const id = await start(app, session);

    const both = await app.handle(
      await audioUpload(session, id, url, {
        audioInfo: { audioFile: new Uint8Array([1]), fileId: "file" },
        partialAudioInfo: { audioPartsLength: 5, fileId: "file", version: 0 },
      }),
    );
    expect((await decode(both, protos.VideoTranslationAudioResponse)).status).toBe(2);
  });
});

describe("audio-required gate applies only to youtu.be", () => {
  const translate = (
    url: string,
    firstRequest: boolean,
    session: ClientSession,
  ): Promise<Request> =>
    signedRequest(
      "/video-translation/translate",
      protos.VideoTranslationRequest,
      {
        url,
        firstRequest,
        duration: 60,
        language: "en",
        responseLanguage: "ru",
      },
      "Vtrans",
      session,
    );

  test("youtu.be stays on status 6 until audio is uploaded", async () => {
    const app = buildApp();
    const session = await createSession(app);
    const url = "https://youtu.be/abc";

    const first = await decode(
      await app.handle(await translate(url, true, session)),
      protos.VideoTranslationResponse,
    );
    expect(first.status).toBe(6);
    expectRemainingTime(first.remainingTime);

    const beforeAudio = await decode(
      await app.handle(await translate(url, false, session)),
      protos.VideoTranslationResponse,
    );
    expect(beforeAudio.status).toBe(6);
    expectRemainingTime(beforeAudio.remainingTime);

    await app.handle(await audioUpload(session, first.translationId, url, partialChunk(1, 0)));

    const afterAudio = await decode(
      await app.handle(await translate(url, false, session)),
      protos.VideoTranslationResponse,
    );
    expect(afterAudio.status).toBe(2);
    expectRemainingTime(afterAudio.remainingTime);
  });

  const NON_AUDIO_URLS: Array<[name: string, url: string]> = [
    ["youtube.com", "https://www.youtube.com/watch?v=abc"],
    ["another host", "https://example.com/watch/abc"],
    ["malformed url", "not-a-url"],
  ];

  for (const [name, url] of NON_AUDIO_URLS) {
    test(`${name} never returns status 6 and reaches translated 1 without audio`, async () => {
      const app = buildApp();
      const session = await createSession(app);

      const first = await decode(
        await app.handle(await translate(url, true, session)),
        protos.VideoTranslationResponse,
      );
      expect(first.status).not.toBe(6);
      expect(first.status).toBe(2);
      expectRemainingTime(first.remainingTime);
      expect(first.translationId.length).toBeGreaterThan(0);

      const second = await decode(
        await app.handle(await translate(url, false, session)),
        protos.VideoTranslationResponse,
      );
      expect(second.status).not.toBe(6);
      expect(second.status).toBe(1);
      expect(second.url ?? "").toMatch(AUDIO_URL_RE);
    });
  }
});

describe("translation state reuse by url", () => {
  const URL = "https://youtu.be/state-reuse";

  async function translate(
    app: ReturnType<typeof buildApp>,
    session: ClientSession,
    url: string,
    firstRequest: boolean,
  ): Promise<protos.VideoTranslationResponse> {
    const res = await app.handle(
      await signedRequest(
        "/video-translation/translate",
        protos.VideoTranslationRequest,
        { url, firstRequest, duration: 60, language: "en", responseLanguage: "ru" },
        "Vtrans",
        session,
      ),
    );
    expect(res.status).toBe(200);
    return decode(res, protos.VideoTranslationResponse);
  }

  test("firstRequest=true after final chunk reuses state: 6 -> audio 2 -> 2 -> 1", async () => {
    const app = buildApp();
    const session = await createSession(app);

    const first = await translate(app, session, URL, true);
    expect(first.status).toBe(6);
    expectRemainingTime(first.remainingTime);
    const id = first.translationId;

    const final = await app.handle(await audioUpload(session, id, URL, partialChunk(2, 1)));
    expect((await decode(final, protos.VideoTranslationAudioResponse)).status).toBe(2);

    // Real client repeats firstRequest=true here; state must not reset.
    const poll1 = await translate(app, session, URL, true);
    expect(poll1.status).toBe(2);
    expect(poll1.translationId).toBe(id);
    expectRemainingTime(poll1.remainingTime);

    const poll2 = await translate(app, session, URL, true);
    expect(poll2.status).toBe(1);
    expect(poll2.translationId).toBe(id);
    expect(poll2.url ?? "").toMatch(AUDIO_URL_RE);
  });

  test("firstRequest=true after audioInfo reuses state: audio 2 -> translate 2", async () => {
    const app = buildApp();
    const session = await createSession(app);

    const first = await translate(app, session, URL, true);
    expect(first.status).toBe(6);
    const id = first.translationId;

    const full = await app.handle(
      await audioUpload(session, id, URL, {
        audioInfo: { audioFile: new Uint8Array([1]), fileId: "file" },
      }),
    );
    expect((await decode(full, protos.VideoTranslationAudioResponse)).status).toBe(2);

    const poll = await translate(app, session, URL, true);
    expect(poll.status).toBe(2);
    expect(poll.translationId).toBe(id);
    expectRemainingTime(poll.remainingTime);
  });

  test("repeated firstRequest=true before completion stays 6 with the same id", async () => {
    const app = buildApp();
    const session = await createSession(app);

    const first = await translate(app, session, URL, true);
    expect(first.status).toBe(6);
    const id = first.translationId;

    for (const _ of [0, 1]) {
      const again = await translate(app, session, URL, true);
      expect(again.status).toBe(6);
      expect(again.translationId).toBe(id);
      expectRemainingTime(again.remainingTime);
    }

    // The repeats allocated no new state: the next distinct URL continues the
    // sequence immediately after the first URL's id.
    const other = await translate(app, session, "https://youtu.be/state-reuse-other", true);
    expect(Number(other.translationId)).toBe(Number(id) + 1);
  });

  test("new distinct urls still get sequential distinct translation ids", async () => {
    const app = buildApp();
    const session = await createSession(app);

    const a = await translate(app, session, "https://youtu.be/state-ref-a", true);
    const b = await translate(app, session, "https://youtu.be/state-ref-b", true);

    expect(a.translationId).not.toBe(b.translationId);
    expect(Number(b.translationId)).toBe(Number(a.translationId) + 1);
  });
});

describe("cache", () => {
  test("returns a ready default and a waiting cloning variant", async () => {
    const app = buildApp();
    const session = await createSession(app);
    const res = await app.handle(
      await signedRequest(
        "/video-translation/cache",
        protos.VideoTranslationCacheRequest,
        {
          url: "https://youtu.be/x",
          duration: 10,
          language: "en",
          responseLanguage: "ru",
        },
        "Vtrans",
        session,
      ),
    );
    const body = await decode(res, protos.VideoTranslationCacheResponse);
    expect(body.default?.status).toBe(0);
    expect(body.cloning?.status).toBe(2);
    expectRemainingTime(body.cloning?.remainingTime);
  });
});

describe("subtitles", () => {
  test("returns local source and translated urls", async () => {
    const app = buildApp();
    const session = await createSession(app);
    const res = await app.handle(
      await signedRequest(
        "/video-subtitles/get-subtitles",
        protos.SubtitlesRequest,
        { url: "https://youtu.be/x", language: "en" },
        "Vsubs",
        session,
      ),
    );
    const body = await decode(res, protos.SubtitlesResponse);
    expect(body.waiting).toBe(false);
    expect(body.subtitles.length).toBeGreaterThan(0);
    const sub = body.subtitles[0];
    expect(sub).toBeDefined();
    // Extensionless `/vtrans/<uuid>` / `/vtrans/translated/<uuid>` shapes.
    expect(sub?.url ?? "").toMatch(SOURCE_URL_RE);
    expect(sub?.translatedUrl ?? "").toMatch(TRANSLATED_URL_RE);

    const src = await app.handle(new Request(sub?.url as string));
    expect(src.status).toBe(200);
    expect(src.headers.get("content-type")).toBe("application/octet-stream");
    const srcJson = (await src.json()) as { subtitles: Array<{ text: string }> };
    expect(srcJson.subtitles[0]?.text).toContain("Both of these machines are controlled by AI");

    const srcHead = await app.handle(new Request(sub?.url as string, { method: "HEAD" }));
    expect(srcHead.status).toBe(200);
    expect(srcHead.headers.get("content-length")).toBe(src.headers.get("content-length"));
    expect(await srcHead.arrayBuffer().then((b) => b.byteLength)).toBe(0);

    const tr = await app.handle(new Request(sub?.translatedUrl as string));
    expect(tr.status).toBe(200);
    expect(tr.headers.get("content-type")).toBe("application/octet-stream");
    const trJson = (await tr.json()) as { subtitles: Array<{ text: string }> };
    expect(trJson.subtitles[0]?.text).toContain("Обеими этими машинами управляет ИИ");
  });

  async function getSubtitles(
    app: ReturnType<typeof buildApp>,
    session: ClientSession,
    value: Record<string, unknown> = { url: "https://youtu.be/x", language: "en" },
  ) {
    const res = await app.handle(
      await signedRequest(
        "/video-subtitles/get-subtitles",
        protos.SubtitlesRequest,
        value,
        "Vsubs",
        session,
      ),
    );
    expect(res.status).toBe(200);
    return decode(res, protos.SubtitlesResponse);
  }

  test("subtitleId increments once per successful response and is independent of urls", async () => {
    const app = buildApp();
    const session = await createSession(app);

    const first = await getSubtitles(app, session);
    expect(first.subtitles[0]?.subtitleId).toBe(500000000);

    // Different request URL/language: still exactly one id consumed per response.
    const second = await getSubtitles(app, session, {
      url: "https://youtu.be/y",
      language: "de",
    });
    expect(second.subtitles[0]?.subtitleId).toBe(500000001);

    const third = await getSubtitles(app, session);
    expect(third.subtitles[0]?.subtitleId).toBe(500000002);
  });

  test("rejected requests do not consume subtitleIds", async () => {
    const app = buildApp();
    const session = await createSession(app);
    expect((await getSubtitles(app, session)).subtitles[0]?.subtitleId).toBe(500000000);

    // Valid protobuf but no sec headers -> 402.
    await expectForbidden(
      await app.handle(
        pbRequest("/video-subtitles/get-subtitles", protos.SubtitlesRequest, {
          url: "https://youtu.be/x",
          language: "en",
        }),
      ),
    );
    // Malformed protobuf -> 400.
    await expectCapturedError(
      await app.handle(
        rawSignedRequest("/video-subtitles/get-subtitles", MALFORMED_BYTES, {
          "Vsubs-Signature": "garbage",
          "Sec-Vsubs-Sk": "garbage",
          "Sec-Vsubs-Token": "garbage",
        }),
      ),
      400,
    );

    expect((await getSubtitles(app, session)).subtitles[0]?.subtitleId).toBe(500000001);
  });

  test("a fresh app instance resets the subtitle sequence", async () => {
    const firstApp = buildApp();
    const firstSession = await createSession(firstApp);
    await getSubtitles(firstApp, firstSession);
    await getSubtitles(firstApp, firstSession);

    const secondApp = buildApp();
    const secondSession = await createSession(secondApp);
    expect((await getSubtitles(secondApp, secondSession)).subtitles[0]?.subtitleId).toBe(500000000);
  });
});

describe("stream", () => {
  test("translate-stream succeeds without hanging, ping accepts encoded request", async () => {
    const app = buildApp();
    const session = await createSession(app);
    const res = await app.handle(
      await signedRequest(
        "/stream-translation/translate-stream",
        protos.StreamTranslationRequest,
        {
          url: "https://example.com/live.m3u8",
          language: "en",
          responseLanguage: "ru",
        },
        "Vtrans",
        session,
      ),
    );
    const body = await decode(res, protos.StreamTranslationResponse);
    expect(body.interval).toBe(protos.StreamInterval.STREAMING);
    expect(body.translatedInfo?.url ?? "").toEndWith(".m3u8");
    expect(typeof body.pingId).toBe("number");

    const playlist = await app.handle(new Request(body.translatedInfo?.url as string));
    expect(playlist.status).toBe(200);
    expect(playlist.headers.get("content-type")).toContain("mpegurl");
    const playlistText = await playlist.text();
    expect(playlistText).toContain("#EXTM3U");
    expect(playlistText).toMatch(AUDIO_PATH_RE);

    const playlistHead = await app.handle(
      new Request(body.translatedInfo?.url as string, { method: "HEAD" }),
    );
    expect(playlistHead.status).toBe(200);
    expect(playlistHead.headers.get("content-type")).toBe(playlist.headers.get("content-type"));
    expect(playlistHead.headers.get("content-length")).toBe(playlist.headers.get("content-length"));
    expect(await playlistHead.arrayBuffer().then((b) => b.byteLength)).toBe(0);

    const ping = await app.handle(
      await signedRequest(
        "/stream-translation/ping-stream",
        protos.StreamPingRequest,
        { pingId: 1 },
        "Vtrans",
        session,
      ),
    );
    expect(ping.status).toBe(200);
    expect(ping.headers.get("content-type")).toBe("application/x-protobuf");
    expect(await ping.arrayBuffer().then((b) => b.byteLength)).toBe(0);
  });
});

describe("fail-audio-js", () => {
  const FAILED_URL = "https://youtu.be/fail-audio-js";
  const FAIL_MESSAGE = "Возникла ошибка при переводе, попробуйте позже";

  async function failAudio(
    app: ReturnType<typeof buildApp>,
    body: unknown,
  ): Promise<Response> {
    return app.handle(
      new Request(`${ORIGIN}/video-translation/fail-audio-js`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  }

  async function translate(
    app: ReturnType<typeof buildApp>,
    session: ClientSession,
    url: string,
    firstRequest: boolean,
  ): Promise<Response> {
    return app.handle(
      await signedRequest(
        "/video-translation/translate",
        protos.VideoTranslationRequest,
        { url, firstRequest, duration: 60, language: "en", responseLanguage: "ru" },
        "Vtrans",
        session,
      ),
    );
  }

  async function translateStatus(
    app: ReturnType<typeof buildApp>,
    session: ClientSession,
    url: string,
    firstRequest: boolean,
  ): Promise<number> {
    const res = await translate(app, session, url, firstRequest);
    expect(res.status).toBe(200);
    return (await decode(res, protos.VideoTranslationResponse)).status;
  }

  test("PUT returns json status 1", async () => {
    const app = buildApp();
    const res = await failAudio(app, { video_url: FAILED_URL });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 1 });
  });

  test("initial 6 -> fail -> next signed translate is 0 with exact message", async () => {
    const app = buildApp();
    const session = await createSession(app);
    expect(await translateStatus(app, session, FAILED_URL, true)).toBe(6);

    const failed = await failAudio(app, { video_url: FAILED_URL });
    expect(await failed.json()).toEqual({ status: 1 });

    const res = await translate(app, session, FAILED_URL, false);
    expect(res.status).toBe(200);
    const body = await decode(res, protos.VideoTranslationResponse);
    expect(body.status).toBe(0);
    expect(body.message).toBe(FAIL_MESSAGE);
  });

  test("fail before first translate also yields the error", async () => {
    const app = buildApp();
    const session = await createSession(app);
    await failAudio(app, { video_url: FAILED_URL });

    const res = await translate(app, session, FAILED_URL, true);
    expect(res.status).toBe(200);
    const body = await decode(res, protos.VideoTranslationResponse);
    expect(body.status).toBe(0);
    expect(body.message).toBe(FAIL_MESSAGE);
  });

  test("another URL is unaffected", async () => {
    const app = buildApp();
    const session = await createSession(app);
    await failAudio(app, { video_url: FAILED_URL });

    expect(await translateStatus(app, session, "https://youtu.be/unaffected", true)).toBe(6);
  });

  for (const [name, body] of [
    ["missing video_url", {}],
    ["empty video_url", { video_url: "" }],
    ["non-string video_url", { video_url: 123 }],
    ["array body", [{ video_url: FAILED_URL }]],
  ] as const) {
    test(`${name} does not mark the url`, async () => {
      const app = buildApp();
      const session = await createSession(app);
      const failed = await failAudio(app, body);
      expect(failed.status).toBe(200);
      expect(await failed.json()).toEqual({ status: 1 });

      expect(await translateStatus(app, session, FAILED_URL, true)).toBe(6);
    });
  }

  test("malformed JSON body does not mark the url", async () => {
    const app = buildApp();
    const session = await createSession(app);
    const failed = await app.handle(
      new Request(`${ORIGIN}/video-translation/fail-audio-js`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: "not-json",
      }),
    );
    expect(failed.status).toBe(200);
    expect(await failed.json()).toEqual({ status: 1 });

    expect(await translateStatus(app, session, FAILED_URL, true)).toBe(6);
  });

  test("a fresh app instance resets failed urls", async () => {
    const firstApp = buildApp();
    const firstSession = await createSession(firstApp);
    await failAudio(firstApp, { video_url: FAILED_URL });
    expect(await translateStatus(firstApp, firstSession, FAILED_URL, true)).toBe(0);

    const secondApp = buildApp();
    const secondSession = await createSession(secondApp);
    expect(await translateStatus(secondApp, secondSession, FAILED_URL, true)).toBe(6);
  });
});

describe("CORS", () => {
  const ACAO = "access-control-allow-origin";
  const EXPOSE = "access-control-expose-headers";
  const ALLOW_CREDENTIALS = "access-control-allow-credentials";
  const PREFLIGHT_METHODS = "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS";

  function expectCors(res: Response): void {
    expect(res.headers.get(ACAO)).toBe("*");
    expect(res.headers.get(ALLOW_CREDENTIALS)).toBeNull();
  }

  test("normal response gets ACAO and exposes headers", async () => {
    const app = buildApp();
    const res = await app.handle(new Request(`${ORIGIN}/health`));
    expect(res.status).toBe(200);
    expectCors(res);
    expect(res.headers.get(EXPOSE)).toBe(
      "Content-Length, Content-Range, Accept-Ranges, X-Yandex-Req-Id",
    );
  });

  test("dynamic server error (400) gets ACAO", async () => {
    const app = buildApp();
    const res = await app.handle(
      new Request(`${ORIGIN}/video-translation/translate`, {
        method: "POST",
        headers: { "content-type": "application/x-protobuf" },
        body: MALFORMED_PROTOBUF,
      }),
    );
    await expectCapturedError(res, 400);
    expectCors(res);
  });

  test("asset GET/HEAD/206/416 keep their headers and get ACAO", async () => {
    const app = buildApp();
    const path = `${ORIGIN}/tts/prod/${TEST_UUID}.mp3`;

    const get = await app.handle(new Request(path));
    expect(get.status).toBe(200);
    expectCors(get);
    expect(get.headers.get("accept-ranges")).toBe("bytes");
    const size = Number(get.headers.get("content-length"));
    expect(size).toBeGreaterThan(1000);

    const head = await app.handle(new Request(path, { method: "HEAD" }));
    expect(head.status).toBe(200);
    expectCors(head);
    expect(head.headers.get("content-length")).toBe(String(size));
    expect(await head.arrayBuffer().then((b) => b.byteLength)).toBe(0);

    const range = await app.handle(new Request(path, { headers: { range: "bytes=0-9" } }));
    expect(range.status).toBe(206);
    expectCors(range);
    expect(range.headers.get("content-range")).toBe(`bytes 0-9/${size}`);

    const bad = await app.handle(
      new Request(path, { headers: { range: `bytes=${size + 1}-${size + 10}` } }),
    );
    expect(bad.status).toBe(416);
    expectCors(bad);
    expect(bad.headers.get("content-range")).toBe(`bytes */${size}`);
  });

  test("protected route preflight -> 204 with permissive preflight headers", async () => {
    const app = buildApp();
    const res = await app.handle(
      new Request(`${ORIGIN}/video-translation/translate`, {
        method: "OPTIONS",
        headers: {
          origin: "https://example.com",
          "access-control-request-method": "POST",
          "access-control-request-headers": "content-type",
        },
      }),
    );
    expect(res.status).toBe(204);
    expectCors(res);
    expect(res.headers.get("access-control-allow-methods")).toBe(PREFLIGHT_METHODS);
    expect(res.headers.get("access-control-allow-headers")).toBe("*");
    expect(res.headers.get("access-control-max-age")).toBe("86400");
  });

  test("asset preflight -> 204 with permissive preflight headers", async () => {
    const app = buildApp();
    const res = await app.handle(
      new Request(`${ORIGIN}/tts/prod/${TEST_UUID}.mp3`, { method: "OPTIONS" }),
    );
    expect(res.status).toBe(204);
    expectCors(res);
    expect(res.headers.get("access-control-allow-methods")).toBe(PREFLIGHT_METHODS);
    expect(res.headers.get("access-control-allow-headers")).toBe("*");
  });

  test("unknown path 404 gets ACAO", async () => {
    const app = buildApp();
    const res = await app.handle(new Request(`${ORIGIN}/no-such-route`));
    expect(res.status).toBe(404);
    expectCors(res);
  });
});

describe("asset proxies", () => {
  test("audio GET/HEAD and byte ranges", async () => {
    const app = buildApp();
    const path = `${ORIGIN}/tts/prod/${TEST_UUID}.mp3?foo=bar`;
    const get = await app.handle(new Request(path));
    expect(get.status).toBe(200);
    expect(get.headers.get("content-type")).toBe("audio/mpeg");
    const size = Number(get.headers.get("content-length"));
    expect(size).toBeGreaterThan(1000);
    expect(get.headers.get("accept-ranges")).toBe("bytes");

    const head = await app.handle(new Request(path, { method: "HEAD" }));
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe(String(size));
    expect(await head.arrayBuffer().then((b) => b.byteLength)).toBe(0);

    const range = await app.handle(new Request(path, { headers: { range: "bytes=0-99" } }));
    expect(range.status).toBe(206);
    expect(range.headers.get("content-range")).toBe(`bytes 0-99/${size}`);
    expect(await range.arrayBuffer().then((b) => b.byteLength)).toBe(100);

    const openRange = await app.handle(new Request(path, { headers: { range: "bytes=0-" } }));
    expect(openRange.status).toBe(206);
    expect(openRange.headers.get("content-range")).toBe(`bytes 0-${size - 1}/${size}`);
    expect(await openRange.arrayBuffer().then((b) => b.byteLength)).toBe(size);

    const badRange = await app.handle(
      new Request(path, { headers: { range: `bytes=${size + 100}-${size + 200}` } }),
    );
    expect(badRange.status).toBe(416);
    expect(badRange.headers.get("content-range")).toBe(`bytes */${size}`);

    const badSuffix = await app.handle(new Request(path, { headers: { range: "bytes=-1.5" } }));
    expect(badSuffix.status).toBe(416);
    expect(badSuffix.headers.get("content-range")).toBe(`bytes */${size}`);
  });

  test("subtitle routes serve JSON assets", async () => {
    const app = buildApp();
    const en = await app.handle(new Request(`${ORIGIN}/vtrans/${TEST_UUID}?x=1`));
    expect(en.status).toBe(200);
    expect(en.headers.get("content-type")).toBe("application/octet-stream");
    const enJson = (await en.json()) as { subtitles: Array<{ text: string }> };
    expect(enJson.subtitles[0]?.text).toContain("Both of these machines are controlled by AI");

    const ru = await app.handle(new Request(`${ORIGIN}/vtrans/translated/${TEST_UUID}`));
    expect(ru.status).toBe(200);
    const ruJson = (await ru.json()) as { subtitles: Array<{ text: string }> };
    expect(ruJson.subtitles[0]?.text).toContain("Обеими этими машинами управляет ИИ");

    const head = await app.handle(new Request(`${ORIGIN}/vtrans/${TEST_UUID}`, { method: "HEAD" }));
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe(en.headers.get("content-length"));
    expect(await head.arrayBuffer().then((b) => b.byteLength)).toBe(0);

    const bad = await app.handle(new Request(`${ORIGIN}/vtrans/not-a-uuid`));
    expect(bad.status).toBe(404);
  });
});

describe("error logging", () => {
  // Exactly one log, carrying method + pathname and the original Error object.
  function expectLoggedError(method: string, pathname: string): Error {
    expect(errorCalls.length).toBe(1);
    const [label, error] = errorCalls[0]!;
    expect(String(label)).toContain(method);
    expect(String(label)).toContain(pathname);
    expect(error).toBeInstanceOf(Error);
    return error as Error;
  }

  test("malformed protobuf decode logs the error, method, and pathname only", async () => {
    const app = buildApp();
    const res = await app.handle(
      new Request(`${ORIGIN}/video-translation/translate?token=query-secret`, {
        method: "POST",
        headers: {
          "content-type": "application/x-protobuf",
          "Vtrans-Signature": "header-secret-signature",
          "Sec-Vtrans-Sk": "header-secret-sk",
          "Sec-Vtrans-Token": "header-secret-token",
        },
        body: MALFORMED_PROTOBUF,
      }),
    );
    expect(res.status).toBe(400);

    const error = expectLoggedError("POST", "/video-translation/translate");
    expect(error.stack).toBeTruthy();
    const logged = JSON.stringify(errorCalls);
    expect(logged).not.toContain("query-secret");
    expect(logged).not.toContain("header-secret-signature");
    expect(logged).not.toContain("header-secret-sk");
    expect(logged).not.toContain("header-secret-token");
  });

  test("malformed fail-audio-js JSON logs the parse error without body/header content", async () => {
    const app = buildApp();
    const res = await app.handle(
      new Request(`${ORIGIN}/video-translation/fail-audio-js?token=query-secret`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "Sec-Vtrans-Token": "header-secret-token",
        },
        body: "not-json",
      }),
    );
    expect(res.status).toBe(200);

    const error = expectLoggedError("PUT", "/video-translation/fail-audio-js");
    expect(error.stack).toBeTruthy();
    const logged = JSON.stringify(errorCalls);
    expect(logged).not.toContain("query-secret");
    expect(logged).not.toContain("header-secret-token");
    expect(logged).not.toContain("not-json");
  });

  test("missing sec headers (402) logs nothing", async () => {
    const app = buildApp();
    const res = await app.handle(
      pbRequest("/video-translation/translate", protos.VideoTranslationRequest, {
        url: "https://youtu.be/x",
        firstRequest: true,
        duration: 60,
        language: "en",
        responseLanguage: "ru",
      }),
    );
    expect(res.status).toBe(402);
    expect(errorCalls.length).toBe(0);
  });

  test("wrong content type (415) logs nothing", async () => {
    const app = buildApp();
    const res = await app.handle(
      new Request(`${ORIGIN}/session/create`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ not: "protobuf" }),
      }),
    );
    expect(res.status).toBe(415);
    expect(errorCalls.length).toBe(0);
  });
});

describe("access logging", () => {
  const CACHE_BODY = {
    url: "https://youtu.be/x",
    duration: 10,
    language: "en",
    responseLanguage: "ru",
  };

  test("one line per completed request with the actual final status", async () => {
    const app = buildApp();
    const cases: Array<[string, Request, number]> = [
      ["200", new Request(`${ORIGIN}/health`), 200],
      [
        "415",
        new Request(`${ORIGIN}/session/create`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ not: "protobuf" }),
        }),
        415,
      ],
      [
        "400",
        new Request(`${ORIGIN}/session/create`, {
          method: "POST",
          headers: { "content-type": "application/x-protobuf" },
          body: MALFORMED_PROTOBUF,
        }),
        400,
      ],
      [
        "402",
        pbRequest("/video-translation/cache", protos.VideoTranslationCacheRequest, CACHE_BODY),
        402,
      ],
      [
        "204",
        new Request(`${ORIGIN}/video-translation/translate`, { method: "OPTIONS" }),
        204,
      ],
      ["404", new Request(`${ORIGIN}/no-such-route`), 404],
    ];

    for (const [, request, status] of cases) {
      const pathname = new URL(request.url).pathname;
      const { res, lines } = await handleAndLog(app, request);
      expect(res.status).toBe(status);
      expect(lines).toEqual([`[mock-server] ${pathname} ${status}`]);
    }
  });

  test("asset 206/416 log the file pathname with the real status", async () => {
    const app = buildApp();
    const pathname = `/tts/prod/${TEST_UUID}.mp3`;

    const full = await handleAndLog(app, new Request(`${ORIGIN}${pathname}`));
    expect(full.res.status).toBe(200);
    expect(full.lines).toEqual([`[mock-server] ${pathname} 200`]);
    const size = Number(full.res.headers.get("content-length"));

    const range = await handleAndLog(
      app,
      new Request(`${ORIGIN}${pathname}`, { headers: { range: "bytes=0-9" } }),
    );
    expect(range.res.status).toBe(206);
    expect(range.lines).toEqual([`[mock-server] ${pathname} 206`]);

    const bad = await handleAndLog(
      app,
      new Request(`${ORIGIN}${pathname}`, { headers: { range: `bytes=${size + 1}-${size + 10}` } }),
    );
    expect(bad.res.status).toBe(416);
    expect(bad.lines).toEqual([`[mock-server] ${pathname} 416`]);
  });

  test("the query string is omitted from the logged pathname", async () => {
    const app = buildApp();
    const { res, lines } = await handleAndLog(
      app,
      new Request(`${ORIGIN}/health?foo=bar&x=1`),
    );
    expect(res.status).toBe(200);
    expect(lines).toEqual(["[mock-server] /health 200"]);
  });

  test("an exception request logs one console.error and one access line", async () => {
    const app = buildApp();
    const { res, lines } = await handleAndLog(
      app,
      new Request(`${ORIGIN}/video-translation/fail-audio-js`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: "not-json",
      }),
    );
    expect(res.status).toBe(200);
    expect(errorCalls.length).toBe(1);
    expect(lines).toEqual(["[mock-server] /video-translation/fail-audio-js 200"]);
  });

});

describe("SKIP_SEC_VALIDATION", () => {
  test("unset or non-true values keep missing sec headers at 402", async () => {
    for (const value of [undefined, "false", "FALSE", "1", "true2", ""]) {
      if (value === undefined) delete process.env.SKIP_SEC_VALIDATION;
      else process.env.SKIP_SEC_VALIDATION = value;
      const app = buildApp();
      await createSession(app);
      const res = await app.handle(
        pbRequest("/video-translation/translate", protos.VideoTranslationRequest, {
          url: "https://youtu.be/x",
          firstRequest: true,
          duration: 60,
          language: "en",
          responseLanguage: "ru",
        }),
      );
      await expectForbidden(res);
    }
  });

  test("true skips the Vtrans-Signature check on session/create", async () => {
    process.env.SKIP_SEC_VALIDATION = "true";
    const app = buildApp();
    const res = await app.handle(
      pbRequest("/session/create", protos.YandexSessionRequest, {
        uuid: TEST_UUID,
        module: "video-translation",
      }),
    );
    expect(res.status).toBe(200);
    const body = await decode(res, protos.YandexSessionResponse);
    expect(body.secretKey.length).toBeGreaterThan(10);
  });

  test("true accepts every protected route with no sec headers or issued session", async () => {
    process.env.SKIP_SEC_VALIDATION = "true";
    const app = buildApp();
    // No createSession: a valid body alone must pass both Vtrans and Vsubs.
    for (const route of PROTECTED_ROUTES) {
      const res = await app.handle(pbRequest(route.path, route.message, route.value, route.method));
      expect(res.status).toBe(200);
    }
  });

  test("is case-insensitive (TRUE)", async () => {
    process.env.SKIP_SEC_VALIDATION = "TRUE";
    const app = buildApp();
    const res = await app.handle(
      pbRequest("/video-subtitles/get-subtitles", protos.SubtitlesRequest, {
        url: "https://youtu.be/x",
        language: "en",
      }),
    );
    expect(res.status).toBe(200);
  });

  test("protobuf content-type and decoding checks still apply", async () => {
    process.env.SKIP_SEC_VALIDATION = "true";
    const app = buildApp();

    const malformed = await app.handle(
      new Request(`${ORIGIN}/video-translation/translate`, {
        method: "POST",
        headers: { "content-type": "application/x-protobuf" },
        body: MALFORMED_PROTOBUF,
      }),
    );
    await expectCapturedError(malformed, 400);

    const empty = await app.handle(
      new Request(`${ORIGIN}/session/create`, {
        method: "POST",
        headers: { "content-type": "application/x-protobuf" },
      }),
    );
    await expectCapturedError(empty, 400);

    const wrongContentType = await app.handle(
      new Request(`${ORIGIN}/video-subtitles/get-subtitles`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://youtu.be/x" }),
      }),
    );
    await expectCapturedError(wrongContentType, 415);
    // Drain the pending onAfterResponse callbacks while the spy is still
    // installed: this is the last test, so no later beforeEach will flush them.
    await flushAccessLog();
  });
});

describe("elysia-protobuf integration", () => {
  const CACHE_BODY = {
    url: "https://youtu.be/x",
    duration: 10,
    language: "en",
    responseLanguage: "ru",
  };

  async function cacheBytes(value: unknown): Promise<Uint8Array> {
    return protos.VideoTranslationCacheRequest.encode(
      protos.VideoTranslationCacheRequest.fromPartial(value as never),
    ).finish();
  }

  test("TProtobuf-decoded body drives the handler under a normalized content type", async () => {
    const app = buildApp();
    const session = await createSession(app);
    const bytes = await cacheBytes(CACHE_BODY);
    const secHeaders = await getSecYaHeaders("Vtrans", session, bytes, "/video-translation/cache");
    // Subtitles echo the decoded `language`: only a real decode yields "de".
    const subBytes = protos.SubtitlesRequest.encode(
      protos.SubtitlesRequest.fromPartial({ url: "https://youtu.be/x", language: "de" }),
    ).finish();
    const subSec = await getSecYaHeaders(
      "Vsubs",
      session,
      subBytes,
      "/video-subtitles/get-subtitles",
    );
    const res = await app.handle(
      new Request(`${ORIGIN}/video-subtitles/get-subtitles`, {
        method: "POST",
        headers: {
          "content-type": "  APPLICATION/X-PROTOBUF ; charset=utf-8  ",
          ...subSec,
        },
        body: subBytes as unknown as ReqBody,
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/x-protobuf");
    const body = await decode(res, protos.SubtitlesResponse);
    expect(body.subtitles[0]?.language).toBe("de");
    expect(secHeaders["Vtrans-Signature"].length).toBeGreaterThan(0);
    expect(bytes.length).toBeGreaterThan(0);
  });

  test("normalized content type still validates the exact raw bytes", async () => {
    const app = buildApp();
    const session = await createSession(app);
    const good = await cacheBytes(CACHE_BODY);
    const secHeaders = await getSecYaHeaders("Vtrans", session, good, "/video-translation/cache");
    // Same-length, still-decodable tamper: the signature must fail on bytes.
    const evil = await cacheBytes({ ...CACHE_BODY, url: "https://youtu.be/y" });
    expect(evil.length).toBe(good.length);
    expect(protos.VideoTranslationCacheRequest.decode(evil).url).toBe("https://youtu.be/y");
    const res = await app.handle(
      new Request(`${ORIGIN}/video-translation/cache`, {
        method: "POST",
        headers: { "content-type": "Application/X-Protobuf; charset=utf-8", ...secHeaders },
        body: evil as unknown as ReqBody,
      }),
    );
    await expectForbidden(res);
  });

  test("unknown-field bytes validate the signature on exact raw bytes", async () => {
    const app = buildApp();
    const uuid = getUUID();
    const canonical = protos.YandexSessionRequest.encode(
      protos.YandexSessionRequest.fromPartial({ uuid, module: "video-translation" }),
    ).finish();
    // Unknown field 99 (varint 1): tag 0x98 0x06, value 0x01. Decoders skip it,
    // but the signature covers every received byte.
    const raw = new Uint8Array([...canonical, 0x98, 0x06, 0x01]);
    const res = await app.handle(
      rawSignedRequest("/session/create", raw, {
        "Vtrans-Signature": await getSignature(raw),
      }),
    );
    expect(res.status).toBe(200);
    const sessionBody = await decode(res, protos.YandexSessionResponse);
    // The uuid was decoded despite the unknown field: the session is usable.
    const session: ClientSession = {
      uuid,
      secretKey: sessionBody.secretKey,
      expires: sessionBody.expires,
      timestamp: Math.floor(Date.now() / 1000),
    };
    const cache = await app.handle(
      await signedRequest(
        "/video-translation/cache",
        protos.VideoTranslationCacheRequest,
        CACHE_BODY,
        "Vtrans",
        session,
      ),
    );
    expect(cache.status).toBe(200);

    // Sanity: re-encoding drops the unknown field, so raw matters for sec.
    const reencoded = protos.YandexSessionRequest.encode(
      protos.YandexSessionRequest.decode(raw),
    ).finish();
    expect(reencoded.length).toBeLessThan(raw.length);
    // A signature over the re-encoded (canonical) bytes does not match the raw.
    const forged = await app.handle(
      rawSignedRequest("/session/create", raw, {
        "Vtrans-Signature": await getSignature(canonical),
      }),
    );
    await expectForbidden(forged);
  });

  test("TProtobuf response encoding is byte-exact for deterministic payloads", async () => {
    const app = buildApp();
    const session = await createSession(app);
    const failed = await app.handle(
      new Request(`${ORIGIN}/video-translation/fail-audio-js`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ video_url: "https://youtu.be/byte-exact" }),
      }),
    );
    expect(await failed.json()).toEqual({ status: 1 });
    const res = await app.handle(
      await signedRequest(
        "/video-translation/translate",
        protos.VideoTranslationRequest,
        {
          url: "https://youtu.be/byte-exact",
          firstRequest: false,
          duration: 60,
          language: "en",
          responseLanguage: "ru",
        },
        "Vtrans",
        session,
      ),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/x-protobuf");
    const actual = new Uint8Array(await res.arrayBuffer());
    const expected = protos.VideoTranslationResponse.encode(
      protos.VideoTranslationResponse.fromPartial({
        status: 0,
        message: "Возникла ошибка при переводе, попробуйте позже",
      }),
    ).finish();
    expect([...actual]).toEqual([...expected]);
  });

  test("thrown 402/415 errors carry CORS headers and log one access line", async () => {
    const app = buildApp();
    const forbidden = await app.handle(
      pbRequest("/video-translation/cache", protos.VideoTranslationCacheRequest, CACHE_BODY),
    );
    await expectCapturedError(forbidden, 402);
    expect(forbidden.headers.get("access-control-allow-origin")).toBe("*");

    const unsupported = await app.handle(
      new Request(`${ORIGIN}/video-translation/cache`, {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "hello" as unknown as ReqBody,
      }),
    );
    await expectCapturedError(unsupported, 415);
    expect(unsupported.headers.get("access-control-allow-origin")).toBe("*");

    // Drain the two access-log callbacks scheduled by the requests above before
    // `handleAndLog` resets `logCalls`; otherwise they fire during its flush and
    // appear as extra lines.
    await flushAccessLog();

    const { lines } = await handleAndLog(
      app,
      pbRequest("/video-translation/cache", protos.VideoTranslationCacheRequest, CACHE_BODY),
    );
    expect(lines).toEqual(["[mock-server] /video-translation/cache 402"]);
    // Drain the pending onAfterResponse callbacks while the spy is still
    // installed: this is the last test, so no later beforeEach will flush them.
    await flushAccessLog();
  });
});
