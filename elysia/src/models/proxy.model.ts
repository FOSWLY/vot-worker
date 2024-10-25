import Elysia, { t } from "elysia";

const HeadersType = t.Record(t.String(), t.Any());

export default new Elysia().model({
  "proxy-model": t.Object({
    body: t.Array(t.Any()),
    headers: HeadersType,
  }),
  "proxy-json-model": t.Object({
    body: t.Union([t.Record(t.String(), t.Any()), t.Array(t.Any())]),
    headers: HeadersType,
  }),
  "proxy-file-model": t.Object({
    "*": t.String(),
  }),
});
