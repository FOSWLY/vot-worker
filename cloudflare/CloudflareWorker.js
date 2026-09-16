// Original script: https://github.com/mynovelhost/voice-over-translation/blob/master/CloudflareWorker.js

const VERSION = "1.1.0";

const YANDEX_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 YaBrowser/26.8.0.0 Safari/537.36";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, GET, PUT, HEAD, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const CORS_HEADERS_KEYS = Object.keys(CORS_HEADERS);

const HOP_BY_HOP_HEADERS = ["upgrade", "transfer-encoding"];

const PROTOBUF_MEDIA_TYPE = "application/x-protobuf";
const JSON_MEDIA_TYPE = "application/json";
const VOT_HEADERS_NAME = "x-vot-headers";

// Never forwarded upstream from `X-VOT-Headers` (matched case-insensitively).
const FILTERED_UPSTREAM_HEADERS = new Set([
  "host",
  "content-length",
  "connection",
  "transfer-encoding",
  "x-vot-headers",
]);

function mediaTypeOf(value) {
  if (typeof value !== "string") return "";
  return value.split(";")[0].trim().toLowerCase();
}

// Base64(JSON) -> string-valued object. Decoded via `atob`, so each byte maps
// to one code unit (Latin-1, not UTF-8). Standard alphabet, padded or not;
// url-safe chars, bad encoding, non-object JSON or non-string values are null.
function decodeVotHeaders(value) {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (raw.length === 0 || raw.includes("-") || raw.includes("_")) return null;
  let parsed;
  try {
    parsed = JSON.parse(atob(raw));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const headers = {};
  for (const [key, val] of Object.entries(parsed)) {
    if (typeof val !== "string") return null;
    if (FILTERED_UPSTREAM_HEADERS.has(key.toLowerCase())) continue;
    headers[key] = val;
  }
  return headers;
}

function isByteRouteContentType(contentType) {
  const mediaType = mediaTypeOf(contentType);
  return mediaType === PROTOBUF_MEDIA_TYPE || mediaType === JSON_MEDIA_TYPE;
}

const S3_URLS = {
  audio: "vtrans.s3-private.mds.yandex.net/tts/prod/",
  subs: "brosubs.s3-private.mds.yandex.net/vtrans/",
};

// Single upstream for the protobuf and JSON API routes. Local development sets
// `env.YANDEX_API_URL` (e.g. `--var YANDEX_API_URL:http://127.0.0.1:3001` in
// `wrangler dev`); production falls back to the real Yandex host.
const DEFAULT_YANDEX_API_URL = "https://api.browser.yandex.ru";

// Normalize the configured origin to `<origin><path>` without a trailing slash
// (unset/invalid values fall back to production), so joining an absolute
// pathname with `new URL` can never produce a double slash.
function normalizeYandexApiUrl(value) {
  const raw = typeof value === "string" && value.length > 0 ? value : DEFAULT_YANDEX_API_URL;
  try {
    const url = new URL(raw);
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return DEFAULT_YANDEX_API_URL;
  }
}

function yandexRequestUrl(base, pathname) {
  return new URL(pathname, `${base}/`).toString();
}

function errorResponse(message) {
  return new Response(null, {
    status: 204,
    headers: {
      ...CORS_HEADERS,
      "X-Yandex-Status": message,
    },
  });
}

function healthResponse() {
  return new Response(
    JSON.stringify({
      status: "ok",
      version: VERSION,
    }),
    {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/json",
      },
    },
  );
}

function badRequestResponse() {
  return new Response("Bad Request", {
    status: 400,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json",
    },
  });
}

async function makeRequest(request) {
  let upstream;
  try {
    upstream = await fetch(request);
  } catch {
    return errorResponse("error-internal");
  }
  const response = new Response(upstream.body, upstream);
  response.headers.delete("date");
  for (const hopByHopHeader of HOP_BY_HOP_HEADERS) {
    response.headers.delete(hopByHopHeader);
  }
  for (const corsHeaderKey of CORS_HEADERS_KEYS) {
    response.headers.delete(corsHeaderKey);
    response.headers.set(corsHeaderKey, CORS_HEADERS[corsHeaderKey]);
  }

  response.headers.set("X-Yandex-Status", "success");
  return response;
}

async function handleYandexRequest(request, pathname, yandexApiUrl) {
  const mediaType = mediaTypeOf(request.headers.get("content-type"));

  if (mediaType === PROTOBUF_MEDIA_TYPE) {
    const metadataHeaders = decodeVotHeaders(request.headers.get(VOT_HEADERS_NAME));
    if (metadataHeaders == null) return errorResponse("error-request");

    const yandexRequest = new Request(yandexRequestUrl(yandexApiUrl, pathname), {
      body: new Uint8Array(await request.arrayBuffer()),
      method: request.method,
      headers: metadataHeaders,
    });

    return await makeRequest(yandexRequest);
  }

  if (mediaType !== JSON_MEDIA_TYPE) return errorResponse("error-content");

  let requestInfo;
  try {
    requestInfo = await request.json();
  } catch {
    return badRequestResponse();
  }

  // Reject malformed envelopes locally: non-object headers or a non-array
  // body must never reach the upstream (or throw inside `new Request`).
  if (
    typeof requestInfo !== "object" ||
    requestInfo === null ||
    Array.isArray(requestInfo) ||
    typeof requestInfo.headers !== "object" ||
    requestInfo.headers === null ||
    Array.isArray(requestInfo.headers) ||
    !Array.isArray(requestInfo.body)
  )
    return errorResponse("error-request");

  const yandexRequest = new Request(yandexRequestUrl(yandexApiUrl, pathname), {
    body: new Uint8Array(requestInfo.body),
    method: request.method,
    headers: requestInfo.headers,
  });

  return await makeRequest(yandexRequest);
}

