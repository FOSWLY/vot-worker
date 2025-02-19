use axum::{
    body::Body,
    http::{HeaderMap, Response},
};
use reqwest::{Method, StatusCode};
use serde_json::{Map, Value};

use super::utils::value_to_bytes;
use crate::api;

pub fn return_error(message: &'static str) -> Response<Body> {
    Response::builder()
        .status(StatusCode::NO_CONTENT)
        .header("X-Yandex-Status", message)
        .body(Body::from(""))
        .unwrap()
}

pub fn parse_request(
    headers: HeaderMap,
    body: String,
) -> Result<(Value, Map<String, Value>), Response<Body>> {
    if headers.get("content-type").and_then(|v| v.to_str().ok()) != Some("application/json") {
        return Err(return_error("error-content"));
    }
    let body_info: Value =
        serde_json::from_str(&body).map_err(|_| return_error("error-request"))?;
    let yandex_body = body_info
        .get("body")
        .cloned()
        .ok_or_else(|| return_error("error-request"))?;
    let yandex_headers = body_info
        .get("headers")
        .and_then(Value::as_object)
        .ok_or_else(|| return_error("error-request"))?;
    Ok((yandex_body, yandex_headers.clone()))
}

fn parse_json_body(body: Value) -> Value {
    body.as_str()
        .filter(|s| !s.is_empty())
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or(body)
}

async fn process_api_request<F>(headers: HeaderMap, body: String, build_client: F) -> Response<Body>
where
    F: FnOnce(Value, Map<String, Value>) -> Option<reqwest::RequestBuilder>,
{
    let (yandex_body, yandex_headers) = match parse_request(headers, body) {
        Ok(val) => val,
        Err(resp) => return resp,
    };
    let client = match build_client(yandex_body, yandex_headers) {
        Some(builder) => builder,
        None => return return_error("error-request"),
    };
    api::browser::request(client)
        .await
        .unwrap_or_else(|_| return_error("error-internal"))
}

pub async fn request_browser_bytes(
    pathname: &str,
    headers: HeaderMap,
    body: String,
    method: Method,
) -> Response<Body> {
    process_api_request(headers, body, |yandex_body, yandex_headers| {
        value_to_bytes(&yandex_body)
            .map(|bytes| api::browser::build_bytes_client(pathname, bytes, &yandex_headers, method))
    })
    .await
}

pub async fn request_browser_json(
    pathname: &str,
    headers: HeaderMap,
    body: String,
    method: Method,
) -> Response<Body> {
    process_api_request(headers, body, |yandex_body, yandex_headers| {
        Some(api::browser::build_json_client(
            pathname,
            parse_json_body(yandex_body),
            &yandex_headers,
            method,
        ))
    })
    .await
}

pub async fn request_audio(
    headers: HeaderMap,
    path: String,
    query: Option<String>,
    method: Method,
) -> Response<Body> {
    if !path.ends_with(".mp3") {
        return return_error("error-content");
    }
    let query_str = query.unwrap_or_default();
    if query_str.is_empty() {
        return return_error("error-request");
    }
    let range = headers.get("range").cloned();
    let client = api::browser::build_s3_audio_client(path, query_str, method, range.as_ref());
    match api::browser::request(client).await {
        Ok(resp) => resp,
        Err(_) => return_error("error-internal"),
    }
}

pub async fn request_subs(path: String, query: Option<String>, method: Method) -> Response<Body> {
    let query_str = query.unwrap_or_default();
    if query_str.is_empty() {
        return return_error("error-request");
    }
    let client = api::browser::build_s3_subs_client(path, query_str, method);
    match api::browser::request(client).await {
        Ok(resp) => resp,
        Err(_) => return_error("error-internal"),
    }
}
