import { s3Urls, yandexUserAgent } from "./config.js";
const repeatableHeaders = ["date", ...Object.keys(corsHeaders)];

async function makeRequest(ctx, url, options) {
  const response = await fetch(url, options);

  ctx.response.status = response.status;
  ctx.response.body = response.body;
  for (const repeatableHeader of repeatableHeaders) {
    ctx.response.headers.delete(repeatableHeader);
  }

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
  return await makeRequest(ctx, `https://${s3Urls[type]}${fileName}${search}`, {
    headers: {
      "User-Agent": yandexUserAgent,
    },
  });
}

export { makeRequestToYandex, makeS3Request };
