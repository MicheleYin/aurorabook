pub mod models;
pub mod storage;
pub mod filters;

pub use models::*;
use storage::*;
use filters::*;
use crate::utils::errors::{AppError, AppResult};
use crate::utils::constants::MAX_EPUB_SIZE;
use crate::utils::path_validation::validate_file_size;
use crate::epub::parser::extract_audio_tracks_from_manifest;

/// Normalize an EPUB href by removing leading slash.
/// The base path should already be correctly derived from the OPF file.
fn normalize_epub_href(href: &str) -> &str {
    // Remove leading slash if present
    href.strip_prefix("/").unwrap_or(href)
}

/// Read all books with optional filtering and search
#[tauri::command]
pub async fn read_all_books(
    filter: Option<LibraryFilter>,
    app: tauri::AppHandle,
) -> AppResult<Vec<Book>> {
    let books = load_all_books(&app).await
        .map_err(|e| AppError::Store(e))?;
    Ok(filter_books(books, filter))
}

/// Read a single complete book by ID
#[tauri::command]
pub async fn read_one_book(
    book_id: String,
    app: tauri::AppHandle,
) -> AppResult<Option<Book>> {
    use storage::get_book;
    get_book(&app, &book_id).await
        .map_err(|e| AppError::Store(e))
}

/// Read a single chapter by book ID and chapter ID
/// This returns the chapter metadata only (no content)
#[tauri::command]
pub async fn read_single_chapter(
    book_id: String,
    chapter_id: String,
    app: tauri::AppHandle,
) -> AppResult<Option<Chapter>> {
    let book = get_book(&app, &book_id).await
        .map_err(|e| AppError::Store(e))?;
    if let Some(book) = book {
        Ok(book.chapters.into_iter().find(|c| c.id == chapter_id))
    } else {
        Ok(None)
    }
}

/// Resolve the chapter file path within an EPUB archive
/// 
/// Takes a chapter href and resolves it to the actual file path in the EPUB,
/// accounting for base paths and leading slashes.
fn resolve_chapter_path(
    archive: &mut zip::ZipArchive<std::io::Cursor<&[u8]>>,
    chapter_href: &str,
) -> Result<String, String> {
    use crate::epub::parser::{find_opf_path, derive_base_path_from_opf};
    use crate::utils::path_validation::validate_epub_path;
    
    // Find OPF path to determine base path
    let opf_path = find_opf_path(archive)?;
    let base_path = derive_base_path_from_opf(&opf_path);
    
    // Validate and resolve chapter path
    let validated_href = validate_epub_path(chapter_href)
        .map_err(|e| format!("Invalid chapter path: {}", e))?;
    
    let chapter_path = if validated_href.starts_with("/") {
        validated_href[1..].to_string()
    } else if !base_path.is_empty() && validated_href.starts_with(&base_path) {
        validated_href.to_string()
    } else {
        format!("{}{}", base_path, validated_href)
    };
    
    Ok(chapter_path)
}

/// Extract chapter content from EPUB archive
/// 
/// Opens the EPUB archive and reads the content of the specified chapter file.
fn extract_chapter_content_from_archive(
    epub_data: &[u8],
    chapter_href: &str,
) -> Result<String, String> {
    use std::io::{Cursor, Read};
    use zip::ZipArchive;
    
    let mut archive = ZipArchive::new(Cursor::new(epub_data))
        .map_err(|e| format!("Failed to open EPUB: {}", e))?;
    
    // Resolve the chapter path
    let chapter_path = resolve_chapter_path(&mut archive, chapter_href)?;
    
    // Read the chapter file content
    let mut file = archive.by_name(&chapter_path)
        .map_err(|e| format!("Failed to find chapter at path '{}': {}", chapter_path, e))?;
    
    let mut content = String::new();
    file.read_to_string(&mut content)
        .map_err(|e| format!("Failed to read chapter content: {}", e))?;
    
    Ok(content)
}

/// Find a chapter in a book by its href
/// 
/// Searches for a chapter matching the given href, trying both exact and normalized matches.
fn find_chapter_by_href(book: &Book, chapter_href: &str) -> Option<Chapter> {
    let normalized_chapter_href = normalize_epub_href(chapter_href);
    
    book.chapters.iter().find(|c| {
        // Try exact match first
        c.href == chapter_href || {
            // Try normalized match (removes base path prefixes)
            normalize_epub_href(&c.href) == normalized_chapter_href
        }
    }).cloned()
}

