use crate::book_service::database::get_db_connection;
use crate::book_service::repositories::AudioRepository;
use crate::book_service::repositories::EpubRepository;
use crate::utils::errors::AppError;
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::Response,
    routing::get,
    Router,
};
use std::sync::{Arc, OnceLock};
use tauri::AppHandle;
use tokio::net::TcpListener;
use tokio::signal;
use tokio::sync::oneshot;
use tower_http::cors::{Any, CorsLayer};

// Global flag to track if server has started
static SERVER_STARTED: OnceLock<Arc<std::sync::atomic::AtomicBool>> = OnceLock::new();

// Global variable to store the port number assigned by the OS
static SERVER_PORT: OnceLock<Arc<std::sync::atomic::AtomicU16>> = OnceLock::new();

// Global shutdown signal sender for graceful server shutdown
static SERVER_SHUTDOWN: OnceLock<Arc<std::sync::Mutex<Option<oneshot::Sender<()>>>>> =
    OnceLock::new();

fn get_server_started_flag() -> Arc<std::sync::atomic::AtomicBool> {
    SERVER_STARTED
        .get_or_init(|| Arc::new(std::sync::atomic::AtomicBool::new(false)))
        .clone()
}

fn get_server_port() -> Arc<std::sync::atomic::AtomicU16> {
    SERVER_PORT
        .get_or_init(|| Arc::new(std::sync::atomic::AtomicU16::new(0)))
        .clone()
}

fn get_server_shutdown() -> Arc<std::sync::Mutex<Option<oneshot::Sender<()>>>> {
    SERVER_SHUTDOWN
        .get_or_init(|| Arc::new(std::sync::Mutex::new(None)))
        .clone()
}

#[derive(serde::Deserialize)]
struct EpubResourceQuery {
    book_id: String,
    href: String,
    chapter_href: Option<String>,
}

async fn ensure_server_started_and_get_port(
    app: tauri::AppHandle,
) -> Result<u16, AppError> {
    let server_started = get_server_started_flag();
    let is_running = if server_started.load(std::sync::atomic::Ordering::Relaxed) {
        check_server_running().await
    } else {
        false
    };

    if !is_running {
        log::info!("Audio/resource server not running, starting it now...");
        match start_audio_server(app.clone()).await {
            Ok(_) => {
                tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;
            }
            Err(e) => {
                tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
                if let Err(e2) = start_audio_server(app.clone()).await {
                    return Err(AppError::Store(format!(
                        "Failed to start streaming server: {}; retry: {}",
                        e, e2
                    )));
                }
            }
        }

        let mut retries = 3;
        while retries > 0 && !check_server_running().await {
            tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
            retries -= 1;
        }

        if !check_server_running().await {
            return Err(AppError::Store(
                "Streaming server is not responding".to_string(),
            ));
        }
    }

    let port = get_server_port().load(std::sync::atomic::Ordering::Relaxed);
    if port == 0 {
        return Err(AppError::Store(
            "Streaming server port not initialized".to_string(),
        ));
    }

    Ok(port)
}

fn detect_resource_mime_type(path: &str, bytes: &[u8]) -> &'static str {
    let lower = path.to_ascii_lowercase();
    if lower.ends_with(".css") {
        "text/css"
    } else if lower.ends_with(".xhtml") || lower.ends_with(".html") || lower.ends_with(".htm") {
        "text/html"
    } else if lower.ends_with(".js") {
        "text/javascript"
    } else if lower.ends_with(".svg") {
        "image/svg+xml"
    } else if lower.ends_with(".png") {
        "image/png"
    } else if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        "image/jpeg"
    } else if lower.ends_with(".gif") {
        "image/gif"
    } else if lower.ends_with(".webp") {
        "image/webp"
    } else if lower.ends_with(".woff2") {
        "font/woff2"
    } else if lower.ends_with(".woff") {
        "font/woff"
    } else if lower.ends_with(".ttf") {
        "font/ttf"
    } else if lower.ends_with(".otf") {
        "font/otf"
    } else if lower.ends_with(".mp3") {
        "audio/mpeg"
    } else if lower.ends_with(".m4a") || lower.ends_with(".m4b") {
        "audio/mp4"
    } else if lower.ends_with(".ogg") {
        "audio/ogg"
    } else if lower.ends_with(".wav") {
        "audio/wav"
    } else if lower.ends_with(".mp4") {
        "video/mp4"
    } else if lower.ends_with(".webm") {
        "video/webm"
    } else if lower.ends_with(".vtt") {
        "text/vtt"
    } else if bytes.len() >= 4 {
        match &bytes[0..4] {
            [0x89, 0x50, 0x4E, 0x47] => "image/png",
            [0xFF, 0xD8, 0xFF, _] => "image/jpeg",
            [0x47, 0x49, 0x46, 0x38] => "image/gif",
            _ => "application/octet-stream",
        }
    } else {
        "application/octet-stream"
    }
}

