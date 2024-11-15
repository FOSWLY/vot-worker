import path from "node:path";
import { LoggerLevel } from "./types/logging";
import { version } from "../package.json";

const rootPath = path.join(__dirname, "..");
let proxyList: string[] = [];
try {
  const proxyFile = Bun.file(path.join(rootPath, "proxies.txt"));
  proxyList = (await proxyFile.text()).split("\n").filter(Boolean);
} catch {
  /* empty */
}

export default {
  port: Bun.env.SERVICE_PORT ?? 3001,
  hostname: "0.0.0.0",
  version,
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 YaBrowser/24.7.0.0 Safari/537.36",
  proxy: {
    list: proxyList,
    force: Bun.env.PROXY_FORCE === "true",
    ignoreS3: Bun.env.PROXY_IGNORE_S3 === "true",
  },
  logging: {
    level: LoggerLevel.INFO,
    logPath: path.join(rootPath, "logs"),
    loki: {
      host: Bun.env.LOKI_HOST ?? "",
      user: Bun.env.LOKI_USER ?? "",
      password: Bun.env.LOKI_PASSWORD ?? "",
      label: Bun.env.LOKI_LABEL ?? "vot-worker",
    },
  },
  cors: {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "POST, GET, PUT, OPTIONS",
    "access-control-max-age": "86400",
  },
  s3Urls: {
    audio: "vtrans.s3-private.mds.yandex.net/tts/prod/",
    subs: "brosubs.s3-private.mds.yandex.net/vtrans/",
  },
};
