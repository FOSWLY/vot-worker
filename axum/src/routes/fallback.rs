use axum::{body::Body, http::Response};

use crate::utils::handlers::return_error;

pub async fn fallback() -> Response<Body> {
    return_error("error-path")
}

pub async fn method_not_allowed() -> Response<Body> {
    return_error("error-path")
}
