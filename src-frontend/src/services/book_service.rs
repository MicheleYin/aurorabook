use crate::types::{Book, Chapter};
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;
use js_sys::Promise;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryFilter {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filter: Option<String>, // "all" | "new" | "resume" | "finished" | "recent" | "author"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search: Option<String>,
}

/// Invoke a Tauri command from WASM
async fn invoke_tauri_command<T>(command: &str, args: JsValue) -> Result<T, String>
where
    T: for<'de> Deserialize<'de>,
{
    let window = web_sys::window().ok_or("No window object")?;
    let tauri = js_sys::Reflect::get(&window, &JsValue::from_str("__TAURI__"))
        .map_err(|_| "Tauri not available")?;
    
    let core = js_sys::Reflect::get(&tauri, &JsValue::from_str("core"))
        .map_err(|_| "Tauri core not available")?;
    
    let invoke_fn = js_sys::Reflect::get(&core, &JsValue::from_str("invoke"))
        .map_err(|_| "Tauri invoke not available")?;
    
    let invoke = invoke_fn.dyn_ref::<js_sys::Function>()
        .ok_or("invoke is not a function")?;
    
    let promise = invoke
        .call2(&core, &JsValue::from_str(command), &args)
        .map_err(|_| "Failed to call invoke")?;
    
    let promise = Promise::from(promise);
    let result = JsFuture::from(promise)
        .await
        .map_err(|e| format!("Command failed: {:?}", e))?;
    
    serde_wasm_bindgen::from_value(result)
        .map_err(|e| format!("Deserialization failed: {:?}", e))
}

/// Read all books with optional filtering and search
/// Does NOT preload chapter content - chapters are loaded lazily when needed
pub async fn read_all_books(filter: Option<LibraryFilter>) -> Result<Vec<Book>, String> {
    let args = serde_wasm_bindgen::to_value(&serde_json::json!({
        "filter": filter
    })).map_err(|e| format!("Serialization failed: {}", e))?;
    
    invoke_tauri_command::<Vec<Book>>("read_all_books", args).await
}

/// Read a single complete book by ID
/// Does NOT preload all chapters - only loads the active chapter and adjacent ones
pub async fn read_one_book(book_id: &str) -> Result<Option<Book>, String> {
    let args = serde_wasm_bindgen::to_value(&serde_json::json!({
        "bookId": book_id
    })).map_err(|e| format!("Serialization failed: {}", e))?;
    
    invoke_tauri_command::<Option<Book>>("read_one_book", args).await
}

/// Read a single chapter by book ID and chapter ID
/// Returns chapter metadata only (no content)
pub async fn read_single_chapter(
    book_id: &str,
    chapter_id: &str,
) -> Result<Option<Chapter>, String> {
    let args = serde_wasm_bindgen::to_value(&serde_json::json!({
        "bookId": book_id,
        "chapterId": chapter_id
    })).map_err(|e| format!("Serialization failed: {}", e))?;
    
    invoke_tauri_command::<Option<Chapter>>("read_single_chapter", args).await
}

/// Load chapter content from EPUB file
/// This loads the actual chapter HTML content from the EPUB file stored in the backend
pub async fn load_chapter_content(
    book_id: &str,
    chapter_href: &str,
) -> Result<Option<Chapter>, String> {
    let args = serde_wasm_bindgen::to_value(&serde_json::json!({
        "bookId": book_id,
        "chapterHref": chapter_href
    })).map_err(|e| format!("Serialization failed: {}", e))?;
    
    invoke_tauri_command::<Option<Chapter>>("load_chapter_content", args).await
}

/// Delete a book by ID
pub async fn delete_book(book_id: &str) -> Result<(), String> {
    let args = serde_wasm_bindgen::to_value(&serde_json::json!({
        "bookId": book_id
    })).map_err(|e| format!("Serialization failed: {}", e))?;
    
    invoke_tauri_command::<()>("delete_book", args).await
}

/// Update book progress
pub async fn update_book_progress(
    book_id: &str,
    progress: serde_json::Value,
) -> Result<(), String> {
    let args = serde_wasm_bindgen::to_value(&serde_json::json!({
        "bookId": book_id,
        "progress": progress
    })).map_err(|e| format!("Serialization failed: {}", e))?;
    
    invoke_tauri_command::<()>("update_book_progress", args).await
}

/// Update book audio state
pub async fn update_book_audio_state(
    book_id: &str,
    audio_state: serde_json::Value,
) -> Result<(), String> {
    let args = serde_wasm_bindgen::to_value(&serde_json::json!({
        "bookId": book_id,
        "audioState": audio_state
    })).map_err(|e| format!("Serialization failed: {}", e))?;
    
    invoke_tauri_command::<()>("update_book_audio_state", args).await
}

/// Load EPUB image
pub async fn load_epub_image(
    book_id: &str,
    image_href: &str,
) -> Result<Option<String>, String> {
    let args = serde_wasm_bindgen::to_value(&serde_json::json!({
        "bookId": book_id,
        "imageHref": image_href
    })).map_err(|e| format!("Serialization failed: {}", e))?;
    
    invoke_tauri_command::<Option<String>>("load_epub_image", args).await
}

/// Load EPUB audio track
pub async fn load_epub_audio(
    book_id: &str,
    audio_href: &str,
) -> Result<Option<String>, String> {
    let args = serde_wasm_bindgen::to_value(&serde_json::json!({
        "bookId": book_id,
        "audioHref": audio_href
    })).map_err(|e| format!("Serialization failed: {}", e))?;
    
    invoke_tauri_command::<Option<String>>("load_epub_audio", args).await
}
