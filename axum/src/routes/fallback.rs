use reqwest::StatusCode;

pub async fn fallback() -> (StatusCode, &'static str) {
    (StatusCode::NO_CONTENT, "")
}
