use axum::{http::HeaderMap, response::IntoResponse, routing::post, Router};

use reqwest::Method;

use crate::utils::handlers::request_browser_bytes;

async fn post_session_create(headers: HeaderMap, body: String) -> impl IntoResponse {
    request_browser_bytes("/session/create", headers, body, Method::POST).await
}

pub fn get_router() -> Router {
    Router::new().route("/create", post(post_session_create))
}
