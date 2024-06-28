import config from "./config";

async function makeRequest(url: string | URL, options: Record<any, any>) {
  const response = await fetch(url, options);
  response.headers.append("X-Yandex-Status", "success");

  return new Response(response.body, {
    status: response.status,
    headers: response.headers,
  });
}

async function makeRequestToYandex(pathname: string, body: any, headers: Record<any, any>) {
  return await makeRequest(`https://api.browser.yandex.ru/${pathname}`, {
    body: body,
    method: "POST",
    headers: headers,
  });
}

async function makeAudioRequest(request: Request, audioName: string, search: string) {
  const response = await makeRequest(
    `https://vtrans.s3-private.mds.yandex.net/tts/prod/${audioName}?${search}`,
    {
      headers: {
        "User-Agent": config.userAgent,
      },
    },
  );

  if (!response.body) {
    return response;
  }

  // https://github.com/oven-sh/bun/issues/10440
  const opts = { code: 200, start: 0, end: Infinity, range: false };
  const file = await Bun.readableStreamToBlob(response.body);

  // remove repeatable field
  response.headers.delete("date");

  response.headers.set("Content-Length", "" + file.size);
  if (request.headers.has("range")) {
    opts.code = 206;
    let [x, y] = request.headers.get("range")!.replace("bytes=", "").split("-");
    let end = (opts.end = parseInt(y, 10) || file.size - 1);
    let start = (opts.start = parseInt(x, 10) || 0);

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

export { makeRequest, makeRequestToYandex, makeAudioRequest };
