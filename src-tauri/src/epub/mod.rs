pub mod parser;
pub mod converter;

// Re-export specific items to avoid ambiguous glob re-exports
pub use parser::{
    EpubMetadata, ManifestItem,
    find_opf_path, derive_base_path_from_opf,
    extract_metadata_with_epub_crate, parse_opf_content,
    parse_ncx_titles,
    find_cover_image, extract_cover_image_as_data_url,
    extract_audio_tracks_from_manifest, compute_audio_track_durations,
    extract_chapters_from_epub,
    extract_year, derive_title_from_path, generate_audio_track_title,
};
pub use converter::{
    ConversionOptions, ConversionChapter, ConversionProgress,
    convert_epub_to_audiobook,
};

use tauri::{AppHandle, Manager};
use crate::utils::errors::{AppError, AppResult};
use crate::utils::constants::MAX_EPUB_SIZE;
use crate::utils::path_validation::validate_file_size;
use crate::book_service::models::Book;
use std::sync::{Arc, Mutex};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};

/// Global cancellation token storage for conversions
/// Maps source_path to cancellation token
#[derive(Default)]
pub struct CancellationTokens {
    tokens: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
}

impl CancellationTokens {
    pub fn new() -> Self {
        Self {
            tokens: Arc::new(Mutex::new(HashMap::new())),
        }
    }
    
    pub fn get(&self) -> Arc<Mutex<HashMap<String, Arc<AtomicBool>>>> {
        Arc::clone(&self.tokens)
    }
}

/// Tauri command to cancel an ongoing conversion
#[tauri::command]
pub async fn cancel_conversion_command(
    source_path: String,
    app: AppHandle,
) -> AppResult<()> {
    let tokens = app.state::<CancellationTokens>();
    let tokens_map = tokens.inner().get();
    {
        let tokens_guard = tokens_map.lock().map_err(|e| {
            AppError::Store(format!("Failed to lock cancellation tokens: {}", e))
        })?;
        
        if let Some(cancel_token) = tokens_guard.get(&source_path) {
            cancel_token.store(true, Ordering::Relaxed);
            log::info!("Cancellation requested for conversion: {}", source_path);
        } else {
            log::warn!("No active conversion found for: {}", source_path);
        }
    }
    
    Ok(())
}

/// Get or create a cancellation token for a conversion
fn get_cancellation_token(
    app: &AppHandle,
    source_path: &str,
) -> AppResult<Arc<AtomicBool>> {
    let tokens = app.state::<CancellationTokens>();
    let tokens_map = tokens.inner().get();
    let cancel_token = {
        let mut tokens_guard = tokens_map.lock().map_err(|e| {
            AppError::Store(format!("Failed to lock cancellation tokens: {}", e))
        })?;
        
        // Remove any existing token (cleanup from previous conversion)
        tokens_guard.remove(source_path);
        
        // Create new cancellation token
        Arc::new(AtomicBool::new(false))
    };
    
    // Insert the token (need to lock again)
    {
        let mut tokens_guard = tokens_map.lock().map_err(|e| {
            AppError::Store(format!("Failed to lock cancellation tokens: {}", e))
        })?;
        tokens_guard.insert(source_path.to_string(), Arc::clone(&cancel_token));
    }
    
    Ok(cancel_token)
}

