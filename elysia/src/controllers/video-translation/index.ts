import { Elysia, t } from "elysia";
import { makeAudioRequest, makeRequestToYandex } from "../../request";
import { ValidationRequestError } from "../../errors";
import ProxyModel from "../../models/proxy.model";

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
    .get(
      "/audio-proxy/:audioId",
      async ({ params: { audioId }, query }) => {
        if (!audioId.endsWith(".mp3")) {
          throw new ValidationRequestError("error-content");
        }

        if (!Object.keys(query).length) {
          throw new ValidationRequestError("error-request");
        }

        return await makeAudioRequest(
          audioId,
          new URLSearchParams(query as Record<string, string>).toString(),
        );
      },
      {
        params: t.Object({
          audioId: t.String(),
        }),
      },
    ),
);