/// Load chapter content from EPUB file
/// 
/// This function reads the EPUB from storage and extracts the chapter content.
/// It uses direct database queries instead of loading all books for better performance.
#[tauri::command]
pub async fn load_chapter_content(
    book_id: String,
    chapter_href: String,
    app: tauri::AppHandle,
) -> AppResult<Option<Chapter>> {
    use storage::get_book;
    
    // Get the specific book (not all books)
    let book = get_book(&app, &book_id).await
        .map_err(|e| AppError::Store(e))?
        .ok_or_else(|| AppError::Store(format!("Book not found: {}", book_id)))?;
    
    // Get EPUB buffer from store
    let epub_data = get_epub_buffer_from_store(&app, &book.source_path).await
        .map_err(|e| AppError::Store(e))?
        .ok_or_else(|| AppError::Store("EPUB not found in store".to_string()))?;
    
    // Load chapter content in a blocking task with timeout
    let epub_data_clone = epub_data.clone();
    let chapter_href_clone = chapter_href.clone();
    let chapter_content = tokio::time::timeout(
        std::time::Duration::from_secs(30), // 30 second timeout
        tokio::task::spawn_blocking(move || {
            extract_chapter_content_from_archive(&epub_data_clone, &chapter_href_clone)
        })
    )
    .await
    .map_err(|_| AppError::EpubParse("Chapter loading timed out after 30 seconds".to_string()))?
    .map_err(|e| AppError::EpubParse(format!("Task join error: {}", e)))?
    .map_err(|e| AppError::EpubParse(e))?;
    
    // Find the chapter in the book to get metadata
    let mut chapter = find_chapter_by_href(&book, &chapter_href)
        .ok_or_else(|| AppError::Store("Chapter not found in book".to_string()))?;
    
    // Set the content
    chapter.content_html = Some(chapter_content);
    
    Ok(Some(chapter))
}

/// Resolve a relative path against a base path, handling ".." and "." components
fn resolve_relative_path(base_path: &str, relative_path: &str) -> String {
    let mut resolved_parts: Vec<&str> = base_path.split("/").filter(|s| !s.is_empty()).collect();
    let relative_parts: Vec<&str> = relative_path.split("/").collect();
    
    for part in relative_parts {
        if part == ".." {
            resolved_parts.pop();
        } else if part != "." && !part.is_empty() {
            resolved_parts.push(part);
        }
    }
    
    resolved_parts.join("/")
}

/// Resolve an image path relative to chapter or OPF location
fn resolve_image_path(
    archive: &mut zip::ZipArchive<std::io::Cursor<&[u8]>>,
    image_href: &str,
    chapter_href: Option<&str>,
) -> Result<String, String> {
    use crate::epub::parser::{find_opf_path, derive_base_path_from_opf};
    use crate::utils::path_validation::validate_epub_path;
    
    // Find OPF path to determine base path
    let opf_path = find_opf_path(archive)?;
    let base_path = derive_base_path_from_opf(&opf_path);
    
    // Resolve image path relative to chapter if provided, otherwise relative to OPF
    let image_path = if image_href.starts_with("/") {
        // Absolute path from EPUB root
        image_href[1..].to_string()
    } else if let Some(chapter) = chapter_href {
        // Resolve relative to chapter location
        let validated_chapter = validate_epub_path(chapter)
            .map_err(|e| format!("Invalid chapter path: {}", e))?;
        
        let chapter_path = if validated_chapter.starts_with("/") {
            validated_chapter[1..].to_string()
        } else if !base_path.is_empty() && validated_chapter.starts_with(&base_path) {
            validated_chapter
        } else {
            format!("{}{}", base_path, validated_chapter)
        };
        
        // Get chapter directory
        let chapter_dir = if chapter_path.contains("/") {
            chapter_path.rfind("/")
                .map(|pos| chapter_path[..pos + 1].to_string())
                .unwrap_or_else(|| base_path.clone())
        } else {
            base_path
        };
        
        // Resolve image path relative to chapter directory
        resolve_relative_path(&chapter_dir, image_href)
    } else {
        // Resolve relative to OPF location
        resolve_relative_path(&base_path, image_href)
    };
    
    Ok(image_path)
}

