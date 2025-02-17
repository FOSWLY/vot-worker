use axum::{http::HeaderMap, response::IntoResponse, routing::post, Router};
use reqwest::Method;

use crate::utils::handlers::request_browser_bytes;

async fn post_strans_translate_stream(headers: HeaderMap, body: String) -> impl IntoResponse {
    request_browser_bytes(
        "/stream-translation/translate-stream",
        headers,
        body,
        Method::POST,
    )
    .await
}

async fn post_strans_ping_stream(headers: HeaderMap, body: String) -> impl IntoResponse {
    request_browser_bytes(
        "/stream-translation/ping-stream",
        headers,
        body,
        Method::POST,
    )
    .await
}

pub fn get_router() -> Router {
    Router::new()
        .route("/translate-stream", post(post_strans_translate_stream))
        .route("/ping-stream", post(post_strans_ping_stream))
}
