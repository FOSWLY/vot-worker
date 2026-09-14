// VOT scenarios and the tiny assert harness. Functional requests go through
// `@vot.js/node`; raw `fetch`/`workerCall` is kept only for `health` and
// intentionally negative transport checks.

import VOTClient from "@vot.js/node";
import { VOTJSError } from "@vot.js/core";
import { VOTWorkerProvider } from "@vot.js/core/providers/votworker";
import { YandexVOTProtobuf } from "@vot.js/core/protobuf";
import type { VideoData } from "@vot.js/core/types/client";

import { FAILED_MESSAGE, f, invalidPayloadStatus, workerKind, workerUrl } from "./config.ts";
import { SYM } from "../src/log.ts";

// Per-run suffix for every URL the mock keys state by, so `--no-spawn` can be
// repeated against a long-lived mock-server without byUrl/failedAudioUrls
// collisions between runs.
const runId = crypto.randomUUID().slice(0, 8);

// Single client for all functional scenarios: the provider signs protobuf
// requests and decodes responses, so no manual encode/decode/signature code.
export const client = new VOTClient({
  provider: VOTWorkerProvider,
  host: workerUrl,
  requestLang: "en",
  responseLang: "ru",
});

function vd(url: string): VideoData {
  return { url, videoId: url, host: "youtube" as VideoData["host"], duration: 60 };
}

// --- tiny test harness ----------------------------------------------------

export let failures = 0;
let assertCount = 0;

