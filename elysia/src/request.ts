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

async function makeAudioRequest(audioName: string, search: string) {
  return await makeRequest(
    `https://vtrans.s3-private.mds.yandex.net/tts/prod/${audioName}?${search}`,
    {
      headers: {
        "User-Agent": config.userAgent,
      },
    },
  );
}

export { makeRequest, makeRequestToYandex, makeAudioRequest };