/// Clean up cancellation token after conversion completes
fn cleanup_cancellation_token(app: &AppHandle, source_path: &str) {
    // Extract the owned Arc first - it lives independently of the state reference
    let tokens_map_opt = {
        if let Some(tokens_state) = app.try_state::<CancellationTokens>() {
            let cancellation_tokens = tokens_state.inner();
            let arc: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>> = cancellation_tokens.get();
            Some(arc)
        } else {
            None
        }
    };
    
    if let Some(arc) = tokens_map_opt {
        // Lock and remove - the guard will be dropped at the end of the match
        match arc.lock() {
            Ok(mut tokens_guard) => {
                tokens_guard.remove(source_path);
                log::debug!("Cleaned up cancellation token for: {}", source_path);
            }
            Err(_) => {
                log::warn!("Failed to lock cancellation tokens for cleanup");
            }
        }
    }
}

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
) -> AppResult<Option<Book>> {
    use base64::{engine::general_purpose, Engine as _};
    use crate::epub::converter::{ConversionProgress, emit_progress};
    
    log::info!("convert_epub_to_audiobook_command called: source_path={}, voice_id={}, epub_data_len={}", 
        source_path, voice_id, epub_data.len());
    
    // Emit immediate progress update for responsive UI
    emit_progress(&app, ConversionProgress {
        current_chapter: 0,
        total_chapters: 0,
        words_processed: 0,
        total_words: 0,
        words_in_current_chapter: 0,
        current_step: "initializing".to_string(),
        message: "Starting conversion...".to_string(),
    });
    
    // Validate EPUB file size before processing
    validate_file_size(epub_data.len(), MAX_EPUB_SIZE, "EPUB")?;
    log::debug!("EPUB file size validated: {} bytes", epub_data.len());
    
    // Store EPUB in cache
    let epub_store = tauri_plugin_store::StoreBuilder::new(&app, "epub-cache.store.json")
        .build()
        .map_err(|e| AppError::Store(format!("Failed to create EPUB store: {}", e)))?;
    let key = format!("epub:{}", source_path);
    
    let base64_data = general_purpose::STANDARD.encode(&epub_data);
    epub_store.set(&key, serde_json::Value::String(base64_data));
    epub_store.save()
        .map_err(|e| AppError::Store(format!("Failed to save EPUB store: {}", e)))?;
    
    // Emit progress for chapter extraction
    emit_progress(&app, ConversionProgress {
        current_chapter: 0,
        total_chapters: 0,
        words_processed: 0,
        total_words: 0,
        words_in_current_chapter: 0,
        current_step: "initializing".to_string(),
        message: "Extracting chapters from EPUB...".to_string(),
    });
    
    // Extract chapters with content loaded from EPUB
    use crate::epub::converter::extract_chapters;
    let (all_conversion_chapters, stats) = extract_chapters(epub_data.clone())
        .map_err(|e| AppError::EpubParse(e.to_string()).with_context("Failed to extract chapters"))?;
    
    let (manifest_count, spine_itemref_count, missing_manifest_count, non_html_count, filtered_count) = stats;
    
    if all_conversion_chapters.is_empty() {
        return Err(AppError::EpubParse(format!(
            "No chapters found in EPUB. Manifest had {} items, spine had {} itemrefs ({} missing from manifest, {} non-HTML, {} filtered), but no valid chapters were extracted.",
            manifest_count, spine_itemref_count, missing_manifest_count, non_html_count, filtered_count
        )));
    }
    
    // Load existing book to check for completed chapters
    use crate::book_service::storage::{load_all_books, save_all_books};
    let mut books = load_all_books(&app).await
        .map_err(|e| AppError::Store(format!("Failed to load books: {}", e)))?;
    
    let (completed_chapters_set, existing_book_clone) = if let Some(book) = books.iter_mut().find(|b| b.source_path == source_path) {
        // Mark conversion as started and store voice ID
        book.conversion_started = true;
        book.voice_id = Some(voice_id.clone());
        let completed_set: std::collections::HashSet<String> = book.completed_chapters.iter().cloned().collect();
        let book_clone = book.clone();
        (completed_set, Some(book_clone))
    } else {
        (std::collections::HashSet::new(), None)
    };
    
    // Filter out completed chapters
    let conversion_chapters: Vec<_> = all_conversion_chapters
        .into_iter()
        .filter(|chapter| !completed_chapters_set.contains(&chapter.href))
        .collect();
    
    if conversion_chapters.is_empty() {
        log::info!("All chapters already converted for book at {}", source_path);
        // Save the conversion_started flag if book exists
        if existing_book_clone.is_some() {
            save_all_books(&app, &books).await
                .map_err(|e| AppError::Store(format!("Failed to save books: {}", e)))?;
        }
        return Ok(existing_book_clone);
    }
    
    let total_chapters = completed_chapters_set.len() + conversion_chapters.len();
    log::info!("Resuming conversion: {} chapters remaining out of {} total ({} already completed)", 
        conversion_chapters.len(), 
        total_chapters,
        completed_chapters_set.len());
    
    // Save the conversion_started flag if book exists
    if existing_book_clone.is_some() {
        save_all_books(&app, &books).await
            .map_err(|e| AppError::Store(format!("Failed to save books: {}", e)))?;
    }
    
    let options = ConversionOptions {
        voice_id,
        chapters: conversion_chapters.clone(),
    };
    
    // Calculate total words for progress tracking
    let total_words: usize = conversion_chapters.iter().map(|c| c.word_count).sum();
    
    // Emit progress with chapter count before starting conversion
    emit_progress(&app, ConversionProgress {
        current_chapter: 0,
        total_chapters: conversion_chapters.len(),
        words_processed: 0,
        total_words,
        words_in_current_chapter: 0,
        current_step: "initializing".to_string(),
        message: format!("Found {} chapters ({} words total). Preparing conversion...", conversion_chapters.len(), total_words),
    });
    
    // Get cancellation token for this conversion
    let cancel_token = get_cancellation_token(&app, &source_path)?;
    
    // Perform conversion (with source_path for incremental saving)
    log::info!("Starting EPUB to audiobook conversion with {} chapters", conversion_chapters.len());
    let converted_epub_result = convert_epub_to_audiobook(
        epub_data, 
        options, 
        app.clone(), 
        Some(source_path.clone()),
        Some(Arc::clone(&cancel_token)),
    ).await;
    
    // Clean up cancellation token
    cleanup_cancellation_token(&app, &source_path);
    
    // Check if conversion was cancelled
    if cancel_token.load(Ordering::Relaxed) {
        log::info!("Conversion was cancelled for: {}", source_path);
        return Err(AppError::EpubParse("Conversion cancelled by user".to_string()));
    }
    
    let converted_epub = converted_epub_result.map_err(|e| {
        log::error!("Conversion failed: {}", e);
        AppError::EpubParse(e.to_string()).with_context("Conversion failed")
    })?;
    log::info!("EPUB conversion completed successfully");
    
    // Store converted EPUB
    let converted_base64 = general_purpose::STANDARD.encode(&converted_epub);
    epub_store.set(&key, serde_json::Value::String(converted_base64));
    epub_store.save()
        .map_err(|e| AppError::Store(format!("Failed to save converted EPUB: {}", e)))?;
    
    // Extract audio tracks from converted EPUB and update book in library
    let updated_book = update_book_audio_tracks(&converted_epub, &source_path, &app).await
        .map_err(|e| AppError::Store(format!("Failed to update book audio tracks: {}", e)))?;
    
    Ok(updated_book)
}

