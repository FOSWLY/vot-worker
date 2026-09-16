import path from "node:path";

import { defineConfig, env, t } from "@nirelc/microconf";
import { version } from "../package.json";
import { LoggerLevel } from "@/types/logging";

const rootPath = path.join(__dirname, "..");
let proxyList: string[] = [];
try {
  const proxyFile = Bun.file(path.join(rootPath, "proxies.txt"));
  proxyList = (await proxyFile.text()).split("\n").filter(Boolean);
} catch {
  /* empty */
}

export default defineConfig({
  schema: {
    port: t.number().default(3001),
    hostname: t.string().default("0.0.0.0"),
    version: t.literal(version).default(version),
    userAgent: t
      .string()
      .default(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 YaBrowser/26.8.0.0 Safari/537.36",
      ),
    yandexApiUrl: t.string().default("https://api.browser.yandex.ru"),
    serverId: t.string().default(""),
    proxy: {
      list: t.array(t.string()).default(proxyList),
      force: t.boolean().default(false),
      ignoreS3: t.boolean().default(false),
    },
    logging: {
      level: t
        .string()
        .default("")
        .transform((value) => {
          return value === "production" ? LoggerLevel.INFO : LoggerLevel.DEBUG;
        }),
      logPath: t.string().default(path.join(rootPath, "logs")),
      logToFile: t.boolean().default(false),
      loki: {
        host: t.string().default(""),
        user: t.string().default(""),
        password: t.string().default(""),
        label: t.string().default("vot-worker"),
      },
    },
    cors: {
      "access-control-allow-origin": t.string().default("*"),
      "access-control-allow-headers": t.string().default("*"),
      "access-control-allow-methods": t.string().default("POST, GET, PUT, HEAD, OPTIONS"),
      "access-control-max-age": t.string().default("86400"),
    },
    s3Urls: {
      audio: t.string().default("vtrans.s3-private.mds.yandex.net/tts/prod/"),
      subs: t.string().default("brosubs.s3-private.mds.yandex.net/vtrans/"),
    },
  },
  sources: [
    env({
      delimiter: "_",
      renames: {
        PORT: "SERVICE_PORT",
        HOSTNAME: "SERVICE_HOSTNAME",
        LOGGING_LEVEL: "NODE_ENV",
        LOGGING_LOG_PATH: "LOG_PATH",
        LOGGING_LOG_TO_FILE: "LOG_TO_FILE",
        LOGGING_LOKI_HOST: "LOKI_HOST",
        LOGGING_LOKI_USER: "LOKI_USER",
        LOGGING_LOKI_PASSWORD: "LOKI_PASSWORD",
        LOGGING_LOKI_LABEL: "LOKI_LABEL",
      },
    }),
  ],
});
