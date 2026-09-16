import { Elysia } from "elysia";

import { makeRequestToYandex } from "@/request";
import { resolveByteRouteBody } from "@/protobuf";

export default new Elysia().group("/stream-translation", (app) =>
  app
    .post(
      "/translate-stream",
      async ({ body, request }) => {
        const resolved = resolveByteRouteBody(request, body);
        return await makeRequestToYandex(
          "stream-translation/translate-stream",
          resolved.bytes,
          resolved.headers,
        );
      },
      {
        parse: "arrayBuffer",
      },
    )
    .post(
      "/ping-stream",
      async ({ body, request }) => {
        const resolved = resolveByteRouteBody(request, body);
        return await makeRequestToYandex(
          "stream-translation/ping-stream",
          resolved.bytes,
          resolved.headers,
        );
      },
      {
        parse: "arrayBuffer",
      },
    ),
);
