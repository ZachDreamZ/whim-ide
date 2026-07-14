use axum::{Router, routing::get};
use std::net::SocketAddr;
use tokio::net::TcpListener;

pub async fn start_gateway(port: u16) -> Result<(), String> {
    let app = Router::new()
        .route("/v1/models", get(list_models_handler));

    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = TcpListener::bind(&addr).await.map_err(|e| e.to_string())?;

    tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });

    Ok(())
}

async fn list_models_handler() -> &'static str {
    // Return dummy response for now
    r#"{"object":"list","data":[]}"#
}
