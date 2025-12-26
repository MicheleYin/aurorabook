
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
    // Initialize logger
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();
    
    tauri::Builder::default()
        .setup(|app| {
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
        ])
        .manage(epub::CancellationTokens::new())
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // Handle file open events (when app is opened with a file)
            #[cfg(any(target_os = "macos", target_os = "ios"))]
            if let tauri::RunEvent::Opened { urls } = event {
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
        });
}
