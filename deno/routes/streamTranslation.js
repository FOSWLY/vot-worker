import { Router } from "@oak/oak";

import { makeRequestToYandex } from "../requests.js";
import { validateJSONRequest } from "../validators.js";

const streamTranslationRouter = new Router()
  .post("/translate-stream", async (ctx) => {
    const [body, headers] = await validateJSONRequest(ctx);
    if (!body || !headers) {
      return;
    }

    // if the value is different from key:value, it will throw 500 error
    return await makeRequestToYandex(
      ctx,
      "stream-translation/translate-stream",
      body,
      headers
    );
  })
  .post("/ping-stream", async (ctx) => {
    const [body, headers] = await validateJSONRequest(ctx);
    if (!body || !headers) {
      return;
    }

    // if the value is different from key:value, it will throw 500 error
    return await makeRequestToYandex(
      ctx,
      "stream-translation/ping-stream",
      body,
      headers
    );
  });

export default streamTranslationRouter;
