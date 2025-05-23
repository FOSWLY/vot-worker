import { Router, Status } from "@oak/oak";

import { version } from "../config.js";

const healthRouter = new Router().get("/", (ctx) => {
  ctx.response.status = Status.OK;
  ctx.response.headers.append("Content-Type", "application/json");
  ctx.response.body = JSON.stringify({
    status: "ok",
    version,
  });
});

export default healthRouter;
