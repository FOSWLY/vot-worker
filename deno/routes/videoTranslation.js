import { Router } from "https://deno.land/x/oak@v12.6.1/mod.ts";
import { makeRequestToYandex, makeS3Request } from "../requests.js";
import { errorResponse } from "../responses.js";
import { validateJSONRequest } from "../validators.js";

const videoTranslationRouter = new Router()
  .post("/translate", async (ctx) => {
    const [body, headers] = await validateJSONRequest(ctx);
    if (!body || !headers) {
      return errorResponse(ctx, "error-content");
    }

    // if the value is different from key:value, it will throw 500 error
    return await makeRequestToYandex(
      ctx,
      "video-translation/translate",
      body,
      headers
    );
  })
  .get("/audio-proxy/:fileName", async (ctx) => {
    const { fileName } = ctx.params;
    if (!fileName?.endsWith(".mp3")) {
      return errorResponse(ctx, "error-content");
    }

    const search = ctx.request.url.search;
    if (!search) {
      return errorResponse(ctx, "error-request");
    }

    return await makeS3Request(ctx, "audio", fileName, search);
  });

export default videoTranslationRouter;
