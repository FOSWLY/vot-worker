use axum::{
    body::{Body, Bytes},
    http::{HeaderMap, Response},
};
use reqwest::{Method, StatusCode};
use serde_json::{Map, Value};

use super::protobuf::{VOT_HEADERS_NAME, decode_vot_headers, is_protobuf_content, media_type};
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
        if e.is_syntax() || e.is_eof() {
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

pub fn parse_protobuf_request(
    headers: &HeaderMap,
    body: &[u8],
) -> Result<(Vec<u8>, Map<String, Value>), Response<Body>> {
    let encoded = headers
        .get(VOT_HEADERS_NAME)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| return_error("error-request"))?;
    let yandex_headers =
        decode_vot_headers(encoded).ok_or_else(|| return_error("error-request"))?;
    Ok((body.to_vec(), yandex_headers))
}

pub async fn request_browser_bytes(
    pathname: &str,
    headers: HeaderMap,
    body: Bytes,
    method: Method,
) -> Response<Body> {
    // Binary protobuf path; transport headers already filtered by decoding.
    if is_protobuf_content(&headers) {
        let (raw_body, yandex_headers) = match parse_protobuf_request(&headers, &body) {
            Ok(val) => val,
            Err(resp) => return resp,
        };
        let client =
            api::browser::build_bytes_client(pathname, raw_body, &yandex_headers, method.clone());
        return api::browser::request(client, &method)
            .await
            .unwrap_or_else(|_| return_error("error-internal"));
    }
    let body = match String::from_utf8(body.to_vec()) {
        Ok(body) => body,
        Err(_) => return return_bad_request(),
    };
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

pub fn parse_fail_audio_plain(
    headers: &HeaderMap,
    body: String,
) -> Result<(String, Map<String, Value>), Response<Body>> {
    if media_type(headers) != "application/json" {
        return Err(return_error("error-content"));
    }
    let encoded = headers
        .get(VOT_HEADERS_NAME)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| return_error("error-request"))?;
    let yandex_headers =
        decode_vot_headers(encoded).ok_or_else(|| return_error("error-request"))?;
    // Plain JSON is forwarded verbatim; nothing here parses or validates it.
    Ok((body, yandex_headers))
}

