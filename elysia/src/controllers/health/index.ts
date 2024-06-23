import { Elysia } from "elysia";

import config from "../../config";

export default new Elysia().group("/health", (app) =>
  app.get("/", () => ({
    status: "ok",
    version: config.version,
  })),
);