/// Resolve an audio path relative to OPF location
fn resolve_audio_path(
    archive: &mut zip::ZipArchive<std::io::Cursor<&[u8]>>,
    audio_href: &str,
) -> Result<String, String> {
    use crate::epub::parser::{find_opf_path, derive_base_path_from_opf};
    
    // Find OPF path to determine base path
    let opf_path = find_opf_path(archive)?;
    let base_path = derive_base_path_from_opf(&opf_path);
    
    // Resolve audio path relative to OPF location
    let audio_path = if audio_href.starts_with("/") {
        // Absolute path from EPUB root
        audio_href[1..].to_string()
    } else {
        // Resolve relative to OPF location
        resolve_relative_path(&base_path, audio_href)
    };
    
    Ok(audio_path)
}

/// Load a resource from EPUB archive with fallback path attempts
fn load_resource_from_archive(
    archive: &mut zip::ZipArchive<std::io::Cursor<&[u8]>>,
    primary_path: &str,
    original_href: &str,
    base_path: &str,
) -> Result<Vec<u8>, String> {
    use std::io::Read;
    use log::{debug, warn};
    
    let mut resource_bytes = Vec::new();
    
    // Try primary path first
    if let Ok(mut file) = archive.by_name(primary_path) {
        if file.read_to_end(&mut resource_bytes).is_ok() && !resource_bytes.is_empty() {
            debug!("Found resource at primary path: '{}'", primary_path);
            return Ok(resource_bytes);
        }
    }
    
    // Try alternative paths if primary didn't work
    let mut alt_paths = vec![original_href.to_string()];
    
    // Add base path variants if base path exists
    if !base_path.is_empty() {
        alt_paths.push(format!("{}{}", base_path, primary_path));
        alt_paths.push(format!("{}{}", base_path, original_href));
    }
    
    for alt_path in &alt_paths {
        if let Ok(mut file) = archive.by_name(alt_path) {
            resource_bytes.clear();
            if file.read_to_end(&mut resource_bytes).is_ok() && !resource_bytes.is_empty() {
                debug!("Found resource at alternative path: '{}'", alt_path);
                return Ok(resource_bytes);
            }
        }
    }
    
    warn!("Resource not found at path '{}' or alternatives", primary_path);
    Err(format!("Resource not found: {}", original_href))
}

/// Detect image MIME type from file extension or magic bytes
fn detect_image_mime_type(image_path: &str, image_href: &str, image_bytes: &[u8]) -> &'static str {
    if image_path.ends_with(".png") || image_href.ends_with(".png") {
        "image/png"
    } else if image_path.ends_with(".jpg") || image_path.ends_with(".jpeg") ||
              image_href.ends_with(".jpg") || image_href.ends_with(".jpeg") {
        "image/jpeg"
    } else if image_path.ends_with(".gif") || image_href.ends_with(".gif") {
        "image/gif"
    } else if image_path.ends_with(".webp") || image_href.ends_with(".webp") {
        "image/webp"
    } else if image_path.ends_with(".svg") || image_href.ends_with(".svg") {
        "image/svg+xml"
    } else {
        // Try to detect from magic bytes
        if image_bytes.len() >= 4 {
            match &image_bytes[0..4] {
                [0x89, 0x50, 0x4E, 0x47] => "image/png",
                [0xFF, 0xD8, 0xFF, _] => "image/jpeg",
                [0x47, 0x49, 0x46, 0x38] => "image/gif",
                _ => "image/jpeg", // Default fallback
            }
        } else {
            "image/jpeg"
        }
    }
}

/// Detect audio MIME type from file extension
fn detect_audio_mime_type(audio_path: &str, audio_href: &str) -> &'static str {
    if audio_path.ends_with(".mp3") || audio_href.ends_with(".mp3") {
        "audio/mpeg"
    } else if audio_path.ends_with(".wav") || audio_href.ends_with(".wav") {
        "audio/wav"
    } else if audio_path.ends_with(".m4a") || audio_href.ends_with(".m4a") {
        "audio/mp4"
    } else if audio_path.ends_with(".ogg") || audio_href.ends_with(".ogg") {
        "audio/ogg"
    } else if audio_path.ends_with(".opus") || audio_href.ends_with(".opus") {
        "audio/opus"
    } else {
        "audio/mpeg" // Default fallback
    }
}

