import { Application, Status } from "https://deno.land/x/oak@v12.6.1/mod.ts";
import { corsHeaders, host, port } from "./config.js";

import mainRouter from "./routes/index.js";

const app = new Application();

// Global CORS
app.use(async (ctx, next) => {
  for (const corsHeaderKey of Object.keys(corsHeaders)) {
    ctx.response.headers.set(corsHeaderKey, corsHeaders[corsHeaderKey]);
  }

  if (ctx.request.method === "OPTIONS") {
    ctx.response.status = Status.NoContent;
    return;
  }

  await next();
});

app.use(mainRouter.routes());

await app.listen({ host, port });
