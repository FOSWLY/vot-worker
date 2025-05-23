use axum::{Json, Router, response::IntoResponse, routing::get};

use serde::Serialize;

use crate::data::config;

#[derive(Serialize)]
pub struct Health {
    status: String,
    version: String,
}

async fn get_health() -> impl IntoResponse {
    let data = Health {
        status: "ok".to_string(),
        version: config::CONFIG.version.clone(),
    };

    Json(data)
}

pub fn get_router() -> Router {
    Router::new().route("/", get(get_health))
}