pub async fn request_browser_json(
    pathname: &str,
    headers: HeaderMap,
    body: String,
    method: Method,
) -> Response<Body> {
    // With `X-VOT-Headers` the body is plain JSON forwarded unchanged;
    // without it the legacy `{headers, body}` envelope applies.
    if headers.get(VOT_HEADERS_NAME).is_some() {
        let (plain_body, yandex_headers) = match parse_fail_audio_plain(&headers, body) {
            Ok(val) => val,
            Err(resp) => return resp,
        };
        let client =
            api::browser::build_json_client(pathname, plain_body, &yandex_headers, method.clone());
        return api::browser::request(client, &method)
            .await
            .unwrap_or_else(|_| return_error("error-internal"));
    }
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

    fn protobuf_headers(vot_headers: Option<&str>) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(
            "content-type",
            HeaderValue::from_static("application/x-protobuf"),
        );
        if let Some(value) = vot_headers {
            headers.insert("x-vot-headers", HeaderValue::from_str(value).unwrap());
        }
        headers
    }

    fn encode_json(value: &Value) -> String {
        use base64::{Engine, engine::general_purpose::STANDARD_NO_PAD};
        STANDARD_NO_PAD.encode(serde_json::to_vec(value).unwrap())
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
    fn uppercase_parameterized_content_type_is_accepted() {
        let mut headers = HeaderMap::new();
        headers.insert(
            "content-type",
            HeaderValue::from_static("Application/JSON; charset=utf-8"),
        );
        let (body, envelope_headers) =
            parse_request(headers, r#"{"headers":{},"body":"hi"}"#.to_string()).unwrap();
        assert_eq!(body, Value::String("hi".to_string()));
        assert!(envelope_headers.is_empty());
    }

    #[test]
    fn empty_raw_request_is_bad_request() {
        let err = parse_request(json_headers(), String::new()).unwrap_err();
        assert_eq!(err.status(), StatusCode::BAD_REQUEST);
    }

    #[test]
    fn empty_string_envelope_body_is_valid() {
        let (body, _) =
            parse_request(json_headers(), r#"{"headers":{},"body":""}"#.to_string()).unwrap();
        assert_eq!(body, Value::String(String::new()));
    }

    #[test]
    fn missing_envelope_body_is_error_request() {
        let err = parse_request(json_headers(), r#"{"headers":{}}"#.to_string()).unwrap_err();
        assert_eq!(err.status(), StatusCode::NO_CONTENT);
        assert_eq!(err.headers()["x-yandex-status"], "error-request");
    }

    #[test]
    fn malformed_envelope_shapes_are_error_request() {
        for body in [
            r#"{"body":[]}"#,
            r#"{"headers":"x","body":[]}"#,
            "[1,2]",
            "null",
        ] {
            let err = parse_request(json_headers(), body.to_string()).unwrap_err();
            assert_eq!(err.status(), StatusCode::NO_CONTENT, "{body}");
            assert_eq!(err.headers()["x-yandex-status"], "error-request");
        }
    }

    #[tokio::test]
    async fn non_array_envelope_body_is_error_request() {
        let resp = request_browser_bytes(
            "/session/create",
            json_headers(),
            Bytes::from_static(br#"{"headers":{},"body":"x"}"#),
            Method::POST,
        )
        .await;
        assert_eq!(resp.status(), StatusCode::NO_CONTENT);
        assert_eq!(resp.headers()["x-yandex-status"], "error-request");
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

    #[test]
    fn protobuf_request_forwards_raw_bytes_with_decoded_headers() {
        let headers = protobuf_headers(Some(&encode_json(&serde_json::json!({
            "content-type": "application/x-protobuf",
            "host": "evil",
        }))));
        let (body, decoded) = parse_protobuf_request(&headers, &[1, 2, 3]).unwrap();
        assert_eq!(body, vec![1, 2, 3]);
        assert_eq!(decoded.len(), 1);
        assert_eq!(decoded["content-type"], "application/x-protobuf");
    }

    #[test]
    fn protobuf_request_rejects_missing_or_invalid_metadata() {
        for headers in [
            protobuf_headers(None),
            protobuf_headers(Some("!!!not-base64!!!")),
            protobuf_headers(Some(&encode_json(&serde_json::json!([1, 2])))),
            protobuf_headers(Some(&encode_json(&serde_json::json!({"a": 1})))),
        ] {
            let err = parse_protobuf_request(&headers, &[1]).unwrap_err();
            assert_eq!(err.status(), StatusCode::NO_CONTENT);
            assert_eq!(err.headers()["x-yandex-status"], "error-request");
        }
    }

    #[tokio::test]
    async fn protobuf_branch_never_touches_envelope_errors() {
        let mut headers = HeaderMap::new();
        headers.insert("content-type", HeaderValue::from_static("text/plain"));
        let resp =
            request_browser_bytes("/session/create", headers, Bytes::from("{}"), Method::POST)
                .await;
        assert_eq!(resp.status(), StatusCode::NO_CONTENT);
        assert_eq!(resp.headers()["x-yandex-status"], "error-content");

        let resp = request_browser_bytes(
            "/session/create",
            protobuf_headers(Some("bogus")),
            Bytes::from_static(&[0, 1]),
            Method::POST,
        )
        .await;
        assert_eq!(resp.status(), StatusCode::NO_CONTENT);
        assert_eq!(resp.headers()["x-yandex-status"], "error-request");
    }

    #[tokio::test]
    async fn bytes_json_fallback_rejects_invalid_utf8_as_bad_request() {
        let resp = request_browser_bytes(
            "/session/create",
            json_headers(),
            Bytes::from_static(&[0xff, 0xfe]),
            Method::POST,
        )
        .await;
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    fn fail_json_headers(vot_headers: &str) -> HeaderMap {
        let mut headers = json_headers();
        headers.insert("x-vot-headers", HeaderValue::from_str(vot_headers).unwrap());
        headers
    }

    #[test]
    fn fail_audio_plain_forwards_decoded_headers() {
        let headers = fail_json_headers(&encode_json(&serde_json::json!({
            "a": "b",
            "host": "evil",
        })));
        let body = r#"{"video_url":"https://youtu.be/x"}"#.to_string();
        let (forwarded, decoded) = parse_fail_audio_plain(&headers, body.clone()).unwrap();
        assert_eq!(forwarded, body);
        assert_eq!(decoded.len(), 1);
        assert_eq!(decoded["a"], "b");
    }

    #[test]
    fn fail_audio_plain_forwards_arbitrary_body_verbatim() {
        let headers = fail_json_headers(&encode_json(&serde_json::json!({"a": "b"})));
        for body in ["{oops", "", "not json at all", r#"  {"video_url":"x"}  "#] {
            let (forwarded, decoded) = parse_fail_audio_plain(&headers, body.to_string()).unwrap();
            assert_eq!(forwarded, body);
            assert_eq!(decoded["a"], "b");
        }
    }

    #[test]
    fn fail_audio_plain_rejects_bad_metadata() {
        for headers in [
            fail_json_headers("bogus"),
            fail_json_headers(&encode_json(&serde_json::json!({"a": 1}))),
        ] {
            let err = parse_fail_audio_plain(
                &headers,
                r#"{"video_url":"https://youtu.be/x"}"#.to_string(),
            )
            .unwrap_err();
            assert_eq!(err.status(), StatusCode::NO_CONTENT);
            assert_eq!(err.headers()["x-yandex-status"], "error-request");
        }
    }

    #[tokio::test]
    async fn fail_audio_json_plain_rejects_bad_metadata_and_content_type() {
        let plain = r#"{"video_url":"https://youtu.be/x"}"#.to_string();
        let resp = request_browser_json(
            "/video-translation/fail-audio-js",
            fail_json_headers("bogus"),
            plain.clone(),
            Method::PUT,
        )
        .await;
        assert_eq!(resp.status(), StatusCode::NO_CONTENT);
        assert_eq!(resp.headers()["x-yandex-status"], "error-request");

        let mut headers = HeaderMap::new();
        headers.insert("content-type", HeaderValue::from_static("text/plain"));
        headers.insert(
            "x-vot-headers",
            HeaderValue::from_str(&encode_json(&serde_json::json!({"a": "b"}))).unwrap(),
        );
        let resp = request_browser_json(
            "/video-translation/fail-audio-js",
            headers,
            plain,
            Method::PUT,
        )
        .await;
        assert_eq!(resp.status(), StatusCode::NO_CONTENT);
        assert_eq!(resp.headers()["x-yandex-status"], "error-content");
    }
}
