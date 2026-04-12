//! EPUB to audiobook conversion command
//!
//! This module provides the main Tauri command for converting EPUB files
//! to audiobooks, broken down into smaller, focused functions.

use crate::book_service::database::get_db_connection;
use crate::book_service::models::{Book, ConversionStatus};
use crate::book_service::repositories::{BookRepository, EpubRepository};
use crate::epub::book_update::update_book_audio_tracks;
use crate::epub::cancellation::{cleanup_cancellation_token, get_cancellation_token};
use crate::epub::converter::{
    emit_progress, ConversionChapter, ConversionOptions, ConversionProgress,
};
use crate::tts::engine::TtsEnginePool;
use crate::utils::constants::MAX_EPUB_SIZE;
use crate::utils::errors::{AppError, AppResult};
use crate::utils::path_validation::validate_file_size;
use std::fs;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

/// Tauri command wrapper for EPUB to audiobook conversion.
///
/// This is the main entry point for converting EPUB files to audiobooks
/// from the frontend. It handles EPUB loading, chapter extraction, and
/// the full conversion process.
///
/// The function:
/// 1. Loads the book from the database using book_id
/// 2. Loads the EPUB file from the file system using source_path
/// 3. Extracts chapters from the EPUB
/// 4. Converts chapters to audiobook format with TTS
/// 5. Stores the converted EPUB back in the store
///
/// # Arguments
/// * `book_id` - The book ID to load from the database
/// * `voice_id` - Voice identifier for TTS (e.g., "af_heart", "af_bella")
/// * `app` - Tauri application handle
///
/// # Returns
/// `Ok(Some(Book))` with the updated book if conversion succeeds and book is found in library.
/// `Ok(None)` if conversion succeeds but book is not in library.
///
/// # Errors
/// Returns an error if:
/// - Book not found in database
/// - EPUB file cannot be loaded from file system
/// - EPUB store creation fails
/// - Chapter extraction fails
/// - No chapters are found
/// - Conversion fails
#[tauri::command]
pub async fn convert_epub_to_audiobook_command(
    book_id: String,
    voice_id: String,
    app: AppHandle,
) -> AppResult<Option<Book>> {
    log::info!(
        "convert_epub_to_audiobook_command called: book_id={}, voice_id={}",
        book_id,
        voice_id
    );
    crate::logging::log(
        "info",
        &format!(
            "Conversion started: book_id={}, voice_id={}",
            book_id, voice_id
        ),
        None,
    );

    // Emit initial progress
    emit_initial_progress(&app);

    // Load book from database to get source_path
    let db = get_db_connection(&app).await.map_err(|e| {
        let err_msg = format!("Failed to connect to database: {}", e);
        crate::logging::log("error", &err_msg, None);
        AppError::Store(err_msg)
    })?;
    let book = BookRepository::find_by_id(db.as_ref(), &book_id)
        .await
        .map_err(|e| {
            let err_msg = format!("Failed to load book: {}", e);
            crate::logging::log("error", &err_msg, None);
            AppError::Store(err_msg)
        })?
        .ok_or_else(|| {
            let err_msg = format!("Book not found: {}", book_id);
            crate::logging::log("error", &err_msg, None);
            AppError::Store(err_msg)
        })?;

    let source_path = book.source_path.clone();
    log::info!(
        "Loaded book from database: id={}, source_path={}",
        book_id,
        source_path
    );
    crate::logging::log(
        "info",
        &format!(
            "Loaded book from database: id={}, source_path={}",
            book_id, source_path
        ),
        None,
    );

    // Load EPUB from database first, fallback to file system
    let epub_data = load_epub_with_fallback(&app, &source_path).await?;
    log::info!("Loaded EPUB: {} bytes", epub_data.len());

    // Validate EPUB
    validate_and_cache_epub(&app, &source_path, &epub_data)?;

    // Load chapter metadata from DB and chapter HTML from EPUB archive (lazy, EPUB-backed).
    let all_conversion_chapters = load_chapters_from_database(&app, &book_id, &epub_data).await?;

    // Load and prepare book data
    let book_data =
        load_and_prepare_book(&app, &source_path, &voice_id, &all_conversion_chapters).await?;

    // Check if all chapters are already converted
    if book_data.conversion_chapters.is_empty() {
        return handle_all_chapters_completed(
            &app,
            &source_path,
            book_data.total_words_all_chapters,
            book_data.existing_book,
        )
        .await;
    }

    // If resuming (has completed chapters), try to load the converted EPUB from database
    // This ensures we have existing audio tracks in the OPF
    let epub_data_for_conversion = if !book_data.completed_chapters_set.is_empty() {
        log::info!("Resuming conversion - attempting to load converted EPUB from database");

        if let Ok(Some(loaded_epub)) =
            EpubRepository::find_by_source_path(db.as_ref(), &source_path).await
        {
            log::info!(
                "Successfully loaded partial EPUB from database ({} bytes, {} chapters completed)",
                loaded_epub.len(),
                book_data.completed_chapters_set.len()
            );
            loaded_epub
        } else {
            log::warn!("No partial EPUB found in database, using original EPUB - existing audio tracks may be missing");
            epub_data
        }
    } else {
        log::info!("Starting new conversion - using original EPUB");
        epub_data
    };

    // Prepare conversion
    let conversion_prep = prepare_conversion(&app, &book_id, &book_data).await?;

    // Perform conversion
    // Note: epub_structure is cached at this level but not passed down since
    // initialize_conversion_context parses it once anyway. The main optimization
    // is loading EPUB and chapters from database instead of file system.
    let converted_epub = perform_conversion(
        &app,
        &book_id,
        &source_path,
        epub_data_for_conversion,
        &book_data,
        &conversion_prep,
    )
    .await?;

    // Save converted EPUB and update book
    save_converted_epub_and_update_book(
        &app,
        &source_path,
        &converted_epub,
        book_data.total_words_all_chapters,
    )
    .await
}

