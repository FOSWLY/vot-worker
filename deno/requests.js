import { yandexUserAgent } from "./config.js";

async function makeRequest(ctx, url, options) {
  const response = await fetch(
    url,
    options,
  );

  ctx.response.status = response.status;
  ctx.response.body = response.body;
  ctx.response.headers = response.headers;
  
  ctx.response.headers.append("X-Yandex-Status", "success");
}

async function makeRequestToYandex(ctx, pathname, body, headers) {
  return await makeRequest(ctx, `https://api.browser.yandex.ru/${pathname}`, {
    body: body,
    method: "POST",
    headers: headers,
  });
}

async function makeAudioRequest(ctx, audioName, search) {
  return await makeRequest(ctx, `https://vtrans.s3-private.mds.yandex.net/tts/prod/${audioName}${search}`, {
    headers: {
      "User-Agent": yandexUserAgent,
    },
  });
}

export { makeRequestToYandex, makeAudioRequest };
