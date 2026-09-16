mod api;
mod data;
mod routes;
mod utils;

use axum::{
    Router,
    extract::Request,
    http::{HeaderValue, Method},
    middleware::{self, Next},
    response::Response,
};
use dotenv::dotenv;
use std::{error::Error, time::Duration};
use tower_http::cors::{Any, CorsLayer};
use tracing::info;
use tracing::level_filters::LevelFilter;
use tracing_subscriber::fmt::Layer;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use url::Url;

use crate::data::config::CONFIG;

// Infallible: an invalid header value only means no header, never a failed request.
fn insert_server_id<B>(response: &mut Response<B>, server_id: Option<&str>) {
    if let Some(server_id) = server_id {
        if let Ok(value) = HeaderValue::from_str(server_id) {
            response.headers_mut().insert("X-VOT-SERVER-ID", value);
        }
    }
}

async fn server_id_header(request: Request, next: Next) -> Response {
    let mut response = next.run(request).await;
    insert_server_id(&mut response, CONFIG.server_id.as_deref());
    response
}

fn tracing_setup() -> Result<(), Box<dyn Error>> {
    let loki_config = match &CONFIG.loki_config {
        Some(loki_config) => loki_config,
        None => {
            tracing_subscriber::registry()
                .with(LevelFilter::INFO)
                .with(Layer::new())
                .init();
            return Ok(());
        }
    };
    let (layer, task) = tracing_loki::builder()
        .label("application", &loki_config.label)?
        .label("service_name", &loki_config.label)?
        .http_header("Authorization", &loki_config.auth)?
        .build_url(Url::parse(&loki_config.host).unwrap())?;

    tracing_subscriber::registry()
        .with(LevelFilter::INFO)
        .with(layer)
        .with(Layer::new())
        .init();
    tokio::spawn(task);
    Ok(())
}

#[tokio::main]
async fn main() {
    dotenv().ok();
    tracing_setup().ok();

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
        .method_not_allowed_fallback(routes::fallback::method_not_allowed)
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
        )
        // Outermost so even CORS preflight (which the inner layer short-circuits)
        // and the fallback/405 responses carry the header.
        .layer(middleware::from_fn(server_id_header));
    let listener = tokio::net::TcpListener::bind(format!("{0}:{1}", CONFIG.hostname, CONFIG.port))
        .await
        .unwrap();
    info!(
        task = "startup",
        "🦀 Axum is running at {}",
        listener.local_addr().unwrap()
    );
    axum::serve(listener, app).await.unwrap();
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;

    #[test]
    fn server_id_header_present_only_when_configured() {
        let mut with_id = Response::new(Body::empty());
        insert_server_id(&mut with_id, Some("node-1"));
        assert_eq!(with_id.headers()["x-vot-server-id"], "node-1");

        let mut without_id = Response::new(Body::empty());
        insert_server_id(&mut without_id, None);
        assert!(without_id.headers().get("x-vot-server-id").is_none());
    }
}