async function handleS3ProxyRequest(type, pathname, search, method, range) {
  if (!search) return errorResponse("error-request");

  const fileName = pathname.split("/").slice(3).join("/");
  const audioRequest = new Request(`https://${S3_URLS[type]}${fileName}${search}`, {
    method,
    headers: {
      "User-Agent": YANDEX_USER_AGENT,
      ...(range ? { Range: range } : {}),
    },
  });

  return await makeRequest(audioRequest);
}

async function handleYAJSONRequest(request, pathname, yandexApiUrl) {
  const votRaw = request.headers.get(VOT_HEADERS_NAME);
  if (votRaw !== null) {
    const metadataHeaders = decodeVotHeaders(votRaw);
    if (metadataHeaders == null) return errorResponse("error-request");

    // Plain JSON is proxied verbatim: the body is never parsed or validated.
    let text;
    try {
      text = await request.text();
    } catch {
      return badRequestResponse();
    }

    const headers = new Headers({
      "User-Agent": YANDEX_USER_AGENT,
      ...metadataHeaders,
    });
    // `set` replaces case-insensitively: a record spread alone would keep both
    // `content-type` and `Content-Type`, which fetch comma-joins upstream.
    headers.set("Content-Type", "application/json");
    const audioRequest = new Request(yandexRequestUrl(yandexApiUrl, pathname), {
      body: text,
      method: request.method,
      headers,
    });

    return await makeRequest(audioRequest);
  }

  let requestInfo;
  try {
    requestInfo = await request.json();
  } catch {
    return badRequestResponse();
  }

  if (
    typeof requestInfo !== "object" ||
    requestInfo === null ||
    Array.isArray(requestInfo) ||
    typeof requestInfo.headers !== "object" ||
    requestInfo.headers === null ||
    Array.isArray(requestInfo.headers) ||
    typeof requestInfo.body !== "string"
  )
    return errorResponse("error-request");

  const headers = new Headers({
    "User-Agent": YANDEX_USER_AGENT,
    ...requestInfo.headers,
  });
  // `set` replaces case-insensitively: a record spread alone would keep both
  // `content-type` and `Content-Type`, which fetch comma-joins upstream.
  headers.set("Content-Type", "application/json");
  const audioRequest = new Request(yandexRequestUrl(yandexApiUrl, pathname), {
    body: requestInfo.body,
    method: request.method,
    headers,
  });

  return await makeRequest(audioRequest);
}

const route = {
  async fetch(request, env) {
    const yandexApiUrl = normalizeYandexApiUrl(env?.YANDEX_API_URL);

    if (request.method == "OPTIONS")
      return new Response(null, {
        headers: {
          ...CORS_HEADERS,
          Allow: "GET, POST, PUT, OPTIONS",
        },
      });

    const url = new URL(request.url);

    if (
      [
        "/video-translation/translate",
        "/video-translation/cache",
        "/video-subtitles/get-subtitles",
        "/stream-translation/translate-stream",
        "/stream-translation/ping-stream",
        "/session/create",
      ].includes(url.pathname)
    ) {
      // translate endpoint (POST)
      if (request.method !== "POST") return errorResponse("error-path");

      if (!isByteRouteContentType(request.headers.get("content-type")))
        return errorResponse("error-content");

      return await handleYandexRequest(request, url.pathname, yandexApiUrl);
    } else if (url.pathname === "/video-translation/audio") {
      // translate endpoint (PUT)
      if (request.method !== "PUT") return errorResponse("error-path");

      if (!isByteRouteContentType(request.headers.get("content-type")))
        return errorResponse("error-content");

      return await handleYandexRequest(request, url.pathname, yandexApiUrl);
    } else if (url.pathname === "/video-translation/fail-audio-js") {
      if (request.method !== "PUT") return errorResponse("error-path");

      if (mediaTypeOf(request.headers.get("content-type")) !== JSON_MEDIA_TYPE)
        return errorResponse("error-content");

      return await handleYAJSONRequest(request, url.pathname, yandexApiUrl);
    } else if (
      url.pathname.startsWith("/video-translation/audio-proxy/") &&
      url.pathname.length > "/video-translation/audio-proxy/".length
    ) {
      // proxy endpoint
      if (request.method !== "GET" && request.method !== "HEAD") return errorResponse("error-path");

      if (!url.pathname.endsWith(".mp3")) return errorResponse("error-content");

      return await handleS3ProxyRequest(
        "audio",
        url.pathname,
        url.search,
        request.method,
        request.headers.get("range"),
      );
    } else if (url.pathname.startsWith("/video-subtitles/subtitles-proxy")) {
      // proxy endpoint
      if (request.method !== "GET" && request.method !== "HEAD") return errorResponse("error-path");

      return await handleS3ProxyRequest(
        "subs",
        url.pathname,
        url.search,
        request.method,
        request.headers.get("range"),
      );
    } else if (url.pathname === "/health" && request.method === "GET") {
      return healthResponse();
    } else {
      return errorResponse("error-path");
    }
  },
};

export default {
  async fetch(request, env) {
    const response = await route.fetch(request, env);
    if (env?.SERVER_ID) response.headers.set("X-VOT-SERVER-ID", env.SERVER_ID);
    return response;
  },
};
