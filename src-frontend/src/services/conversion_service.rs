use crate::types::{Book, VoiceId};
use crate::services::book_service::invoke_tauri_command;
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;
use js_sys::Promise;
use serde_wasm_bindgen;

/// Convert an EPUB to audiobook format
/// This calls the backend conversion command and sets up event listeners for progress
pub async fn convert_epub_to_audiobook(
    book_id: &str,
    voice_id: &str,
) -> Result<Option<Book>, String> {
    let args = serde_wasm_bindgen::to_value(&serde_json::json!({
        "bookId": book_id,
        "voiceId": voice_id
    })).map_err(|e| format!("Serialization failed: {}", e))?;
    
    invoke_tauri_command::<Option<Book>>("convert_epub_to_audiobook_command", args).await
}

/// Cancel a conversion in progress
pub async fn cancel_conversion(source_path: &str) -> Result<(), String> {
    let args = serde_wasm_bindgen::to_value(&serde_json::json!({
        "sourcePath": source_path
    })).map_err(|e| format!("Serialization failed: {}", e))?;
    
    invoke_tauri_command::<()>("cancel_conversion_command", args).await
}

// Note: Event listeners for conversion progress should be set up in the hook/component
// using Tauri's event API directly via JavaScript interop


