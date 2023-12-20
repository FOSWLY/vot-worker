import { errorResponse } from "./responses.js";

async function validateJSONRequest(ctx) {
  const contentType = ctx.request.headers.get("Content-Type");
  if (contentType !== "application/json") {
    errorResponse(ctx, "error-content");
    return [null, null];
  }

  const requestBody = ctx.request.body();
  const requestInfo = await requestBody.value;

  let yandexBody = requestInfo.body;
  const yandexHeaders = requestInfo.headers;

  if ((yandexBody == undefined && yandexHeaders == undefined)) {
    errorResponse(ctx, "error-request");
    return [null, null];
  }

  yandexBody = new Uint8Array(yandexBody);

  return [yandexBody, yandexHeaders];
}

export { validateJSONRequest };
