import { Status } from "https://deno.land/x/oak@v12.6.1/mod.ts";

function errorResponse(ctx, message) {
  ctx.response.status = Status.NoContent;
  ctx.response.body = null;
  ctx.response.headers.append("X-Yandex-Status", message);
}

export { errorResponse };
