import * as path from "node:path";
import { LoggerLevel } from "./types/logging";
import { version } from "../package.json";

export default {
  port: Bun.env.SERVICE_PORT ?? 3001,
  hostname: "0.0.0.0",
  version,
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 YaBrowser/24.6.0.0 Safari/537.36",
  logging: {
    level: LoggerLevel.INFO,
    logRequests: false, // for debugging (true/false)
    logPath: path.join(__dirname, "..", "logs"),
  },
  cors: {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Max-Age": "86400",
  },
};
