use crate::services::book_service::invoke_tauri_command;
use wasm_bindgen::prelude::*;
use js_sys::Uint8Array;
use web_sys::Blob;
use serde_wasm_bindgen;

/// Load chapter content from backend as blob URL and HTML string
/// Returns (blob_url, html_string) or None if chapter not found
pub async fn load_epub_chapter_blob(
    book_id: &str,
    chapter_href: &str,
) -> Result<Option<(String, String)>, String> {
    let args = serde_wasm_bindgen::to_value(&serde_json::json!({
        "bookId": book_id,
        "chapterHref": chapter_href
    })).map_err(|e| format!("Serialization failed: {}", e))?;
    
    let result: Option<(Vec<u8>, String)> = invoke_tauri_command("load_epub_chapter_bytes", args).await?;
    
    if let Some((bytes, mime_type)) = result {
        // Convert Vec<u8> to Uint8Array
        let uint8_array = Uint8Array::new_with_length(bytes.len() as u32);
        for (i, &byte) in bytes.iter().enumerate() {
            uint8_array.set_index(i as u32, byte);
        }
        
        // Decode bytes to get HTML string (using Rust's UTF-8 decoding)
        let html_string = String::from_utf8(bytes)
            .map_err(|e| format!("Failed to decode UTF-8: {}", e))?;
        
        // Create Blob URL
        let blob_parts = js_sys::Array::new();
        blob_parts.push(&uint8_array.into());
        
        let blob_options = js_sys::Object::new();
        js_sys::Reflect::set(&blob_options, &JsValue::from_str("type"), &JsValue::from_str(&mime_type))
            .ok();
        
        // Use Blob constructor via js_sys::Reflect
        let blob_constructor = js_sys::Reflect::get(&js_sys::global(), &JsValue::from_str("Blob"))
            .map_err(|_| "Blob constructor not found")?;
        let blob = js_sys::Reflect::construct(
            &blob_constructor.dyn_into::<js_sys::Function>()
                .map_err(|_| "Blob is not a function")?,
            &js_sys::Array::of2(&blob_parts.into(), &blob_options.into())
        )
        .map_err(|e| format!("Failed to create blob: {:?}", e))?;
        
        let blob = blob.dyn_into::<Blob>()
            .map_err(|_| "Failed to cast to Blob")?;
        
        let blob_url = web_sys::Url::create_object_url_with_blob(&blob)
            .map_err(|e| format!("Failed to create blob URL: {:?}", e))?;
        
        Ok(Some((blob_url, html_string)))
    } else {
        Ok(None)
    }
}


