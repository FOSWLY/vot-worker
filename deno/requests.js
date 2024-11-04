import { s3Urls, yandexUserAgent } from "./config.js";

async function makeRequest(ctx, url, options) {
  const response = await fetch(url, options);

  ctx.response.status = response.status;
  ctx.response.body = response.body;
  ctx.response.headers.delete("Access-Control-Allow-Origin");

  for (const [name, value] of response.headers) {
    ctx.response.headers.append(name, value);
  }

  ctx.response.headers.append("X-Yandex-Status", "success");
}

async function makeRequestToYandex(
  ctx,
  pathname,
  body,
  headers,
  method = "POST"
) {
  return await makeRequest(ctx, `https://api.browser.yandex.ru/${pathname}`, {
    body,
    method,
    headers,
  });
}

async function makeS3Request(ctx, type, fileName, search) {
  const range = ctx.request.headers.get("range");
  return await makeRequest(ctx, `https://${s3Urls[type]}${fileName}${search}`, {
    headers: {
      "User-Agent": yandexUserAgent,
      ...(range
        ? {
            Range: range,
          }
        : {}),
    },
  });
}

export { makeRequestToYandex, makeS3Request };
