import { Elysia } from "elysia";
import { makeS3Request, makeRequestToYandex } from "../../request";
import ProxyModel from "../../models/proxy.model";
import { ValidationRequestError } from "../../errors";
import { FileProxyOpts } from "../../types/requests";

async function subtitlesProxy({ params: { fileName }, query, request }: FileProxyOpts) {
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
    .use(ProxyModel)
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
        body: "proxy-model",
      },
    )
    .get("/subtitles-proxy/:fileName", subtitlesProxy, {
      params: "proxy-file-model",
    })
    .head("/subtitles-proxy/:fileName", subtitlesProxy, {
      params: "proxy-file-model",
    }),
);
