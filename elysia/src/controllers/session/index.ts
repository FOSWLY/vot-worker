import { Elysia } from "elysia";

import { makeRequestToYandex } from "@/request";
import { proxyModel } from "@/models/proxy.model";

export default new Elysia().group("/session", (app) =>
  app.post(
    "/create",
    async ({ body }) => {
      return await makeRequestToYandex("session/create", new Uint8Array(body.body), body.headers);
    },
    {
      body: proxyModel.proxyRequestBody,
    },
  ),
);