/// Create a base64 data URL from resource bytes and MIME type
fn create_data_url(mime_type: &str, bytes: &[u8]) -> String {
    use base64::{Engine as _, engine::general_purpose};
    let base64_data = general_purpose::STANDARD.encode(bytes);
    format!("data:{};base64,{}", mime_type, base64_data)
}

/// Extract image from EPUB archive and return as data URL
fn extract_image_from_archive(
    epub_data: &[u8],
    image_href: &str,
    chapter_href: Option<&str>,
) -> Result<Option<String>, String> {
    use std::io::Cursor;
    use zip::ZipArchive;
    use crate::epub::parser::{find_opf_path, derive_base_path_from_opf};
    use log::debug;
    
    let mut archive = ZipArchive::new(Cursor::new(epub_data))
        .map_err(|e| format!("Failed to open EPUB: {}", e))?;
    
    // Resolve image path
    let image_path = resolve_image_path(&mut archive, image_href, chapter_href)?;
    
    // Get base path for fallback attempts
    let opf_path = find_opf_path(&mut archive)?;
    let base_path = derive_base_path_from_opf(&opf_path);
    
    debug!("Attempting to load image from path: '{}' (resolved from '{}')", image_path, image_href);
    
    // Load image bytes with fallback paths
    let image_bytes = load_resource_from_archive(&mut archive, &image_path, image_href, &base_path)?;
    
    // Detect MIME type
    let mime_type = detect_image_mime_type(&image_path, image_href, &image_bytes);
    
    // Create data URL
    let data_url = create_data_url(mime_type, &image_bytes);
    
    debug!("Successfully loaded image ({} bytes, type: {})", image_bytes.len(), mime_type);
    
    Ok(Some(data_url))
}

/// Extract audio from EPUB archive and return as data URL
fn extract_audio_from_archive(
    epub_data: &[u8],
    audio_href: &str,
) -> Result<Option<String>, String> {
    use std::io::Cursor;
    use zip::ZipArchive;
    use crate::epub::parser::{find_opf_path, derive_base_path_from_opf};
    use log::debug;
    
    let mut archive = ZipArchive::new(Cursor::new(epub_data))
        .map_err(|e| format!("Failed to open EPUB: {}", e))?;
    
    // Resolve audio path
    let audio_path = resolve_audio_path(&mut archive, audio_href)?;
    
    // Get base path for fallback attempts
    let opf_path = find_opf_path(&mut archive)?;
    let base_path = derive_base_path_from_opf(&opf_path);
    
    debug!("Attempting to load audio from path: '{}' (resolved from '{}')", audio_path, audio_href);
    
    // Load audio bytes with fallback paths
    let audio_bytes = load_resource_from_archive(&mut archive, &audio_path, audio_href, &base_path)?;
    
    // Detect MIME type
    let mime_type = detect_audio_mime_type(&audio_path, audio_href);
    
    // Create data URL
    let data_url = create_data_url(mime_type, &audio_bytes);
    
    debug!("Successfully loaded audio ({} bytes, type: {})", audio_bytes.len(), mime_type);
    
    Ok(Some(data_url))
}

/// Load an image from EPUB file and return as base64 data URL
/// This function resolves relative image paths relative to the chapter location
#[tauri::command]
pub async fn load_epub_image(
    book_id: String,
    image_href: String,
    chapter_href: Option<String>,
    app: tauri::AppHandle,
) -> AppResult<Option<String>> {
    use storage::get_book;
    
    // Get the specific book (not all books)
    let book = get_book(&app, &book_id).await
        .map_err(|e| AppError::Store(e))?
        .ok_or_else(|| AppError::Store(format!("Book not found: {}", book_id)))?;
    
    // Get EPUB buffer from store
    let epub_data = get_epub_buffer_from_store(&app, &book.source_path).await
        .map_err(|e| AppError::Store(e))?
        .ok_or_else(|| AppError::Store("EPUB not found in store".to_string()))?;
    
    // Load image in a blocking task with timeout
    let epub_data_clone = epub_data.clone();
    let image_href_clone = image_href.clone();
    let chapter_href_clone = chapter_href.clone();
    let image_data_url = tokio::time::timeout(
        std::time::Duration::from_secs(10), // 10 second timeout
        tokio::task::spawn_blocking(move || {
            extract_image_from_archive(
                &epub_data_clone,
                &image_href_clone,
                chapter_href_clone.as_deref(),
            )
        })
    )
    .await
    .map_err(|_| AppError::EpubParse("Image loading timed out after 10 seconds".to_string()))?
    .map_err(|e| AppError::EpubParse(format!("Task join error: {}", e)))?
    .map_err(|e| AppError::EpubParse(e))?;
    
    Ok(image_data_url)
}

