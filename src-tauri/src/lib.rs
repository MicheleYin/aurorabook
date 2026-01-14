
// ONNX Runtime with CoreML EP support (macOS/iOS only)
#[cfg(any(target_os = "macos", target_os = "ios"))]

use tauri::{Manager, Emitter};

pub mod book_service;  // Made public for testing
pub mod resources;  // Made public for testing
pub mod tts_commands;  // Made public for testing
pub mod tts;  // Made public for testing
pub mod epub;  // Made public for testing
pub mod utils;  // Made public for testing
mod window;
mod logging;

// Use kokoros crate directly on all platforms (it uses ONNX Runtime with CoreML EP on macOS/iOS)

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

/// Simple greeting command for testing Tauri integration.
///
/// # Arguments
/// * `name` - Name to greet
///
/// # Returns
/// A greeting message string.
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// Main entry point for the Tauri application.
///
/// This function initializes the Tauri application with all required plugins
/// and registers all available commands. It also initializes the logger for
/// structured logging throughout the application.
///
/// # Plugins
/// - `tauri_plugin_dialog` - File dialogs
/// - `tauri_plugin_fs` - File system operations
/// - `tauri_plugin_opener` - Opening files/URLs
/// - `tauri_plugin_sql` - SQLite database storage
///
/// # Commands
/// The application registers commands for:
/// - TTS operations (init, generate, batch)
/// - EPUB conversion
/// - Book management
/// - Resource management
///
/// # Logging
/// Initializes `env_logger` with default filter level "info".
/// Can be overridden with `RUST_LOG` environment variable.
///
/// # Panics
/// Panics if the Tauri application fails to run.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // Initialize log forwarding first (before setting up logger)
            logging::init_log_forwarding(app.handle());
            
            // Initialize custom logger that forwards to frontend
            // The logger will use RUST_LOG env var or default to trace to capture all logs
            let logger = Box::new(logging::FrontendLogger::new());
            // Set max level to Trace to capture all logs including ONNX Runtime
            // The env_logger inside FrontendLogger will handle filtering based on RUST_LOG
            log::set_boxed_logger(logger)
                .map(|()| log::set_max_level(log::LevelFilter::Trace))
                .expect("Failed to set logger");
            // Set TAURI_RESOURCE_DIR environment variable for kokoros to find bundled models
            match app.path().resource_dir() {
                Ok(resource_dir) => {
                    if let Some(resource_str) = resource_dir.to_str() {
                        std::env::set_var("TAURI_RESOURCE_DIR", resource_str);
                        let msg = format!("✓ Set TAURI_RESOURCE_DIR to: {}", resource_str);
                        log::info!("{}", msg);
                        logging::log("info", &msg, None);
                        
                        let exists_msg = format!("  Resource directory exists: {}", resource_dir.exists());
                        log::info!("{}", exists_msg);
                        logging::log("info", &exists_msg, None);
                        
                        // Verify kokoro model is available
                        let kokoro_path = resource_dir.join("kokoro-v1.0.onnx");
                        if kokoro_path.exists() {
                            let model_msg = format!("✓ Found kokoro-v1.0.onnx model at: {}", kokoro_path.display());
                            log::info!("{}", model_msg);
                            logging::log("info", &model_msg, None);
                        } else {
                            let warn_msg = format!("⚠ kokoro-v1.0.onnx model not found at: {:?}", kokoro_path);
                            log::warn!("{}", warn_msg);
                            logging::log("warn", &warn_msg, None);
                        }
                        
                        // Log what's actually in the resource directory
                        if let Ok(entries) = std::fs::read_dir(&resource_dir) {
                            let mut files: Vec<String> = entries
                                .filter_map(|e| e.ok())
                                .map(|e| e.file_name().to_string_lossy().to_string())
                                .collect();
                            files.sort();
                            let contents_msg = format!("  Resource directory contents ({} items): {:?}", files.len(), files);
                            log::info!("{}", contents_msg);
                            logging::log("info", &contents_msg, Some(serde_json::json!({ "files": files })));
                        }
                    } else {
                        let warn_msg = format!("⚠ Resource directory path is not valid UTF-8: {:?}", resource_dir);
                        log::warn!("{}", warn_msg);
                        logging::log("warn", &warn_msg, None);
                    }
                }
                Err(e) => {
                    let error_msg = format!("❌ Failed to get Tauri resource directory: {}", e);
                    log::error!("{}", error_msg);
                    logging::log("error", &error_msg, None);
                    
                    let error_msg2 = "  This will cause path resolution to fail in production!";
                    log::error!("{}", error_msg2);
                    logging::log("error", error_msg2, None);
                }
            }
            
            // Create and configure the main window
            window::create_main_window(app)?;
            
            // Initialize database connection (single connection for entire app)
            // Use blocking wait since setup is synchronous
            let app_handle = app.handle().clone();
            let rt = tokio::runtime::Runtime::new().expect("Failed to create tokio runtime");
            rt.block_on(async {
                book_service::database::init_db_connection(&app_handle).await
            }).map_err(|e| {
                log::error!("Failed to initialize database connection: {}", e);
                e
            })?;
            
            // Start audio streaming HTTP server tied to app lifecycle
            // Use the runtime handle to spawn the task
            let app_handle_for_server = app.handle().clone();
            let handle = rt.handle().clone();
            
            // Spawn the server task - the handle keeps the runtime alive
            handle.spawn(async move {
                // Small delay to ensure everything is initialized
                tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
                log::info!("Starting audio streaming server (tied to app lifecycle)...");
                match book_service::audio_stream::start_audio_server(app_handle_for_server).await {
                    Ok(_) => {
                        log::info!("Audio streaming server started successfully");
                    }
                    Err(e) => {
                        log::error!("Failed to start audio streaming server: {}", e);
                    }
                }
            });
            
            // Keep the runtime alive by leaking it (it will run for the app lifetime)
            // This is safe because the runtime will be cleaned up when the app exits
            std::mem::forget(rt);
            
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            greet,
            tts_commands::init_kokoros_engine,
            tts_commands::generate_tts_cached,
            tts_commands::generate_tts_batch,
            resources::copy_resource_file,
            resources::copy_directory,
            tts_commands::convert_pcm_to_mp3,
            epub::conversion_command::convert_epub_to_audiobook_command,
            epub::cancellation::cancel_conversion_command,
            resources::read_resource_file,
            book_service::read_all_books,
            book_service::read_one_book,
            book_service::read_single_chapter,
            book_service::load_chapter_content,
            book_service::load_epub_chapter_bytes,
            book_service::load_epub_image,
            book_service::load_epub_audio,
            book_service::load_epub_audio_bytes,
            book_service::read_single_audio_track,
            book_service::delete_book,
            book_service::add_book,
            book_service::get_epub_buffer,
            book_service::export_epub_to_file,
            book_service::update_book_progress,
            book_service::update_book_audio_state,
            book_service::ingest_epub,
            book_service::get_app_settings,
            book_service::update_app_settings,
            book_service::get_reader_preferences,
            book_service::update_reader_preferences,
            book_service::update_book_last_opened_time,
            book_service::audio_stream::get_audio_stream_url,
            utils::path_resolver::get_path_diagnostics,
        ])
        .manage(epub::CancellationTokens::new())
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            match event {
                // Handle app close events (when app is about to close)
                tauri::RunEvent::ExitRequested { code, .. } => {
                    log::info!("App is closing with exit code: {:?}", code);
                    
                    // Emit event to frontend to save progress before closing
                    if let Some(window) = app_handle.get_webview_window("main") {
                        if let Err(e) = window.emit("app-closing", ()) {
                            log::warn!("Failed to emit app-closing event: {}", e);
                        } else {
                            log::info!("Emitted app-closing event to frontend");
                            // Give frontend a moment to save progress
                            std::thread::sleep(std::time::Duration::from_millis(500));
                        }
                    }
                    
                    // Cancel any ongoing conversion operations
                    {
                        let tokens_map_opt = if let Some(tokens_state) = app_handle.try_state::<epub::CancellationTokens>() {
                            let cancellation_tokens = tokens_state.inner();
                            let arc = cancellation_tokens.get();
                            Some(arc)
                        } else {
                            None
                        };
                        
                        if let Some(tokens_map) = tokens_map_opt {
                            match tokens_map.lock() {
                                Ok(tokens_guard) => {
                                    let count = tokens_guard.len();
                                    for (book_id, cancel_token) in tokens_guard.iter() {
                                        cancel_token.store(true, std::sync::atomic::Ordering::Relaxed);
                                        log::debug!("Cancelled conversion for book_id: {}", book_id);
                                    }
                                    if count > 0 {
                                        log::info!("Cancelled {} ongoing conversion(s)", count);
                                    }
                                }
                                Err(e) => {
                                    log::warn!("Failed to lock cancellation tokens: {}", e);
                                }
                            }
                        }
                    }
                    
                    // Stop the audio streaming server gracefully
                    if let Ok(handle) = tokio::runtime::Handle::try_current() {
                        handle.spawn(async move {
                            if let Err(e) = book_service::audio_stream::stop_audio_server().await {
                                log::error!("Failed to stop audio streaming server: {}", e);
                            } else {
                                log::info!("Audio streaming server stopped gracefully");
                            }
                        });
                        // Give the server a moment to shut down
                        std::thread::sleep(std::time::Duration::from_millis(500));
                    } else {
                        // Fallback: try to stop synchronously if no runtime handle
                        log::warn!("No tokio runtime handle available, server may not shut down gracefully");
                    }
                    
                    log::info!("Cleanup completed, app will now close");
                }
                
                // Handle app lifecycle events (especially important on iOS)
                #[cfg(target_os = "ios")]
                tauri::RunEvent::Ready => {
                    log::info!("App is ready, ensuring audio server is running (tied to app lifecycle)...");
                    let app_handle_clone = app_handle.clone();
                    // Use Tauri's runtime if available
                    if let Ok(handle) = tokio::runtime::Handle::try_current() {
                        handle.spawn(async move {
                            tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;
                            // Check if server is running, restart if not
                            if !book_service::audio_stream::check_server_running().await {
                                log::info!("Audio server not running, starting it...");
                                if let Err(e) = book_service::audio_stream::restart_audio_server(app_handle_clone).await {
                                    log::error!("Failed to restart audio server: {}", e);
                                }
                            }
                        });
                    }
                }
                
                #[cfg(target_os = "ios")]
                tauri::RunEvent::Resumed => {
                    log::info!("App resumed from background, restarting audio server (tied to app lifecycle)...");
                    let app_handle_clone = app_handle.clone();
                    // Always restart server when app resumes on iOS
                    // iOS may have killed the server when app was backgrounded
                    if let Ok(handle) = tokio::runtime::Handle::try_current() {
                        handle.spawn(async move {
                            tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
                            log::info!("Restarting audio server after app resume...");
                            if let Err(e) = book_service::audio_stream::restart_audio_server(app_handle_clone).await {
                                log::error!("Failed to restart audio server after resume: {}", e);
                            }
                        });
                    }
                }
                
                // Handle file open events (when app is opened with a file)
                #[cfg(any(target_os = "macos", target_os = "ios"))]
                tauri::RunEvent::Opened { urls } => {
                    for url in urls {
                        // Convert URL to string and normalize the file path
                        // (remove file:// prefix and decode URL encoding)
                        let url_string = url.to_string();
                        let normalized_path = utils::path_resolver::ResourcePathResolver::normalize_file_path(&url_string);
                        
                        // Check if file is an EPUB by extension or content type
                        // On iOS, we need to be more lenient since file type detection may vary
                        let is_epub = normalized_path.to_lowercase().ends_with(".epub") ||
                            url_string.contains("epub") ||
                            url_string.contains("org.idpf.epub-container");
                        
                        if is_epub {
                            log::info!("File opened from OS: {} (detected as EPUB)", normalized_path);
                            
                            // Emit event to frontend to trigger ingestion
                            let app_handle_clone = app_handle.clone();
                            let path_clone = normalized_path.clone();
                            
                            // Try to emit immediately
                            if let Some(window) = app_handle_clone.get_webview_window("main") {
                                if let Err(e) = window.emit("file-opened", &path_clone) {
                                    log::warn!("Failed to emit file-opened event: {}", e);
                                }
                            } else {
                                // If window doesn't exist yet, store the path for later
                                // The frontend will check for pending files on mount
                                log::warn!("Main window not available yet, file will be processed when window is ready: {}", path_clone);
                            }
                        } else {
                            log::warn!("Opened file is not an EPUB: {} (url: {})", normalized_path, url_string);
                        }
                    }
                }
                
                _ => {}
            }
        });
}
