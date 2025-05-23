import { Router } from "@oak/oak";

import { makeRequestToYandex } from "../requests.js";
import { validateJSONRequest } from "../validators.js";

const videoSubtitlesRouter = new Router()
  .post("/get-subtitles", async (ctx) => {
    const [body, headers] = await validateJSONRequest(ctx);
    if (!body || !headers) {
      return;
    }

    // if the value is different from key:value, it will throw 500 error
    return await makeRequestToYandex(
      ctx,
      "video-subtitles/get-subtitles",
      body,
      headers
    );
  })
  .get("/subtitles-proxy/:fileName*", async (ctx) => {
    const { fileName } = ctx.params;
    const search = ctx.request.url.search;
    if (!search) {
      return errorResponse(ctx, "error-request");
    }

    return await makeS3Request(ctx, "subs", fileName, search);
  });

export default videoSubtitlesRouter;
