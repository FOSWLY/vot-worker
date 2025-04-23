use axum::{
    extract::{Path, RawQuery},
    http::HeaderMap,
    response::IntoResponse,
    routing::{get, head, post, put},
    Router,
};
use reqwest::Method;

use crate::utils::handlers::{request_audio, request_browser_bytes, request_browser_json};

async fn post_vtrans_translate(headers: HeaderMap, body: String) -> impl IntoResponse {
    request_browser_bytes("/video-translation/translate", headers, body, Method::POST).await
}

async fn post_vtrans_cache(headers: HeaderMap, body: String) -> impl IntoResponse {
    request_browser_bytes("/video-translation/cache", headers, body, Method::POST).await
}

async fn put_vtrans_audio(headers: HeaderMap, body: String) -> impl IntoResponse {
    request_browser_bytes("/video-translation/audio", headers, body, Method::PUT).await
}

async fn put_vtrans_fail_audio_js(headers: HeaderMap, body: String) -> impl IntoResponse {
    request_browser_json(
        "/video-translation/fail-audio-js",
        headers,
        body,
        Method::PUT,
    )
    .await
}

async fn get_audio_proxy(
    headers: HeaderMap,
    Path(path): Path<String>,
    RawQuery(query): RawQuery,
) -> impl IntoResponse {
    request_audio(headers, path, query, Method::GET).await
}

async fn head_audio_proxy(
    headers: HeaderMap,
    Path(path): Path<String>,
    RawQuery(query): RawQuery,
) -> impl IntoResponse {
    request_audio(headers, path, query, Method::HEAD).await
}

pub fn get_router() -> Router {
    Router::new()
        .route("/translate", post(post_vtrans_translate))
        .route("/cache", post(post_vtrans_cache))
        .route("/audio", put(put_vtrans_audio))
        .route("/fail-audio-js", put(put_vtrans_fail_audio_js))
        .route("/audio-proxy/{*file_name}", get(get_audio_proxy))
        .route("/audio-proxy/{*file_name}", head(head_audio_proxy))
}
