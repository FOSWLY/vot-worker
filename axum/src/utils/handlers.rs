use axum::{
    body::Body,
    http::{HeaderMap, Response},
};
use reqwest::{Method, StatusCode};
use serde_json::Map;

use crate::api;

use super::utils::value_to_bytes;

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
) -> Result<(serde_json::Value, Map<String, serde_json::Value>), Response<Body>> {
    let content_type = headers.get("content-type");
    if content_type.is_none() || content_type.unwrap() != "application/json" {
        return Err(return_error("error-content"));
    }

    let body_result = serde_json::from_str::<serde_json::Value>(&body);
    if body_result.is_err() {
        return Err(return_error("error-request"));
    }

    let body_info = body_result.unwrap();
    let yandex_body = &body_info["body"];
    let yandex_headers = &body_info["headers"].as_object();
    if yandex_body == &serde_json::Value::Null || yandex_headers.is_none() {
        return Err(return_error("error-request"));
    }

    return Ok((yandex_body.clone(), yandex_headers.unwrap().clone()));
}

pub async fn request_browser_bytes(
    pathname: &str,
    headers: HeaderMap,
    body: String,
    method: Method,
) -> Response<Body> {
    let (yandex_body, yandex_headers) = match parse_request(headers, body) {
        Ok((body, headers)) => (body, headers),
        Err(err) => return err,
    };

    let yandex_u8_body = value_to_bytes(&yandex_body);
    if yandex_u8_body.is_none() {
        return return_error("error-request");
    }

    let client = api::browser::build_bytes_client(
        pathname,
        yandex_u8_body.unwrap(),
        &yandex_headers,
        method,
    );
    let data = api::browser::request(client).await;
    if data.is_err() {
        return return_error("error-internal");
    }

    data.unwrap()
}

fn parse_json_body(body: serde_json::Value) -> serde_json::Value {
    if !body.is_string() {
        return body;
    };

    let body_str = body.as_str().unwrap_or("");
    if body_str.is_empty() {
        return body;
    }

    // try parse string as json string
    let result = serde_json::from_str::<serde_json::Value>(body_str);
    if result.is_err() {
        return body;
    }

    return result.unwrap();
}

pub async fn request_browser_json(
    pathname: &str,
    headers: HeaderMap,
    body: String,
    method: Method,
) -> Response<Body> {
    let (yandex_body, yandex_headers) = match parse_request(headers, body) {
        Ok((body, headers)) => (body, headers),
        Err(err) => return err,
    };

    let client = api::browser::build_json_client(
        pathname,
        parse_json_body(yandex_body),
        &yandex_headers,
        method,
    );
    let data = api::browser::request(client).await;
    if data.is_err() {
        return return_error("error-internal");
    }

    data.unwrap()
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

    let query_str = query.unwrap_or("".to_string());
    if query_str.is_empty() {
        return return_error("error-request");
    }

    let range = headers.get("range");
    let client = api::browser::build_s3_audio_client(path, query_str, method, range);
    let data = api::browser::request(client).await;
    if data.is_err() {
        return return_error("error-internal");
    }

    data.unwrap()
}

pub async fn request_subs(path: String, query: Option<String>, method: Method) -> Response<Body> {
    let query_str = query.unwrap_or("".to_string());
    if query_str.is_empty() {
        return return_error("error-request");
    }

    let client = api::browser::build_s3_subs_client(path, query_str, method);
    let data = api::browser::request(client).await;
    if data.is_err() {
        return return_error("error-internal");
    }

    data.unwrap()
}