/// Load an audio track from EPUB file and return as base64 data URL
/// This resolves relative audio paths relative to the OPF location
#[tauri::command]
pub async fn load_epub_audio(
    book_id: String,
    audio_href: String,
    app: tauri::AppHandle,
) -> AppResult<Option<String>> {
    use storage::get_book;
    
    // Get the specific book (not all books)
    let book = get_book(&app, &book_id).await
        .map_err(|e| AppError::Store(e))?
        .ok_or_else(|| AppError::Store(format!("Book not found: {}", book_id)))?;
    
    // Get EPUB buffer from store
    let epub_data = get_epub_buffer_from_store(&app, &book.source_path).await
        .map_err(|e| AppError::Store(e))?
        .ok_or_else(|| AppError::Store("EPUB not found in store".to_string()))?;
    
    // Load audio in a blocking task with timeout
    let epub_data_clone = epub_data.clone();
    let audio_href_clone = audio_href.clone();
    let audio_data_url = tokio::time::timeout(
        std::time::Duration::from_secs(30), // 30 second timeout for audio files
        tokio::task::spawn_blocking(move || {
            extract_audio_from_archive(&epub_data_clone, &audio_href_clone)
        })
    )
    .await
    .map_err(|_| AppError::EpubParse("Audio loading timed out after 30 seconds".to_string()))?
    .map_err(|e| AppError::EpubParse(format!("Task join error: {}", e)))?
    .map_err(|e| AppError::EpubParse(e))?;
    
    Ok(audio_data_url)
}

/// Read a single audio track by book ID and track ID
#[tauri::command]
pub async fn read_single_audio_track(
    book_id: String,
    track_id: String,
    app: tauri::AppHandle,
) -> AppResult<Option<AudioTrack>> {
    let book = get_book(&app, &book_id).await
        .map_err(|e| AppError::Store(e))?;
    if let Some(book) = book {
        Ok(book.audio_tracks.into_iter().find(|t| t.id == track_id))
    } else {
        Ok(None)
    }
}

/// Delete a book by ID
#[tauri::command]
pub async fn delete_book(
    book_id: String,
    app: tauri::AppHandle,
) -> AppResult<()> {
    use storage::{get_book, delete_book as delete_book_storage};
    
    // Get the book first to find its source_path for EPUB cleanup
    let book = get_book(&app, &book_id).await
        .map_err(|e| AppError::Store(e))?;
    
    let source_path = book.as_ref().map(|b| b.source_path.clone());
    
    // Delete the book from storage
    delete_book_storage(&app, &book_id).await
        .map_err(|e| AppError::Store(e))?;
    
    // Clean up EPUB from store if it exists
    if let Some(path) = source_path {
        delete_epub_from_store(&app, path.as_str()).await
            .map_err(|e| AppError::Store(e))?;
    }
    
    Ok(())
}


/// Merge new book data with existing book, preserving important state
fn merge_book_data(new_book: &Book, existing_book: &Book) -> Book {
    let mut merged = new_book.clone();
    
    // Preserve progress, audio_state, and page_count from existing book
    merged.progress = existing_book.progress.clone();
    merged.audio_state = existing_book.audio_state.clone();
    merged.page_count = existing_book.page_count;
    
    // Preserve the existing book ID to maintain continuity
    merged.id = existing_book.id.clone();
    
    // Preserve conversion state from existing book
    merged.conversion_started = existing_book.conversion_started;
    merged.completed_chapters = existing_book.completed_chapters.clone();
    
    // If audio_sync_map is missing but we have audio tracks, use the new one
    // This allows books imported before SMIL parsing to get sync maps
    if merged.audio_sync_map.is_none() && !merged.audio_tracks.is_empty() {
        log::info!("Rebuilding audio sync map for existing book (was missing)");
        // Keep the new audio_sync_map from the parsed book
    } else if existing_book.audio_sync_map.is_some() {
        // Preserve existing sync map if it exists
        merged.audio_sync_map = existing_book.audio_sync_map.clone();
    }
    
    merged
}

