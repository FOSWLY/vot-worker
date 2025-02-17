use axum::{
    extract::{Path, RawQuery},
    http::HeaderMap,
    response::IntoResponse,
    routing::{get, head, post},
    Router,
};
use reqwest::Method;

use crate::utils::handlers::{request_browser_bytes, request_subs};

async fn post_vsubs_get_subtitles(headers: HeaderMap, body: String) -> impl IntoResponse {
    request_browser_bytes(
        "/video-subtitles/get-subtitles",
        headers,
        body,
        Method::POST,
    )
    .await
}

async fn get_subs_proxy(Path(path): Path<String>, RawQuery(query): RawQuery) -> impl IntoResponse {
    request_subs(path, query, Method::GET).await
}

async fn head_subs_proxy(Path(path): Path<String>, RawQuery(query): RawQuery) -> impl IntoResponse {
    request_subs(path, query, Method::HEAD).await
}

pub fn get_router() -> Router {
    Router::new()
        .route("/get-subtitles", post(post_vsubs_get_subtitles))
        .route("/subtitles-proxy/{*file_name}", get(get_subs_proxy))
        .route("/subtitles-proxy/{*file_name}", head(head_subs_proxy))
}
