import * as path from "node:path";

import { Elysia } from "elysia";
import { formatters, pino, createPinoLogger } from "@bogeychan/elysia-logger";
import pinnoPretty from "pino-pretty";

import config from "./config";

const stream = pinnoPretty({
  colorize: true,
});

const startingDate = new Date().toISOString().split("T")[0];

export const log = createPinoLogger({
  level: config.logging.level,
  formatters: {
    ...formatters,
    level: (label) => {
      return { level: label.toUpperCase() };
    },
  },
  stream: pino.multistream([
    stream,
    pino.destination(path.join(config.logging.logPath, `${startingDate}.log`)),
  ]),
});

// https://elysiajs.com/essential/plugin#service-locator
export default new Elysia().use(
  log.into({
    autoLogging: config.logging.logRequests as true,
  }),
);
