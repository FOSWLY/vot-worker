import { Application, Status } from "@oak/oak";

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

console.log(`🐿️ Oak is running at ${host}:${port}`);
await app.listen({ host, port });
