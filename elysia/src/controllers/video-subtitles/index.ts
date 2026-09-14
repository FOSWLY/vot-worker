import { Elysia } from "elysia";

import { makeS3Request, makeRequestToYandex } from "@/request";
import { ValidationRequestError } from "@/errors";
import { proxyModel } from "@/models/proxy.model";
import { FileProxyOpts } from "@/types/requests";

async function subtitlesProxy({ params, query, request }: FileProxyOpts) {
  const fileName = params["*"];
  if (!Object.keys(query).length) {
    throw new ValidationRequestError("error-request");
  }

  return await makeS3Request(
    request,
    "subs",
    fileName,
    new URLSearchParams(query as Record<string, string>).toString(),
  );
}

export default new Elysia().group("/video-subtitles", (app) =>
  app
    .post(
      "/get-subtitles",
      async ({ body }) => {
        return await makeRequestToYandex(
          "video-subtitles/get-subtitles",
          new Uint8Array(body.body),
          body.headers,
        );
      },
      {
        body: proxyModel.proxyRequestBody,
      },
    )
    .get("/subtitles-proxy/*", subtitlesProxy, {
      params: proxyModel.proxyFileParams,
    })
    .head("/subtitles-proxy/*", subtitlesProxy, {
      params: proxyModel.proxyFileParams,
    }),
);
