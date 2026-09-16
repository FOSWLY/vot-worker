use axum::http::HeaderMap;
use base64::{
    Engine,
    engine::general_purpose::{STANDARD, STANDARD_NO_PAD},
};
use serde_json::{Map, Value};

pub const PROTOBUF_MEDIA_TYPE: &str = "application/x-protobuf";
pub const VOT_HEADERS_NAME: &str = "x-vot-headers";

// Never forwarded upstream from `X-VOT-Headers` (matched case-insensitively).
const FILTERED_UPSTREAM_HEADERS: [&str; 5] = [
    "host",
    "content-length",
    "connection",
    "transfer-encoding",
    "x-vot-headers",
];

pub fn media_type(headers: &HeaderMap) -> String {
    headers
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .map(|v| {
            v.split(';')
                .next()
                .unwrap_or("")
                .trim()
                .to_ascii_lowercase()
        })
        .unwrap_or_default()
}

pub fn is_protobuf_content(headers: &HeaderMap) -> bool {
    media_type(headers) == PROTOBUF_MEDIA_TYPE
}

// Base64(JSON) -> string-valued object. Decoding matches `JSON.parse(atob(raw))`:
// each byte maps to one code unit (Latin-1, not UTF-8). Standard alphabet,
// padded or not, ASCII whitespace anywhere (as forgiving-base64 does); url-safe
// chars, bad encoding, non-object JSON or non-string values are None.
pub fn decode_vot_headers(value: &str) -> Option<Map<String, Value>> {
    let raw = value.trim();
    if raw.is_empty() || raw.bytes().any(|b| b == b'-' || b == b'_') {
        return None;
    }
    let cleaned: String = raw.chars().filter(|c| !c.is_ascii_whitespace()).collect();
    let bytes = STANDARD
        .decode(&cleaned)
        .or_else(|_| STANDARD_NO_PAD.decode(&cleaned))
        .ok()?;
    let latin1: String = bytes.iter().map(|&b| b as char).collect();
    let parsed: Value = serde_json::from_str(&latin1).ok()?;
    let obj = parsed.as_object()?;
    let mut headers = Map::with_capacity(obj.len());
    for (key, val) in obj {
        if !val.is_string() {
            return None;
        }
        if FILTERED_UPSTREAM_HEADERS.contains(&key.to_ascii_lowercase().as_str()) {
            continue;
        }
        headers.insert(key.clone(), val.clone());
    }
    Some(headers)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    fn headers_of(content_type: &str) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert("content-type", HeaderValue::from_str(content_type).unwrap());
        headers
    }

    fn encode_json(value: &Value) -> String {
        STANDARD_NO_PAD.encode(serde_json::to_vec(value).unwrap())
    }

    #[test]
    fn media_type_ignores_case_and_parameters() {
        assert_eq!(
            media_type(&headers_of("Application/X-Protobuf; charset=utf-8")),
            "application/x-protobuf"
        );
        assert_eq!(
            media_type(&headers_of("  APPLICATION/JSON ;charset=binary  ")),
            "application/json"
        );
        assert_eq!(media_type(&HeaderMap::new()), "");
    }

    #[test]
    fn decode_accepts_padded_and_unpadded() {
        let value = serde_json::json!({"k": "v1"});
        let raw = serde_json::to_vec(&value).unwrap();
        let padded = STANDARD.encode(&raw);
        assert!(padded.ends_with('='), "{padded:?}");
        for encoded in [padded, STANDARD_NO_PAD.encode(&raw)] {
            let decoded = decode_vot_headers(&encoded).unwrap();
            assert_eq!(decoded.len(), 1);
            assert_eq!(decoded["k"], "v1");
        }
    }

    #[test]
    fn decode_ignores_internal_ascii_whitespace() {
        let encoded = encode_json(&serde_json::json!({"k": "v"}));
        let spaced = format!("{}\t\n\x0c\r {}", &encoded[..1], &encoded[1..]);
        let decoded = decode_vot_headers(&spaced).unwrap();
        assert_eq!(decoded["k"], "v");
    }

    #[test]
    fn decode_matches_atob_latin1_semantics_not_utf8() {
        // `atob` maps each byte to one code unit: U+00C3 U+00A9 (Ã©), not é.
        let raw = serde_json::to_vec(&serde_json::json!({"a": "é"})).unwrap();
        let encoded = STANDARD_NO_PAD.encode(&raw);
        let decoded = decode_vot_headers(&encoded).unwrap();
        assert_eq!(decoded["a"], "\u{00c3}\u{00a9}");
        assert_ne!(decoded["a"], "é");
    }

    #[test]
    fn decode_rejects_url_safe_alphabet() {
        // `~~~` encodes with a `+` in standard base64.
        let standard =
            STANDARD.encode(serde_json::to_vec(&serde_json::json!({"a": "~~~"})).unwrap());
        assert!(standard.contains('+'));
        assert_eq!(decode_vot_headers(&standard).unwrap()["a"], "~~~");
        assert!(decode_vot_headers(&standard.replace('+', "-")).is_none());
    }

    #[test]
    fn decode_rejects_missing_and_malformed() {
        for bad in ["", "   ", "!!!not-base64!!!", "a"] {
            assert!(decode_vot_headers(bad).is_none(), "{bad:?}");
        }
        for not_object in [
            serde_json::json!([1, 2]),
            serde_json::json!(null),
            serde_json::json!("str"),
            serde_json::json!({"a": 1}),
            serde_json::json!({"a": null}),
        ] {
            assert!(decode_vot_headers(&encode_json(&not_object)).is_none());
        }
        assert!(
            decode_vot_headers(&encode_json(&serde_json::json!({})))
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn decode_filters_transport_headers_case_insensitively() {
        let decoded = decode_vot_headers(&encode_json(&serde_json::json!({
            "Host": "x",
            "Content-Length": "3",
            "Connection": "keep-alive",
            "Transfer-Encoding": "chunked",
            "X-VOT-Headers": "y",
            "Vtrans-Signature": "sig",
            "content-type": "application/x-protobuf",
        })))
        .unwrap();
        assert_eq!(decoded.len(), 2);
        assert_eq!(decoded["Vtrans-Signature"], "sig");
        assert_eq!(decoded["content-type"], "application/x-protobuf");
    }
}