fn is_external_resource_ref(v: &str) -> bool {
    let l = v.trim().to_ascii_lowercase();
    l.starts_with("data:")
        || l.starts_with("http://")
        || l.starts_with("https://")
        || l.starts_with("blob:")
        || l.starts_with("javascript:")
        || l.starts_with("mailto:")
        || l.starts_with('#')
}

fn build_epub_resource_absolute_url(
    port: u16,
    book_id: &str,
    href: &str,
    chapter_href: Option<&str>,
) -> String {
    fn enc(v: &str) -> String {
        percent_encoding::utf8_percent_encode(v, percent_encoding::NON_ALPHANUMERIC).to_string()
    }

    let mut url = format!(
        "http://localhost:{}/epub-resource?book_id={}&href={}",
        port,
        enc(book_id),
        enc(href)
    );
    if let Some(ch) = chapter_href {
        url.push_str("&chapter_href=");
        url.push_str(&enc(ch));
    }
    url
}

fn rewrite_css_urls_for_endpoint(
    css_text: &str,
    port: u16,
    book_id: &str,
    css_member_path: &str,
) -> String {
    use regex::Regex;

    // Note: the `regex` crate does not support backreferences (`\1`), so quote
    // variants are matched with alternation instead.
    let import_url_re = match Regex::new(
        r#"(?is)@import\s+url\(\s*(?:"([^"]+)"|'([^']+)'|([^"')\s]+))\s*\)"#,
    ) {
        Ok(v) => v,
        Err(_) => return append_reader_css_width_guards(css_text),
    };
    let import_plain_re =
        match Regex::new(r#"(?is)@import\s+(?:"([^"]+)"|'([^']+)')"#) {
            Ok(v) => v,
            Err(_) => return append_reader_css_width_guards(css_text),
        };
    let url_re = match Regex::new(
        r#"(?is)url\(\s*(?:"([^"]+)"|'([^']+)'|([^"')\s]+))\s*\)"#,
    ) {
        Ok(v) => v,
        Err(_) => return append_reader_css_width_guards(css_text),
    };

    let capture_url = |caps: &regex::Captures| -> String {
        caps.get(1)
            .or_else(|| caps.get(2))
            .or_else(|| caps.get(3))
            .map(|m| m.as_str())
            .unwrap_or_default()
            .trim()
            .to_string()
    };

    let mut out = css_text.to_string();

    out = import_url_re
        .replace_all(&out, |caps: &regex::Captures| {
            let raw = capture_url(caps);
            if raw.is_empty() || is_external_resource_ref(&raw) {
                caps.get(0).map(|m| m.as_str()).unwrap_or_default().to_string()
            } else {
                let rewritten =
                    build_epub_resource_absolute_url(port, book_id, &raw, Some(css_member_path));
                format!("@import url(\"{rewritten}\")")
            }
        })
        .to_string();

    out = import_plain_re
        .replace_all(&out, |caps: &regex::Captures| {
            let raw = caps
                .get(1)
                .or_else(|| caps.get(2))
                .map(|m| m.as_str())
                .unwrap_or_default()
                .trim()
                .to_string();
            if raw.is_empty() || is_external_resource_ref(&raw) {
                caps.get(0).map(|m| m.as_str()).unwrap_or_default().to_string()
            } else {
                let rewritten =
                    build_epub_resource_absolute_url(port, book_id, &raw, Some(css_member_path));
                format!("@import url(\"{rewritten}\")")
            }
        })
        .to_string();

    out = url_re
        .replace_all(&out, |caps: &regex::Captures| {
            let raw = capture_url(caps);
            if raw.is_empty() || is_external_resource_ref(&raw) {
                caps.get(0).map(|m| m.as_str()).unwrap_or_default().to_string()
            } else {
                let rewritten =
                    build_epub_resource_absolute_url(port, book_id, &raw, Some(css_member_path));
                format!("url(\"{rewritten}\")")
            }
        })
        .to_string();

    append_reader_css_width_guards(&out)
}

