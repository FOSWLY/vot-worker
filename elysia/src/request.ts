import config from "./config";
import { log } from "./logging";

const { proxy: proxyData } = config;

const getRandomProxy = () =>
  // eslint-disable-next-line sonarjs/pseudo-random
  proxyData.list[Math.floor(Math.random() * proxyData.list.length)];

const getProxy = (isS3Request: boolean) => {
  if (!proxyData.list.length || (isS3Request && proxyData.ignoreS3)) {
    return "";
  }

  return getRandomProxy();
};

async function makeRequest(url: string | URL, options: Record<any, any>, isS3Request = false) {
  const proxy = getProxy(isS3Request);
  const fetchOpts: FetchRequestInit = {
    ...options,
    proxy,
  };
  const logOpts = JSON.stringify(fetchOpts);
  try {
    if (!(isS3Request && proxyData.ignoreS3) && proxyData.force && !proxy) {
      throw new Error("Failed to find any available proxy");
    }

    const response = await fetch(url, fetchOpts);
    response.headers.append("X-Yandex-Status", "success");
    response.headers.delete("Access-Control-Allow-Origin");
    const body = response.body;
    const headers = response.headers;
    if (![200, 204, 206, 301, 304, 404].includes(response.status)) {
      const isCaptchaError = headers.has("x-yandex-captcha");
      if (isCaptchaError) {
        proxyData.list = proxyData.list.filter((proxyItem) => proxyItem !== proxy);
      }

      log.error(
        {
          url,
          options: logOpts,
          headers,
          status: response.status,
          proxy,
        },
        isCaptchaError
          ? "Request has been temporarily blocked by Yandex Captcha"
          : "An error occurred during the make request",
      );
    }

    return new Response(body, {
      status: response.status,
      headers,
    });
  } catch (err) {
    const message = (err as Error).message;
    log.error({ url, message, options: logOpts, proxy }, "Failed to make request");
    return new Response(null, {
      status: 204,
      headers: {
        "X-Yandex-Status": message,
      },
    });
  }
}

async function makeRequestToYandex(
  pathname: string,
  body: unknown,
  headers: Record<any, any>,
  method = "POST",
) {
  return await makeRequest(`https://api.browser.yandex.ru/${pathname}`, {
    body,
    method,
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
  const range = request.headers.get("range");
  const response = await makeRequest(
    url,
    {
      method: request.method,
      headers: {
        "User-Agent": config.userAgent,
        ...(range
          ? {
              Range: range,
            }
          : {}),
      },
    },
    true,
  );

  // remove repeatable field
  response.headers.delete("date");
  if (
    type === "subs" ||
    !response.body ||
    ![200, 206].includes(response.status) ||
    request.method === "HEAD"
  ) {
    response.headers.delete("content-encoding");
  }

  return new Response(response.body, {
    headers: response.headers,
    status: response.status,
  });
}

export { makeRequest, makeRequestToYandex, makeS3Request };
