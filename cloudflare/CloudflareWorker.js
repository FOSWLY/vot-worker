// Original script: https://github.com/mynovelhost/voice-over-translation/blob/master/CloudflareWorker.js

const version = "1.0.13";

const yandexUserAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 YaBrowser/24.7.0.0 Safari/537.36";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, GET, PUT, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const corsHeadersKeys = Object.keys(corsHeaders);

const s3Urls = {
  audio: "vtrans.s3-private.mds.yandex.net/tts/prod/",
  subs: "brosubs.s3-private.mds.yandex.net/vtrans/",
};

function errorResponse(message) {
  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders,
      "X-Yandex-Status": message,
    },
  });
}

function healthResponse() {
  return new Response(
    JSON.stringify({
      status: "ok",
      version,
    }),
    {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    }
  );
}

function badRequestResponse() {
  return new Response("Bad Request", {
    status: 400,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

async function makeRequest(request) {
  let response = await fetch(request);
  response = new Response(response.body, response);
  response.headers.delete("date");
  for (const corsHeaderKey of corsHeadersKeys) {
    response.headers.delete(corsHeaderKey);
    response.headers.set(corsHeaderKey, corsHeaders[corsHeaderKey]);
  }

  response.headers.set("X-Yandex-Status", "success");
  return response;
}

async function handleYandexRequest(request, pathname) {
  let requestInfo;
  try {
    requestInfo = await request.json();
  } catch {
    return badRequestResponse();
  }

  if (requestInfo.headers == null || requestInfo.body == null)
    return errorResponse("error-request");

  const yandexRequest = new Request(
    "https://api.browser.yandex.ru" + pathname,
    {
      body: new Uint8Array(requestInfo.body),
      method: request.method,
      headers: requestInfo.headers,
    }
  );

  return await makeRequest(yandexRequest);
}

async function handleS3ProxyRequest(type, pathname, search) {
  if (search === undefined) return errorResponse("error-request");

  const fileName = pathname.split("/").slice(3).join("/");
  const audioRequest = new Request(
    `https://${s3Urls[type]}${fileName}${search}`,
    {
      headers: {
        "User-Agent": yandexUserAgent,
      },
    }
  );

  return await makeRequest(audioRequest);
}

async function handleYAJSONRequest(request, pathname) {
  let requestInfo;
  try {
    requestInfo = await request.json();
  } catch {
    return badRequestResponse();
  }

  if (requestInfo.headers == null || requestInfo.body == null)
    return errorResponse("error-request");

  const audioRequest = new Request(`https://api.browser.yandex.ru${pathname}`, {
    body: requestInfo.body,
    method: request.method,
    headers: {
      "User-Agent": yandexUserAgent,
      "Content-Type": "application/json",
      ...requestInfo.headers,
    },
  });

  return await makeRequest(audioRequest);
}

addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method == "OPTIONS")
    return event.respondWith(
      new Response(null, {
        headers: {
          ...corsHeaders,
          Allow: "GET, POST, PUT, OPTIONS",
        },
      })
    );

  const url = new URL(request.url);

  if (
    [
      "/video-translation/translate",
      "/video-subtitles/get-subtitles",
      "/stream-translation/translate-stream",
      "/stream-translation/ping-stream",
      "/session/create",
    ].includes(url.pathname)
  ) {
    // translate endpoint (POST)
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.includes("application/json"))
      return event.respondWith(errorResponse("error-content"));

    if (request.method !== "POST")
      return event.respondWith(errorResponse("error-method"));

    return event.respondWith(handleYandexRequest(request, url.pathname));
  } else if (url.pathname === "/video-translation/audio") {
    // translate endpoint (PUT)
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.includes("application/json"))
      return event.respondWith(errorResponse("error-content"));

    if (request.method !== "PUT")
      return event.respondWith(errorResponse("error-method"));

    return event.respondWith(handleYandexRequest(request, url.pathname));
  } else if (url.pathname === "/video-translation/fail-audio-js") {
    if (request.method !== "PUT")
      return event.respondWith(errorResponse("error-method"));

    return event.respondWith(handleYAJSONRequest(request, url.pathname));
  } else if (
    url.pathname.startsWith("/video-translation/audio-proxy") &&
    url.pathname.endsWith(".mp3")
  ) {
    // proxy endpoint
    if (request.method !== "GET")
      return event.respondWith(errorResponse("error-method"));

    return event.respondWith(
      handleS3ProxyRequest("audio", url.pathname, url.search)
    );
  } else if (url.pathname.startsWith("/video-subtitles/subtitles-proxy")) {
    // proxy endpoint
    if (request.method !== "GET")
      return event.respondWith(errorResponse("error-method"));

    return event.respondWith(
      handleS3ProxyRequest("subs", url.pathname, url.search)
    );
  } else if (url.pathname === "/health" && request.method === "GET") {
    return event.respondWith(healthResponse());
  } else {
    return event.respondWith(errorResponse("error-path"));
  }
});
