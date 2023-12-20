import { Router } from "https://deno.land/x/oak@v12.6.1/mod.ts";
import { makeRequestToYandex, makeAudioRequest } from "../requests.js";
import { errorResponse } from "../responses.js";
import { validateJSONRequest } from "../validators.js";

const videoTranslationRouter = new Router()
  .post("/translate", async (ctx) => {
    const [body, headers] = await validateJSONRequest(ctx);
    if (!body || !headers) {
      return;
    }

    // if the value is different from key:value, it will throw 500 error
    return await makeRequestToYandex(
      ctx,
      "video-translation/translate",
      body,
      headers,
    );
  })
  .get("/audio-proxy/:audioId", async (ctx) => {
    const { audioId } = ctx.params;
    if (!audioId || !audioId?.endsWith(".mp3")) {
      return errorResponse(ctx, "error-content");
    }

    const search = ctx.request.url.search;
    if (!search) {
      return errorResponse(ctx, "error-request");
    }

    return await makeAudioRequest(ctx, audioId, search);
  });

export default videoTranslationRouter;