fn append_reader_css_width_guards(css_text: &str) -> String {
    let mut out = String::with_capacity(css_text.len() + 1024);
    out.push_str(css_text);
    out.push_str(
        "\n\n/* Aurorabook reader guard: keep injected EPUB CSS within reader bounds */\n",
    );
    out.push_str(
        "[data-reader-chapter-content=\"true\"]{max-width:100%!important;overflow-x:clip;overflow-wrap:break-word;word-break:break-word;}\n",
    );
    out.push_str(
        "[data-reader-chapter-content=\"true\"] *{box-sizing:border-box;max-width:100%;}\n",
    );
    out.push_str(
        "[data-reader-chapter-content=\"true\"] :where(.width,.width1,.calibre,.calibre3,.calibre9,.calibre10,#button,section,article,div,p){margin-left:0!important;margin-right:0!important;padding-left:0!important;padding-right:0!important;}\n",
    );
    out.push_str(
        "[data-reader-chapter-content=\"true\"] :where(img,svg,canvas,video,iframe,table){max-width:100%!important;height:auto;}\n",
    );
    out
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
    let db = get_db_connection(&app)
        .await
        .map_err(|e| AppError::Store(e))?;

    let can = AudioRepository::can_stream_track(db.as_ref(), &book_id, &track_id)
        .await
        .map_err(|e| AppError::Store(e))?;

    if !can {
        return Err(AppError::Store(
            "Audio track not found or EPUB file missing".to_string(),
        ));
    }

    let port = ensure_server_started_and_get_port(app).await?;

    // Return HTTP URL for the local streaming server
    Ok(format!(
        "http://localhost:{}/audio/{}/{}",
        port, book_id, track_id
    ))
}

