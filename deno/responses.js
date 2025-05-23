import { Status } from "@oak/oak";

function errorResponse(ctx, message) {
  ctx.response.status = Status.NoContent;
  ctx.response.body = null;
  ctx.response.headers.append("X-Yandex-Status", message);
}

export { errorResponse };
