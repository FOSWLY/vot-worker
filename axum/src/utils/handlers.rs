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

pub fn return_bad_request() -> Response<Body> {
    Response::builder()
        .status(StatusCode::BAD_REQUEST)
        .body(Body::from("Bad Request"))
        .unwrap()
}

pub fn parse_request(
    headers: HeaderMap,
    body: String,
) -> Result<(Value, Map<String, Value>), Response<Body>> {
    let is_json = headers
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .map(|v| {
            v.split(';')
                .next()
                .unwrap_or("")
                .trim()
                .eq_ignore_ascii_case("application/json")
        })
        .unwrap_or(false);
    if !is_json {
        return Err(return_error("error-content"));
    }
    let body_info: Value = serde_json::from_str(&body).map_err(|e| {
        if e.is_syntax() {
            return_bad_request()
        } else {
            return_error("error-request")
        }
    })?;
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

async fn process_api_request<F>(
    headers: HeaderMap,
    body: String,
    method: Method,
    build_client: F,
) -> Response<Body>
where
    F: FnOnce(Value, Map<String, Value>, Method) -> Option<reqwest::RequestBuilder>,
{
    let (yandex_body, yandex_headers) = match parse_request(headers, body) {
        Ok(val) => val,
        Err(resp) => return resp,
    };
    let client = match build_client(yandex_body, yandex_headers, method.clone()) {
        Some(builder) => builder,
        None => return return_error("error-request"),
    };
    api::browser::request(client, &method)
        .await
        .unwrap_or_else(|_| return_error("error-internal"))
}

pub async fn request_browser_bytes(
    pathname: &str,
    headers: HeaderMap,
    body: String,
    method: Method,
) -> Response<Body> {
    process_api_request(
        headers,
        body,
        method,
        |yandex_body, yandex_headers, method| {
            value_to_bytes(&yandex_body).map(|bytes| {
                api::browser::build_bytes_client(pathname, bytes, &yandex_headers, method)
            })
        },
    )
    .await
}

pub async fn request_browser_json(
    pathname: &str,
    headers: HeaderMap,
    body: String,
    method: Method,
) -> Response<Body> {
    process_api_request(
        headers,
        body,
        method,
        |yandex_body, yandex_headers, method| {
            yandex_body.as_str().map(|s| {
                api::browser::build_json_client(pathname, s.to_owned(), &yandex_headers, method)
            })
        },
    )
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
    let client =
        api::browser::build_s3_audio_client(path, query_str, method.clone(), headers.get("range"));
    match api::browser::request(client, &method).await {
        Ok(resp) => resp,
        Err(_) => return_error("error-internal"),
    }
}

pub async fn request_subs(
    headers: HeaderMap,
    path: String,
    query: Option<String>,
    method: Method,
) -> Response<Body> {
    let query_str = query.unwrap_or_default();
    if query_str.is_empty() {
        return return_error("error-request");
    }
    let client =
        api::browser::build_s3_subs_client(path, query_str, method.clone(), headers.get("range"));
    match api::browser::request(client, &method).await {
        Ok(resp) => resp,
        Err(_) => return_error("error-internal"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    fn json_headers() -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert("content-type", HeaderValue::from_static("application/json"));
        headers
    }

    #[test]
    fn malformed_outer_json_is_bad_request() {
        let err = parse_request(json_headers(), "{oops".to_string()).unwrap_err();
        assert_eq!(err.status(), StatusCode::BAD_REQUEST);
    }

    #[test]
    fn non_json_content_type_is_error_content() {
        let err = parse_request(HeaderMap::new(), "{}".to_string()).unwrap_err();
        assert_eq!(err.status(), StatusCode::NO_CONTENT);
        assert_eq!(err.headers()["x-yandex-status"], "error-content");
    }

    #[test]
    fn missing_envelope_body_is_error_request() {
        let err = parse_request(json_headers(), r#"{"headers":{}}"#.to_string()).unwrap_err();
        assert_eq!(err.status(), StatusCode::NO_CONTENT);
        assert_eq!(err.headers()["x-yandex-status"], "error-request");
    }

    #[tokio::test]
    async fn fail_audio_js_rejects_non_string_body() {
        let resp = request_browser_json(
            "/video-translation/fail-audio-js",
            json_headers(),
            r#"{"headers":{},"body":[1,2]}"#.to_string(),
            Method::PUT,
        )
        .await;
        assert_eq!(resp.status(), StatusCode::NO_CONTENT);
        assert_eq!(resp.headers()["x-yandex-status"], "error-request");
    }

    #[tokio::test]
    async fn audio_proxy_rejects_bad_extension() {
        let resp = request_audio(
            HeaderMap::new(),
            "file.txt".to_string(),
            Some("a=1".to_string()),
            Method::GET,
        )
        .await;
        assert_eq!(resp.status(), StatusCode::NO_CONTENT);
        assert_eq!(resp.headers()["x-yandex-status"], "error-content");
    }
}
