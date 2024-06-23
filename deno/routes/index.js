import { Router } from "https://deno.land/x/oak@v12.6.1/mod.ts";

import videoTranslationRouter from "./videoTranslation.js";
import videoSubtitlesRouter from "./videoSubtitles.js";
import streamTranslationRouter from "./streamTranslation.js";
import sessionRouter from "./session.js";
import healthRouter from "./health.js";

const mainRouter = new Router()
  .use(
    "/video-translation",
    videoTranslationRouter.routes(),
    videoTranslationRouter.allowedMethods()
  )
  .use(
    "/video-subtitles",
    videoSubtitlesRouter.routes(),
    videoSubtitlesRouter.allowedMethods()
  )
  .use(
    "/stream-translation",
    streamTranslationRouter.routes(),
    streamTranslationRouter.allowedMethods()
  )
  .use("/session", sessionRouter.routes(), sessionRouter.allowedMethods())
  .use("/health", healthRouter.routes(), healthRouter.allowedMethods());

export default mainRouter;
