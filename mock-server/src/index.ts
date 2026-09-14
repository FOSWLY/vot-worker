import { buildApp } from "./app.ts";
import { formatter, SYM } from "./log.ts";

const port = Number(process.env.PORT ?? 3001);
const hostname = process.env.HOSTNAME ?? "127.0.0.1";

buildApp().listen({ port, hostname });
const endpoint = `http://${hostname}:${port}`;
const f = formatter();
console.log(
  f.color
    ? `${f.accent(SYM.node)} ${f.accent("mock-server")} ${f.dim("listening on")} ` +
        `${f.success(endpoint)}`
    : `[mock-server] listening on ${endpoint}`,
);