#[tauri::command]
pub async fn get_epub_resource_url(
    book_id: String,
    href: String,
    chapter_href: Option<String>,
    app: tauri::AppHandle,
) -> Result<String, AppError> {
    let port = ensure_server_started_and_get_port(app).await?;

    Ok(build_epub_resource_absolute_url(
        port,
        &book_id,
        &href,
        chapter_href.as_deref(),
    ))
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
    log::debug!(
        "Streaming audio: book_id='{}', track_id='{}'",
        book_id,
        track_id
    );

    // Get database connection
    let db = get_db_connection(&*app)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let (audio_data, href) = AudioRepository::resolve_track_audio_bytes(db.as_ref(), &book_id, &track_id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;

    // Detect MIME type
    let mime_type = detect_audio_mime_type(&href, &href);

    log::info!(
        "Streaming audio track '{}' ({} bytes, type: {})",
        track_id,
        audio_data.len(),
        mime_type
    );

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

async fn handle_epub_resource(
    Query(query): Query<EpubResourceQuery>,
    State(app): State<Arc<AppHandle>>,
) -> Result<Response<axum::body::Body>, StatusCode> {
    let db = get_db_connection(&*app)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let Some(epub_file_path) = EpubRepository::file_path_for_book_id(db.as_ref(), &query.book_id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    else {
        return Err(StatusCode::NOT_FOUND);
    };

    let href = query.href.clone();
    let chapter_href = query.chapter_href.clone();
    let path_for_task = epub_file_path.clone();
    let result = tokio::task::spawn_blocking(move || {
        crate::book_service::epub_file_storage::read_resource_from_epub_file(
            std::path::Path::new(&path_for_task),
            &href,
            chapter_href.as_deref(),
        )
    })
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let (mut resource_bytes, resolved_path) = result.map_err(|_| StatusCode::NOT_FOUND)?;
    let mime_type = detect_resource_mime_type(&resolved_path, &resource_bytes);

    if mime_type == "text/css" {
        if let Ok(css_text) = String::from_utf8(resource_bytes.clone()) {
            let port = get_server_port().load(std::sync::atomic::Ordering::Relaxed);
            let rewritten_css = rewrite_css_urls_for_endpoint(
                &css_text,
                port,
                &query.book_id,
                &resolved_path,
            );
            resource_bytes = rewritten_css.into_bytes();
        }
    }

    Ok(Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", mime_type)
        .header("Content-Length", resource_bytes.len().to_string())
        .header("Cache-Control", "public, max-age=86400")
        .header("Access-Control-Allow-Origin", "*")
        .body(axum::body::Body::from(resource_bytes))
        .unwrap())
}

/// Check if the server is running by attempting to connect to the port
pub async fn check_server_running() -> bool {
    let port = get_server_port().load(std::sync::atomic::Ordering::Relaxed);
    if port == 0 {
        return false;
    }

    // Simple check: try to connect to the port
    let addr = format!("127.0.0.1:{}", port);
    match tokio::net::TcpStream::connect(&addr).await {
        Ok(mut stream) => {
            // Try to make a simple HTTP request to verify it's our server
            use tokio::io::{AsyncReadExt, AsyncWriteExt};
            let request = format!("GET /health HTTP/1.1\r\nHost: localhost:{}\r\n\r\n", port);
            if stream.write_all(request.as_bytes()).await.is_ok() {
                let mut buffer = [0u8; 64];
                if let Ok(_) = tokio::time::timeout(
                    tokio::time::Duration::from_millis(100),
                    stream.read(&mut buffer),
                )
                .await
                {
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
pub async fn start_audio_server(
    app: AppHandle,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
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
        .route("/epub-resource", get(handle_epub_resource))
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any),
        )
        .with_state(app_state);

    // Try to bind to an available port (port 0 lets the OS choose)
    log::info!("Attempting to bind to 127.0.0.1:0 (OS will assign available port)...");
    let listener = match TcpListener::bind("127.0.0.1:0").await {
        Ok(listener) => {
            // Get the actual port assigned by the OS
            let port = listener
                .local_addr()
                .map_err(|e| format!("Failed to get local address: {}", e))?
                .port();

            // Store the port number
            let server_port = get_server_port();
            server_port.store(port, std::sync::atomic::Ordering::Relaxed);

            log::info!("✓ Successfully bound to http://127.0.0.1:{}", port);
            listener
        }
        Err(e) => {
            log::error!("✗ Failed to bind to port: {}", e);
            return Err(format!("Failed to bind to port: {}", e).into());
        }
    };

    // Get the port for logging
    let port = get_server_port().load(std::sync::atomic::Ordering::Relaxed);

    // Create shutdown signal for graceful shutdown
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();

    // Store the shutdown sender in global state
    let shutdown_state = get_server_shutdown();
    {
        let mut guard = shutdown_state.lock().unwrap();
        *guard = Some(shutdown_tx);
    }

    // Spawn the server in a separate task with graceful shutdown support
    let server_handle = tokio::spawn(async move {
        log::info!(
            "🚀 Audio streaming server starting on http://127.0.0.1:{}",
            port
        );
        log::info!("   Health check: http://127.0.0.1:{}/health", port);

        // Create a shutdown signal that combines our custom shutdown with OS signals
        let shutdown = async {
            #[cfg(not(target_os = "ios"))]
            {
                // On non-iOS platforms, wait for either our custom shutdown signal or OS signals
                tokio::select! {
                    _ = shutdown_rx => {
                        log::info!("Received shutdown signal for audio streaming server");
                    }
                    _ = signal::ctrl_c() => {
                        log::info!("Received Ctrl+C, shutting down audio streaming server");
                    }
                }
            }
            #[cfg(target_os = "ios")]
            {
                // On iOS, only wait for our custom shutdown signal
                shutdown_rx.await;
                log::info!("Received shutdown signal for audio streaming server");
            }
        };

        // Serve with graceful shutdown
        if let Err(e) = axum::serve(listener, router)
            .with_graceful_shutdown(shutdown)
            .await
        {
            log::error!("Audio streaming server error: {}", e);
        } else {
            log::info!("Audio streaming server shut down gracefully");
        }
    });

    // Mark server as started
    server_started.store(true, std::sync::atomic::Ordering::Relaxed);

    // Give the server a moment to start accepting connections
    tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
    log::info!("Audio streaming server initialization complete");

    // Store the server handle (we could use this to wait for shutdown, but for now we just let it run)
    std::mem::forget(server_handle);

    Ok(())
}

/// Stop the audio streaming server gracefully
pub async fn stop_audio_server() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let server_started = get_server_started_flag();
    let shutdown_state = get_server_shutdown();

    // Check if server is running
    if !server_started.load(std::sync::atomic::Ordering::Relaxed) {
        log::debug!("Audio streaming server is not running, nothing to stop");
        return Ok(());
    }

    log::info!("Stopping audio streaming server...");

    // Send shutdown signal
    let shutdown_tx = {
        let mut guard = shutdown_state.lock().unwrap();
        guard.take()
    };

    if let Some(tx) = shutdown_tx {
        if let Err(_e) = tx.send(()) {
            log::warn!("Failed to send shutdown signal (server may have already stopped)");
        } else {
            log::info!("Shutdown signal sent to audio streaming server");
            // Give the server a moment to shut down gracefully
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        }
    }

    // Reset server state
    server_started.store(false, std::sync::atomic::Ordering::Relaxed);
    let server_port = get_server_port();
    server_port.store(0, std::sync::atomic::Ordering::Relaxed);

    log::info!("Audio streaming server stopped");
    Ok(())
}

/// Restart the audio streaming server (useful when app comes back to foreground on iOS)
pub async fn restart_audio_server(
    app: AppHandle,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Stop the server first if it's running
    let _ = stop_audio_server().await;

    // Wait a moment before restarting
    tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;

    log::info!("Restarting audio streaming server...");
    start_audio_server(app.clone()).await?;

    // Notify the frontend so it can reconnect the audio element with the new URL.
    // The port changes on every restart because we bind to :0 (OS-assigned).
    let port = get_server_port().load(std::sync::atomic::Ordering::Relaxed);
    if port > 0 {
        use tauri::Emitter;
        if let Err(e) = app.emit("audio-server-restarted", port) {
            log::warn!("Failed to emit audio-server-restarted event: {}", e);
        } else {
            log::info!("Emitted audio-server-restarted (port={})", port);
        }
    }

    Ok(())
}

/// Detect audio MIME type from file extension
fn detect_audio_mime_type(audio_path: &str, audio_href: &str) -> &'static str {
    let path_lower = audio_path.to_lowercase();
    let href_lower = audio_href.to_lowercase();

    if path_lower.ends_with(".mp3") || href_lower.ends_with(".mp3") {
        "audio/mpeg"
    } else if path_lower.ends_with(".m4a")
        || href_lower.ends_with(".m4a")
        || path_lower.ends_with(".m4b")
        || href_lower.ends_with(".m4b")
    {
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

#[cfg(test)]
mod tests {
    use super::{
        append_reader_css_width_guards, build_epub_resource_absolute_url,
        detect_audio_mime_type, detect_resource_mime_type, is_external_resource_ref,
        rewrite_css_urls_for_endpoint,
    };

    #[test]
    fn detects_resource_mime_types_from_extension_and_signature() {
        assert_eq!(detect_resource_mime_type("styles/main.css", b"body{}"), "text/css");
        assert_eq!(detect_resource_mime_type("chapter.xhtml", b"<html />"), "text/html");
        assert_eq!(detect_resource_mime_type("cover.unknown", &[0x89, 0x50, 0x4E, 0x47]), "image/png");
        assert_eq!(detect_resource_mime_type("cover.bin", &[0x00, 0x01]), "application/octet-stream");
    }

    #[test]
    fn detects_audio_mime_types_with_reasonable_default() {
        assert_eq!(detect_audio_mime_type("track.m4b", "track.bin"), "audio/mp4");
        assert_eq!(detect_audio_mime_type("track.bin", "track.ogg"), "audio/ogg");
        assert_eq!(detect_audio_mime_type("track.bin", "track.unknown"), "audio/mpeg");
    }

    #[test]
    fn recognizes_external_resource_references() {
        assert!(is_external_resource_ref("https://example.com/a.css"));
        assert!(is_external_resource_ref(" data:image/png;base64,abc"));
        assert!(is_external_resource_ref("#chapter-1"));
        assert!(!is_external_resource_ref("../images/cover.png"));
    }

    #[test]
    fn builds_epub_resource_urls_with_encoded_query_values() {
        let url = build_epub_resource_absolute_url(
            4321,
            "book 1",
            "Text/chapter 1.xhtml",
            Some("OPS/chapter 1.xhtml"),
        );

        assert_eq!(
            url,
            "http://localhost:4321/epub-resource?book_id=book%201&href=Text%2Fchapter%201%2Exhtml&chapter_href=OPS%2Fchapter%201%2Exhtml"
        );
    }

    #[test]
    fn preserves_external_css_urls_and_appends_reader_guards() {
        let css = ".keep-http { background-image: url(\"https://example.com/bg.png\"); } .keep-anchor { mask-image: url(#mask); }";

        let rewritten = rewrite_css_urls_for_endpoint(css, 8080, "book-id", "OPS/styles/main.css");

        assert!(rewritten.contains("https://example.com/bg.png"));
        assert!(rewritten.contains("url(#mask)"));
        assert!(rewritten.contains("[data-reader-chapter-content=\"true\"]{max-width:100%!important"));
    }

    #[test]
    fn appends_reader_width_guards_to_css() {
        let guarded = append_reader_css_width_guards("body { color: black; }");

        assert!(guarded.starts_with("body { color: black; }"));
        assert!(guarded.contains("Aurorabook reader guard"));
        assert!(guarded.contains("overflow-wrap:break-word"));
    }

    #[test]
    fn detects_fonts_media_and_magic_mime_types() {
        assert_eq!(detect_resource_mime_type("f.woff2", b""), "font/woff2");
        assert_eq!(detect_resource_mime_type("f.ttf", b""), "font/ttf");
        assert_eq!(detect_resource_mime_type("a.mp3", b""), "audio/mpeg");
        assert_eq!(detect_resource_mime_type("a.m4b", b""), "audio/mp4");
        assert_eq!(detect_resource_mime_type("v.webm", b""), "video/webm");
        assert_eq!(detect_resource_mime_type("s.vtt", b""), "text/vtt");
        assert_eq!(
            detect_resource_mime_type("x.bin", &[0xFF, 0xD8, 0xFF, 0xE0]),
            "image/jpeg"
        );
        assert_eq!(
            detect_resource_mime_type("x.bin", &[0x47, 0x49, 0x46, 0x38]),
            "image/gif"
        );
    }

    #[test]
    fn detects_more_audio_mime_extensions() {
        assert_eq!(detect_audio_mime_type("a.wav", "x"), "audio/wav");
        assert_eq!(detect_audio_mime_type("a.webm", "x"), "audio/webm");
        assert_eq!(detect_audio_mime_type("a.flac", "x"), "audio/flac");
        assert_eq!(detect_audio_mime_type("a.mp3", "x"), "audio/mpeg");
    }

    #[test]
    fn rewrite_css_rewrites_relative_urls_and_imports() {
        let css = r#"
@import url("fonts/book.woff2");
@import 'theme.css';
.bg { background: url(../images/cover.jpg); }
"#;
        let rewritten =
            rewrite_css_urls_for_endpoint(css, 9000, "book-id", "OPS/styles/main.css");
        assert!(rewritten.contains("http://localhost:9000/epub-resource?"));
        assert!(rewritten.contains("book_id=book%2Did"));
        assert!(rewritten.contains("Aurorabook reader guard"));
        assert!(!rewritten.contains("url(../images/cover.jpg)"));
    }
}
