//! EPUB to audiobook conversion command
//!
//! This module provides the main Tauri command for converting EPUB files
//! to audiobooks, broken down into smaller, focused functions.

use tauri::{AppHandle, Emitter};
use crate::utils::errors::{AppError, AppResult};
use crate::utils::constants::MAX_EPUB_SIZE;
use crate::utils::path_validation::validate_file_size;
use crate::book_service::models::{Book, ConversionStatus};
use crate::book_service::storage::{load_all_books, save_all_books, add_book as save_book};
use crate::epub::converter::{ConversionOptions, ConversionProgress, ConversionChapter, emit_progress};
use crate::epub::converter::extract_chapters;
use crate::epub::cancellation::{get_cancellation_token, cleanup_cancellation_token};
use crate::epub::book_update::update_book_audio_tracks;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use base64::{engine::general_purpose, Engine as _};

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
/// `Ok(Some(Book))` with the updated book if conversion succeeds and book is found in library.
/// `Ok(None)` if conversion succeeds but book is not in library.
///
/// # Errors
/// Returns an error if:
/// - EPUB store creation fails
/// - Chapter extraction fails
/// - No chapters are found
/// - Conversion fails
#[tauri::command]
pub async fn convert_epub_to_audiobook_command(
    source_path: String,
    epub_data: Vec<u8>,
    voice_id: String,
    app: AppHandle,
) -> AppResult<Option<Book>> {
    log::info!("convert_epub_to_audiobook_command called: source_path={}, voice_id={}, epub_data_len={}", 
        source_path, voice_id, epub_data.len());
    
    // Emit initial progress
    emit_initial_progress(&app);
    
    // Validate and cache EPUB
    validate_and_cache_epub(&app, &source_path, &epub_data)?;
    
    // Extract chapters
    let all_conversion_chapters = extract_chapters_from_epub(&app, epub_data.clone())?;
    
    // Load and prepare book data
    let book_data = load_and_prepare_book(&app, &source_path, &voice_id, &all_conversion_chapters).await?;
    
    // Check if all chapters are already converted
    if book_data.conversion_chapters.is_empty() {
        return handle_all_chapters_completed(&app, &source_path, book_data.total_words_all_chapters, book_data.existing_book).await;
    }
    
    // Prepare conversion
    let conversion_prep = prepare_conversion(&app, &source_path, &book_data).await?;
    
    // Perform conversion
    let converted_epub = perform_conversion(
        &app,
        &source_path,
        epub_data,
        &book_data,
        &conversion_prep,
    ).await?;
    
    // Save converted EPUB and update book
    save_converted_epub_and_update_book(&app, &source_path, &converted_epub, book_data.total_words_all_chapters).await
}

/// Emit initial progress update for responsive UI
fn emit_initial_progress(app: &AppHandle) {
    emit_progress(app, ConversionProgress {
        current_chapter: 0,
        total_chapters: 0,
        words_processed: 0,
        total_words: 0,
        words_in_current_chapter: 0,
        current_step: "initializing".to_string(),
        message: "Starting conversion...".to_string(),
    });
}

/// Validate EPUB file size and cache it
fn validate_and_cache_epub(
    app: &AppHandle,
    source_path: &str,
    epub_data: &[u8],
) -> AppResult<()> {
    validate_file_size(epub_data.len(), MAX_EPUB_SIZE, "EPUB")?;
    log::debug!("EPUB file size validated: {} bytes", epub_data.len());
    
    // Store EPUB in cache
    let epub_store = tauri_plugin_store::StoreBuilder::new(app, "epub-cache.store.json")
        .build()
        .map_err(|e| AppError::Store(format!("Failed to create EPUB store: {}", e)))?;
    let key = format!("epub:{}", source_path);
    
    let base64_data = general_purpose::STANDARD.encode(epub_data);
    epub_store.set(&key, serde_json::Value::String(base64_data));
    epub_store.save()
        .map_err(|e| AppError::Store(format!("Failed to save EPUB store: {}", e)))?;
    
    Ok(())
}

/// Extract chapters from EPUB
fn extract_chapters_from_epub(
    app: &AppHandle,
    epub_data: Vec<u8>,
) -> AppResult<Vec<ConversionChapter>> {
    // Emit progress for chapter extraction
    emit_progress(app, ConversionProgress {
        current_chapter: 0,
        total_chapters: 0,
        words_processed: 0,
        total_words: 0,
        words_in_current_chapter: 0,
        current_step: "initializing".to_string(),
        message: "Extracting chapters from EPUB...".to_string(),
    });
    
    let (all_conversion_chapters, stats) = extract_chapters(epub_data)
        .map_err(|e| AppError::EpubParse(e.to_string()).with_context("Failed to extract chapters"))?;
    
    let (manifest_count, spine_itemref_count, missing_manifest_count, non_html_count, filtered_count) = stats;
    
    if all_conversion_chapters.is_empty() {
        return Err(AppError::EpubParse(format!(
            "No chapters found in EPUB. Manifest had {} items, spine had {} itemrefs ({} missing from manifest, {} non-HTML, {} filtered), but no valid chapters were extracted.",
            manifest_count, spine_itemref_count, missing_manifest_count, non_html_count, filtered_count
        )));
    }
    
    Ok(all_conversion_chapters)
}

