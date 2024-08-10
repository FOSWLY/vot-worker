import { Elysia } from "elysia";
import { HttpStatusCode } from "elysia-http-status-code";

import * as fs from "fs";

import config from "./config";

import healthController from "./controllers/health";
import videoTranslationController from "./controllers/video-translation";
import streamTranslationController from "./controllers/stream-translation";
import videoSubtitlesController from "./controllers/video-subtitles";
import sessionController from "./controllers/session";
import { log } from "./logging";
import { ValidationRequestError } from "./errors";

if (!fs.existsSync(config.logging.logPath)) {
  fs.mkdirSync(config.logging.logPath, { recursive: true });
  log.info(`Created log directory`);
}

const app = new Elysia()
  .use(HttpStatusCode())
  .error({
    VALIDATION_REQUEST_ERROR: ValidationRequestError,
  })
  .onRequest(({ set }) => {
    for (const [key, val] of Object.entries(config.cors)) {
      set.headers[key] = val;
    }
  })
  .onError(({ set, code, error, httpStatus }) => {
    switch (code) {
      case "NOT_FOUND":
        set.status = httpStatus.HTTP_204_NO_CONTENT;
        return "";
      case "VALIDATION":
      case "VALIDATION_REQUEST_ERROR":
        set.status = httpStatus.HTTP_204_NO_CONTENT;
        set.headers["X-Yandex-Status"] =
          (error as ValidationRequestError).data ?? code === "VALIDATION"
            ? "error-content"
            : "error-request";
        return "";
      case "PARSE":
        return "Bad Request";
    }

    return {
      error: error.message,
    };
  })
  .use(healthController)
  .use(videoTranslationController)
  .use(streamTranslationController)
  .use(videoSubtitlesController)
  .use(sessionController)
  .listen({
    port: config.port,
    hostname: config.hostname,
  });

log.info(`🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`);
