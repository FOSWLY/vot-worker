import config from "@/config";
import { log } from "@/logging";

const { proxy: proxyData } = config;
const repeatableHeaders = ["date", ...Object.keys(config.cors)];
const hopByHopHeaders = ["upgrade", "transfer-encoding"];

const getRandomProxy = () => proxyData.list[Math.floor(Math.random() * proxyData.list.length)];

const getProxy = (isS3Request: boolean) => {
  if (!proxyData.list.length || (isS3Request && proxyData.ignoreS3)) {
    return "";
  }

  return getRandomProxy();
};

async function makeRequest(url: string | URL, options: Record<any, any>, isS3Request = false) {
  const proxy = getProxy(isS3Request);
  const fetchOpts: BunFetchRequestInit = {
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
    for (const repeatableHeader of repeatableHeaders) {
      response.headers.delete(repeatableHeader);
    }
    for (const hopByHopHeader of hopByHopHeaders) {
      response.headers.delete(hopByHopHeader);
    }

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
        "X-Yandex-Status": "error-internal",
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
  // `pathname` has no leading slash; the base may or may not end with one.
  const base = config.yandexApiUrl.replace(/\/+$/, "");
  return await makeRequest(`${base}/${pathname.replace(/^\/+/, "")}`, {
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

  response.headers.delete("content-encoding");
  response.headers.delete("content-length");
  return new Response(request.method === "HEAD" ? null : response.body, {
    headers: response.headers,
    status: response.status,
  });
}

export { makeRequest, makeRequestToYandex, makeS3Request };