/// Book data structure for conversion preparation
struct BookData {
    completed_chapters_set: std::collections::HashSet<String>,
    existing_book: Option<Book>,
    total_words_all_chapters: usize,
    words_processed_from_completed: usize,
    conversion_chapters: Vec<ConversionChapter>,
    total_chapters: usize,
    voice_id: String,
}

/// Load existing book and prepare conversion data
async fn load_and_prepare_book(
    app: &AppHandle,
    source_path: &str,
    voice_id: &str,
    all_conversion_chapters: &[ConversionChapter],
) -> AppResult<BookData> {
    let mut books = load_all_books(app).await
        .map_err(|e| AppError::Store(format!("Failed to load books: {}", e)))?;
    
    let (completed_chapters_set, existing_book_clone) = if let Some(book) = books.iter_mut().find(|b| b.source_path == source_path) {
        // Mark conversion as started and store voice ID
        book.conversion_status = ConversionStatus::Started;
        book.voice_id = Some(voice_id.to_string());
        let completed_set: std::collections::HashSet<String> = book.completed_chapters.iter().cloned().collect();
        let book_clone = book.clone();
        (completed_set, Some(book_clone))
    } else {
        (std::collections::HashSet::new(), None)
    };
    
    // Calculate total words across ALL chapters
    let total_words_all_chapters: usize = all_conversion_chapters.iter().map(|c| c.word_count).sum();
    
    // Filter out completed chapters
    let conversion_chapters: Vec<_> = all_conversion_chapters
        .iter()
        .filter(|chapter| !completed_chapters_set.contains(&chapter.href))
        .cloned()
        .collect();
    
    // Calculate words processed from completed chapters
    let words_processed_from_completed: usize = if let Some(ref existing_book) = existing_book_clone {
        existing_book.words_processed.unwrap_or_else(|| {
            all_conversion_chapters.iter()
                .filter(|c| completed_chapters_set.contains(&c.href))
                .map(|c| c.word_count)
                .sum()
        })
    } else {
        0
    };
    
    // Update book with total words if not already set, and save voice_id
    if let Some(book) = books.iter_mut().find(|b| b.source_path == source_path) {
        if book.total_words.is_none() {
            book.total_words = Some(total_words_all_chapters);
        }
        // Ensure voice_id is set (it should already be set above, but make sure it's saved)
        if book.voice_id.is_none() {
            book.voice_id = Some(voice_id.to_string());
        }
        
        // Save only this specific book to persist voice_id and conversion_status changes
        save_book(app, book).await
            .map_err(|e| AppError::Store(format!("Failed to save book with voice_id: {}", e)))?;
    }
    
    let total_chapters = completed_chapters_set.len() + conversion_chapters.len();
    
    Ok(BookData {
        completed_chapters_set,
        existing_book: existing_book_clone,
        total_words_all_chapters,
        words_processed_from_completed,
        conversion_chapters,
        total_chapters,
        voice_id: voice_id.to_string(),
    })
}

/// Handle case when all chapters are already converted
async fn handle_all_chapters_completed(
    app: &AppHandle,
    source_path: &str,
    total_words_all_chapters: usize,
    existing_book: Option<Book>,
) -> AppResult<Option<Book>> {
    log::info!("All chapters already converted for book at {}", source_path);
    // Mark conversion as done and save word counts if book exists
    if existing_book.is_some() {
        let mut books = load_all_books(app).await
            .map_err(|e| AppError::Store(format!("Failed to load books: {}", e)))?;
        if let Some(book) = books.iter_mut().find(|b| b.source_path == source_path) {
            book.conversion_status = ConversionStatus::Done;
            book.total_words = Some(total_words_all_chapters);
            book.words_processed = Some(total_words_all_chapters);
            save_all_books(app, &books).await
                .map_err(|e| AppError::Store(format!("Failed to save books: {}", e)))?;
        }
    }
    Ok(existing_book)
}

/// Conversion preparation data
struct ConversionPrep {
    cancel_token: Arc<AtomicBool>,
}

/// Prepare conversion with cancellation token and progress updates
async fn prepare_conversion(
    app: &AppHandle,
    source_path: &str,
    book_data: &BookData,
) -> AppResult<ConversionPrep> {
    log::info!("Resuming conversion: {} chapters remaining out of {} total ({} already completed)", 
        book_data.conversion_chapters.len(), 
        book_data.total_chapters,
        book_data.completed_chapters_set.len());
    
    // Calculate total words for remaining chapters
    let total_words_remaining: usize = book_data.conversion_chapters.iter().map(|c| c.word_count).sum();
    
    // Emit progress with restored progress from completed chapters
    emit_progress(app, ConversionProgress {
        current_chapter: book_data.completed_chapters_set.len(),
        total_chapters: book_data.total_chapters,
        words_processed: book_data.words_processed_from_completed,
        total_words: book_data.total_words_all_chapters,
        words_in_current_chapter: 0,
        current_step: "initializing".to_string(),
        message: format!("Resuming: {} chapters remaining ({} words), {} words already processed out of {} total", 
            book_data.conversion_chapters.len(), total_words_remaining, book_data.words_processed_from_completed, book_data.total_words_all_chapters),
    });
    
    // Get cancellation token for this conversion
    let cancel_token = get_cancellation_token(app, source_path)?;
    
    Ok(ConversionPrep { cancel_token })
}

