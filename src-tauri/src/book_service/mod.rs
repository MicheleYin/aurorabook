pub mod models;
pub mod filters;
pub mod database;
pub mod repositories;
pub mod audio_stream;

pub use models::*;
use filters::*;
use database::get_db_connection;
use repositories::*;
use crate::utils::errors::{AppError, AppResult};
use crate::utils::constants::MAX_EPUB_SIZE;
use crate::utils::path_validation::validate_file_size;

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
    let db = get_db_connection(&app).await
        .map_err(|e| AppError::Store(e))?;
    let books = BookRepository::find_all(db.as_ref()).await
        .map_err(|e| AppError::Store(e))?;
    Ok(filter_books(books, filter))
}

/// Read a single complete book by ID
#[tauri::command]
pub async fn read_one_book(
    book_id: String,
    app: tauri::AppHandle,
) -> AppResult<Option<Book>> {
    let db = get_db_connection(&app).await
        .map_err(|e| AppError::Store(e))?;
    BookRepository::find_by_id(db.as_ref(), &book_id).await
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
    let db = get_db_connection(&app).await
        .map_err(|e| AppError::Store(e))?;
    let book = BookRepository::find_by_id(db.as_ref(), &book_id).await
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

/// Load chapter content from database and resolve images
/// 
/// This function reads chapter content directly from the database and resolves all images
/// to data URLs before returning.
#[tauri::command]
pub async fn load_chapter_content(
    book_id: String,
    chapter_href: String,
    app: tauri::AppHandle,
) -> AppResult<Option<Chapter>> {
    let db = get_db_connection(&app).await
        .map_err(|e| AppError::Store(e))?;
    
    // Try to get chapter from database first
    let mut chapter = if let Some(ch) = ChapterRepository::find_by_href(db.as_ref(), &book_id, &chapter_href).await
        .map_err(|e| AppError::Store(e))?
    {
        ch
    } else {
        // Chapter content should already be in database from ingestion
        return Ok(None);
    };
    
    // If content is not stored, return None
    let content_html = match chapter.content_html.as_ref() {
        Some(html) => html,
        None => return Ok(None),
    };
    
    // Process images in the HTML: resolve relative paths to data URLs
    let processed_html = process_images_in_html(db.as_ref(), &book_id, content_html, &chapter_href).await?;
    
    // Update chapter with processed HTML
    chapter.content_html = Some(processed_html);
    
    Ok(Some(chapter))
}

/// Process images in HTML content by resolving them to data URLs
async fn process_images_in_html(
    db: &sqlx::SqlitePool,
    book_id: &str,
    html: &str,
    chapter_href: &str,
) -> Result<String, AppError> {
    use scraper::{Html, Selector};
    use regex::Regex;
    
    // Parse HTML synchronously to extract image sources
    // We need to do this in a block to ensure the document is dropped before async operations
    let image_sources: Vec<String> = {
        let document = Html::parse_document(html);
        let img_selector = Selector::parse("img").map_err(|e| AppError::EpubParse(format!("Failed to parse img selector: {}", e)))?;
        
        // Collect all image sources that need to be resolved
        let mut sources = Vec::new();
        for img in document.select(&img_selector) {
            if let Some(src) = img.value().attr("src") {
                // Skip if already a data URL or absolute URL
                if !src.starts_with("data:") && !src.starts_with("http://") && !src.starts_with("https://") && !src.starts_with("blob:") {
                    sources.push(src.to_string());
                }
            }
        }
        sources
    }; // document is dropped here
    
    // Now resolve images asynchronously (document is no longer in scope)
    let mut processed_html = html.to_string();
    // Pre-allocate replacements vector with estimated capacity
    let estimated_image_count = image_sources.len();
    let mut replacements: Vec<(String, String)> = Vec::with_capacity(estimated_image_count);
    
    for src in image_sources {
        // Try to load image from database
        // Pre-allocate with known capacity (3 variations)
        let mut href_variations = Vec::with_capacity(3);
        href_variations.push(src.clone());
        href_variations.push(src.trim_start_matches('/').to_string());
        if src.starts_with('/') {
            href_variations.push(src[1..].to_string());
        } else {
            href_variations.push(format!("/{}", src));
        }
        
        let mut image_data_url: Option<String> = None;
        for href in &href_variations {
            if let Ok(Some((mime_type, image_data))) = ImageRepository::find_by_href(db, book_id, href).await {
                let data_url = create_data_url(&mime_type, &image_data);
                image_data_url = Some(data_url);
                log::debug!("Resolved image '{}' to data URL using href variation: '{}'", src, href);
                break;
            }
        }
        
        if let Some(data_url) = image_data_url {
            // Use regex to replace src attribute, handling both single and double quotes
            // Escape special regex characters in src
            let escaped_src = regex::escape(&src);
            let pattern = format!(r#"(?i)src\s*=\s*["']{}["']"#, escaped_src);
            replacements.push((pattern, format!(r#"src="{}""#, data_url)));
        } else {
            log::warn!("Could not resolve image '{}' in chapter '{}'", src, chapter_href);
        }
    }
    
    // Apply all replacements using regex
    for (pattern, replacement) in replacements {
        if let Ok(re) = Regex::new(&pattern) {
            processed_html = re.replace_all(&processed_html, replacement.as_str()).to_string();
        }
    }
    
    Ok(processed_html)
}

/// Helper function to resolve image path for storage (used during ingestion)
fn resolve_image_path_for_storage_simple(
    image_href: &str,
    chapter_href: Option<&str>,
    base_path: &str,
) -> String {
    if image_href.starts_with("/") {
        image_href[1..].to_string()
    } else if let Some(chapter) = chapter_href {
        // Resolve relative to chapter location
        let chapter_path = if chapter.starts_with("/") {
            chapter[1..].to_string()
        } else if !base_path.is_empty() && chapter.starts_with(base_path) {
            chapter.to_string()
        } else {
            format!("{}{}", base_path, chapter)
        };
        
        // Get chapter directory
        let chapter_dir = if chapter_path.contains("/") {
            chapter_path.rfind("/")
                .map(|pos| chapter_path[..pos + 1].to_string())
                .unwrap_or_else(|| base_path.to_string())
        } else {
            base_path.to_string()
        };
        
        // Resolve image path relative to chapter directory
        resolve_relative_path(&chapter_dir, image_href)
    } else {
        // Resolve relative to OPF location
        resolve_relative_path(base_path, image_href)
    }
}

/// Helper function to detect image MIME type for storage
fn detect_image_mime_type_storage(image_path: &str, image_href: &str, image_bytes: &[u8]) -> String {
    if image_path.ends_with(".png") || image_href.ends_with(".png") {
        "image/png".to_string()
    } else if image_path.ends_with(".jpg") || image_path.ends_with(".jpeg") ||
              image_href.ends_with(".jpg") || image_href.ends_with(".jpeg") {
        "image/jpeg".to_string()
    } else if image_path.ends_with(".gif") || image_href.ends_with(".gif") {
        "image/gif".to_string()
    } else if image_path.ends_with(".webp") || image_href.ends_with(".webp") {
        "image/webp".to_string()
    } else if image_path.ends_with(".svg") || image_href.ends_with(".svg") {
        "image/svg+xml".to_string()
    } else {
        // Try to detect from magic bytes
        if image_bytes.len() >= 4 {
            match &image_bytes[0..4] {
                [0x89, 0x50, 0x4E, 0x47] => "image/png".to_string(),
                [0xFF, 0xD8, 0xFF, _] => "image/jpeg".to_string(),
                [0x47, 0x49, 0x46, 0x38] => "image/gif".to_string(),
                _ => "image/jpeg".to_string(), // Default fallback
            }
        } else {
            "image/jpeg".to_string()
        }
    }
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

/// Load an image from database and return as base64 data URL
/// This function reads images directly from the database without opening EPUB zip.
/// Images are stored with the original src attribute from HTML during ingestion.
#[tauri::command]
pub async fn load_epub_image(
    book_id: String,
    image_href: String,
    _chapter_href: Option<String>, // Not used - images are stored with original src from HTML
    app: tauri::AppHandle,
) -> AppResult<Option<String>> {
    let db = get_db_connection(&app).await
        .map_err(|e| AppError::Store(e))?;
    
    // Try multiple variations of the image href to find a match
    // During ingestion, images are stored with the original src from HTML (line 1027)
    // So we need to try various path formats that might match
    let mut href_variations = Vec::new();
    
    // Add the exact href as-is (most likely to match since it's stored with original src)
    href_variations.push(image_href.clone());
    
    // Try with/without leading slash
    if image_href.starts_with('/') {
        href_variations.push(image_href[1..].to_string());
    } else {
        href_variations.push(format!("/{}", image_href));
    }
    
    // Try trimmed version (remove leading/trailing whitespace)
    let trimmed = image_href.trim();
    if trimmed != image_href {
        href_variations.push(trimmed.to_string());
        if trimmed.starts_with('/') {
            href_variations.push(trimmed[1..].to_string());
        } else {
            href_variations.push(format!("/{}", trimmed));
        }
    }
    
    // Remove duplicates while preserving order
    let mut seen = std::collections::HashSet::new();
    let mut unique_variations = Vec::new();
    for href in href_variations {
        if seen.insert(href.clone()) {
            unique_variations.push(href);
        }
    }
    
    log::debug!("Trying to load image '{}' for book '{}' with {} variations", 
        image_href, book_id, unique_variations.len());
    
    // Try to get image from database with each variation
    for (idx, href) in unique_variations.iter().enumerate() {
        match ImageRepository::find_by_href(db.as_ref(), &book_id, href).await {
            Ok(Some((mime_type, image_data))) => {
                // Create data URL from stored image
                let data_url = create_data_url(&mime_type, &image_data);
                log::info!("✓ Found image with href variation #{}: '{}' (original: '{}', {} bytes, type: {})", 
                    idx + 1, href, image_href, image_data.len(), mime_type);
                return Ok(Some(data_url));
            }
            Ok(None) => {
                log::trace!("  Variation #{} '{}' not found", idx + 1, href);
            }
            Err(e) => {
                log::warn!("Error querying image with href '{}': {}", href, e);
            }
        }
    }
    
    log::warn!("✗ Image not found in database: '{}' for book '{}' (tried {} variations: {:?})", 
        image_href, book_id, unique_variations.len(), unique_variations);
    
    // Image should already be in database from ingestion
    // If not found, return None (images should have been extracted during ingestion)
    Ok(None)
}

/// Load an audio track from database and return as base64 data URL
/// This function reads audio directly from the database without opening EPUB zip.
#[tauri::command]
pub async fn load_epub_audio(
    book_id: String,
    track_id: String,
    app: tauri::AppHandle,
) -> AppResult<Option<String>> {
    let db = get_db_connection(&app).await
        .map_err(|e| AppError::Store(e))?;
    
    log::debug!("Trying to load audio track '{}' for book '{}'", track_id, book_id);
    
    match AudioRepository::find_data_by_id(db.as_ref(), &book_id, &track_id).await {
        Ok(Some((audio_data, href))) => {
            // Detect MIME type from extension
            let mime_type = detect_audio_mime_type(&href, &href);
            let data_url = create_data_url(&mime_type, &audio_data);
            log::info!("✓ Found audio track '{}' (href: '{}', {} bytes, type: {})", 
                track_id, href, audio_data.len(), mime_type);
            Ok(Some(data_url))
        }
        Ok(None) => {
            log::warn!("✗ Audio track not found in database: '{}' for book '{}'", track_id, book_id);
            Ok(None)
        }
        Err(e) => {
            log::warn!("Error querying audio track '{}': {}", track_id, e);
            Err(AppError::Store(e))
        }
    }
}

/// Load an audio track from database and return as raw bytes with MIME type
/// This is more efficient for large files as it avoids base64 encoding overhead
#[tauri::command]
pub async fn load_epub_audio_bytes(
    book_id: String,
    track_id: String,
    app: tauri::AppHandle,
) -> AppResult<Option<(Vec<u8>, String)>> {
    let db = get_db_connection(&app).await
        .map_err(|e| AppError::Store(e))?;
    
    log::debug!("Trying to load audio track bytes '{}' for book '{}'", track_id, book_id);
    
    match AudioRepository::find_data_by_id(db.as_ref(), &book_id, &track_id).await {
        Ok(Some((audio_data, href))) => {
            // Detect MIME type from extension
            let mime_type = detect_audio_mime_type(&href, &href);
            log::info!("✓ Found audio track bytes '{}' (href: '{}', {} bytes, type: {})", 
                track_id, href, audio_data.len(), mime_type);
            Ok(Some((audio_data, mime_type.to_string())))
        }
        Ok(None) => {
            log::warn!("✗ Audio track not found in database: '{}' for book '{}'", track_id, book_id);
            Ok(None)
        }
        Err(e) => {
            log::warn!("Error querying audio track '{}': {}", track_id, e);
            Err(AppError::Store(e))
        }
    }
}

/// Load chapter content as bytes (for blob URL creation)
/// Returns (bytes, mime_type) where bytes is the UTF-8 encoded HTML
#[tauri::command]
pub async fn load_epub_chapter_bytes(
    book_id: String,
    chapter_href: String,
    app: tauri::AppHandle,
) -> AppResult<Option<(Vec<u8>, String)>> {
    let db = get_db_connection(&app).await
        .map_err(|e| AppError::Store(e))?;
    
    // Try multiple variations of the chapter href to find a match
    let mut href_variations = Vec::new();
    
    // Add the exact href as-is
    href_variations.push(chapter_href.clone());
    
    // Try with/without leading slash
    if chapter_href.starts_with('/') {
        href_variations.push(chapter_href[1..].to_string());
    } else {
        href_variations.push(format!("/{}", chapter_href));
    }
    
    // Try OEBPS variations
    if !chapter_href.starts_with("OEBPS/") {
        href_variations.push(format!("OEBPS/{}", chapter_href.trim_start_matches('/')));
    }
    if chapter_href.starts_with("OEBPS/") {
        href_variations.push(chapter_href.trim_start_matches("OEBPS/").to_string());
    }
    
    // Remove duplicates while preserving order
    let mut seen = std::collections::HashSet::new();
    let mut unique_variations = Vec::new();
    for href in href_variations {
        if seen.insert(href.clone()) {
            unique_variations.push(href);
        }
    }
    
    log::debug!("Trying to load chapter bytes '{}' for book '{}' with {} variations", 
        chapter_href, book_id, unique_variations.len());
    
    // Try to get chapter from database with each variation
    for (idx, href) in unique_variations.iter().enumerate() {
        match ChapterRepository::find_by_href(db.as_ref(), &book_id, href).await {
            Ok(Some(chapter)) => {
                // Get the HTML content
                if let Some(content_html) = chapter.content_html {
                    // Process images in the HTML: resolve relative paths to data URLs
                    let processed_html = process_images_in_html(db.as_ref(), &book_id, &content_html, href).await?;
                    
                    // Convert HTML string to bytes (UTF-8)
                    let bytes = processed_html.into_bytes();
                    let mime_type = "text/html".to_string();
                    
                    log::info!("✓ Found chapter bytes with href variation #{}: '{}' (original: '{}', {} bytes)", 
                        idx + 1, href, chapter_href, bytes.len());
                    return Ok(Some((bytes, mime_type)));
                } else {
                    log::trace!("  Variation #{} '{}' found but has no content", idx + 1, href);
                }
            }
            Ok(None) => {
                log::trace!("  Variation #{} '{}' not found", idx + 1, href);
            }
            Err(e) => {
                log::warn!("Error querying chapter with href '{}': {}", href, e);
            }
        }
    }
    
    log::warn!("✗ Chapter not found in database: '{}' for book '{}' (tried {} variations: {:?})", 
        chapter_href, book_id, unique_variations.len(), unique_variations);
    
    // Chapter should already be in database from ingestion
    // If not found, return None
    Ok(None)
}

/// Read a single audio track by book ID and track ID
#[tauri::command]
pub async fn read_single_audio_track(
    book_id: String,
    track_id: String,
    app: tauri::AppHandle,
) -> AppResult<Option<AudioTrack>> {
    let db = get_db_connection(&app).await
        .map_err(|e| AppError::Store(e))?;
    let book = BookRepository::find_by_id(db.as_ref(), &book_id).await
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
    let db = get_db_connection(&app).await
        .map_err(|e| AppError::Store(e))?;
    
    // Delete the book from storage (CASCADE will delete related records)
    // All related data (chapters, images, audio tracks) will be automatically deleted
    BookRepository::delete(db.as_ref(), &book_id).await
        .map_err(|e| AppError::Store(e))?;
    
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
    
    // Set conversion status: if new book has audio tracks, mark as Done
    // Otherwise preserve existing conversion status
    if !merged.audio_tracks.is_empty() {
        merged.conversion_status = crate::book_service::models::ConversionStatus::Done;
    } else {
        merged.conversion_status = existing_book.conversion_status;
    }
    merged.completed_chapters = existing_book.completed_chapters.clone();
    merged.voice_id = existing_book.voice_id.clone();
    merged.total_words = existing_book.total_words;
    merged.words_processed = existing_book.words_processed;
    
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
    let db = get_db_connection(&app).await
        .map_err(|e| AppError::Store(e))?;
    
    // Add the book directly without checking for duplicates
    log::debug!("Adding new book: ID={}, title='{}'", book.id, book.title);
    BookRepository::save(db.as_ref(), &book).await
        .map_err(|e| AppError::Store(e))?;
    
    // EPUB data is no longer stored separately - all content is in structured tables
    // The epub_data parameter is kept for API compatibility but not used
    let _ = epub_data;
    
    Ok(book)
}
/// Get EPUB buffer for a book
/// Note: EPUB buffer is no longer stored separately - all content is in structured tables
/// This function is kept for API compatibility but returns None
#[tauri::command]
pub async fn get_epub_buffer(
    source_path: String,
    app: tauri::AppHandle,
) -> AppResult<Option<Vec<u8>>> {
    use repositories::EpubRepository;
    let db = get_db_connection(&app).await
        .map_err(|e| AppError::Store(e))?;
    EpubRepository::find_by_source_path(db.as_ref(), &source_path).await
        .map_err(|e| AppError::Store(e))
}

/// Export EPUB file directly to disk (optimized for large files)
/// This avoids the overhead of serializing large binary data through Tauri IPC
#[tauri::command]
pub async fn export_epub_to_file(
    book_id: String,
    output_path: String,
    app: tauri::AppHandle,
) -> AppResult<()> {
    use repositories::EpubRepository;
    use std::fs::File;
    use std::io::Write;
    
    let db = get_db_connection(&app).await
        .map_err(|e| AppError::Store(e))?;
    
    // Get EPUB data from database by book_id
    let epub_data = EpubRepository::find_by_book_id(db.as_ref(), &book_id).await
        .map_err(|e| AppError::Store(e))?
        .ok_or_else(|| AppError::Store("EPUB not found in store".to_string()))?;
    
    // Write directly to file in chunks to avoid loading entire file into memory
    // For very large files, we still need to load from DB, but we can write in chunks
    const CHUNK_SIZE: usize = 1024 * 1024; // 1MB chunks
    
    let mut file = File::create(&output_path)
        .map_err(|e| AppError::Store(format!("Failed to create output file: {}", e)))?;
    
    // Write in chunks to avoid blocking
    for chunk in epub_data.chunks(CHUNK_SIZE) {
        file.write_all(chunk)
            .map_err(|e| AppError::Store(format!("Failed to write to file: {}", e)))?;
    }
    
    file.sync_all()
        .map_err(|e| AppError::Store(format!("Failed to sync file: {}", e)))?;
    
    Ok(())
}


/// Update book progress
/// Uses lightweight update_progress_only instead of full save to avoid expensive
/// chapter deletion/re-insertion and audio track re-saving
/// Optimized: Returns from hybrid store if available, avoiding expensive re-fetch
#[tauri::command]
pub async fn update_book_progress(
    book_id: String,
    progress: BookProgress,
    app: tauri::AppHandle,
) -> AppResult<Book> {
    let db = get_db_connection(&app).await
        .map_err(|e| AppError::Store(e))?;
    
    // Use lightweight progress-only update (doesn't touch chapters/audio tracks)
    BookRepository::update_progress_only(db.as_ref(), &book_id, &progress).await
        .map_err(|e| AppError::Store(e))?;
    
    // Re-fetch updated book
    let book = BookRepository::find_by_id(db.as_ref(), &book_id).await
        .map_err(|e| AppError::Store(e))?
        .ok_or_else(|| AppError::Store(format!("Book not found: {}", book_id)))?;
    
    Ok(book)
}

/// Update book audio state
/// Uses lightweight update_audio_state_only instead of full save to avoid expensive
/// chapter deletion/re-insertion and audio track re-saving
/// Optimized: Returns from hybrid store if available, avoiding expensive re-fetch
#[tauri::command]
pub async fn update_book_audio_state(
    book_id: String,
    audio_state: BookAudioState,
    app: tauri::AppHandle,
) -> AppResult<Book> {
    let db = get_db_connection(&app).await
        .map_err(|e| AppError::Store(e))?;
    
    // Use lightweight audio-state-only update (doesn't touch chapters/audio tracks)
    BookRepository::update_audio_state_only(db.as_ref(), &book_id, &audio_state).await
        .map_err(|e| AppError::Store(e))?;
    
    // Re-fetch updated book
    let book = BookRepository::find_by_id(db.as_ref(), &book_id).await
        .map_err(|e| AppError::Store(e))?
        .ok_or_else(|| AppError::Store(format!("Book not found: {}", book_id)))?;
    
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

    // Read EPUB from file system
    // Normalize path (remove file:// prefix and decode URL-encoded characters)
    // This is important on iOS where file picker returns URL-encoded paths
    use crate::utils::path_resolver::ResourcePathResolver;
    let actual_path = ResourcePathResolver::normalize_file_path(&epub_path);
    
    log::info!("Reading EPUB from file system: {}", actual_path);
    let epub_data = fs::read(&actual_path)
        .map_err(|e| AppError::Io(e).with_context(format!("Failed to read EPUB file from path '{}'", actual_path)))?;
    
    // Validate EPUB file size
    validate_file_size(epub_data.len(), MAX_EPUB_SIZE, "EPUB")?;
    
    // Validate EPUB signature (should start with PK for ZIP)
    if epub_data.len() < 4 || &epub_data[0..4] != b"PK\x03\x04" {
        return Err(AppError::EpubParse("Invalid EPUB file: not a valid ZIP archive".to_string()));
    }
    
    // Wrap EPUB data in Arc to avoid multiple clones (saves significant memory)
    use std::sync::Arc;
    let epub_data_arc = Arc::new(epub_data);
    
    // Parse EPUB in a blocking task
    let epub_data_clone = Arc::clone(&epub_data_arc);
    let (chapters, _stats) = tokio::task::spawn_blocking(move || {
        extract_chapters_from_epub(epub_data_clone.as_slice())
    })
    .await
    .map_err(|e| AppError::EpubParse(format!("Failed to parse EPUB: {}", e)))?
    .map_err(|e| AppError::EpubParse(e))?;
    
    if chapters.is_empty() {
        return Err(AppError::EpubParse("No readable chapters found in EPUB".to_string()));
    }
    
    // Extract metadata and parse OPF to get media-overlay attributes
    // We need to parse the OPF directly to get media-overlay attributes which are required
    // for matching audio tracks to chapters via the media-overlay chain
    let epub_data_for_metadata = Arc::clone(&epub_data_arc);
    let (metadata, manifest_items, spine_items, opf_path) = tokio::task::spawn_blocking(move || {
        use std::io::{Cursor, Read};
        use zip::ZipArchive;
        use crate::epub::parser::{find_opf_path, parse_opf_content};
        
        // Open EPUB as ZIP to read OPF
        let epub_slice: &[u8] = epub_data_for_metadata.as_slice();
        let mut archive = ZipArchive::new(Cursor::new(epub_slice))
            .map_err(|e| format!("Failed to open EPUB archive: {}", e))?;
        
        // Find OPF path
        let opf_path = find_opf_path(&mut archive)
            .map_err(|e| format!("Failed to find OPF path: {}", e))?;
        
        // Read OPF content
        let mut opf_file = archive.by_name(&opf_path)
            .map_err(|e| format!("Failed to open OPF file: {}", e))?;
        let mut opf_content = String::new();
        opf_file.read_to_string(&mut opf_content)
            .map_err(|e| format!("Failed to read OPF content: {}", e))?;
        
        // Parse OPF to get metadata, manifest (with media-overlay), and spine
        let (metadata, manifest_items, spine_items) = parse_opf_content(&opf_content)
            .map_err(|e| format!("Failed to parse OPF content: {}", e))?;
        
        Ok((metadata, manifest_items, spine_items, opf_path))
    })
    .await
    .map_err(|e| AppError::EpubParse(format!("Failed to extract metadata: {}", e)))?
    .map_err(|e| AppError::EpubParse(e).with_context("Failed to extract EPUB metadata"))?;
    
    // Find cover image href
    let cover_href = find_cover_image(metadata.cover_id.as_ref(), &manifest_items);
    
    // Extract cover image as data URL if found
    let cover_url = if let Some(href) = cover_href {
        let epub_data_for_cover = Arc::clone(&epub_data_arc);
        let opf_path_for_cover = opf_path.clone();
        tokio::task::spawn_blocking(move || {
            crate::epub::parser::extract_cover_image_as_data_url(
                epub_data_for_cover.as_slice(),
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
    
    // Extract audio tracks from spine in order (ensures tracks match chapter order)
    use crate::epub::parser::extract_audio_tracks_from_spine;
    
    // Log spine items to verify order
    log::info!("🔍 DEBUG: Spine items order ({} items):", spine_items.len());
    for (idx, (idref, href)) in spine_items.iter().enumerate() {
        log::info!("  Spine #{}: idref='{}', href='{}'", idx, idref, href);
    }
    
    let mut audio_tracks = extract_audio_tracks_from_spine(&spine_items, &manifest_items);
    
    // Log extracted tracks to verify order
    log::info!("🔍 DEBUG: Extracted audio tracks from spine ({} tracks):", audio_tracks.len());
    for (idx, track) in audio_tracks.iter().enumerate() {
        log::info!("  Track #{}: href='{}', order={}", idx, track.href, track.order);
    }
    
    // Audio tracks are already in spine order with correct sequential ordering (0, 1, 2, ...)
    // from extract_audio_tracks_from_spine. We don't need to reorder them since they're
    // already in the correct order. The order_audio_tracks_by_chapters function would
    // reorder them based on chapter order (which might be NCX order, not spine order),
    // so we skip it to preserve the spine order.
    // Note: Tracks are already matched to chapters via the media-overlay chain in extract_audio_tracks_from_spine
    log::info!("Audio tracks already in spine order ({} tracks)", audio_tracks.len());
    
    // Compute durations for audio tracks
    if !audio_tracks.is_empty() {
        let epub_data_for_durations = Arc::clone(&epub_data_arc);
        let opf_path_for_durations = opf_path.clone();
        let audio_tracks_clone = audio_tracks.clone();
        audio_tracks = match tokio::task::spawn_blocking(move || {
            use crate::epub::parser::compute_audio_track_durations;
            let mut tracks = audio_tracks_clone;
            compute_audio_track_durations(
                epub_data_for_durations.as_slice(),
                &mut tracks,
                &opf_path_for_durations,
            );
            // Ensure tracks remain sorted by order after computing durations
            tracks.sort_by_key(|t| t.order);
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
        let epub_data_for_smil = Arc::clone(&epub_data_arc);
        let chapters_for_smil = chapters.clone();
        tokio::task::spawn_blocking(move || {
            use std::io::Cursor;
            use zip::ZipArchive;
            use crate::epub::converter::smil::build_audio_sync_map;
            
            let epub_slice = epub_data_for_smil.as_slice();
            let mut archive = ZipArchive::new(Cursor::new(epub_slice))
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
    
    // Determine conversion status: if book already has audio tracks, mark as Done
    let conversion_status = if !audio_tracks.is_empty() {
        crate::book_service::models::ConversionStatus::Done
    } else {
        crate::book_service::models::ConversionStatus::NotStarted
    };
    
    // Extract all content during ingestion
    log::info!("Extracting chapter content, images, and audio during ingestion...");
    
    // Extract chapter content HTML for all chapters
    let epub_data_for_content = Arc::clone(&epub_data_arc);
    let chapters_for_content = chapters.clone();
    let opf_path_for_content = opf_path.clone();
    let chapters_with_content = tokio::task::spawn_blocking(move || {
        use std::io::{Cursor, Read};
        use zip::ZipArchive;
        use crate::epub::parser::derive_base_path_from_opf;
        use crate::utils::path_validation::validate_epub_path;
        use log::warn;
        
        let epub_slice: &[u8] = epub_data_for_content.as_slice();
        let mut archive = ZipArchive::new(Cursor::new(epub_slice))
            .map_err(|e| format!("Failed to open EPUB: {}", e))?;
        
        let base_path = derive_base_path_from_opf(&opf_path_for_content);
        
        let mut updated_chapters = Vec::new();
        for mut chapter in chapters_for_content {
            // Resolve chapter path
            let validated_href = validate_epub_path(&chapter.href)
                .map_err(|e| format!("Invalid chapter path: {}", e))?;
            
            let chapter_path = if validated_href.starts_with("/") {
                validated_href[1..].to_string()
            } else if !base_path.is_empty() && validated_href.starts_with(&base_path) {
                validated_href.to_string()
            } else {
                format!("{}{}", base_path, validated_href)
            };
            
            // Try to read chapter content
            let mut found_content = false;
            let paths_to_try = vec![
                chapter_path.clone(),
                validated_href.clone(),
                validated_href.trim_start_matches('/').to_string(),
                format!("{}{}", base_path, validated_href.trim_start_matches('/')),
            ];
            
            for path in paths_to_try {
                if let Ok(mut file) = archive.by_name(&path) {
                    let mut content = String::new();
                    if file.read_to_string(&mut content).is_ok() {
                        chapter.content_html = Some(content);
                        found_content = true;
                        break;
                    }
                }
            }
            
            if !found_content {
                warn!("Could not find chapter content for: {}", chapter.href);
            }
            
            updated_chapters.push(chapter);
        }
        
        Ok::<Vec<Chapter>, String>(updated_chapters)
    })
    .await
    .map_err(|e| AppError::EpubParse(format!("Failed to extract chapter content: {}", e)))?
    .map_err(|e| AppError::EpubParse(e))?;
    
    // Extract all images from chapters and store them
    let epub_data_for_images = Arc::clone(&epub_data_arc);
    let chapters_for_images = chapters_with_content.clone();
    let opf_path_for_images = opf_path.clone();
    let images_extracted = tokio::task::spawn_blocking(move || {
        use std::io::{Cursor, Read};
        use zip::ZipArchive;
        use crate::epub::parser::derive_base_path_from_opf;
        use scraper::{Html, Selector};
        use log::debug;
        
        let epub_slice: &[u8] = epub_data_for_images.as_slice();
        let mut archive = ZipArchive::new(Cursor::new(epub_slice))
            .map_err(|e| format!("Failed to open EPUB: {}", e))?;
        
        let base_path = derive_base_path_from_opf(&opf_path_for_images);
        let mut images_to_store = Vec::new();
        
        // Collect all image hrefs from chapter HTML
        let mut total_images_found = 0;
        let mut total_images_extracted = 0;
        
        for chapter in &chapters_for_images {
            if let Some(ref html) = chapter.content_html {
                let document = Html::parse_document(html);
                let img_selector = Selector::parse("img").unwrap();
                
                for img in document.select(&img_selector) {
                    if let Some(src) = img.value().attr("src") {
                        total_images_found += 1;
                        
                        // Skip data URLs and absolute URLs
                        if src.starts_with("data:") || src.starts_with("http://") || src.starts_with("https://") {
                            debug!("Skipping data/absolute URL image: {}", src);
                            continue;
                        }
                        
                        // Resolve image path relative to chapter
                        let image_path = resolve_image_path_for_storage_simple(src, Some(&chapter.href), &base_path);
                        debug!("Resolved image path: '{}' -> '{}' (chapter: '{}', base: '{}')", 
                            src, image_path, chapter.href, base_path);
                        
                        // Try multiple path variations
                        let paths_to_try = vec![
                            image_path.clone(),
                            format!("{}{}", base_path, src),
                            src.to_string(),
                            if src.starts_with("/") { src[1..].to_string() } else { src.to_string() },
                        ];
                        
                        let mut found = false;
                        for path_to_try in &paths_to_try {
                            if let Ok(mut file) = archive.by_name(path_to_try) {
                                let mut image_data = Vec::new();
                                if file.read_to_end(&mut image_data).is_ok() && !image_data.is_empty() {
                                    let image_len = image_data.len();
                                    // Detect MIME type
                                    let mime_type = detect_image_mime_type_storage(path_to_try, src, &image_data);
                                    images_to_store.push((src.to_string(), mime_type, image_data));
                                    debug!("Extracted image: {} -> {} ({} bytes)", src, path_to_try, image_len);
                                    total_images_extracted += 1;
                                    found = true;
                                    break;
                                }
                            }
                        }
                        
                        if !found {
                            debug!("Could not find image in archive: '{}' (tried: {:?})", src, paths_to_try);
                        }
                    }
                }
            } else {
                debug!("Chapter '{}' has no content_html", chapter.href);
            }
        }
        
        debug!("Image extraction summary: found {} images, extracted {}", total_images_found, total_images_extracted);
        
        Ok::<Vec<(String, String, Vec<u8>)>, String>(images_to_store)
    })
    .await
    .map_err(|e| AppError::EpubParse(format!("Failed to extract images: {}", e)))?
    .map_err(|e| AppError::EpubParse(e))?;
    
    // Extract audio track data
    let epub_data_for_audio = Arc::clone(&epub_data_arc);
    let audio_tracks_for_extraction = audio_tracks.clone();
    let opf_path_for_audio = opf_path.clone();
    let audio_extracted = tokio::task::spawn_blocking(move || {
        use std::io::{Cursor, Read};
        use zip::ZipArchive;
        use crate::epub::parser::derive_base_path_from_opf;
        use log::{debug, warn};
        
        let epub_slice: &[u8] = epub_data_for_audio.as_slice();
        let mut archive = ZipArchive::new(Cursor::new(epub_slice))
            .map_err(|e| format!("Failed to open EPUB: {}", e))?;
        
        let base_path = derive_base_path_from_opf(&opf_path_for_audio);
        let mut audio_to_store = Vec::new();
        let mut total_audio_found = 0;
        let mut total_audio_extracted = 0;
        
        debug!("Extracting audio tracks (base_path: '{}', tracks: {})", base_path, audio_tracks_for_extraction.len());
        
        for track in &audio_tracks_for_extraction {
            total_audio_found += 1;
            
            // Resolve audio path - try multiple variations like we do for images
            let audio_path_primary = if track.href.starts_with("/") {
                track.href[1..].to_string()
            } else {
                format!("{}{}", base_path, track.href)
            };
            
            // Try multiple path variations
            let paths_to_try = vec![
                audio_path_primary.clone(),
                track.href.clone(),
                if track.href.starts_with("/") { track.href[1..].to_string() } else { track.href.clone() },
                format!("{}{}", base_path, if track.href.starts_with("/") { &track.href[1..] } else { &track.href }),
            ];
            
            debug!("Trying to extract audio track: '{}' (trying {} path variations)", track.href, paths_to_try.len());
            
            let mut found = false;
            for path_to_try in &paths_to_try {
                if let Ok(mut file) = archive.by_name(path_to_try) {
                    let mut audio_data = Vec::new();
                    if file.read_to_end(&mut audio_data).is_ok() && !audio_data.is_empty() {
                        let audio_len = audio_data.len();
                        audio_to_store.push((track.href.clone(), audio_data));
                        debug!("✓ Extracted audio track: {} -> {} ({} bytes)", track.href, path_to_try, audio_len);
                        total_audio_extracted += 1;
                        found = true;
                        break;
                    }
                }
            }
            
            if !found {
                warn!("✗ Could not find audio track in archive: '{}' (tried: {:?}, base_path: '{}')", 
                    track.href, paths_to_try, base_path);
            }
        }
        
        debug!("Audio extraction summary: found {} tracks, extracted {}", total_audio_found, total_audio_extracted);
        
        Ok::<Vec<(String, Vec<u8>)>, String>(audio_to_store)
    })
    .await
    .map_err(|e| AppError::EpubParse(format!("Failed to extract audio: {}", e)))?
    .map_err(|e| AppError::EpubParse(e))?;
    
    // Ensure audio tracks are sorted by order before creating Book
    audio_tracks.sort_by_key(|t| t.order);
    
    // Log track order before creating Book to verify correct ordering
    log::info!("Audio tracks before creating Book (sorted by order):");
    for (idx, track) in audio_tracks.iter().enumerate() {
        log::info!("  Track #{}: href='{}', order={}", idx, track.href, track.order);
    }
    
    // Create Book object with chapters that have content
    let book = Book {
        id: book_id.clone(),
        title,
        author: metadata.creator.unwrap_or_else(|| "Unknown author".to_string()),
        chapters: chapters_with_content,
        cover_url,
        source_path: source_path.clone(),
        publisher: metadata.publisher,
        published_year,
        subjects: if metadata.subjects.is_empty() {
            None
        } else {
            Some(metadata.subjects)
        },
        file_size_bytes: Some(epub_data_arc.len()),
        audio_tracks,
        audio_state: None,
        audio_sync_map,
        progress: None,
        page_count: None,
        conversion_status,
        completed_chapters: Vec::new(),
        voice_id: None,
        total_words: None,
        words_processed: None,
        last_opened_time: None,
    };
    
    let db = get_db_connection(&app).await
        .map_err(|e| AppError::Store(e))?;
    
    // Store book (this will store chapters with content_html)
    // Note: This will delete existing images/audio if updating, so we save them after
    BookRepository::save(db.as_ref(), &book).await
        .map_err(|e| AppError::Store(e))?;
    
    // Store original EPUB data in database
    use repositories::EpubRepository;
    log::info!("Storing original EPUB data ({} bytes)...", epub_data_arc.len());
    if let Err(e) = EpubRepository::save(db.as_ref(), &source_path, &book_id, epub_data_arc.as_slice()).await {
        log::error!("Failed to store original EPUB data: {}", e);
        // Don't fail ingestion if EPUB storage fails, but log it
    } else {
        log::debug!("Successfully stored original EPUB data ({} bytes)", epub_data_arc.len());
    }
    
    // Store all images AFTER book save (since book save deletes them first)
    log::info!("Storing {} images...", images_extracted.len());
    if images_extracted.is_empty() {
        log::warn!("No images were extracted during ingestion! This might indicate an issue with image extraction.");
    }
    for (image_href, mime_type, image_data) in images_extracted {
        match ImageRepository::save(db.as_ref(), &book_id, &image_href, &mime_type, &image_data).await {
            Ok(()) => {
                log::info!("Successfully stored image: {} ({} bytes, {})", image_href, image_data.len(), mime_type);
            }
            Err(e) => {
                log::error!("Failed to store image {}: {}", image_href, e);
            }
        }
    }
    
    // Process chapter HTML to resolve images to data URLs
    // Reload chapters from database since chapters_with_content was moved into Book
    log::info!("Resolving images in chapter HTML content...");
    let chapters_to_process = ChapterRepository::find_by_book_id(db.as_ref(), &book_id).await
        .map_err(|e| AppError::Store(format!("Failed to reload chapters for image processing: {}", e)))?;
    
    for chapter in &chapters_to_process {
        if let Some(ref content_html) = chapter.content_html {
            match process_images_in_html(db.as_ref(), &book_id, content_html, &chapter.href).await {
                Ok(processed_html) => {
                    // Only update if HTML was actually changed
                    if processed_html != *content_html {
                        log::debug!("Updating chapter '{}' with resolved images ({} -> {} bytes)", 
                            chapter.href, content_html.len(), processed_html.len());
                        if let Err(e) = ChapterRepository::update_content(db.as_ref(), &book_id, &chapter.id, &processed_html, None).await {
                            log::error!("Failed to update chapter '{}' with resolved images: {}", chapter.href, e);
                        } else {
                            log::debug!("Successfully updated chapter '{}' with resolved images", chapter.href);
                        }
                    } else {
                        log::debug!("Chapter '{}' HTML unchanged (no images to resolve)", chapter.href);
                    }
                }
                Err(e) => {
                    log::warn!("Failed to process images in chapter '{}': {}", chapter.href, e);
                }
            }
        }
    }
    
    // Store all audio track data AFTER book save (since book save deletes them first)
    log::info!("Storing {} audio tracks...", audio_extracted.len());
    if audio_extracted.is_empty() {
        log::warn!("No audio tracks were extracted during ingestion! This might indicate an issue with audio extraction.");
    }
    for (audio_href, audio_data) in audio_extracted {
        log::info!("Storing audio track: {} ({} bytes)", audio_href, audio_data.len());
        match AudioRepository::save_data(db.as_ref(), &book_id, &audio_href, &audio_data).await {
            Ok(()) => {
                log::info!("✓ Successfully stored audio track data: {} ({} bytes)", audio_href, audio_data.len());
            }
            Err(e) => {
                log::error!("✗ Failed to store audio track {} ({} bytes): {}", audio_href, audio_data.len(), e);
                // Check if audio track metadata exists
                if let Ok(tracks) = AudioRepository::find_by_book_id(db.as_ref(), &book_id).await {
                    if tracks.iter().any(|t| t.href == audio_href) {
                        log::warn!("Audio track metadata exists but data save failed. Track href: {}", audio_href);
                    } else {
                        log::warn!("Audio track not found in database. Track href: {}, Available tracks: {:?}", 
                            audio_href, tracks.iter().map(|t| &t.href).collect::<Vec<_>>());
                    }
                }
            }
        }
    }
    
    // Reload book to get the complete data
    let result_book = BookRepository::find_by_id(db.as_ref(), &book_id).await
        .map_err(|e| AppError::Store(e))?
        .ok_or_else(|| AppError::Store("Book not found after ingestion".to_string()))?;
    
    Ok(result_book)
}

/// Get app settings
#[tauri::command]
pub async fn get_app_settings(
    app: tauri::AppHandle,
) -> AppResult<AppSettings> {
    let db = get_db_connection(&app).await
        .map_err(|e| AppError::Store(e))?;
    SettingsRepository::get(db.as_ref()).await
        .map_err(|e| AppError::Store(e))
}

/// Update app settings
#[tauri::command]
pub async fn update_app_settings(
    settings: AppSettings,
    app: tauri::AppHandle,
) -> AppResult<AppSettings> {
    let db = get_db_connection(&app).await
        .map_err(|e| AppError::Store(e))?;
    SettingsRepository::save(db.as_ref(), &settings).await
        .map_err(|e| AppError::Store(e))?;
    Ok(settings)
}

/// Get reader preferences
#[tauri::command]
pub async fn get_reader_preferences(
    app: tauri::AppHandle,
) -> AppResult<ReaderPreferences> {
    let db = get_db_connection(&app).await
        .map_err(|e| AppError::Store(e))?;
    ReaderPreferencesRepository::get(db.as_ref()).await
        .map_err(|e| AppError::Store(e))
}

/// Update reader preferences
#[tauri::command]
pub async fn update_reader_preferences(
    preferences: ReaderPreferences,
    app: tauri::AppHandle,
) -> AppResult<ReaderPreferences> {
    let db = get_db_connection(&app).await
        .map_err(|e| AppError::Store(e))?;
    ReaderPreferencesRepository::save(db.as_ref(), &preferences).await
        .map_err(|e| AppError::Store(e))?;
    Ok(preferences)
}

/// Update book last opened time
#[tauri::command]
pub async fn update_book_last_opened_time(
    book_id: String,
    app: tauri::AppHandle,
) -> AppResult<()> {
    use std::time::{SystemTime, UNIX_EPOCH};
    let db = get_db_connection(&app).await
        .map_err(|e| AppError::Store(e))?;
    
    // Get current timestamp as RFC3339 string
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
        .to_string();
    
    // Update only the last_opened_time field
    sqlx::query("UPDATE books SET last_opened_time = ? WHERE id = ?")
        .bind(&timestamp)
        .bind(&book_id)
        .execute(db.as_ref())
        .await
        .map_err(|e| AppError::Store(format!("Failed to update last_opened_time: {}", e)))?;
    
    
    Ok(())
}

