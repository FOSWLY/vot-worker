import { Router } from "https://deno.land/x/oak@v12.6.1/mod.ts";
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
      headers,
    );
  })

export default videoSubtitlesRouter;