/// Load EPUB from database first, fallback to file system
async fn load_epub_with_fallback(app: &AppHandle, source_path: &str) -> AppResult<Vec<u8>> {
    let db = get_db_connection(app)
        .await
        .map_err(|e| AppError::Store(format!("Failed to connect to database: {}", e)))?;

    // Try to load from database first
    if let Ok(Some(epub_data)) = EpubRepository::find_by_source_path(db.as_ref(), source_path).await
    {
        log::info!("Loaded EPUB from database: {} bytes", epub_data.len());

        // Validate EPUB file size
        validate_file_size(epub_data.len(), MAX_EPUB_SIZE, "EPUB")?;

        // Validate EPUB signature (should start with PK for ZIP)
        if epub_data.len() >= 4 && &epub_data[0..4] == b"PK\x03\x04" {
            return Ok(epub_data);
        } else {
            log::warn!("EPUB from database has invalid signature, falling back to file system");
        }
    } else {
        log::info!("EPUB not found in database, loading from file system");
    }

    // Fallback to file system
    load_epub_from_file_system(source_path)
}

/// Load EPUB file from file system using source_path
fn load_epub_from_file_system(source_path: &str) -> AppResult<Vec<u8>> {
    // Handle web:// prefix (not supported)
    if source_path.starts_with("web://") {
        return Err(AppError::EpubParse(format!(
            "Cannot load EPUB from web source: {}",
            source_path
        )));
    }

    // Normalize path (remove file:// prefix and decode URL-encoded characters)
    // This is important on iOS where file picker returns URL-encoded paths
    use crate::utils::path_resolver::ResourcePathResolver;
    let actual_path = ResourcePathResolver::normalize_file_path(source_path);

    log::info!("Loading EPUB from file system: {}", actual_path);
    let epub_data = fs::read(&actual_path).map_err(|e| {
        AppError::Io(e).with_context(format!(
            "Failed to read EPUB file from path '{}'",
            actual_path
        ))
    })?;

    // Validate EPUB file size
    validate_file_size(epub_data.len(), MAX_EPUB_SIZE, "EPUB")?;

    // Validate EPUB signature (should start with PK for ZIP)
    if epub_data.len() < 4 || &epub_data[0..4] != b"PK\x03\x04" {
        return Err(AppError::EpubParse(
            "Invalid EPUB file: not a valid ZIP archive".to_string(),
        ));
    }

    Ok(epub_data)
}

