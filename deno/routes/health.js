import { Router, Status } from "https://deno.land/x/oak@v12.6.1/mod.ts";
import { version } from "../config.js";

const healthRouter = new Router()
  .get("/", (ctx) => {
    ctx.response.status = Status.OK;
    ctx.response.headers.append("Content-Type", "application/json");
    ctx.response.body = JSON.stringify({
      status: "ok",
      version
    });
  });

export default healthRouter;
