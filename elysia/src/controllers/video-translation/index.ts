import { Elysia } from "elysia";

import { makeS3Request, makeRequestToYandex } from "@/request";
import { ValidationRequestError } from "@/errors";
import { proxyModel } from "@/models/proxy.model";
import { resolveByteRouteBody, resolveFailAudioJsBody } from "@/protobuf";
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
      async ({ body, request }) => {
        const resolved = resolveByteRouteBody(request, body);
        return await makeRequestToYandex(
          "video-translation/translate",
          resolved.bytes,
          resolved.headers,
        );
      },
      {
        parse: "arrayBuffer",
      },
    )
    .post(
      "/cache",
      async ({ body, request }) => {
        const resolved = resolveByteRouteBody(request, body);
        return await makeRequestToYandex(
          "video-translation/cache",
          resolved.bytes,
          resolved.headers,
        );
      },
      {
        parse: "arrayBuffer",
      },
    )
    .put(
      "/audio",
      async ({ body, request }) => {
        const resolved = resolveByteRouteBody(request, body);
        return await makeRequestToYandex(
          "video-translation/audio",
          resolved.bytes,
          resolved.headers,
          "PUT",
        );
      },
      {
        parse: "arrayBuffer",
      },
    )
    .put(
      "/fail-audio-js",
      async ({ body, request }) => {
        const resolved = resolveFailAudioJsBody(request, body);
        return await makeRequestToYandex(
          "video-translation/fail-audio-js",
          resolved.body,
          resolved.headers,
          "PUT",
        );
      },
      {
        parse: "arrayBuffer",
      },
    )
    .get("/audio-proxy/*", audioProxy, {
      params: proxyModel.proxyFileParams,
    })
    .head("/audio-proxy/*", audioProxy, {
      params: proxyModel.proxyFileParams,
    }),
);
