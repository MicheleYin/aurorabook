use tauri::AppHandle;
use crate::book_service::database::get_db_connection;
use crate::book_service::repositories::AudioRepository;
use crate::utils::errors::AppError;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::Response,
    routing::get,
    Router,
};
use std::sync::{Arc, OnceLock};
use tokio::net::TcpListener;
use tower_http::cors::{CorsLayer, Any};

// Global flag to track if server has started
static SERVER_STARTED: OnceLock<Arc<std::sync::atomic::AtomicBool>> = OnceLock::new();

fn get_server_started_flag() -> Arc<std::sync::atomic::AtomicBool> {
    SERVER_STARTED.get_or_init(|| Arc::new(std::sync::atomic::AtomicBool::new(false))).clone()
}

/// Generate a streaming URL for an audio track
/// This URL can be used with HTML5 audio elements for streaming playback
/// This function ensures the server is running before returning the URL
#[tauri::command]
pub async fn get_audio_stream_url(
    book_id: String,
    track_id: String,
    app: tauri::AppHandle,
) -> Result<String, AppError> {
    // Validate that the track exists
    let db = get_db_connection(&app).await
        .map_err(|e| AppError::Store(e))?;
    
    let track_exists = AudioRepository::find_data_by_id(db.as_ref(), &book_id, &track_id).await
        .map_err(|e| AppError::Store(e))?;
    
    if track_exists.is_none() {
        return Err(AppError::Store("Audio track not found".to_string()));
    }
    
    // Ensure the server is running before returning the URL
    // This is especially important on iOS where the server may have been killed
    let server_started = get_server_started_flag();
    let is_running = if server_started.load(std::sync::atomic::Ordering::Relaxed) {
        // Check if it's actually responding
        check_server_running().await
    } else {
        false
    };
    
    if !is_running {
        log::info!("Audio server not running, starting it now...");
        // Try to start the server
        match start_audio_server(app.clone()).await {
            Ok(_) => {
                log::info!("Audio server started successfully");
                // Give it a moment to be ready
                tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;
            }
            Err(e) => {
                log::error!("Failed to start audio server: {}", e);
                // Try one more time after a short delay
                tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
                if let Err(e2) = start_audio_server(app.clone()).await {
                    log::error!("Failed to start audio server on retry: {}", e2);
                    return Err(AppError::Store(format!("Failed to start audio streaming server: {}", e2)));
                }
            }
        }
        
        // Verify it's actually running now
        let mut retries = 3;
        while retries > 0 && !check_server_running().await {
            log::warn!("Server started but not responding yet, waiting... ({} retries left)", retries - 1);
            tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
            retries -= 1;
        }
        
        if !check_server_running().await {
            log::error!("Audio server failed to become responsive");
            return Err(AppError::Store("Audio streaming server is not responding".to_string()));
        }
    }
    
    // Return HTTP URL for the local streaming server
    Ok(format!("http://localhost:1422/audio/{}/{}", book_id, track_id))
}

/// Health check endpoint
async fn health_check() -> &'static str {
    "OK"
}

/// Handle audio streaming HTTP requests
async fn handle_audio_stream(
    Path((book_id, track_id)): Path<(String, String)>,
    State(app): State<Arc<AppHandle>>,
) -> Result<Response<axum::body::Body>, StatusCode> {
    log::debug!("Streaming audio: book_id='{}', track_id='{}'", book_id, track_id);
    
    // Get database connection
    let db = get_db_connection(&*app).await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    
    // Fetch audio data and metadata
    let (audio_data, href) = AudioRepository::find_data_by_id(db.as_ref(), &book_id, &track_id).await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;
    
    // Detect MIME type
    let mime_type = detect_audio_mime_type(&href, &href);
    
    log::info!("Streaming audio track '{}' ({} bytes, type: {})", 
        track_id, audio_data.len(), mime_type);
    
    // Create response with proper headers for streaming
    Ok(Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", mime_type)
        .header("Content-Length", audio_data.len().to_string())
        .header("Accept-Ranges", "bytes")
        .header("Cache-Control", "public, max-age=31536000")
        .header("Access-Control-Allow-Origin", "*")
        .body(axum::body::Body::from(audio_data))
        .unwrap())
}

