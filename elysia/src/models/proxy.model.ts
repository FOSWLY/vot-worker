import { t } from "elysia";

const HeadersType = t.Record(t.String(), t.Any());

export const proxyModel = {
  proxyRequestBody: t.Object({
    body: t.Array(t.Any()),
    headers: HeadersType,
  }),
  proxyJsonRequestBody: t.Object({
    body: t.String(),
    headers: HeadersType,
  }),
  proxyFileParams: t.Object({
    "*": t.String(),
  }),
};
