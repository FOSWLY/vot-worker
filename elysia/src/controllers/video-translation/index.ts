import { Elysia } from "elysia";
import { makeS3Request, makeRequestToYandex } from "../../request";
import { ValidationRequestError } from "../../errors";
import ProxyModel from "../../models/proxy.model";
import { FileProxyOpts } from "../../types/requests";

async function audioProxy({ params: { fileName }, query, request }: FileProxyOpts) {
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
    .get("/audio-proxy/:fileName", audioProxy, {
      params: "proxy-file-model",
    })
    .head("/audio-proxy/:fileName", audioProxy, {
      params: "proxy-file-model",
    }),
);
