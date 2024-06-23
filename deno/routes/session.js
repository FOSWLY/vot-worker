import { Router } from "https://deno.land/x/oak@v12.6.1/mod.ts";

const sessionRouter = new Router().post("/create", async (ctx) => {
  const [body, headers] = await validateJSONRequest(ctx);
  if (!body || !headers) {
    return;
  }

  // if the value is different from key:value, it will throw 500 error
  return await makeRequestToYandex(ctx, "session/create", body, headers);
});

export default sessionRouter;