// EPUB structure caching disabled - structure is parsed on-demand when needed

/// Load chapters from database and convert to ConversionChapter format
async fn load_chapters_from_database(
    app: &AppHandle,
    book_id: &str,
    epub_data: &[u8],
) -> AppResult<Vec<ConversionChapter>> {
    use crate::book_service::repositories::ChapterRepository;
    use crate::epub::converter::ConversionChapter;
    use crate::epub::parser::{derive_base_path_from_opf, find_opf_path};
    use crate::utils::path_validation::validate_epub_path;
    use crate::utils::text::count_words_in_html;
    use std::collections::HashMap;
    use std::io::{Cursor, Read};
    use zip::ZipArchive;

    let db = get_db_connection(app)
        .await
        .map_err(|e| AppError::Store(format!("Failed to connect to database: {}", e)))?;

    // Emit progress for chapter loading
    emit_progress(
        app,
        ConversionProgress {
            current_chapter: 0,
            total_chapters: 0,
            words_processed: 0,
            total_words: 0,
            words_in_current_chapter: 0,
            current_step: "initializing".to_string(),
            message: "Loading chapters from database...".to_string(),
        },
    );

    // Load chapter metadata only from DB.
    let db_chapters = ChapterRepository::find_by_book_id(db.as_ref(), book_id)
        .await
        .map_err(|e| AppError::Store(format!("Failed to load chapters from database: {}", e)))?;

    if db_chapters.is_empty() {
        return Err(AppError::EpubParse(
            "No chapters found in database".to_string(),
        ));
    }

    // Build an in-memory file cache once from EPUB for fast chapter content resolution.
    let mut archive = ZipArchive::new(Cursor::new(epub_data))
        .map_err(|e| AppError::EpubParse(format!("Failed to open EPUB archive: {}", e)))?;
    let mut opf_archive = ZipArchive::new(Cursor::new(epub_data))
        .map_err(|e| AppError::EpubParse(format!("Failed to open EPUB archive for OPF: {}", e)))?;
    let opf_path = find_opf_path(&mut opf_archive)
        .map_err(|e| AppError::EpubParse(format!("Failed to find OPF path: {}", e)))?;
    let base_path = derive_base_path_from_opf(&opf_path);

    let mut file_cache: HashMap<String, String> = HashMap::new();
    for i in 0..archive.len() {
        let mut file = match archive.by_index(i) {
            Ok(f) => f,
            Err(_) => continue,
        };
        let name = file.name().to_string();
        if !(name.ends_with(".xhtml") || name.ends_with(".html") || name.ends_with(".htm")) {
            continue;
        }
        let mut content = String::new();
        if file.read_to_string(&mut content).is_ok() {
            file_cache.insert(name, content);
        }
    }

    // Convert chapter metadata + EPUB content to ConversionChapter format.
    let mut conversion_chapters = Vec::new();
    let mut chapters_without_content = 0;
    for chapter in db_chapters {
        let validated_href = validate_epub_path(&chapter.href)
            .map_err(|e| AppError::EpubParse(format!("Invalid chapter href '{}': {}", chapter.href, e)))?;

        let chapter_path = if validated_href.starts_with('/') {
            validated_href[1..].to_string()
        } else if !base_path.is_empty() && validated_href.starts_with(&base_path) {
            validated_href.clone()
        } else {
            format!("{}{}", base_path, validated_href)
        };

        let mut content_html = file_cache.get(&chapter_path).cloned();
        if content_html.is_none() {
            content_html = file_cache.get(&validated_href).cloned();
        }
        if content_html.is_none() {
            let href_no_slash = validated_href.trim_start_matches('/');
            content_html = file_cache.get(href_no_slash).cloned();
        }
        if content_html.is_none() && !base_path.is_empty() {
            let href_with_base = format!("{}{}", base_path, validated_href.trim_start_matches('/'));
            content_html = file_cache.get(&href_with_base).cloned();
        }

        let content_html = content_html.unwrap_or_else(|| {
            chapters_without_content += 1;
            log::warn!(
                "Chapter '{}' (href: '{}') content not found in EPUB",
                chapter.title,
                chapter.href
            );
            String::new()
        });

        if !content_html.is_empty() {
            log::debug!(
                "Loaded chapter '{}' with {} bytes of content",
                chapter.title,
                content_html.len()
            );
        }

        // Calculate word count if not already set, or use existing
        let word_count = chapter
            .word_count
            .unwrap_or_else(|| count_words_in_html(&content_html));

        conversion_chapters.push(ConversionChapter {
            id: chapter.id,
            title: chapter.title,
            href: chapter.href,
            content_html,
            word_count,
        });
    }

    if chapters_without_content > 0 {
        log::warn!(
            "Loaded {} chapters for conversion, but {} chapters have no resolved content from EPUB",
            conversion_chapters.len(),
            chapters_without_content
        );
    } else {
        log::info!(
            "Loaded {} chapters from EPUB with content",
            conversion_chapters.len()
        );
    }

    Ok(conversion_chapters)
}