/// Add a new book to the library
#[tauri::command]
pub async fn add_book(
    book: Book,
    epub_data: Option<Vec<u8>>,
    app: tauri::AppHandle,
) -> AppResult<Book> {
    use storage::{get_book_by_hash, get_book_by_source_path, add_book as add_book_storage};
    
    // Clone source_path before we might move book
    let source_path = book.source_path.clone();
    
    // Check for duplicates by content hash first (if available), then fall back to source_path
    let result_book = if let Some(ref hash) = book.content_hash {
        log::debug!("Checking for duplicate book with hash: {}", hash);
        // Check if book with same content hash already exists
        if let Some(existing_book) = get_book_by_hash(&app, hash).await
            .map_err(|e| AppError::Store(e))?
        {
            log::info!("Duplicate book detected by hash {}: existing ID={}, new ID={}", 
                hash, existing_book.id, book.id);
            // Update existing book instead, but preserve progress and state
            let updated_book = merge_book_data(&book, &existing_book);
            add_book_storage(&app, &updated_book).await
                .map_err(|e| AppError::Store(e))?;
            updated_book
        } else {
            log::debug!("No duplicate found for hash {}, adding new book", hash);
            // New book - just add it
            add_book_storage(&app, &book).await
                .map_err(|e| AppError::Store(e))?;
            book
        }
    } else {
        log::debug!("No content hash available, checking for duplicate by source_path: {}", source_path);
        // Fall back to source_path check if no hash available (backward compatibility)
        if let Some(existing_book) = get_book_by_source_path(&app, &source_path).await
            .map_err(|e| AppError::Store(e))?
        {
            log::info!("Duplicate book detected by source_path {}: existing ID={}, new ID={}", 
                source_path, existing_book.id, book.id);
            // Update existing book instead, but preserve progress and state
            let updated_book = merge_book_data(&book, &existing_book);
            add_book_storage(&app, &updated_book).await
                .map_err(|e| AppError::Store(e))?;
            updated_book
        } else {
            log::debug!("No duplicate found for source_path {}, adding new book", source_path);
            // New book - just add it
            add_book_storage(&app, &book).await
                .map_err(|e| AppError::Store(e))?;
            book
        }
    };
    
    // Store EPUB data if provided
    if let Some(data) = epub_data {
        save_epub_buffer_to_store(&app, &source_path, &data).await
            .map_err(|e| AppError::Store(e))?;
    }
    
    Ok(result_book)
}
/// Get EPUB buffer for a book
#[tauri::command]
pub async fn get_epub_buffer(
    source_path: String,
    app: tauri::AppHandle,
) -> AppResult<Option<Vec<u8>>> {
    get_epub_buffer_from_store(&app, &source_path).await
        .map_err(|e| AppError::Store(e))
}


/// Update book progress
#[tauri::command]
pub async fn update_book_progress(
    book_id: String,
    progress: BookProgress,
    app: tauri::AppHandle,
) -> AppResult<Book> {
    use storage::{get_book, add_book as add_book_storage};
    
    let mut book = get_book(&app, &book_id).await
        .map_err(|e| AppError::Store(e))?
        .ok_or_else(|| AppError::Store(format!("Book not found: {}", book_id)))?;
    
    book.progress = Some(progress);
    
    add_book_storage(&app, &book).await
        .map_err(|e| AppError::Store(e))?;
    
    Ok(book)
}

