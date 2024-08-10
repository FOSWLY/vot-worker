import path from "node:path";
import { pino, type TransportMultiOptions, type TransportTargetOptions } from "pino";

import config from "./config";

const startingDate = new Date().toISOString().split("T")[0];

type PinoOpts = Parameters<typeof pino>[0] & {
  transport: TransportMultiOptions & { targets: TransportTargetOptions[] };
};

// https://github.com/pinojs/pino/issues/1791
// if don't take out the options separately, it willn't work
const opts: PinoOpts = {
  level: config.logging.level,
  redact: {
    // these just cause clutter
    paths: ["pid", "hostname"],
    remove: true,
  },
  transport: {
    targets: [],
  },
};

// it may be higher level than global, but it cann't be lower
opts.transport.targets.push({
  level: config.logging.level,
  target: "pino-pretty",
  options: {
    colorized: true,
  },
});

opts.transport.targets.push({
  level: config.logging.level,
  target: "pino/file",
  options: {
    destination: path.join(config.logging.logPath, `${startingDate}.log`),
  },
});

export const log = pino(opts);
