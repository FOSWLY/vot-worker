import Elysia, { t } from "elysia";

export default new Elysia().model({
  "proxy-model": t.Object({
    body: t.Array(t.Any()),
    headers: t.Object(t.Any()),
  }),
  "proxy-file-model": t.Object({
    fileName: t.String(),
  }),
});
