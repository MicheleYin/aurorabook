
extern crate self as kokoros;

use tauri::{Emitter, Manager};

pub mod book_service;  // Made public for testing
pub mod resources;  // Made public for testing
pub mod tts_commands;  // Made public for testing
pub mod tts;  // Made public for testing
pub mod epub;  // Made public for testing
pub mod utils;  // Made public for testing
pub mod background;
pub mod native_player;
pub mod dictionary;
mod window;
mod logging;

/// Owns the dedicated Tokio runtime used for DB init and the audio HTTP server.
/// Stored in managed state so we never `mem::forget` it; ExitRequested uses the
/// cloned [`tokio::runtime::Handle`] also kept in managed state.
struct DedicatedRuntime {
    _runtime: tokio::runtime::Runtime,
}

fn with_dedicated_handle(app_handle: &tauri::AppHandle, f: impl FnOnce(&tokio::runtime::Handle)) {
    if let Some(handle) = app_handle.try_state::<tokio::runtime::Handle>() {
        f(&*handle);
    } else if let Ok(handle) = tokio::runtime::Handle::try_current() {
        f(&handle);
    } else {
        log::warn!("No dedicated Tokio runtime handle available");
    }
}

/// Ensure Windows can resolve `webgpu_dawn.dll` (and companion DXC DLLs).
///
/// ORT's WebGPU build links Dawn as a DLL. The install must place
/// `webgpu_dawn.dll` next to `AuroraBook.exe` (see `tauri.windows.conf.json`).
/// PATH is still prepended for companions / delay-loaded helpers under
/// `resources/ort-dylibs`.
#[cfg(target_os = "windows")]
fn prepend_windows_ort_dylib_dir(resource_dir: &std::path::Path) {
    let mut extras: Vec<String> = Vec::new();

    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            if let Some(s) = exe_dir.to_str() {
                extras.push(s.to_string());
            }
        }
    }

    for dir in [
        resource_dir.join("ort-dylibs"),
        resource_dir.join("resources").join("ort-dylibs"),
    ] {
        if dir.is_dir() {
            if let Some(s) = dir.to_str() {
                extras.push(s.to_string());
            }
        }
    }

    if extras.is_empty() {
        return;
    }

    let joined = extras.join(";");
    let new_path = match std::env::var_os("PATH") {
        Some(existing) => {
            let mut s = joined;
            s.push(';');
            s.push_str(&existing.to_string_lossy());
            s
        }
        None => joined,
    };
    std::env::set_var("PATH", new_path);
    log::info!("✓ Prepended Windows Dawn DLL search dirs to PATH");
}

