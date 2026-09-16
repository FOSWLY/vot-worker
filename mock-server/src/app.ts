import { Elysia } from "elysia";
import { protobuf, TProtobuf } from "elysia-protobuf";
import { protos } from "@vot.js/shared";
import type { ClientSession } from "@vot.js/shared/types/secure";
import { createProtobufProtocol, logRequestError, randomRemainingTime } from "./protocol.ts";
import { audioUrl, isAudioFile, isUuid, playlist, serveAsset, streamUrl } from "./assets.ts";
import { formatter, SYM } from "./log.ts";

interface TranslationState {
  polls: number;
  audioCompleted: boolean;
  url: string;
  duration: number;
  language: string;
}

// Audio-required translations are simulated only for the youtu.be host. Every
// other URL (youtube.com, arbitrary hosts, or strings `URL` cannot parse) skips
// the audio gate and progresses 2 -> 1 without an upload.
function requiresAudio(url: string): boolean {
  try {
    return new URL(url).hostname === "youtu.be";
  } catch {
    return false;
  }
}

const FAILED_AUDIO_MESSAGE = "Возникла ошибка при переводе, попробуйте позже";

const CORS_EXPOSE_HEADERS = "Content-Length, Content-Range, Accept-Ranges, X-Yandex-Req-Id";

// Single access log line per completed request: pathname and final status only
// (no query string, body, headers, cookies, or sec values). Method is shown
// only in the interactive TTY format; the plain fallback (non-TTY, test spies)
// stays the machine-readable `[mock-server] <pathname> <status>`.
function logAccess(request: Request, status: number): void {
  const { pathname } = new URL(request.url);
  const f = formatter();
  if (!f.color) {
    console.log(`[mock-server] ${pathname} ${status}`);
    return;
  }
  console.log(`  ${f.dim(SYM.arrow)} ${f.accent(request.method)} ${pathname} ${f.status(status)}`);
}

// Preflight defaults. No `access-control-allow-credentials`: the mock is fully
// permissive and any credentialed request would be rejected by browsers.
const CORS_PREFLIGHT = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS",
  "access-control-allow-headers": "*",
  "access-control-max-age": "86400",
};