/// Check if the server is running by attempting to connect to the port
pub async fn check_server_running() -> bool {
    // Simple check: try to connect to the port
    match tokio::net::TcpStream::connect("127.0.0.1:1422").await {
        Ok(mut stream) => {
            // Try to make a simple HTTP request to verify it's our server
            use tokio::io::{AsyncWriteExt, AsyncReadExt};
            let request = b"GET /health HTTP/1.1\r\nHost: localhost:1422\r\n\r\n";
            if stream.write_all(request).await.is_ok() {
                let mut buffer = [0u8; 64];
                if let Ok(_) = tokio::time::timeout(
                    tokio::time::Duration::from_millis(100),
                    stream.read(&mut buffer)
                ).await {
                    // Check if we got an HTTP response
                    let response = String::from_utf8_lossy(&buffer);
                    response.contains("HTTP/1.1") && response.contains("200")
                } else {
                    false
                }
            } else {
                false
            }
        }
        Err(_) => false,
    }
}

/// Start the audio streaming HTTP server
pub async fn start_audio_server(app: AppHandle) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let server_started = get_server_started_flag();
    
    // Check if server already started
    if server_started.load(std::sync::atomic::Ordering::Relaxed) {
        // Verify it's actually running
        if check_server_running().await {
            log::debug!("Audio streaming server is already running");
            return Ok(());
        } else {
            log::warn!("Server flag says started but server is not responding, restarting...");
            server_started.store(false, std::sync::atomic::Ordering::Relaxed);
        }
    }
    
    log::info!("Initializing audio streaming server...");
    let app_state = Arc::new(app);
    
    let router = Router::new()
        .route("/health", get(health_check))
        .route("/audio/:book_id/:track_id", get(handle_audio_stream))
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any)
        )
        .with_state(app_state);
    
    // Try to bind to the port
    log::info!("Attempting to bind to 127.0.0.1:1422...");
    let listener = match TcpListener::bind("127.0.0.1:1422").await {
        Ok(listener) => {
            log::info!("✓ Successfully bound to http://127.0.0.1:1422");
            listener
        }
        Err(e) => {
            log::error!("✗ Failed to bind to port 1422: {}", e);
            return Err(format!("Failed to bind to port 1422: {}", e).into());
        }
    };
    
    // Spawn the server in a separate task so it doesn't block
    tokio::spawn(async move {
        log::info!("🚀 Audio streaming server starting on http://127.0.0.1:1422");
        log::info!("   Health check: http://127.0.0.1:1422/health");
        if let Err(e) = axum::serve(listener, router).await {
            log::error!("Audio streaming server error: {}", e);
        }
    });
    
    // Mark server as started
    server_started.store(true, std::sync::atomic::Ordering::Relaxed);
    
    // Give the server a moment to start accepting connections
    tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
    log::info!("Audio streaming server initialization complete");
    
    Ok(())
}

/// Restart the audio streaming server (useful when app comes back to foreground on iOS)
pub async fn restart_audio_server(app: AppHandle) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let server_started = get_server_started_flag();
    server_started.store(false, std::sync::atomic::Ordering::Relaxed);
    log::info!("Restarting audio streaming server...");
    start_audio_server(app).await
}

/// Detect audio MIME type from file extension
fn detect_audio_mime_type(audio_path: &str, audio_href: &str) -> &'static str {
    let path_lower = audio_path.to_lowercase();
    let href_lower = audio_href.to_lowercase();
    
    if path_lower.ends_with(".mp3") || href_lower.ends_with(".mp3") {
        "audio/mpeg"
    } else if path_lower.ends_with(".m4a") || href_lower.ends_with(".m4a") {
        "audio/mp4"
    } else if path_lower.ends_with(".ogg") || href_lower.ends_with(".ogg") {
        "audio/ogg"
    } else if path_lower.ends_with(".wav") || href_lower.ends_with(".wav") {
        "audio/wav"
    } else if path_lower.ends_with(".webm") || href_lower.ends_with(".webm") {
        "audio/webm"
    } else if path_lower.ends_with(".flac") || href_lower.ends_with(".flac") {
        "audio/flac"
    } else {
        // Default to MP3 if unknown
        "audio/mpeg"
    }
}