export function assert(condition: unknown, message: string): asserts condition {
  const n = ++assertCount;
  if (condition) {
    console.log(`    ${f.success(SYM.ok)} ${f.dim(`assert #${n}`)} ${message}`);
    return;
  }
  console.error(`    ${f.failure(SYM.fail)} ${f.dim(`assert #${n}`)} ${f.failure(message)}`);
  throw new Error(`Assertion failed: ${message}`);
}

function assertStatus(res: Response, expected: number, context: string): void {
  assert(res.status === expected, `${context}: expected HTTP ${expected}, got ${res.status}`);
}

function assertRemainingTime(value: number | undefined): void {
  assert(
    typeof value === "number" && Number.isInteger(value) && value >= 60 && value <= 180,
    `remainingTime is ${String(value)}, expected an integer in [60, 180]`,
  );
}

export async function scenario(name: string, run: () => Promise<void>): Promise<void> {
  const started = Date.now();
  try {
    await run();
    console.log(`  ${f.success(SYM.ok)} ${name} ${f.dim(`(${Date.now() - started}ms)`)}`);
  } catch (error) {
    failures += 1;
    console.error(
      `  ${f.failure(SYM.fail)} ${name} ${f.dim(`(${Date.now() - started}ms)`)}\n` +
        `       ${f.failure((error as Error).message)}`,
    );
  }
}

// --- raw transport helpers (negative checks only) --------------------------
// The package cannot send malformed/unsigned requests on purpose, so these
// stay on the bare worker envelope. Functional scenarios above never use them.

function workerCall(path: string, payload: unknown, method = "POST"): Promise<Response> {
  return fetch(`${workerUrl}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

// --- scenarios ------------------------------------------------------------

export async function checkHealth(): Promise<void> {
  const res = await fetch(`${workerUrl}/health`);
  assertStatus(res, 200, "GET /health");
  const body = (await res.json()) as { status?: string; version?: string };
  assert(body.status === "ok", `health status is ${String(body.status)}`);
  assert(typeof body.version === "string" && body.version.length > 0, "health version is present");
}

export async function checkNormalVideoFlow(): Promise<void> {
  const url = `https://www.youtube.com/watch?v=smoke-normal-${runId}`;
  const first = await client.translateVideo({ videoData: vd(url) });
  assert(first.status === 2, `normal first status is ${first.status}, expected 2 (processing)`);

  const done = await client.translateVideo({ videoData: vd(url) });
  assert(done.status === 1, `normal final status is ${done.status}, expected 1 (done)`);
  assert(done.translated, "normal response is translated");
  assert(
    typeof done.url === "string" && done.url.endsWith(".mp3"),
    "normal done url ends with .mp3",
  );
}

export async function checkAudioGatedFlow(): Promise<void> {
  const url = `https://youtu.be/smoke-audio-${runId}`;
  // shouldSendFailedAudio:false keeps the package from auto-uploading the
  // fallback empty audio, so status 6 stays observable for the manual upload.
  const waiting = await client.translateVideo({ videoData: vd(url), shouldSendFailedAudio: false });
  assert(waiting.status === 6, `audio waiting status is ${waiting.status}, expected 6`);
  assert(!waiting.translated, "audio waiting response is not translated");
  assert(waiting.translationId.length > 0, "audio translationId is present");
  assertRemainingTime(waiting.remainingTime);

  // Full (non-partial) audio buffer completes the translation outright.
  const uploaded = await client.provider.requestVtransAudio(url, waiting.translationId, {
    audioFile: new Uint8Array([1]),
    fileId: `smoke-audio-${runId}`,
  });
  assert(uploaded.status === 2, `audio upload status is ${uploaded.status}, expected 2`);

  const processing = await client.translateVideo({
    videoData: vd(url),
    shouldSendFailedAudio: false,
  });
  assert(
    processing.status === 2,
    `audio processing status is ${processing.status}, expected 2`,
  );

  const done = await client.translateVideo({ videoData: vd(url), shouldSendFailedAudio: false });
  assert(done.status === 1, `audio done status is ${done.status}, expected 1`);
  assert(done.translated, "audio done response is translated");
  assert(
    typeof done.url === "string" && done.url.endsWith(".mp3"),
    "audio done url ends with .mp3",
  );
}

export async function checkCache(): Promise<void> {
  const body = await client.provider.translateVideoCache({
    videoData: vd(`https://youtu.be/smoke-cache-${runId}`),
  });
  assert(body.default?.status === 0, `cache default status is ${body.default?.status}, expected 0`);
  assert(body.cloning?.status === 2, `cache cloning status is ${body.cloning?.status}, expected 2`);
  assertRemainingTime(body.cloning?.remainingTime);
}

export async function checkFailureFlow(): Promise<void> {
  const url = `https://youtu.be/smoke-fail-${runId}`;
  const failed = await client.provider.requestVtransFailAudio(url);
  const failedStatus =
    typeof failed.data === "string" || failed.data === null ? failed.data : failed.data.status;
  assert(failedStatus === 1, `fail-audio-js status is ${String(failedStatus)}`);

  let thrown: unknown;
  try {
    await client.translateVideo({ videoData: vd(url) });
  } catch (error) {
    thrown = error;
  }
  assert(thrown instanceof VOTJSError, "failed translate throws VOTJSError");
  const data = thrown.data as { status?: unknown; message?: unknown };
  assert(
    data.status === 0,
    `failed translate status is ${String(data.status)}, expected 0 (failed)`,
  );
  assert(data.message === FAILED_MESSAGE, `failed translate message is ${String(data.message)}`);
}

export async function checkSubtitles(): Promise<void> {
  const body = await client.getSubtitles({
    videoData: vd(`https://youtu.be/smoke-subs-${runId}`),
  });
  assert(body.waiting === false, "subtitles waiting is false");
  assert(body.subtitles.length > 0, "subtitle list is not empty");
  const subtitle = body.subtitles[0];
  assert(subtitle !== undefined, "first subtitle is present");
  assert(
    typeof subtitle.url === "string" && subtitle.url.includes("/vtrans/"),
    "subtitle source url is present",
  );
  assert(
    typeof subtitle.translatedUrl === "string" &&
      subtitle.translatedUrl.includes("/vtrans/translated/"),
    "subtitle translated url is present",
  );
}

export async function checkStreamAndPing(): Promise<void> {
  // No `.m3u8`/similar extension: the package `isCustomLink` rejects custom
  // links for streams. The mock still answers with a `.m3u8` translated url.
  const body = await client.translateStream({
    videoData: vd(`https://www.youtube.com/watch?v=smoke-stream-${runId}`),
  });
  // 20 is StreamInterval.STREAMING (literal keeps `@vot.js/shared` out of smoke).
  assert(body.interval === 20, `stream interval is ${body.interval}, expected 20 (STREAMING)`);
  assert(body.translated, "stream response is translated");
  assert(
    typeof body.result?.url === "string" && body.result.url.endsWith(".m3u8"),
    "stream translated url ends with .m3u8",
  );

  const ping = await client.provider.pingStream({ pingId: body.pingId });
  assert(ping === true, `ping-stream result is ${String(ping)}, expected true`);
}

function unsignedProbeBody(): Uint8Array {
  return YandexVOTProtobuf.encodeTranslationRequest(
    `https://www.youtube.com/watch?v=smoke-no-sec-${runId}`,
    60,
    "en",
    "ru",
    null,
  );
}

export async function secValidationEnabled(): Promise<boolean> {
  const bytes = unsignedProbeBody();
  const res = await workerCall("/video-translation/translate", {
    body: Array.from(bytes),
    headers: { "content-type": "application/x-protobuf" },
  });
  return res.status === 402;
}

export async function checkNegativeRoutes(secEnabled: boolean): Promise<void> {
  const notFound = await fetch(`${workerUrl}/__smoke_missing__`);
  assertStatus(notFound, 204, "unknown route");
  assert(
    notFound.headers.get("x-yandex-status") === "error-path",
    `unknown route X-Yandex-Status is ${notFound.headers.get("x-yandex-status")}`,
  );

  const invalid = await workerCall("/video-translation/translate", { not: "a valid payload" });
  assertStatus(invalid, 204, "invalid payload");
  assert(
    invalid.headers.get("x-yandex-status") === invalidPayloadStatus,
    `invalid payload X-Yandex-Status is ${invalid.headers.get("x-yandex-status")}, ` +
      `expected ${invalidPayloadStatus} for worker "${workerKind}"`,
  );

  if (!secEnabled) {
    console.log(
      `  ${f.skip(SYM.skip)} unsigned protected request ${f.dim("(mock sec validation disabled)")}`,
    );
    return;
  }
  const unsigned = await workerCall("/video-translation/translate", {
    body: Array.from(unsignedProbeBody()),
    headers: { "content-type": "application/x-protobuf" },
  });
  assertStatus(unsigned, 402, "unsigned protected request");
}
