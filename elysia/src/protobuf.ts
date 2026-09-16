import { BadRequestError, ValidationRequestError } from "@/errors";

export const PROTOBUF_MEDIA_TYPE = "application/x-protobuf";
export const JSON_MEDIA_TYPE = "application/json";
export const VOT_HEADERS_NAME = "x-vot-headers";

// Never forwarded upstream from `X-VOT-Headers` (matched case-insensitively).
const FILTERED_UPSTREAM_HEADERS = new Set([
  "host",
  "content-length",
  "connection",
  "transfer-encoding",
  "x-vot-headers",
]);

export function mediaType(contentType: string | null | undefined): string {
  if (typeof contentType !== "string") return "";
  return contentType.split(";")[0]!.trim().toLowerCase();
}

// Base64(JSON) -> string-valued object. Decoded via `atob`, so each byte maps
// to one code unit (Latin-1, not UTF-8). Standard alphabet, padded or not;
// url-safe chars, bad encoding, non-object JSON or non-string values are null.
export function decodeVotHeaders(value: string | null | undefined): Record<string, string> | null {
  if (typeof value !== "string") {
    return null;
  }

  const raw = value.trim();
  if (raw.length === 0 || raw.includes("-") || raw.includes("_")) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(atob(raw));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }

  const headers: Record<string, string> = {};
  for (const [key, val] of Object.entries(parsed)) {
    if (typeof val !== "string") return null;
    if (FILTERED_UPSTREAM_HEADERS.has(key.toLowerCase())) continue;
    headers[key] = val;
  }
  return headers;
}

function toByteArray(rawBody: unknown): Uint8Array {
  if (rawBody instanceof Uint8Array) return rawBody;
  if (rawBody instanceof ArrayBuffer) return new Uint8Array(rawBody);
  throw new ValidationRequestError("error-request");
}

// Shared by every byte route; callers must set `parse: "arrayBuffer"`.
export function resolveByteRouteBody(
  request: Request,
  rawBody: unknown,
): { bytes: Uint8Array; headers: Record<string, unknown> } {
  const type = mediaType(request.headers.get("content-type"));

  if (type === PROTOBUF_MEDIA_TYPE) {
    const metadata = decodeVotHeaders(request.headers.get(VOT_HEADERS_NAME));
    if (metadata === null) throw new ValidationRequestError("error-request");
    return { bytes: toByteArray(rawBody), headers: metadata };
  }

  if (type !== JSON_MEDIA_TYPE) throw new ValidationRequestError("error-content");

  const bytes = toByteArray(rawBody);
  let envelope: unknown;
  try {
    envelope = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new BadRequestError();
  }
  // Any envelope shape problem is `error-request` (unknown content-type above
  // stays `error-content`), matching the other runtimes.
  if (typeof envelope !== "object" || envelope === null || Array.isArray(envelope)) {
    throw new ValidationRequestError("error-request");
  }
  const { headers, body } = envelope as { headers?: unknown; body?: unknown };
  if (typeof headers !== "object" || headers === null || Array.isArray(headers)) {
    throw new ValidationRequestError("error-request");
  }
  if (!Array.isArray(body)) throw new ValidationRequestError("error-request");
  return { bytes: new Uint8Array(body), headers: headers as Record<string, unknown> };
}

// JSON-only `fail-audio-js`: with `X-VOT-Headers` the body is plain JSON
// forwarded verbatim (no local parse/validation); without it the legacy envelope
// `{headers, body: string}` applies. Callers must set `parse: "arrayBuffer"`, so
// the raw bytes are parsed here: a malformed envelope is `400`, while envelope
// shape problems (or a bad `X-VOT-Headers`) are `error-request`.
export function resolveFailAudioJsBody(
  request: Request,
  rawBody: unknown,
): { body: string; headers: Record<string, unknown> } {
  if (mediaType(request.headers.get("content-type")) !== JSON_MEDIA_TYPE) {
    throw new ValidationRequestError("error-content");
  }
  const votRaw = request.headers.get(VOT_HEADERS_NAME);
  if (votRaw !== null) {
    const metadata = decodeVotHeaders(votRaw);
    if (metadata === null) throw new ValidationRequestError("error-request");
    const text = new TextDecoder().decode(toByteArray(rawBody));
    const upstreamHeaders: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(metadata)) {
      if (key.toLowerCase() !== "content-type") upstreamHeaders[key] = value;
    }
    upstreamHeaders["Content-Type"] = "application/json";
    return { body: text, headers: upstreamHeaders };
  }
  if (rawBody === undefined) throw new BadRequestError();

  const bytes = toByteArray(rawBody);
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new BadRequestError();
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ValidationRequestError("error-request");
  }
  const { headers, body: audioBody } = body as { headers?: unknown; body?: unknown };
  if (
    typeof headers !== "object" ||
    headers === null ||
    Array.isArray(headers) ||
    typeof audioBody !== "string"
  ) {
    throw new ValidationRequestError("error-request");
  }
  // Forced case-insensitively: a record spread would keep both `content-type`
  // and `Content-Type`, which fetch comma-joins upstream.
  const upstreamHeaders: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== "content-type") upstreamHeaders[key] = value;
  }
  upstreamHeaders["Content-Type"] = "application/json";
  return { body: audioBody, headers: upstreamHeaders };
}
