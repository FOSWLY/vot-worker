use axum::{
    body::Body,
    http::{HeaderMap, HeaderName, HeaderValue, Response, header::CONTENT_TYPE},
};
use lazy_static::lazy_static;
use reqwest::{Client, Error, Method, RequestBuilder};
use serde_json::Map;
use tracing::error;

use crate::data::config::CONFIG;

lazy_static! {
    static ref REQ_CLIENT: Client = Client::new();
    static ref SUCCESS_STATUSES: Vec<u16> = vec![200, 204, 206, 301, 304, 404];
}

fn convert_headers(headers_data: &Map<String, serde_json::Value>) -> HeaderMap {
    headers_data
        .iter()
        .filter_map(|(k, v)| {
            v.as_str().and_then(|s| {
                HeaderName::from_bytes(k.as_bytes())
                    .ok()
                    .and_then(|hn| HeaderValue::from_str(s).ok().map(|hv| (hn, hv)))
            })
        })
        .collect()
}

pub fn build_bytes_client(
    pathname: &str,
    body: Vec<u8>,
    headers_data: &Map<String, serde_json::Value>,
    method: Method,
) -> RequestBuilder {
    let is_get = method == Method::GET;
    let request_url = format!(
        "{}{}",
        CONFIG.yandex_api_url.trim_end_matches('/'),
        pathname
    );
    let headers = convert_headers(headers_data);
    let builder = REQ_CLIENT.request(method, &request_url).headers(headers);
    if is_get {
        builder
    } else {
        builder.body(reqwest::Body::from(body))
    }
}

pub fn build_json_client(
    pathname: &str,
    body: String,
    headers_data: &Map<String, serde_json::Value>,
    method: Method,
) -> RequestBuilder {
    let is_get = method == Method::GET;
    let request_url = format!(
        "{}{}",
        CONFIG.yandex_api_url.trim_end_matches('/'),
        pathname
    );
    let mut headers = convert_headers(headers_data);
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    let builder = REQ_CLIENT.request(method, &request_url).headers(headers);
    if is_get { builder } else { builder.body(body) }
}

pub fn build_s3_audio_client(
    pathname: String,
    query: String,
    method: Method,
    range: Option<&HeaderValue>,
) -> RequestBuilder {
    let host = &CONFIG.s3_audio_url;
    let request_url = format!("https://{}{}?{}", host, pathname, query);
    let mut headers = HeaderMap::new();
    headers.insert(
        "user-agent",
        HeaderValue::from_str(&CONFIG.user_agent).unwrap(),
    );
    if let Some(r) = range {
        headers.insert("range", r.clone());
    }
    REQ_CLIENT.request(method, &request_url).headers(headers)
}

pub fn build_s3_subs_client(
    pathname: String,
    query: String,
    method: Method,
    range: Option<&HeaderValue>,
) -> RequestBuilder {
    let host = &CONFIG.s3_subs_url;
    let request_url = format!("https://{}{}?{}", host, pathname, query);
    let mut headers = HeaderMap::new();
    headers.insert(
        "user-agent",
        HeaderValue::from_str(&CONFIG.user_agent).unwrap(),
    );
    if let Some(r) = range {
        headers.insert("range", r.clone());
    }
    REQ_CLIENT.request(method, &request_url).headers(headers)
}

pub async fn request(client: RequestBuilder, method: &Method) -> Result<Response<Body>, Error> {
    let res = client.send().await?;
    let status = res.status();
    let mut headers = res.headers().clone();
    headers.append("X-Yandex-Status", HeaderValue::from_str("success").unwrap());
    for name in [
        "date",
        "upgrade",
        "transfer-encoding",
        "access-control-allow-origin",
        "access-control-allow-headers",
        "access-control-allow-methods",
        "access-control-max-age",
    ] {
        headers.remove(name);
    }
    if !&SUCCESS_STATUSES.contains(&status.as_u16()) {
        let orig_headers = res.headers();
        let is_captcha_error = &orig_headers.get("x-yandex-captcha").is_some();
        let url = res.url().as_str();
        error!(
            task="request",
            status = status.as_u16(),
            headers = ?orig_headers,
            url,
            "{}", match is_captcha_error {
                true => "Request has been temporarily blocked by Yandex Captcha",
                false => "An error occurred during the make request"
            }
        );
    };

    let mut response = Response::new(if method == Method::HEAD {
        Body::empty()
    } else {
        Body::from_stream(res.bytes_stream())
    });
    *response.status_mut() = status;
    *response.headers_mut() = headers;
    Ok(response)
}
