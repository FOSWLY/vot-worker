use axum::{response::IntoResponse, routing::get, Json, Router};

use serde::Serialize;

use crate::data::config;

#[derive(Serialize)]
pub struct Health {
    version: String,
    status: String,
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
