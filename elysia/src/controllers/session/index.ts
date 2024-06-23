import { Elysia } from "elysia";
import { makeRequestToYandex } from "../../request";
import ProxyModel from "../../models/proxy.model";

export default new Elysia().group("/session", (app) =>
  app.use(ProxyModel).post(
    "/create",
    async ({ body }) => {
      return await makeRequestToYandex("session/create", new Uint8Array(body.body), body.headers);
    },
    {
      body: "proxy-model",
    },
  ),
);
