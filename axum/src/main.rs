mod api;
mod data;
mod routes;
mod utils;

use axum::{http::Method, Router};
use dotenv::dotenv;
use std::time::Duration;
use tower_http::cors::{Any, CorsLayer};

use crate::data::config::CONFIG;

#[tokio::main]
async fn main() {
    dotenv().ok();

    let health_router = routes::health::get_router();
    let session_router = routes::session::get_router();
    let vtrans_router = routes::video_translation::get_router();
    let vsubs_router = routes::video_subtitles::get_router();
    let strans_router = routes::stream_translation::get_router();
    let app = Router::new()
        .nest("/health", health_router)
        .nest("/session", session_router)
        .nest("/video-translation", vtrans_router)
        .nest("/video-subtitles", vsubs_router)
        .nest("/stream-translation", strans_router)
        .fallback(routes::fallback::fallback)
        .layer(
            CorsLayer::new()
                .allow_headers(Any)
                .allow_origin(Any)
                .allow_methods([
                    Method::GET,
                    Method::POST,
                    Method::PUT,
                    Method::HEAD,
                    Method::OPTIONS,
                ])
                .max_age(Duration::from_secs(86400)),
        );
    let listener = tokio::net::TcpListener::bind(format!("{0}:{1}", CONFIG.hostname, CONFIG.port))
        .await
        .unwrap();
    println!("🦀 Axum is running at {}", listener.local_addr().unwrap());
    axum::serve(listener, app).await.unwrap();
}