/// Emit initial progress update for responsive UI
fn emit_initial_progress(app: &AppHandle) {
    emit_progress(
        app,
        ConversionProgress {
            current_chapter: 0,
            total_chapters: 0,
            words_processed: 0,
            total_words: 0,
            words_in_current_chapter: 0,
            current_step: "initializing".to_string(),
            message: "Starting conversion...".to_string(),
        },
    );
}

/// Validate EPUB file size (no longer caching - EPUB is loaded from file system when needed)
fn validate_and_cache_epub(
    _app: &AppHandle,
    _source_path: &str,
    epub_data: &[u8],
) -> AppResult<()> {
    validate_file_size(epub_data.len(), MAX_EPUB_SIZE, "EPUB")?;
    log::debug!("EPUB file size validated: {} bytes", epub_data.len());
    // EPUB is no longer cached here - it's saved to database during conversion
    Ok(())
}

// Note: extract_chapters_from_epub is no longer used - we load chapters from database instead
// Keeping it commented out for reference, but it's replaced by load_chapters_from_database

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
    let db = get_db_connection(app)
        .await
        .map_err(|e| AppError::Store(format!("Failed to connect to database: {}", e)))?;
    let mut books = BookRepository::find_all(db.as_ref())
        .await
        .map_err(|e| AppError::Store(format!("Failed to load books: {}", e)))?;

    let (completed_chapters_set, existing_book_clone) =
        if let Some(book) = books.iter_mut().find(|b| b.source_path == source_path) {
            // Mark conversion as started and store voice ID
            book.conversion_status = ConversionStatus::Started;
            book.voice_id = Some(voice_id.to_string());
            let completed_set: std::collections::HashSet<String> =
                book.completed_chapters.iter().cloned().collect();
            let book_clone = book.clone();
            (completed_set, Some(book_clone))
        } else {
            (std::collections::HashSet::new(), None)
        };

    // Calculate total words across ALL chapters
    let total_words_all_chapters: usize =
        all_conversion_chapters.iter().map(|c| c.word_count).sum();

    // Filter out completed chapters and chapters without text content
    // Chapters without text content (word_count == 0) are skipped during conversion
    // so we exclude them from the conversion_chapters list
    let conversion_chapters: Vec<_> = all_conversion_chapters
        .iter()
        .filter(|chapter| {
            // Only include chapters that haven't been completed AND have text content
            !completed_chapters_set.contains(&chapter.href) && chapter.word_count > 0
        })
        .cloned()
        .collect();

    // Calculate words processed from completed chapters
    let words_processed_from_completed: usize = if let Some(ref existing_book) = existing_book_clone
    {
        existing_book.words_processed.unwrap_or_else(|| {
            all_conversion_chapters
                .iter()
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
        BookRepository::save(db.as_ref(), book)
            .await
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
    log::info!(
        "All chapters with text content already converted for book at {}",
        source_path
    );
    // Mark conversion as done and save word counts if book exists
    if existing_book.is_some() {
        use crate::book_service::database::get_db_connection;
        use crate::book_service::repositories::BookRepository;
        let db = get_db_connection(app)
            .await
            .map_err(|e| AppError::Store(format!("Failed to connect to database: {}", e)))?;
        if let Ok(Some(mut book)) =
            BookRepository::find_by_source_path(db.as_ref(), source_path).await
        {
            // Verify that all chapters with text content are completed
            let chapters_with_text: usize = book
                .chapters
                .iter()
                .filter(|ch| ch.word_count.map(|wc| wc > 0).unwrap_or(false))
                .count();

            if book.completed_chapters.len() >= chapters_with_text {
                book.conversion_status = ConversionStatus::Done;
                log::info!("All chapters with text content completed ({} of {} total chapters), marking conversion as done", 
                    book.completed_chapters.len(), book.chapters.len());
            } else {
                log::warn!("Expected all chapters to be completed, but only {}/{} chapters with text are completed", 
                    book.completed_chapters.len(), chapters_with_text);
            }

            book.total_words = Some(total_words_all_chapters);
            book.words_processed = Some(total_words_all_chapters);
            BookRepository::save(db.as_ref(), &book)
                .await
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
    book_id: &str,
    book_data: &BookData,
) -> AppResult<ConversionPrep> {
    log::info!(
        "Resuming conversion: {} chapters remaining out of {} total ({} already completed)",
        book_data.conversion_chapters.len(),
        book_data.total_chapters,
        book_data.completed_chapters_set.len()
    );

    // Calculate total words for remaining chapters
    let total_words_remaining: usize = book_data
        .conversion_chapters
        .iter()
        .map(|c| c.word_count)
        .sum();

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
    let cancel_token = get_cancellation_token(app, book_id)?;

    Ok(ConversionPrep { cancel_token })
}

/// Perform the actual EPUB conversion
async fn perform_conversion(
    app: &AppHandle,
    book_id: &str,
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
    log::info!(
        "Starting EPUB to audiobook conversion with {} chapters",
        book_data.conversion_chapters.len()
    );
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
    )
    .await;

    // Clean up cancellation token
    cleanup_cancellation_token(app, book_id);

    if let Err(e) = TtsEnginePool::clear_global() {
        log::warn!("Failed to clear global TTS engine pool after conversion: {}", e);
    }

    // Check if conversion was cancelled
    if cancel_token.load(Ordering::Relaxed) {
        handle_conversion_cancellation(app, book_id, source_path).await?;
        return Err(AppError::EpubParse(
            "Conversion cancelled by user".to_string(),
        ));
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
    book_id: &str,
    source_path: &str,
) -> AppResult<()> {
    log::info!(
        "Conversion was cancelled for book_id: {}, source_path: {}",
        book_id,
        source_path
    );

    // Set conversion status to "started" when cancelling
    if let Ok(db) = get_db_connection(app).await {
        if let Ok(mut books) = BookRepository::find_all(db.as_ref()).await {
            if let Some(book) = books.iter_mut().find(|b| b.id == book_id) {
                book.conversion_status = ConversionStatus::Started;
                if let Err(e) = BookRepository::save(db.as_ref(), book).await {
                    log::warn!(
                        "Failed to set conversion status to started on cancellation: {}",
                        e
                    );
                } else {
                    log::debug!("Set conversion status to started for cancelled conversion");
                }
            }
        }
    }

    // Emit conversion-cancelled event to frontend
    use crate::epub::converter::ConversionCancelledEvent;
    let event = ConversionCancelledEvent {
        book_id: book_id.to_string(),
        source_path: source_path.to_string(),
    };
    if let Err(e) = app.emit("conversion-cancelled", event) {
        log::warn!("Failed to emit conversion-cancelled event: {}", e);
    } else {
        log::debug!(
            "Emitted conversion-cancelled event for book_id: {}",
            book_id
        );
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
    // Get database connection once and reuse it
    let db = get_db_connection(app)
        .await
        .map_err(|e| AppError::Store(format!("Failed to connect to database: {}", e)))?;

    // Store converted EPUB in database
    if let Ok(Some(book)) = BookRepository::find_by_source_path(db.as_ref(), source_path).await {
        EpubRepository::save_write_file_and_clear_blob(
                db.as_ref(),
                app,
                source_path,
                &book.id,
                converted_epub,
            )
            .await
            .map_err(|e| AppError::Store(format!("Failed to save converted EPUB: {}", e)))?;
        log::debug!(
            "Saved converted EPUB to database ({} bytes)",
            converted_epub.len()
        );
    } else {
        log::warn!(
            "Book not found for source_path '{}', cannot save converted EPUB",
            source_path
        );
    }

    // Save final words_processed now that conversion is complete (reusing same connection)
    if let Ok(Some(mut book)) = BookRepository::find_by_source_path(db.as_ref(), source_path).await
    {
        if book.total_words.is_none() {
            book.total_words = Some(total_words_all_chapters);
        }
        book.words_processed = Some(total_words_all_chapters);
        if let Err(e) = BookRepository::save(db.as_ref(), &book).await {
            log::warn!("Failed to save final words_processed: {}", e);
        } else {
            log::debug!(
                "Saved final words_processed: {} / {}",
                total_words_all_chapters,
                total_words_all_chapters
            );
        }
    }

    // Extract audio tracks from converted EPUB and update book in library
    update_book_audio_tracks(converted_epub, source_path, app)
        .await
        .map_err(|e| AppError::Store(format!("Failed to update book audio tracks: {}", e)))?;

    // Explicitly check and set conversion status to Done if all chapters are completed
    // This ensures the status is properly set even if update_book_in_library didn't catch it
    // Then reload the book from database to return the updated version
    let final_book = if let Ok(Some(mut book)) =
        BookRepository::find_by_source_path(db.as_ref(), source_path).await
    {
        // Try to count chapters with text content first
        let chapters_with_text: usize = book
            .chapters
            .iter()
            .filter(|ch| ch.word_count.map(|wc| wc > 0).unwrap_or(false))
            .count();

        // If no chapters with word_count found, use total chapters as fallback
        // (this can happen if chapters were reloaded from EPUB without word_count)
        let expected_completed = if chapters_with_text > 0 {
            chapters_with_text
        } else {
            // Fallback: use total chapters if word_count is not available
            // This is safe because we only convert chapters with text content
            book.chapters.len()
        };

        log::debug!("Final conversion status check: completed_chapters={}, chapters_with_text={}, total_chapters={}, expected_completed={}, current_status={:?}", 
            book.completed_chapters.len(), chapters_with_text, book.chapters.len(), expected_completed, book.conversion_status);

        // Check if all expected chapters are completed
        if book.completed_chapters.len() == expected_completed && expected_completed > 0 {
            if book.conversion_status != ConversionStatus::Done {
                book.conversion_status = ConversionStatus::Done;
                log::info!(
                    "Conversion completed - all {} chapters are done, setting status to Done",
                    expected_completed
                );
                if let Err(e) = BookRepository::save(db.as_ref(), &book).await {
                    log::warn!("Failed to save conversion status as Done: {}", e);
                } else {
                    log::info!("Successfully set conversion status to Done");
                }
            } else {
                log::debug!("Conversion status already set to Done");
            }
        } else {
            log::warn!(
                "Conversion not complete yet: {}/{} chapters are completed (status: {:?})",
                book.completed_chapters.len(),
                expected_completed,
                book.conversion_status
            );
        }

        // Reload the book from database to get the latest status
        BookRepository::find_by_source_path(db.as_ref(), source_path)
            .await
            .map_err(|e| {
                AppError::Store(format!("Failed to reload book after status update: {}", e))
            })?
    } else {
        None
    };

    Ok(final_book)
}
