pub mod parser;
pub mod converter;

pub use parser::*;
pub use converter::*;

use tauri::AppHandle;
use crate::epub::converter::{extract_chapters, convert_epub_to_audiobook, ConversionOptions, ConversionChapter};
use crate::book_service::models::Chapter;
use crate::utils::errors::{AppError, AppResult};
use crate::utils::constants::MAX_EPUB_SIZE;
use crate::utils::path_validation::validate_file_size;

/// Tauri command wrapper for EPUB to audiobook conversion.
///
/// This is the main entry point for converting EPUB files to audiobooks
/// from the frontend. It handles EPUB caching, chapter extraction, and
/// the full conversion process.
///
/// The function:
/// 1. Stores the original EPUB in the Tauri store for later retrieval
/// 2. Extracts chapters from the EPUB
/// 3. Converts chapters to audiobook format with TTS
/// 4. Stores the converted EPUB back in the store
///
/// # Arguments
/// * `source_path` - Original file path of the EPUB (used as cache key)
/// * `epub_data` - The EPUB file as a byte vector
/// * `voice_id` - Voice identifier for TTS (e.g., "af_heart", "af_bella")
/// * `app` - Tauri application handle
///
/// # Returns
/// `Ok(())` if conversion succeeds.
///
/// # Errors
/// Returns an error if:
/// - EPUB store creation fails
/// - Chapter extraction fails
/// - No chapters are found
/// - Conversion fails
///
/// # Example
/// ```typescript
/// // From frontend (TypeScript)
/// const epubData = await fs.readFile("book.epub");
/// await invoke("convert_epub_to_audiobook_command", {
///   sourcePath: "book.epub",
///   epubData: Array.from(epubData),
///   voiceId: "af_heart"
/// });
/// ```
#[tauri::command]
pub async fn convert_epub_to_audiobook_command(
    source_path: String,
    epub_data: Vec<u8>,
    voice_id: String,
    app: AppHandle,
) -> AppResult<()> {
    use base64::{engine::general_purpose, Engine as _};
    
    // Validate EPUB file size before processing
    validate_file_size(epub_data.len(), MAX_EPUB_SIZE, "EPUB")?;
    
    // Store EPUB in cache
    let epub_store = tauri_plugin_store::StoreBuilder::new(&app, "epub-cache.store.json")
        .build()
        .map_err(|e| AppError::Store(format!("Failed to create EPUB store: {}", e)))?;
    let key = format!("epub:{}", source_path);
    
    let base64_data = general_purpose::STANDARD.encode(&epub_data);
    epub_store.set(&key, serde_json::Value::String(base64_data));
    epub_store.save()
        .map_err(|e| AppError::Store(format!("Failed to save EPUB store: {}", e)))?;
    
    // Extract chapters
    let (chapters, stats) = extract_chapters(epub_data.clone())
        .map_err(|e| e.with_context("Failed to extract chapters"))?;
    
    let (manifest_count, spine_itemref_count, missing_manifest_count, non_html_count, filtered_count) = stats;
    
    if chapters.is_empty() {
        return Err(AppError::EpubParse(format!(
            "No chapters found in EPUB. Manifest had {} items, spine had {} itemrefs ({} missing from manifest, {} non-HTML, {} filtered), but no valid chapters were extracted.",
            manifest_count, spine_itemref_count, missing_manifest_count, non_html_count, filtered_count
        )));
    }
    
    // Convert chapters to ConversionChapter format
    let conversion_chapters: Vec<ConversionChapter> = chapters.into_iter().map(|c| ConversionChapter {
        id: c.id,
        title: c.title,
        href: c.href,
        content_html: c.content_html,
    }).collect();
    
    let options = ConversionOptions {
        voice_id,
        chapters: conversion_chapters,
    };
    
    // Perform conversion
    let converted_epub = convert_epub_to_audiobook(epub_data, options, app)
        .await
        .map_err(|e| AppError::EpubParse(e.to_string()).with_context("Conversion failed"))?;
    
    // Store converted EPUB
    let converted_base64 = general_purpose::STANDARD.encode(&converted_epub);
    epub_store.set(&key, serde_json::Value::String(converted_base64));
    epub_store.save();
    
    Ok(())
}
