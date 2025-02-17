use axum::{
    body::Body,
    http::{HeaderMap, HeaderName, HeaderValue, Response},
};
use lazy_static::lazy_static;
use reqwest::{Client, Error, Method, RequestBuilder};
use serde_json::Map;

use crate::data::config::CONFIG;

lazy_static! {
    static ref REQ_CLIENT: Client = reqwest::Client::new();
}

fn convert_headers(headers_data: &Map<String, serde_json::Value>) -> HeaderMap {
    let mut headers = HeaderMap::new();
    for (key, value) in headers_data {
        if !value.is_string() {
            continue;
        }

        if let (Ok(header_name), Some(value_str)) = (key.parse::<HeaderName>(), value.as_str()) {
            if let Ok(header_value) = HeaderValue::from_str(value_str) {
                headers.insert(header_name, header_value);
            }
        }
    }

    headers
}

pub fn build_bytes_client(
    pathname: &str,
    body: Vec<u8>,
    headers_data: &Map<String, serde_json::Value>,
    method: Method,
) -> RequestBuilder {
    let request_url = format!("https://api.browser.yandex.ru{pathname}");
    let headers = convert_headers(headers_data);
    let mut client = REQ_CLIENT
        .request(method.clone(), &request_url)
        .headers(headers);

    if method != Method::GET {
        client = client.body(reqwest::Body::from(body));
    }

    client
}

pub fn build_json_client(
    pathname: &str,
    body: serde_json::Value,
    headers_data: &Map<String, serde_json::Value>,
    method: Method,
) -> RequestBuilder {
    let request_url = format!("https://api.browser.yandex.ru{pathname}");
    let headers = convert_headers(headers_data);
    let mut client = REQ_CLIENT
        .request(method.clone(), &request_url)
        .headers(headers);

    if method != Method::GET {
        client = client.json(&body);
    }

    client
}

pub fn build_s3_audio_client(
    pathname: String,
    query: String,
    method: Method,
    range: Option<&HeaderValue>,
) -> RequestBuilder {
    let host = &CONFIG.s3_audio_url;
    let request_url = format!("https://{host}{pathname}?{query}");
    let mut headers = HeaderMap::new();
    headers.insert(
        "user-agent",
        HeaderValue::from_str(&CONFIG.user_agent).unwrap(),
    );
    if range.is_some() {
        headers.insert("range", range.unwrap().clone());
    }

    REQ_CLIENT
        .request(method.clone(), &request_url)
        .headers(headers)
}

pub fn build_s3_subs_client(pathname: String, query: String, method: Method) -> RequestBuilder {
    let host = &CONFIG.s3_subs_url;
    let request_url = format!("https://{host}{pathname}?{query}");
    let mut headers = HeaderMap::new();
    headers.insert(
        "user-agent",
        HeaderValue::from_str(&CONFIG.user_agent).unwrap(),
    );

    REQ_CLIENT
        .request(method.clone(), &request_url)
        .headers(headers)
}

pub async fn request(client: RequestBuilder) -> Result<Response<Body>, Error> {
    let res = client.send().await?;

    let status = res.status();
    let mut headers = res.headers().clone();
    headers.append("X-Yandex-Status", HeaderValue::from_str("success").unwrap());
    let bytes = res.bytes().await?;

    let mut response = Response::new(Body::from(bytes));
    *response.status_mut() = status;
    *response.headers_mut() = headers;

    Ok(response)
}
