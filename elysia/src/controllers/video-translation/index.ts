import { Elysia } from "elysia";

import { makeS3Request, makeRequestToYandex } from "@/request";
import { ValidationRequestError } from "@/errors";
import { proxyModel } from "@/models/proxy.model";
import { FileProxyOpts } from "@/types/requests";

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
        body: proxyModel.proxyRequestBody,
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
        body: proxyModel.proxyRequestBody,
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
        body: proxyModel.proxyRequestBody,
      },
    )
    .put(
      "/fail-audio-js",
      async ({ body }) => {
        return await makeRequestToYandex(
          "video-translation/fail-audio-js",
          body.body,
          { ...body.headers, "Content-Type": "application/json" },
          "PUT",
        );
      },
      {
        body: proxyModel.proxyJsonRequestBody,
      },
    )
    .get("/audio-proxy/*", audioProxy, {
      params: proxyModel.proxyFileParams,
    })
    .head("/audio-proxy/*", audioProxy, {
      params: proxyModel.proxyFileParams,
    }),
);
