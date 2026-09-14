import { Elysia } from "elysia";

import { makeRequestToYandex } from "@/request";
import { proxyModel } from "@/models/proxy.model";

export default new Elysia().group("/stream-translation", (app) =>
  app
    .post(
      "/translate-stream",
      async ({ body }) => {
        return await makeRequestToYandex(
          "stream-translation/translate-stream",
          new Uint8Array(body.body),
          body.headers,
        );
      },
      {
        body: proxyModel.proxyRequestBody,
      },
    )
    .post(
      "/ping-stream",
      async ({ body }) => {
        return await makeRequestToYandex(
          "stream-translation/ping-stream",
          new Uint8Array(body.body),
          body.headers,
        );
      },
      {
        body: proxyModel.proxyRequestBody,
      },
    ),
);