// In-tree Supertonic wrapper uses ONNX Runtime (CPU/CoreML depending on platform and ORT EP configuration).

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
/// Debug builds: forwards logs to stderr and the webview (`frontend-log`); default `trace`, overridable via `RUST_LOG`.
/// Release builds: logging is fully disabled (no stderr, no UI forwarding).
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
                .map(|()| {
                    log::set_max_level(if cfg!(debug_assertions) {
                        log::LevelFilter::Trace
                    } else {
                        log::LevelFilter::Off
                    });
                })
                .expect("Failed to set logger");
            // Set TAURI_RESOURCE_DIR environment variable for bundled Supertonic assets
            match app.path().resource_dir() {
                Ok(resource_dir) => {
                    if let Some(resource_str) = resource_dir.to_str() {
                        std::env::set_var("TAURI_RESOURCE_DIR", resource_str);
                        let msg = format!("✓ Set TAURI_RESOURCE_DIR to: {}", resource_str);
                        log::info!("{}", msg);
                        logging::log("info", &msg, None);

                        // Windows: Dawn / DirectML helper DLLs live under resources/ort-dylibs.
                        // Prepend that directory to PATH so LoadLibrary finds them before system dirs.
                        #[cfg(target_os = "windows")]
                        {
                            prepend_windows_ort_dylib_dir(&resource_dir);
                        }

                        let exists_msg = format!("  Resource directory exists: {}", resource_dir.exists());
                        log::info!("{}", exists_msg);
                        logging::log("info", &exists_msg, None);
                        
                        let bundled_onnx = resource_dir
                            .join("resources")
                            .join("supertonic")
                            .join("onnx");
                        let flat_onnx = resource_dir.join("supertonic").join("onnx");
                        let supertonic_onnx = if bundled_onnx.join("tts.json").exists() {
                            bundled_onnx
                        } else {
                            flat_onnx
                        };
                        if supertonic_onnx.join("tts.json").exists() {
                            let model_msg = format!(
                                "✓ Found Supertonic ONNX bundle at: {}",
                                supertonic_onnx.display()
                            );
                            log::info!("{}", model_msg);
                            logging::log("info", &model_msg, None);
                        } else {
                            let warn_msg = format!(
                                "⚠ Supertonic ONNX bundle not found under Resources (expected resources/supertonic/onnx from build.rs). Ensure ./supertonic-3 exists and run cargo build."
                            );
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
            
            // Initialize database connection (single pool for entire app)
            // Use a dedicated runtime kept in managed state (no mem::forget).
            let app_handle = app.handle().clone();
            let runtime =
                tokio::runtime::Runtime::new().expect("Failed to create tokio runtime");
            let handle = runtime.handle().clone();
            handle
                .block_on(async {
                    book_service::database::init_db_connection(&app_handle).await
                })
                .map_err(|e| {
                    log::error!("Failed to initialize database connection: {}", e);
                    e
                })?;

            // iOS 26+ continued processing (BGContinuedProcessingTaskRequest)
            background::init_background_runtime(app.handle());

            // Native AVPlayer bridge — enables lock-screen controls on iOS
            native_player::init(app.handle());

            // Start audio streaming HTTP server tied to app lifecycle
            let app_handle_for_server = app.handle().clone();
            handle.spawn(async move {
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

            app.manage(handle);
            app.manage(DedicatedRuntime { _runtime: runtime });

            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            greet,
            dictionary::lookup_dictionary,
            tts_commands::init_kokoros_engine,
            tts_commands::generate_tts_cached,
            tts_commands::generate_tts_batch,
            resources::copy_resource_file,
            resources::copy_directory,
            tts_commands::convert_pcm_to_mp3,
            epub::conversion_command::convert_epub_to_audiobook_command,
            epub::cancellation::cancel_conversion_command,
            background::commands::background_capabilities,
            background::commands::start_continued_conversion,
            background::commands::cancel_continued_task,
            resources::read_resource_file,
            book_service::read_all_books,
            book_service::read_one_book,
            book_service::get_current_converting_chapter,
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
            book_service::mp3_export::export_as_mp3,
            book_service::mp3_export::get_mp3_export_status,
            book_service::mp3_export::get_audio_export_status,
            book_service::mp3_export::export_as_m4a,
            book_service::mp3_export::export_as_m4b,
            book_service::mp3_export::cancel_audio_export,
            book_service::update_book_progress,
            book_service::update_book_audio_state,
            book_service::ingest_epub,
            book_service::get_app_settings,
            book_service::update_app_settings,
            book_service::get_reader_preferences,
            book_service::update_reader_preferences,
            book_service::update_book_last_opened_time,
            book_service::audio_stream::get_audio_stream_url,
            book_service::audio_stream::get_epub_resource_url,
            book_service::audio_stream::get_audio_live_stream_url,
            book_service::audio_stream::get_live_chapter_duration,
            book_service::audio_stream::get_live_sync_marker,
            book_service::audio_stream::get_live_segment_manifest,
            book_service::audio_stream::get_live_segment_bytes,
            utils::path_resolver::get_path_diagnostics,
            native_player::ios_player_load,
            native_player::ios_player_play,
            native_player::ios_player_pause,
            native_player::ios_player_seek,
            native_player::ios_player_set_rate,
            native_player::ios_player_current_time,
            native_player::ios_player_is_playing,
        ])
        .manage(epub::CancellationTokens::new())
        .manage(background::BackgroundCoordinator::new())
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            match event {
                // Handle app close events (when app is about to close)
                tauri::RunEvent::ExitRequested { code, .. } => {
                    log::info!("App is closing with exit code: {:?}", code);

                    #[cfg(not(target_os = "ios"))]
                    book_service::mp3_export::terminate_active_ffmpeg_audio_exports();

                    // Emit event to frontend to save progress before closing
                    if let Some(window) = app_handle.get_webview_window("main") {
                        if let Err(e) = window.emit("app-closing", ()) {
                            log::warn!("Failed to emit app-closing event: {}", e);
                        } else {
                            log::info!("Emitted app-closing event to frontend");
                            // Give frontend time to flush chapter/audio progress via IPC
                            std::thread::sleep(std::time::Duration::from_millis(800));
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
                    
                    // Stop the audio streaming server gracefully via the dedicated runtime.
                    with_dedicated_handle(app_handle, |handle| {
                        if let Err(e) =
                            handle.block_on(book_service::audio_stream::stop_audio_server())
                        {
                            log::error!("Failed to stop audio streaming server: {}", e);
                        } else {
                            log::info!("Audio streaming server stopped gracefully");
                        }
                    });
                    
                    log::info!("Cleanup completed, app will now close");
                }

                // Handle app lifecycle events (especially important on iOS)
                #[cfg(target_os = "ios")]
                tauri::RunEvent::Ready => {
                    log::info!("App is ready, ensuring audio server is running (tied to app lifecycle)...");
                    let app_handle_clone = app_handle.clone();
                    with_dedicated_handle(app_handle, |handle| {
                        handle.spawn(async move {
                            tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;
                            if !book_service::audio_stream::check_server_running().await {
                                log::info!("Audio server not running, starting it...");
                                if let Err(e) = book_service::audio_stream::restart_audio_server(app_handle_clone).await {
                                    log::error!("Failed to restart audio server: {}", e);
                                }
                            }
                        });
                    });
                }
                
                #[cfg(target_os = "ios")]
                tauri::RunEvent::Resumed => {
                    log::info!("App resumed from background, restarting audio server (tied to app lifecycle)...");
                    let app_handle_clone = app_handle.clone();
                    with_dedicated_handle(app_handle, |handle| {
                        handle.spawn(async move {
                            tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
                            log::info!("Restarting audio server after app resume...");
                            if let Err(e) = book_service::audio_stream::restart_audio_server(app_handle_clone).await {
                                log::error!("Failed to restart audio server after resume: {}", e);
                            }
                        });
                    });
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
