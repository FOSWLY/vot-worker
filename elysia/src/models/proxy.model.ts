import { t } from "elysia";

export const proxyModel = {
  proxyFileParams: t.Object({
    "*": t.String(),
  }),
};