/// Perform the actual EPUB conversion
async fn perform_conversion(
    app: &AppHandle,
    source_path: &str,
    epub_data: Vec<u8>,
    book_data: &BookData,
    conversion_prep: &ConversionPrep,
) -> AppResult<Vec<u8>> {
    use crate::epub::converter::convert_epub_to_audiobook;
    
    let options = ConversionOptions {
        voice_id: book_data.voice_id.clone(),
        chapters: book_data.conversion_chapters.clone(),
    };
    
    // Use the cancellation token from preparation
    let cancel_token = Arc::clone(&conversion_prep.cancel_token);
    
    // Perform conversion
    log::info!("Starting EPUB to audiobook conversion with {} chapters", book_data.conversion_chapters.len());
    let converted_epub_result = convert_epub_to_audiobook(
        epub_data, 
        options, 
        app.clone(), 
        Some(source_path.to_string()),
        Some(Arc::clone(&cancel_token)),
        Some(book_data.words_processed_from_completed),
        Some(book_data.total_words_all_chapters),
        Some(book_data.completed_chapters_set.len()),
        Some(book_data.total_chapters),
    ).await;
    
    // Clean up cancellation token
    cleanup_cancellation_token(app, source_path);
    
    // Check if conversion was cancelled
    if cancel_token.load(Ordering::Relaxed) {
        handle_conversion_cancellation(app, source_path).await?;
        return Err(AppError::EpubParse("Conversion cancelled by user".to_string()));
    }
    
    let converted_epub = converted_epub_result.map_err(|e| {
        log::error!("Conversion failed: {}", e);
        AppError::EpubParse(e.to_string()).with_context("Conversion failed")
    })?;
    
    log::info!("EPUB conversion completed successfully");
    Ok(converted_epub)
}

/// Handle conversion cancellation
async fn handle_conversion_cancellation(
    app: &AppHandle,
    source_path: &str,
) -> AppResult<()> {
    log::info!("Conversion was cancelled for: {}", source_path);
    
    // Set conversion status to "started" when cancelling
    if let Ok(mut books) = load_all_books(app).await {
        if let Some(book) = books.iter_mut().find(|b| b.source_path == source_path) {
            book.conversion_status = ConversionStatus::Started;
            if let Err(e) = save_all_books(app, &books).await {
                log::warn!("Failed to set conversion status to started on cancellation: {}", e);
            } else {
                log::debug!("Set conversion status to started for cancelled conversion");
            }
        }
    }
    
    // Emit conversion-cancelled event to frontend
    use crate::epub::converter::ConversionCancelledEvent;
    let event = ConversionCancelledEvent {
        source_path: source_path.to_string(),
    };
    if let Err(e) = app.emit("conversion-cancelled", event) {
        log::warn!("Failed to emit conversion-cancelled event: {}", e);
    } else {
        log::debug!("Emitted conversion-cancelled event for: {}", source_path);
    }
    
    Ok(())
}

/// Save converted EPUB and update book in library
async fn save_converted_epub_and_update_book(
    app: &AppHandle,
    source_path: &str,
    converted_epub: &[u8],
    total_words_all_chapters: usize,
) -> AppResult<Option<Book>> {
    // Store converted EPUB
    let epub_store = tauri_plugin_store::StoreBuilder::new(app, "epub-cache.store.json")
        .build()
        .map_err(|e| AppError::Store(format!("Failed to create EPUB store: {}", e)))?;
    let key = format!("epub:{}", source_path);
    
    let converted_base64 = general_purpose::STANDARD.encode(converted_epub);
    epub_store.set(&key, serde_json::Value::String(converted_base64));
    epub_store.save()
        .map_err(|e| AppError::Store(format!("Failed to save converted EPUB: {}", e)))?;
    
    // Save final words_processed now that conversion is complete
    if let Ok(mut books) = load_all_books(app).await {
        if let Some(book) = books.iter_mut().find(|b| b.source_path == source_path) {
            if book.total_words.is_none() {
                book.total_words = Some(total_words_all_chapters);
            }
            book.words_processed = Some(total_words_all_chapters);
            if let Err(e) = save_all_books(app, &books).await {
                log::warn!("Failed to save final words_processed: {}", e);
            } else {
                log::debug!("Saved final words_processed: {} / {}", total_words_all_chapters, total_words_all_chapters);
            }
        }
    }
    
    // Extract audio tracks from converted EPUB and update book in library
    let updated_book = update_book_audio_tracks(converted_epub, source_path, app).await
        .map_err(|e| AppError::Store(format!("Failed to update book audio tracks: {}", e)))?;
    
    Ok(updated_book)
}