/// Update book audio state
#[tauri::command]
pub async fn update_book_audio_state(
    book_id: String,
    audio_state: BookAudioState,
    app: tauri::AppHandle,
) -> AppResult<Book> {
    use storage::{get_book, add_book as add_book_storage};
    
    let mut book = get_book(&app, &book_id).await
        .map_err(|e| AppError::Store(e))?
        .ok_or_else(|| AppError::Store(format!("Book not found: {}", book_id)))?;
    
    book.audio_state = Some(audio_state);
    
    add_book_storage(&app, &book).await
        .map_err(|e| AppError::Store(e))?;
    
    Ok(book)
}

/// Ingest EPUB file - parse and store metadata
/// Returns the Book object with chapters containing only metadata (no content)
///
/// This function uses the epub::parser module to extract chapters and metadata
/// from an EPUB file, then creates a Book object and stores it in the library.
#[tauri::command]
pub async fn ingest_epub(
    epub_path: String,
    source_path: String,
    app: tauri::AppHandle,
) -> AppResult<Book> {
    use crate::epub::parser::{extract_chapters_from_epub, find_cover_image, extract_year, derive_title_from_path}; 
    use uuid::Uuid;
    use std::fs;

    // First, try to get EPUB from store (might be converted audiobook)
    let epub_data = if let Some(stored_data) = get_epub_buffer_from_store(&app, &source_path).await
        .map_err(|e| AppError::Store(format!("Failed to check EPUB store: {}", e)))?
    {
        log::info!("Using EPUB from store for source_path: {}", source_path);
        stored_data
    } else {
        // Fall back to reading from file system
        // Handle file:// URL prefix
        let actual_path = if epub_path.starts_with("file://") {
            epub_path.replacen("file://", "", 1)
        } else {
            epub_path.clone()
        };
        
        log::info!("Reading EPUB from file system: {}", actual_path);
        fs::read(&actual_path)
            .map_err(|e| AppError::Io(e).with_context(format!("Failed to read EPUB file from path '{}'", actual_path)))?
    };
    
    // Validate EPUB file size
    validate_file_size(epub_data.len(), MAX_EPUB_SIZE, "EPUB")?;
    
    // Validate EPUB signature (should start with PK for ZIP)
    if epub_data.len() < 4 || &epub_data[0..4] != b"PK\x03\x04" {
        return Err(AppError::EpubParse("Invalid EPUB file: not a valid ZIP archive".to_string()));
    }
    
    // Compute content hash for duplicate detection (synchronously since data is already in memory)
    use sha2::{Sha256, Digest};
    let mut hasher = Sha256::new();
    hasher.update(&epub_data);
    let content_hash = hex::encode(hasher.finalize());
    log::debug!("Computed content hash for EPUB ({} bytes): {}", epub_data.len(), content_hash);
    
    // Check for duplicate by hash BEFORE doing expensive parsing
    use storage::get_book_by_hash;
    if let Some(existing_book) = get_book_by_hash(&app, &content_hash).await
        .map_err(|e| AppError::Store(format!("Failed to check for duplicate: {}", e)))?
    {
        log::info!("Duplicate EPUB detected by hash {}: existing book ID={}, title='{}'.", 
            content_hash, existing_book.id, existing_book.title);
        return Err(AppError::DuplicateBook(format!(
            "This EPUB is already in your library: \"{}\"",
            existing_book.title
        )));
    }
    
    // Parse EPUB in a blocking task
    let epub_data_clone = epub_data.clone();
    let (chapters, _stats) = tokio::task::spawn_blocking(move || {
        extract_chapters_from_epub(&epub_data_clone)
    })
    .await
    .map_err(|e| AppError::EpubParse(format!("Failed to parse EPUB: {}", e)))?
    .map_err(|e| AppError::EpubParse(e))?;
    
    if chapters.is_empty() {
        return Err(AppError::EpubParse("No readable chapters found in EPUB".to_string()));
    }
    
    // Extract metadata using epub crate in a separate blocking task
    let epub_data_for_metadata = epub_data.clone();
    let (metadata, manifest_items, _spine_items, opf_path) = tokio::task::spawn_blocking(move || {
        use crate::epub::parser::extract_metadata_with_epub_crate;
        extract_metadata_with_epub_crate(&epub_data_for_metadata)
            .map_err(|e| format!("Failed to extract metadata: {}", e))
    })
    .await
    .map_err(|e| AppError::EpubParse(format!("Failed to extract metadata: {}", e)))?
    .map_err(|e| AppError::EpubParse(e).with_context("Failed to extract EPUB metadata"))?;
    
    // Find cover image href
    let cover_href = find_cover_image(metadata.cover_id.as_ref(), &manifest_items);
    
    // Extract cover image as data URL if found
    let cover_url = if let Some(href) = cover_href {
        let epub_data_for_cover = epub_data.clone();
        let opf_path_for_cover = opf_path.clone();
        tokio::task::spawn_blocking(move || {
            crate::epub::parser::extract_cover_image_as_data_url(
                &epub_data_for_cover,
                &href,
                &opf_path_for_cover,
            )
        })
        .await
        .unwrap_or_else(|e| {
            log::warn!("Failed to extract cover image: {}", e);
            None
        })
    } else {
        None
    };
    
    // Extract published year from date
    let published_year = extract_year(metadata.pubdate.as_ref());
    
    // Extract audio tracks from manifest
    let mut audio_tracks = extract_audio_tracks_from_manifest(&manifest_items);
    
    // Compute durations for audio tracks
    if !audio_tracks.is_empty() {
        let epub_data_for_durations = epub_data.clone();
        let opf_path_for_durations = opf_path.clone();
        let audio_tracks_clone = audio_tracks.clone();
        audio_tracks = match tokio::task::spawn_blocking(move || {
            use crate::epub::parser::compute_audio_track_durations;
            let mut tracks = audio_tracks_clone;
            compute_audio_track_durations(
                &epub_data_for_durations,
                &mut tracks,
                &opf_path_for_durations,
            );
            tracks
        })
        .await
        {
            Ok(tracks) => tracks,
            Err(e) => {
                log::warn!("Failed to compute audio track durations in background task: {}", e);
                audio_tracks
            }
        };
    }
    
    // Build audio sync map from SMIL files if audio tracks exist
    let audio_sync_map = if !audio_tracks.is_empty() {
        log::info!("Building audio sync map for book with {} audio tracks", audio_tracks.len());
        let epub_data_for_smil = epub_data.clone();
        let chapters_for_smil = chapters.clone();
        tokio::task::spawn_blocking(move || {
            use std::io::Cursor;
            use zip::ZipArchive;
            use crate::epub::converter::smil::build_audio_sync_map;
            
            let mut archive = ZipArchive::new(Cursor::new(epub_data_for_smil.as_slice()))
                .map_err(|e| format!("Failed to open EPUB for SMIL parsing: {}", e))?;
            
            build_audio_sync_map(&mut archive, &chapters_for_smil)
                .map_err(|e| format!("Failed to build audio sync map: {}", e))
        })
        .await
        .unwrap_or_else(|e| {
            log::warn!("Failed to parse SMIL files in background task: {}", e);
            Ok(None)
        })
        .unwrap_or_else(|e| {
            log::warn!("Failed to build audio sync map: {}", e);
            None
        })
    } else {
        log::debug!("Skipping audio sync map - no audio tracks found");
        None
    };
    
    if let Some(ref sync_map) = audio_sync_map {
        log::info!("Successfully built audio sync map with {} segments", sync_map.segments.len());
    } else {
        log::debug!("No audio sync map available for this book");
    }
    
    // Generate book ID
    let book_id = Uuid::new_v4().to_string();
    
    // Derive title from path if not available
    let title = metadata.title
        .unwrap_or_else(|| derive_title_from_path(&source_path));
    
    // Create Book object
    let book = Book {
        id: book_id,
        title,
        author: metadata.creator.unwrap_or_else(|| "Unknown author".to_string()),
        chapters,
        cover_url,
        source_path: source_path.clone(),
        content_hash: Some(content_hash.clone()),
        publisher: metadata.publisher,
        published_year,
        subjects: if metadata.subjects.is_empty() {
            None
        } else {
            Some(metadata.subjects)
        },
        file_size_bytes: Some(epub_data.len()),
        audio_tracks,
        audio_state: None,
        audio_sync_map,
        progress: None,
        page_count: None,
        conversion_started: false,
        completed_chapters: Vec::new(),
    };
    
    // Store book and EPUB data
    // add_book will check for duplicates by hash and merge if found
    let result_book = add_book(book, Some(epub_data), app).await?;
    
    Ok(result_book)
}

