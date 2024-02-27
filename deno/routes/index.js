import { Router } from "https://deno.land/x/oak@v12.6.1/mod.ts";

import videoTranslationRouter from "./videoTranslation.js";
import videoSubtitlesRouter from "./videoSubtitles.js";
import streamTranslationRouter from "./streamTranslation.js";
import healthRouter from "./health.js";

const mainRouter = new Router();
mainRouter.use(
  "/video-translation",
  videoTranslationRouter.routes(),
  videoTranslationRouter.allowedMethods(),
);
mainRouter.use(
  "/video-subtitles",
  videoSubtitlesRouter.routes(),
  videoSubtitlesRouter.allowedMethods(),
);
mainRouter.use(
  "/stream-translation",
  streamTranslationRouter.routes(),
  streamTranslationRouter.allowedMethods(),
);
mainRouter.use(
  "/health",
  healthRouter.routes(),
  healthRouter.allowedMethods(),
);

export default mainRouter;
