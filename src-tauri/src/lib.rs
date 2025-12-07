
// ONNX Runtime with CoreML EP support (macOS/iOS only)
#[cfg(any(target_os = "macos", target_os = "ios"))]

pub mod book_service;  // Made public for testing
mod resources;
mod tts_commands;
mod tts;
pub mod epub;  // Made public for testing
mod utils;
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
            book_service::load_epub_image,
            book_service::load_epub_audio,
            book_service::read_single_audio_track,
            book_service::delete_book,
            book_service::add_book,
            book_service::get_epub_buffer,
            book_service::update_book_progress,
            book_service::update_book_audio_state,
            book_service::ingest_epub,
        ])
        .manage(epub::CancellationTokens::new())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