export function buildApp() {
  let seq = 0;
  let subsSeq = 0;
  const byId = new Map<string, TranslationState>();
  const byUrl = new Map<string, string>();
  // URLs explicitly failed via `PUT /video-translation/fail-audio-js`, keyed by
  // the exact `video_url` string. A translate for one short-circuits to FAILED.
  const failedAudioUrls = new Set<string>();
  // Sessions issued by /session/create on this instance, keyed by the uuid
  // from the session request. Enough ClientSession fields are kept to call
  // shared getSecYaHeaders (uuid + secretKey).
  const sessions = new Map<string, ClientSession>();
  // Package-native protobuf plumbing: `protobuf()` registers the
  // elysia-protobuf parser/serializer; the protocol plugin stashes exact raw
  // bytes, normalizes accepted Content-Types for the parser, and maps package
  // decode failures to balancer errors. Security still runs on the raw bytes
  // via `@vot.js/shared/secure`.
  const { plugin: protobufProtocol, guard } = createProtobufProtocol(sessions);

  return (
    new Elysia()
      .use(protobuf())
      .use(protobufProtocol)
      // CORS is handled centrally: the preflight is short-circuited here, before
      // routing/body parsing. The origin is also set on every request because
      // Elysia builds its 404 response straight from `set.headers`, without
      // running `mapResponse`.
      .onRequest(({ request, set }) => {
        set.headers["access-control-allow-origin"] = "*";
        if (request.method !== "OPTIONS") return;
        Object.assign(set.headers, CORS_PREFLIGHT);
        // This early response bypasses Elysia's `onAfterResponse`, so it logs
        // the access line here instead (see the comment on that hook).
        logAccess(request, 204);
        return new Response(null, { status: 204 });
      })
      // Merged into every handled response; explicit response headers win, so
      // `content-length`/`content-range` of HEAD and 206/416 responses survive.
      .mapResponse(({ set }) => {
        set.headers["access-control-allow-origin"] = "*";
        set.headers["access-control-expose-headers"] = CORS_EXPOSE_HEADERS;
      })
      // Final lifecycle event, registered before the routes so every route
      // captures it. Fires once per completed request after the response is
      // mapped. Thrown balancer errors and handler `Response`s (static
      // 206/416) keep the real final status on `responseValue` while
      // `set.status` stays 200; errors and the default 404 leave
      // `responseValue` non-Response with `set.status` already set. The OPTIONS
      // early return above never reaches this event and logs on its own.
      .onAfterResponse(({ request, responseValue, set }) => {
        const status =
          responseValue instanceof Response
            ? responseValue.status
            : typeof set.status === "number"
              ? set.status
              : 500;
        logAccess(request, status);
      })
      .get("/health", () => ({ status: "ok" }))
      .post(
        "/session/create",
        ({ body }) => {
          const now = Math.floor(Date.now() / 1000);
          const hex = crypto.randomUUID().replaceAll("-", "");
          const secretKey = `${hex}:${now}:3600`;
          sessions.set(body.uuid, {
            uuid: body.uuid,
            secretKey,
            expires: 3600,
            timestamp: now,
          });
          return protos.YandexSessionResponse.fromPartial({
            secretKey,
            expires: 3600,
          });
        },
        {
          parse: "protobuf",
          body: TProtobuf(protos.YandexSessionRequest),
          response: TProtobuf(protos.YandexSessionResponse),
          beforeHandle: guard({ signatureOnly: true }),
        },
      )
      .post(
        "/video-translation/translate",
        ({ body, request }) => {
          if (failedAudioUrls.has(body.url)) {
            return protos.VideoTranslationResponse.fromPartial({
              status: 0,
              message: FAILED_AUDIO_MESSAGE,
            });
          }
          const origin = new URL(request.url).origin;
          const audioRequired = requiresAudio(body.url);
          // Real clients re-send `firstRequest: true` after the final audio
          // upload, so state is keyed by URL and reused whenever it exists;
          // `firstRequest` never resets an existing translation. A new ID is
          // allocated only for a URL with no (or a dangling) state.
          let knownId = byUrl.get(body.url);
          let known = knownId ? byId.get(knownId) : undefined;
          if (!knownId || !known) {
            seq += 1;
            knownId = String(400000000 + seq);
            known = {
              polls: 0,
              audioCompleted: false,
              url: body.url,
              duration: body.duration,
              language: body.language,
            };
            byUrl.set(body.url, knownId);
            byId.set(knownId, known);
          }
          if (audioRequired && !known.audioCompleted) {
            return protos.VideoTranslationResponse.fromPartial({
              status: 6,
              remainingTime: randomRemainingTime(),
              unknown0: 0,
              translationId: knownId,
              isLivelyVoice: false,
            });
          }
          known.polls += 1;
          if (known.polls === 1) {
            return protos.VideoTranslationResponse.fromPartial({
              status: 2,
              remainingTime: randomRemainingTime(),
              unknown0: 0,
              translationId: knownId,
              isLivelyVoice: false,
            });
          }
          return protos.VideoTranslationResponse.fromPartial({
            url: audioUrl(origin),
            duration: known.duration,
            status: 1,
            translationId: knownId,
            language: known.language,
            isLivelyVoice: false,
          });
        },
        {
          parse: "protobuf",
          body: TProtobuf(protos.VideoTranslationRequest),
          response: TProtobuf(protos.VideoTranslationResponse),
          beforeHandle: guard({ secType: "Vtrans" }),
        },
      )
      .put(
        "/video-translation/audio",
        ({ body }) => {
          // Explicit completion: `audioInfo` (whole file) completes outright;
          // a partial chunk only completes as the zero-based final chunk
          // (`chunkId === audioPartsLength - 1`) carrying an `audioBuffer`.
          const partial = body.partialAudioInfo;
          const completed =
            body.audioInfo !== undefined ||
            (partial !== undefined &&
              partial.audioPartsLength > 0 &&
              partial.audioBuffer !== undefined &&
              partial.audioBuffer.chunkId === partial.audioPartsLength - 1);
          let state = byId.get(body.translationId);
          if (!state) {
            state = {
              polls: 0,
              audioCompleted: false,
              url: body.url,
              duration: 0,
              language: "",
            };
            byId.set(body.translationId, state);
          }
          if (completed) state.audioCompleted = true;
          return protos.VideoTranslationAudioResponse.fromPartial({
            status: state.audioCompleted ? 2 : 1,
            remainingChunks: [],
          });
        },
        {
          parse: "protobuf",
          body: TProtobuf(protos.VideoTranslationAudioRequest),
          response: TProtobuf(protos.VideoTranslationAudioResponse),
          beforeHandle: guard({ secType: "Vtrans" }),
        },
      )
      .post(
        "/video-translation/cache",
        () =>
          protos.VideoTranslationCacheResponse.fromPartial({
            // One ready variant and one waiting variant.
            default: { status: 0, flags: [] },
            cloning: { status: 2, remainingTime: randomRemainingTime(), flags: [] },
          }),
        {
          parse: "protobuf",
          body: TProtobuf(protos.VideoTranslationCacheRequest),
          response: TProtobuf(protos.VideoTranslationCacheResponse),
          beforeHandle: guard({ secType: "Vtrans" }),
        },
      )
      .put("/video-translation/fail-audio-js", async ({ request }) => {
        // Best-effort, non-protobuf JSON: a valid object with a non-empty
        // string `video_url` records the URL. Anything else (missing/invalid
        // URL, malformed JSON, non-object) is ignored. Always `{ status: 1 }`.
        try {
          const body: unknown = await request.json();
          if (typeof body === "object" && body !== null && !Array.isArray(body)) {
            const videoUrl = (body as { video_url?: unknown }).video_url;
            if (typeof videoUrl === "string" && videoUrl.length > 0) {
              failedAudioUrls.add(videoUrl);
            }
          }
        } catch (error) {
          // Body is not JSON / already consumed: nothing to record.
          logRequestError("invalid fail-audio-js JSON body", request, error);
        }
        return Response.json({ status: 1 });
      })
      .post(
        "/video-subtitles/get-subtitles",
        ({ body, request }) => {
          const origin = new URL(request.url).origin;
          const subtitleId = 500000000 + subsSeq;
          subsSeq += 1;
          return protos.SubtitlesResponse.fromPartial({
            waiting: false,
            subtitles: [
              {
                language: body.language || "en",
                url: `${origin}/vtrans/${crypto.randomUUID()}`,
                hasTranslation: true,
                translatedLanguage: "ru",
                translatedUrl: `${origin}/vtrans/translated/${crypto.randomUUID()}`,
                unknown1: false,
                subtitleId,
              },
            ],
          });
        },
        {
          parse: "protobuf",
          body: TProtobuf(protos.SubtitlesRequest),
          response: TProtobuf(protos.SubtitlesResponse),
          beforeHandle: guard({ secType: "Vsubs" }),
        },
      )
      .post(
        "/stream-translation/translate-stream",
        ({ request }) => {
          const origin = new URL(request.url).origin;
          return protos.StreamTranslationResponse.fromPartial({
            interval: protos.StreamInterval.STREAMING,
            translatedInfo: {
              url: streamUrl(origin),
              timestamp: String(Math.floor(Date.now() / 1000)),
            },
            pingId: 1,
          });
        },
        {
          parse: "protobuf",
          body: TProtobuf(protos.StreamTranslationRequest),
          response: TProtobuf(protos.StreamTranslationResponse),
          beforeHandle: guard({ secType: "Vtrans" }),
        },
      )
      .post("/stream-translation/ping-stream", () => protos.StreamPingRequest.fromPartial({}), {
        parse: "protobuf",
        body: TProtobuf(protos.StreamPingRequest),
        // No ping response schema exists in shared: an empty request message
        // encodes to zero bytes, which is exactly the empty protobuf reply.
        response: TProtobuf(protos.StreamPingRequest),
        beforeHandle: guard({ secType: "Vtrans" }),
      })
      .all("/stream-translation/stream-proxy/mock.m3u8", ({ request }) => {
        // A static route's HEAD goes through Elysia's generated fallback, which
        // measures the returned body with getResponseLength before discarding it.
        // Returning the real body (even for HEAD) keeps content-length in sync
        // with GET; Elysia still sends an empty HEAD body.
        const body = playlist(new URL(request.url).origin);
        return new Response(body, {
          headers: {
            "content-type": "application/vnd.apple.mpegurl",
            "content-length": String(Buffer.byteLength(body)),
          },
        });
      })
      // NOTE: `.all` (not `.get`+`.head`) — Elysia normalizes HEAD
      // `content-length` to 0 when GET and HEAD routes share a pattern.
      .all("/tts/prod/:file", ({ request, params: { file } }) => {
        if (!isAudioFile(file)) return new Response("Not Found", { status: 404 });
        return serveAsset(request, "22-121148-0003.wav", "audio/mpeg");
      })
      // More specific translated path registered before the source route.
      .all("/vtrans/translated/:uuid", ({ request, params: { uuid } }) => {
        if (!isUuid(uuid)) return new Response("Not Found", { status: 404 });
        return serveAsset(request, "ru.json", "application/octet-stream");
      })
      .all("/vtrans/:uuid", ({ request, params: { uuid } }) => {
        if (!isUuid(uuid)) return new Response("Not Found", { status: 404 });
        return serveAsset(request, "en.json", "application/octet-stream");
      })
  );
}
