import { Elysia } from "elysia";

import { makeRequestToYandex } from "@/request";
import { resolveByteRouteBody } from "@/protobuf";

export default new Elysia().group("/session", (app) =>
  app.post(
    "/create",
    async ({ body, request }) => {
      const resolved = resolveByteRouteBody(request, body);
      return await makeRequestToYandex("session/create", resolved.bytes, resolved.headers);
    },
    {
      parse: "arrayBuffer",
    },
  ),
);
