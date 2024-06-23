import { Elysia } from "elysia";
import { makeRequestToYandex } from "../../request";
import ProxyModel from "../../models/proxy.model";

export default new Elysia().group("/video-subtitles", (app) =>
  app.use(ProxyModel).post(
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
  ),
);
