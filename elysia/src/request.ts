import config from "./config";
import { log } from "./logging";

async function makeRequest(url: string | URL, options: Record<any, any>) {
  const response = await fetch(url, options);
  response.headers.append("X-Yandex-Status", "success");
  response.headers.delete("Access-Control-Allow-Origin");
  const body = response.body;
  if (![200, 204, 206, 301, 304, 404].includes(response.status)) {
    log.error(
      {
        url,
        options: JSON.stringify(options),
        response: body,
        status: response.status,
      },
      "An error occurred during the make request",
    );
  }

  return new Response(body, {
    status: response.status,
    headers: response.headers,
  });
}

async function makeRequestToYandex(pathname: string, body: unknown, headers: Record<any, any>) {
  return await makeRequest(`https://api.browser.yandex.ru/${pathname}`, {
    body,
    method: "POST",
    headers,
  });
}

async function makeS3Request(
  request: Request,
  type: "audio" | "subs",
  fileName: string,
  search: string,
) {
  const url = `https://${config.s3Urls[type]}${fileName}?${search}`;
  const response = await makeRequest(url, {
    method: request.method,
    headers: {
      "User-Agent": config.userAgent,
    },
  });

  // remove repeatable field
  response.headers.delete("date");
  if (
    type === "subs" ||
    !response.body ||
    ![200, 206].includes(response.status) ||
    request.method === "HEAD"
  ) {
    response.headers.delete("content-encoding");
    return new Response(request.method === "HEAD" ? null : response.body, {
      headers: response.headers,
      status: response.status,
    });
  }

  // https://github.com/oven-sh/bun/issues/10440
  const opts = { code: 200, start: 0, end: Infinity, range: false };
  const file = await Bun.readableStreamToBlob(response.body);

  response.headers.set("Content-Length", "" + file.size);
  if (request.headers.has("range")) {
    opts.code = 206;
    const [x, y] = request.headers.get("range")!.replace("bytes=", "").split("-");
    const end = (opts.end = parseInt(y, 10) || file.size - 1);
    const start = (opts.start = parseInt(x, 10) || 0);

    if (start >= file.size || end >= file.size) {
      response.headers.set("Content-Range", `bytes */${file.size}`);
      return new Response(null, {
        headers: response.headers,
        status: 416,
      });
    }

    response.headers.set("Content-Range", `bytes ${start}-${end}/${file.size}`);
    response.headers.set("Content-Length", "" + (end - start + 1));
    opts.range = true;
  }

  const blob = opts.range ? file.slice(opts.start, opts.end) : file;
  return new Response(blob.stream(), {
    headers: response.headers,
    status: opts.code,
  });
}

export { makeRequest, makeRequestToYandex, makeS3Request };
