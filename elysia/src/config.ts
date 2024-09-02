import path from "node:path";
import { LoggerLevel } from "./types/logging";
import { version } from "../package.json";

export default {
  port: Bun.env.SERVICE_PORT ?? 3001,
  hostname: "0.0.0.0",
  version,
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 YaBrowser/24.7.0.0 Safari/537.36",
  logging: {
    level: LoggerLevel.INFO,
    logPath: path.join(__dirname, "..", "logs"),
    loki: {
      host: Bun.env.LOKI_HOST ?? "",
      user: Bun.env.LOKI_USER ?? "",
      password: Bun.env.LOKI_PASSWORD ?? "",
      label: Bun.env.LOKI_LABEL ?? "vot-worker",
    },
  },
  cors: {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Max-Age": "86400",
  },
  s3Urls: {
    audio: "vtrans.s3-private.mds.yandex.net/tts/prod/",
    subs: "brosubs.s3-private.mds.yandex.net/vtrans/",
  },
};