/// Update book audio tracks and audio sync map after conversion
/// 
/// This function parses the converted EPUB to extract audio tracks from the manifest
/// and builds the audio sync map from SMIL files, then updates the corresponding book
/// in the library store.
/// 
/// Returns the updated Book if found, or None if the book wasn't in the library.
pub(crate) async fn update_book_audio_tracks(
    converted_epub: &[u8],
    source_path: &str,
    app: &AppHandle,
) -> Result<Option<Book>, String> {
    use crate::book_service::storage::{load_all_books, save_all_books};
    use crate::epub::parser::{find_opf_path, parse_opf_content, extract_audio_tracks_from_manifest, extract_chapters_from_epub};
    use crate::epub::converter::smil::build_audio_sync_map;
    use std::io::{Cursor, Read};
    use zip::ZipArchive;
    
    // Parse the converted EPUB to extract audio tracks
    let mut archive = ZipArchive::new(Cursor::new(converted_epub))
        .map_err(|e| format!("Failed to open converted EPUB: {}", e))?;
    
    let opf_path = find_opf_path(&mut archive)
        .map_err(|e| format!("Failed to find OPF path: {}", e))?;
    
    let opf_content = {
        let mut opf_file = archive.by_name(&opf_path)
            .map_err(|e| format!("Failed to find OPF at path '{}': {}", opf_path, e))?;
        let mut content = String::new();
        opf_file.read_to_string(&mut content)
            .map_err(|e| format!("Failed to read OPF: {}", e))?;
        content
    };
    
    let (_metadata, manifest_items, _spine_items) = parse_opf_content(&opf_content)
        .map_err(|e| format!("Failed to parse OPF content: {}", e))?;
    
    log::debug!("Parsed manifest with {} items", manifest_items.len());
    for (id, item) in &manifest_items {
        if let Some(ref mt) = item.media_type {
            if mt.starts_with("audio/") || mt == "application/smil+xml" {
                log::debug!("Found {} item: id={}, href={}, media-type={}", 
                    if mt.starts_with("audio/") { "audio" } else { "SMIL" },
                    id, item.href, mt);
            }
        }
    }
    
    let audio_tracks = extract_audio_tracks_from_manifest(&manifest_items);
    log::info!("Extracted {} audio tracks from manifest", audio_tracks.len());
    
    // Extract chapters from converted EPUB for building audio sync map
    let (chapters, _) = extract_chapters_from_epub(converted_epub)
        .map_err(|e| format!("Failed to extract chapters from converted EPUB: {}", e))?;
    
    log::debug!("Extracted {} chapters for SMIL parsing", chapters.len());
    for chapter in &chapters {
        log::debug!("Chapter href: {}", chapter.href);
    }
    
    // Build audio sync map from SMIL files
    let mut archive_for_smil = ZipArchive::new(Cursor::new(converted_epub))
        .map_err(|e| format!("Failed to open converted EPUB for SMIL parsing: {}", e))?;
    
    // List all files in the EPUB for debugging
    log::debug!("EPUB contains {} files", archive_for_smil.len());
    for i in 0..archive_for_smil.len() {
        if let Ok(file) = archive_for_smil.by_index(i) {
            let name = file.name();
            if name.ends_with(".smil") || name.ends_with(".mp3") {
                log::debug!("Found file in EPUB: {}", name);
            }
        }
    }
    
    let audio_sync_map = build_audio_sync_map(&mut archive_for_smil, &chapters)
        .map_err(|e| format!("Failed to build audio sync map: {}", e))?;
    
    if let Some(ref sync_map) = audio_sync_map {
        log::info!("Built audio sync map with {} segments", sync_map.segments.len());
    } else {
        log::warn!("No audio sync map built - no SMIL files found or no segments parsed");
    }
    
    // Update book in library
    let mut books = load_all_books(app).await
        .map_err(|e| format!("Failed to load books: {}", e))?;
    
    if let Some(book) = books.iter_mut().find(|b| b.source_path == source_path) {
        book.audio_tracks = audio_tracks;
        book.audio_sync_map = audio_sync_map;
        log::info!("Updated audio tracks for book '{}' ({} tracks) and audio sync map", book.title, book.audio_tracks.len());
        
        // Clone the updated book before saving
        let updated_book = book.clone();
        
        save_all_books(app, &books).await
            .map_err(|e| format!("Failed to save books: {}", e))?;
        
        Ok(Some(updated_book))
    } else {
        log::warn!("Book with source_path '{}' not found in library, skipping audio track update", source_path);
        // Don't return error - book might not be in library yet
        Ok(None)
    }
}
