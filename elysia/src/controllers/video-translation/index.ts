import { Elysia } from "elysia";
import { makeS3Request, makeRequestToYandex } from "../../request";
import { ValidationRequestError } from "../../errors";
import ProxyModel from "../../models/proxy.model";
import { FileProxyOpts } from "../../types/requests";

async function audioProxy({ params, query, request }: FileProxyOpts) {
  const fileName = params["*"];
  if (!fileName.endsWith(".mp3")) {
    throw new ValidationRequestError("error-content");
  }

  if (!Object.keys(query).length) {
    throw new ValidationRequestError("error-request");
  }

  return await makeS3Request(
    request,
    "audio",
    fileName,
    new URLSearchParams(query as Record<string, string>).toString(),
  );
}

export default new Elysia().group("/video-translation", (app) =>
  app
    .use(ProxyModel)
    .post(
      "/translate",
      async ({ body }) => {
        return await makeRequestToYandex(
          "video-translation/translate",
          new Uint8Array(body.body),
          body.headers,
        );
      },
      {
        body: "proxy-model",
      },
    )
    .post(
      "/cache",
      async ({ body }) => {
        return await makeRequestToYandex(
          "video-translation/cache",
          new Uint8Array(body.body),
          body.headers,
        );
      },
      {
        body: "proxy-model",
      },
    )
    .put(
      "/audio",
      async ({ body }) => {
        return await makeRequestToYandex(
          "video-translation/audio",
          new Uint8Array(body.body),
          body.headers,
          "PUT",
        );
      },
      {
        body: "proxy-model",
      },
    )
    .put(
      "/fail-audio-js",
      async ({ body }) => {
        return await makeRequestToYandex(
          "video-translation/fail-audio-js",
          body.body,
          body.headers,
          "PUT",
        );
      },
      {
        body: "proxy-json-model",
      },
    )
    .get("/audio-proxy/*", audioProxy, {
      params: "proxy-file-model",
    })
    .head("/audio-proxy/*", audioProxy, {
      params: "proxy-file-model",
    }),
);
