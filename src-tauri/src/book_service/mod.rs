pub mod models;
pub mod filters;
pub mod database;
pub mod repositories;
pub mod audio_stream;
pub mod epub_file_storage;
pub mod mp3_export;

pub use models::*;
use filters::*;
use database::get_db_connection;
use repositories::*;
use crate::utils::errors::{AppError, AppResult};
use crate::utils::constants::MAX_EPUB_SIZE;
use crate::utils::path_validation::validate_file_size;
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use tauri::{Emitter, Manager};

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct M4bExportProgress {
    book_id: String,
    current_step: String,
    message: String,
    processed_tracks: usize,
    total_tracks: usize,
    percent: u8,
    eta_ms: Option<u64>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct M4bExportStatus {
    in_progress: bool,
    book_id: Option<String>,
}

static ACTIVE_M4B_EXPORT_PIDS: OnceLock<Mutex<HashSet<u32>>> = OnceLock::new();
static M4B_EXPORT_IN_PROGRESS: AtomicBool = AtomicBool::new(false);
static ACTIVE_M4B_EXPORT_BOOK_ID: OnceLock<Mutex<Option<String>>> = OnceLock::new();

fn active_m4b_export_pids() -> &'static Mutex<HashSet<u32>> {
    ACTIVE_M4B_EXPORT_PIDS.get_or_init(|| Mutex::new(HashSet::new()))
}

fn active_m4b_export_book_id() -> &'static Mutex<Option<String>> {
    ACTIVE_M4B_EXPORT_BOOK_ID.get_or_init(|| Mutex::new(None))
}

fn set_active_m4b_export_book_id(book_id: Option<String>) {
    if let Ok(mut guard) = active_m4b_export_book_id().lock() {
        *guard = book_id;
    }
}

#[tauri::command]
pub async fn get_m4b_export_status() -> AppResult<M4bExportStatus> {
    #[cfg(target_os = "ios")]
    {
        return Ok(M4bExportStatus {
            in_progress: false,
            book_id: None,
        });
    }

    let in_progress = M4B_EXPORT_IN_PROGRESS.load(Ordering::Acquire);
    let book_id = if let Ok(guard) = active_m4b_export_book_id().lock() {
        guard.clone()
    } else {
        None
    };

    Ok(M4bExportStatus {
        in_progress,
        book_id,
    })
}

fn register_m4b_export_pid(pid: u32) {
    if let Ok(mut guard) = active_m4b_export_pids().lock() {
        guard.insert(pid);
    }
}

fn unregister_m4b_export_pid(pid: u32) {
    if let Ok(mut guard) = active_m4b_export_pids().lock() {
        guard.remove(&pid);
    }
}

pub fn terminate_active_m4b_exports() {
    let pids: Vec<u32> = if let Ok(guard) = active_m4b_export_pids().lock() {
        guard.iter().copied().collect()
    } else {
        Vec::new()
    };

    for pid in pids {
        let pid_str = pid.to_string();
        match std::process::Command::new("kill")
            .arg("-TERM")
            .arg(&pid_str)
            .status()
        {
            Ok(status) if status.success() => {
                log::info!("Sent SIGTERM to active M4B export ffmpeg process pid={}", pid);
            }
            Ok(status) => {
                log::warn!(
                    "Failed to terminate M4B export ffmpeg process pid={} (status={:?})",
                    pid,
                    status.code()
                );
            }
            Err(e) => {
                log::warn!(
                    "Failed to execute kill for M4B export ffmpeg process pid={}: {}",
                    pid,
                    e
                );
            }
        }
    }
}

#[tauri::command]
pub async fn cancel_m4b_export(app: tauri::AppHandle) -> AppResult<bool> {
    #[cfg(target_os = "ios")]
    {
        let _ = app;
        return Ok(false);
    }

    let in_progress = M4B_EXPORT_IN_PROGRESS.load(Ordering::Acquire);
    if !in_progress {
        return Ok(false);
    }

    let active_book_id = if let Ok(guard) = active_m4b_export_book_id().lock() {
        guard.clone()
    } else {
        None
    };

    let pids: Vec<u32> = if let Ok(guard) = active_m4b_export_pids().lock() {
        guard.iter().copied().collect()
    } else {
        Vec::new()
    };

    let mut killed_any = false;
    for pid in pids {
        let pid_str = pid.to_string();
        match std::process::Command::new("kill")
            .arg("-TERM")
            .arg(&pid_str)
            .status()
        {
            Ok(status) if status.success() => {
                killed_any = true;
                log::info!("Sent SIGTERM to cancel M4B export ffmpeg process pid={}", pid);
            }
            Ok(status) => {
                log::warn!(
                    "Failed to cancel M4B export ffmpeg process pid={} (status={:?})",
                    pid,
                    status.code()
                );
            }
            Err(e) => {
                log::warn!(
                    "Failed to execute kill for cancelling M4B export ffmpeg process pid={}: {}",
                    pid,
                    e
                );
            }
        }
    }

    if killed_any {
        let _ = app.emit(
            "m4b-export-progress",
            M4bExportProgress {
                book_id: active_book_id.unwrap_or_default(),
                current_step: "cancelled".to_string(),
                message: "M4B export cancelled".to_string(),
                processed_tracks: 0,
                total_tracks: 0,
                percent: 0,
                eta_ms: Some(0),
            },
        );
    }

    Ok(killed_any)
}

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
    use crate::epub::parser::{find_opf_path, derive_base_path_from_opf};
    
    let mut archive = ZipArchive::new(Cursor::new(epub_data))
        .map_err(|e| format!("Failed to open EPUB: {}", e))?;
    
    let chapter_path = resolve_chapter_path(&mut archive, chapter_href)?;
    let opf_path = find_opf_path(&mut archive)?;
    let base_path = derive_base_path_from_opf(&opf_path);

    let paths_to_try = vec![
        chapter_path,
        chapter_href.to_string(),
        chapter_href.trim_start_matches('/').to_string(),
        format!("{}{}", base_path, chapter_href.trim_start_matches('/')),
    ];

    for path in &paths_to_try {
        if let Ok(mut file) = archive.by_name(path) {
            let mut content = String::new();
            if file.read_to_string(&mut content).is_ok() {
                return Ok(content);
            }
        }
    }

    let suffix = chapter_href.trim_start_matches('/').to_ascii_lowercase();
    if !suffix.is_empty() {
        for idx in 0..archive.len() {
            if let Ok(mut file) = archive.by_index(idx) {
                let name = file.name().to_ascii_lowercase();
                if name.ends_with(&suffix) || name.ends_with(&format!("/{}", suffix)) {
                    let mut content = String::new();
                    if file.read_to_string(&mut content).is_ok() {
                        return Ok(content);
                    }
                }
            }
        }
    }

    Err(format!(
        "Failed to find chapter content for '{}' (tried {:?})",
        chapter_href, paths_to_try
    ))
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

fn build_href_variations(chapter_href: &str) -> Vec<String> {
    let mut href_variations = Vec::new();

    href_variations.push(chapter_href.to_string());

    if chapter_href.starts_with('/') {
        href_variations.push(chapter_href[1..].to_string());
    } else {
        href_variations.push(format!("/{}", chapter_href));
    }

    if !chapter_href.starts_with("OEBPS/") {
        href_variations.push(format!("OEBPS/{}", chapter_href.trim_start_matches('/')));
    }
    if chapter_href.starts_with("OEBPS/") {
        href_variations.push(chapter_href.trim_start_matches("OEBPS/").to_string());
    }

    let mut seen = std::collections::HashSet::new();
    let mut unique_variations = Vec::new();
    for href in href_variations {
        if seen.insert(href.clone()) {
            unique_variations.push(href);
        }
    }

    unique_variations
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
    
    // Resolve chapter metadata from DB using href variations.
    let href_variations = build_href_variations(&chapter_href);
    let mut chapter: Option<Chapter> = None;
    for href in &href_variations {
        if let Some(found) = ChapterRepository::find_by_href(db.as_ref(), &book_id, href)
            .await
            .map_err(AppError::Store)?
        {
            chapter = Some(found);
            break;
        }
    }
    let mut chapter = match chapter {
        Some(ch) => ch,
        None => return Ok(None),
    };

    // Load chapter HTML directly from canonical EPUB.
    let epub_data = EpubRepository::find_by_book_id(db.as_ref(), &book_id)
        .await
        .map_err(AppError::Store)?
        .ok_or_else(|| AppError::Store(format!("No EPUB data found for book {}", book_id)))?;

    let content_html = extract_chapter_content_from_archive(&epub_data, &chapter.href)
        .or_else(|_| extract_chapter_content_from_archive(&epub_data, &chapter_href))
        .map_err(AppError::EpubParse)?;

    // Resolve inline image/audio references against EPUB resources.
    let processed_html = process_images_in_html(&app, db.as_ref(), &book_id, &content_html, &chapter.href).await?;
    
    // Update chapter with processed HTML
    chapter.content_html = Some(processed_html);
    
    Ok(Some(chapter))
}

/// Process embedded resources in chapter HTML by rewriting refs to local EPUB resource URLs.
async fn process_images_in_html(
    app: &tauri::AppHandle,
    _db: &sqlx::SqlitePool,
    book_id: &str,
    html: &str,
    chapter_href: &str,
) -> Result<String, AppError> {
    use regex::Regex;
    
    // Use regex extraction because some EPUB XHTML/SVG namespace combinations are not
    // consistently exposed by CSS selectors.
    let img_src_re = Regex::new(r#"(?is)<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']"#)
        .map_err(|e| AppError::EpubParse(format!("Failed to compile img src regex: {}", e)))?;
    let svg_image_href_re = Regex::new(
        r#"(?is)<image\b[^>]*?\b(xlink:href|href)\s*=\s*["']([^"']+)["']"#,
    )
    .map_err(|e| AppError::EpubParse(format!("Failed to compile svg image href regex: {}", e)))?;
    let audio_src_re = Regex::new(r#"(?is)<audio\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']"#)
        .map_err(|e| AppError::EpubParse(format!("Failed to compile audio src regex: {}", e)))?;
    let source_src_re = Regex::new(r#"(?is)<source\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']"#)
        .map_err(|e| AppError::EpubParse(format!("Failed to compile source src regex: {}", e)))?;
    let video_src_re = Regex::new(r#"(?is)<video\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']"#)
        .map_err(|e| AppError::EpubParse(format!("Failed to compile video src regex: {}", e)))?;
    let video_poster_re = Regex::new(r#"(?is)<video\b[^>]*?\bposter\s*=\s*["']([^"']+)["']"#)
        .map_err(|e| AppError::EpubParse(format!("Failed to compile video poster regex: {}", e)))?;
    let track_src_re = Regex::new(r#"(?is)<track\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']"#)
        .map_err(|e| AppError::EpubParse(format!("Failed to compile track src regex: {}", e)))?;
    let css_link_href_re = Regex::new(
        r#"(?is)<link\b[^>]*?\brel\s*=\s*["'][^"']*stylesheet[^"']*["'][^>]*?\bhref\s*=\s*["']([^"']+)["']"#,
    )
    .map_err(|e| AppError::EpubParse(format!("Failed to compile stylesheet link regex: {}", e)))?;

    let mut resource_sources: Vec<(String, String, bool)> = Vec::new();
    for caps in img_src_re.captures_iter(html) {
        if let Some(src_match) = caps.get(1) {
            let src = sanitize_resource_href(src_match.as_str());
            if !src.is_empty()
                && !src.starts_with("data:")
                && !src.starts_with("http://")
                && !src.starts_with("https://")
                && !src.starts_with("blob:")
            {
                resource_sources.push(("src".to_string(), src, false));
            }
        }
    }
    for caps in svg_image_href_re.captures_iter(html) {
        let attr_name = caps
            .get(1)
            .map(|m| m.as_str().to_ascii_lowercase())
            .unwrap_or_else(|| "href".to_string());
        if let Some(src_match) = caps.get(2) {
            let src = sanitize_resource_href(src_match.as_str());
            if !src.is_empty()
                && !src.starts_with("data:")
                && !src.starts_with("http://")
                && !src.starts_with("https://")
                && !src.starts_with("blob:")
            {
                resource_sources.push((attr_name, src, false));
            }
        }
    }
    for caps in audio_src_re.captures_iter(html) {
        if let Some(src_match) = caps.get(1) {
            let src = sanitize_resource_href(src_match.as_str());
            if !src.is_empty()
                && !src.starts_with("data:")
                && !src.starts_with("http://")
                && !src.starts_with("https://")
                && !src.starts_with("blob:")
            {
                resource_sources.push(("src".to_string(), src, true));
            }
        }
    }
    for caps in source_src_re.captures_iter(html) {
        if let Some(src_match) = caps.get(1) {
            let src = sanitize_resource_href(src_match.as_str());
            if !src.is_empty()
                && !src.starts_with("data:")
                && !src.starts_with("http://")
                && !src.starts_with("https://")
                && !src.starts_with("blob:")
            {
                // Treat <source src> as media source (typically audio/video in EPUB flows).
                resource_sources.push(("src".to_string(), src, true));
            }
        }
    }
    for caps in video_src_re.captures_iter(html) {
        if let Some(src_match) = caps.get(1) {
            let src = sanitize_resource_href(src_match.as_str());
            if !src.is_empty()
                && !src.starts_with("data:")
                && !src.starts_with("http://")
                && !src.starts_with("https://")
                && !src.starts_with("blob:")
            {
                resource_sources.push(("src".to_string(), src, true));
            }
        }
    }
    for caps in video_poster_re.captures_iter(html) {
        if let Some(src_match) = caps.get(1) {
            let src = sanitize_resource_href(src_match.as_str());
            if !src.is_empty()
                && !src.starts_with("data:")
                && !src.starts_with("http://")
                && !src.starts_with("https://")
                && !src.starts_with("blob:")
            {
                resource_sources.push(("poster".to_string(), src, false));
            }
        }
    }
    for caps in track_src_re.captures_iter(html) {
        if let Some(src_match) = caps.get(1) {
            let src = sanitize_resource_href(src_match.as_str());
            if !src.is_empty()
                && !src.starts_with("data:")
                && !src.starts_with("http://")
                && !src.starts_with("https://")
                && !src.starts_with("blob:")
            {
                resource_sources.push(("src".to_string(), src, true));
            }
        }
    }
    for caps in css_link_href_re.captures_iter(html) {
        if let Some(src_match) = caps.get(1) {
            let src = sanitize_resource_href(src_match.as_str());
            if !src.is_empty()
                && !src.starts_with("data:")
                && !src.starts_with("http://")
                && !src.starts_with("https://")
                && !src.starts_with("blob:")
            {
                resource_sources.push(("href".to_string(), src, false));
            }
        }
    }
    
    // Rewrite resource refs to local resource endpoint URLs.
    let mut processed_html = html.to_string();
    let estimated_resource_count = resource_sources.len();
    let mut replacements: Vec<(String, String)> = Vec::with_capacity(estimated_resource_count);
    
    for (attr_name, src, is_media) in resource_sources {
        let rewritten_url = crate::book_service::audio_stream::get_epub_resource_url(
            book_id.to_string(),
            src.clone(),
            Some(chapter_href.to_string()),
            app.clone(),
        )
        .await
        .map_err(|e| AppError::Store(format!("Failed to build EPUB resource URL: {}", e)))?;

        if !rewritten_url.is_empty() {
            let escaped_src = regex::escape(&src);
            let escaped_attr = regex::escape(&attr_name);
            let pattern = format!(r#"(?i){}\s*=\s*["']{}["']"#, escaped_attr, escaped_src);
            replacements.push((pattern, format!("{}=\"{}\"", attr_name, rewritten_url)));
        } else {
            if is_media {
                log::warn!("Could not resolve audio/media '{}' in chapter '{}'", src, chapter_href);
            } else {
                log::warn!("Could not resolve image '{}' in chapter '{}'", src, chapter_href);
            }
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

/// Normalize an EPUB resource reference by trimming spaces and removing query/fragment parts.
fn sanitize_resource_href(href: &str) -> String {
    let trimmed = href.trim();
    let no_fragment = trimmed.split('#').next().unwrap_or(trimmed);
    let no_query = no_fragment.split('?').next().unwrap_or(no_fragment);
    no_query.trim().to_string()
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

    // Last-resort lookup by suffix in case archive member uses a different folder prefix.
    let suffix = sanitize_resource_href(original_href)
        .trim_start_matches('/')
        .to_ascii_lowercase();
    if !suffix.is_empty() {
        for idx in 0..archive.len() {
            if let Ok(mut file) = archive.by_index(idx) {
                let member_name = file.name().to_string();
                let member_name_lower = member_name.to_ascii_lowercase();
                if member_name_lower.ends_with(&suffix)
                    || member_name_lower.ends_with(&format!("/{}", suffix))
                {
                    resource_bytes.clear();
                    if file.read_to_end(&mut resource_bytes).is_ok() && !resource_bytes.is_empty() {
                        debug!("Found resource via suffix fallback: '{}'", member_name);
                        return Ok(resource_bytes);
                    }
                }
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

fn extract_resource_from_archive(
    epub_data: &[u8],
    resource_href: &str,
    chapter_href: Option<&str>,
    prefer_audio: bool,
) -> Result<Option<String>, String> {
    use std::io::Cursor;
    use zip::ZipArchive;
    use crate::epub::parser::{find_opf_path, derive_base_path_from_opf};

    let mut archive = ZipArchive::new(Cursor::new(epub_data))
        .map_err(|e| format!("Failed to open EPUB: {}", e))?;

    // Use chapter-aware resolution for both image and audio refs.
    let resource_path = resolve_image_path(&mut archive, resource_href, chapter_href)?;

    let opf_path = find_opf_path(&mut archive)?;
    let base_path = derive_base_path_from_opf(&opf_path);

    let resource_bytes = load_resource_from_archive(&mut archive, &resource_path, resource_href, &base_path)?;
    let mime_type = if prefer_audio {
        detect_audio_mime_type(&resource_path, resource_href)
    } else {
        detect_image_mime_type(&resource_path, resource_href, &resource_bytes)
    };

    Ok(Some(create_data_url(mime_type, &resource_bytes)))
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
    
    match AudioRepository::resolve_track_audio_bytes(db.as_ref(), &book_id, &track_id).await {
        Ok(Some((audio_data, href))) => {
            let mime_type = detect_audio_mime_type(&href, &href);
            let data_url = create_data_url(&mime_type, &audio_data);
            log::info!("✓ Found audio track '{}' (href: '{}', {} bytes, type: {})", 
                track_id, href, audio_data.len(), mime_type);
            Ok(Some(data_url))
        }
        Ok(None) => {
            log::warn!("✗ Audio track not found: '{}' for book '{}'", track_id, book_id);
            Ok(None)
        }
        Err(e) => {
            log::warn!("Error loading audio track '{}': {}", track_id, e);
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
    
    match AudioRepository::resolve_track_audio_bytes(db.as_ref(), &book_id, &track_id).await {
        Ok(Some((audio_data, href))) => {
            let mime_type = detect_audio_mime_type(&href, &href);
            log::info!("✓ Found audio track bytes '{}' (href: '{}', {} bytes, type: {})", 
                track_id, href, audio_data.len(), mime_type);
            Ok(Some((audio_data, mime_type.to_string())))
        }
        Ok(None) => {
            log::warn!("✗ Audio track not found: '{}' for book '{}'", track_id, book_id);
            Ok(None)
        }
        Err(e) => {
            log::warn!("Error loading audio track '{}': {}", track_id, e);
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
    let unique_variations = build_href_variations(&chapter_href);
    
    log::debug!("Trying to load chapter bytes '{}' for book '{}' with {} variations", 
        chapter_href, book_id, unique_variations.len());
    
    // Resolve chapter metadata, then load chapter HTML from EPUB bytes.
    let epub_data = EpubRepository::find_by_book_id(db.as_ref(), &book_id)
        .await
        .map_err(AppError::Store)?
        .ok_or_else(|| AppError::Store(format!("No EPUB data found for book {}", book_id)))?;

    for (idx, href) in unique_variations.iter().enumerate() {
        match ChapterRepository::find_by_href(db.as_ref(), &book_id, href).await {
            Ok(Some(chapter)) => {
                let content_html = extract_chapter_content_from_archive(&epub_data, &chapter.href)
                    .or_else(|_| extract_chapter_content_from_archive(&epub_data, href))
                    .map_err(AppError::EpubParse)?;

                let processed_html = process_images_in_html(&app, db.as_ref(), &book_id, &content_html, &chapter.href).await?;

                let bytes = processed_html.into_bytes();
                let mime_type = "text/html".to_string();

                log::info!("✓ Found chapter bytes with href variation #{}: '{}' (original: '{}', {} bytes)", 
                    idx + 1, href, chapter_href, bytes.len());
                return Ok(Some((bytes, mime_type)));
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

    // Remove canonical EPUB and any other files under `Library/<book_id>/`
    if let Err(e) = epub_file_storage::remove_book_library_dir(&app, &book_id) {
        log::warn!(
            "Book removed from database but failed to delete on-disk library files for {}: {}",
            book_id,
            e
        );
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

/// Export audiobook as M4B (MPEG-4 Audio Book)
/// Extracts audio tracks and creates an M4B file using bundled FFmpeg.
///
/// # Arguments
/// * `book_id` - The book ID to export
/// * `output_path` - The file path where the M4B file will be saved
/// * `app` - Tauri application handle
///
/// # Returns
/// `Ok(())` if export succeeds
///
/// # Errors
/// Returns an error if audio processing or FFmpeg fails
#[tauri::command]
pub async fn export_as_m4b(
    book_id: String,
    output_path: String,
    app: tauri::AppHandle,
) -> AppResult<()> {
    #[cfg(target_os = "ios")]
    {
        let _ = (book_id, output_path, app);
        return Err(AppError::Store(
            "M4B export requires FFmpeg and is not available on iOS. Use Export as MP3 instead."
                .to_string(),
        ));
    }

    use repositories::AudioRepository;
    use std::fs;
    use std::io::{BufRead, BufReader, Read, Write};
    use std::path::Path;
    use std::process::{Command, Stdio};
    use std::time::Instant;
    use uuid::Uuid;
    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;
    #[cfg(unix)]
    use std::os::unix::process::CommandExt;

    if M4B_EXPORT_IN_PROGRESS
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err(AppError::Store(
            "Another M4B export is already in progress. Please wait for it to finish."
                .to_string(),
        ));
    }

    set_active_m4b_export_book_id(Some(book_id.clone()));

    struct M4bExportLockGuard;
    impl Drop for M4bExportLockGuard {
        fn drop(&mut self) {
            set_active_m4b_export_book_id(None);
            M4B_EXPORT_IN_PROGRESS.store(false, Ordering::Release);
        }
    }
    let _m4b_export_lock_guard = M4bExportLockGuard;

    fn escape_ffmetadata_value(value: &str) -> String {
        value
            .replace('\\', "\\\\")
            .replace('\n', "\\\n")
            .replace('=', "\\=")
            .replace(';', "\\;")
            .replace('#', "\\#")
    }

    fn probe_duration_ms(ffmpeg_path: &Path, path: &Path) -> Option<u64> {
        let mut cmd = Command::new(ffmpeg_path);
        #[cfg(unix)]
        {
            cmd.arg0("aurorabook");
        }

        let output = cmd
            .arg("-v").arg("error")
            .arg("-show_entries").arg("format=duration")
            .arg("-of").arg("default=noprint_wrappers=1:nokey=1")
            .arg(path)
            .output()
            .ok()?;

        if !output.status.success() {
            return None;
        }

        let duration_secs = String::from_utf8_lossy(&output.stdout)
            .trim()
            .parse::<f64>()
            .ok()?;

        if duration_secs.is_sign_negative() {
            return None;
        }

        Some((duration_secs * 1000.0).round() as u64)
    }
    
    let db = get_db_connection(&app).await
        .map_err(|e| AppError::Store(e))?;
    
    // Get book metadata
    let book = BookRepository::find_by_id(db.as_ref(), &book_id).await
        .map_err(|e| AppError::Store(e))?
        .ok_or_else(|| AppError::Store(format!("Book not found: {}", book_id)))?;
    
    // Get bundled FFmpeg path
    let ffmpeg_path = app.path().resolve("resources-desktop/ffmpeg", tauri::path::BaseDirectory::Resource)
        .map_err(|e| AppError::Store(format!("Failed to resolve FFmpeg path: {}", e)))?;
    
    if !ffmpeg_path.exists() {
        return Err(AppError::Store(
            format!("FFmpeg binary not found at: {:?}", ffmpeg_path)
        ));
    }
    
    // Ensure executable permissions on Unix
    #[cfg(unix)]
    {
        use std::fs::Metadata;
        if let Ok(metadata) = fs::metadata(&ffmpeg_path) {
            let mut perms = metadata.permissions();
            perms.set_mode(0o755);
            let _ = fs::set_permissions(&ffmpeg_path, perms);
        }
    }
    
    // Use system temp directory for pipes
    let temp_dir = std::env::temp_dir();
    let work_id = Uuid::new_v4().to_string();
    
    // Extract audio files and create file list using pipes
    let mut filelist_content = String::new();
    let mut chapter_entries: Vec<(String, u64)> = Vec::new();
    let mut audio_pipe_handles = Vec::new();
    
    // Sort audio tracks by order
    let mut sorted_tracks = book.audio_tracks.clone();
    sorted_tracks.sort_by_key(|t| t.order);

    let total_tracks = sorted_tracks.len();
    let export_started = Instant::now();

    let emit_m4b_progress = |current_step: &str,
                             message: String,
                             processed_tracks: usize,
                             total_tracks: usize,
                             percent: u8,
                             eta_ms: Option<u64>| {
        let _ = app.emit(
            "m4b-export-progress",
            M4bExportProgress {
                book_id: book_id.clone(),
                current_step: current_step.to_string(),
                message,
                processed_tracks,
                total_tracks,
                percent,
                eta_ms,
            },
        );
    };

    emit_m4b_progress(
        "initializing",
        "Starting M4B export...".to_string(),
        0,
        total_tracks,
        0,
        None,
    );
    
    let mut missing_tracks = 0usize;
    for (index, track) in sorted_tracks.iter().enumerate() {
        match AudioRepository::resolve_track_audio_bytes(db.as_ref(), &book_id, &track.id).await {
            Ok(Some((audio_bytes, href))) => {
                let ext = href.rsplit('.').next().unwrap_or("mp3");
                
                #[cfg(unix)]
                {
                    use std::os::unix::fs as unix_fs;
                    
                    // Create named pipe for this audio track
                    let pipe_path = temp_dir.join(format!("m4b_{}_{:03}.{}", work_id, index, ext));
                    
                    // Clean up any stale pipe
                    let _ = fs::remove_file(&pipe_path);
                    
                    // Create named pipe using mkfifo
                    unsafe {
                        use std::ffi::CString;
                        use std::os::raw::c_int;
                        extern "C" {
                            fn mkfifo(path: *const u8, mode: c_int) -> c_int;
                        }
                        let c_path = CString::new(pipe_path.to_str().unwrap()).unwrap();
                        if mkfifo(c_path.as_ptr() as *const u8, 0o644) == -1 {
                            return Err(AppError::Store(format!("Failed to create named pipe for track {}", index)));
                        }
                    }
                    
                    // Spawn thread to write audio to pipe
                    let pipe_path_clone = pipe_path.clone();
                    let handle = std::thread::spawn(move || {
                        if let Ok(mut file) = fs::File::create(&pipe_path_clone) {
                            let _ = file.write_all(&audio_bytes);
                        }
                    });
                    audio_pipe_handles.push((pipe_path.clone(), handle));
                    
                    let escaped_path = pipe_path.display().to_string().replace('\'', "'\\''");
                    filelist_content.push_str(&format!("file '{}'\n", escaped_path));
                }
                
                #[cfg(not(unix))]
                {
                    // Fallback for non-Unix: use temp files
                    let output_file = temp_dir.join(format!("m4b_{}_{:03}.{}", work_id, index, ext));
                    fs::write(&output_file, audio_bytes)
                        .map_err(|e| AppError::Store(format!("Failed to write temp audio file: {}", e)))?;
                    
                    let escaped_path = output_file.display().to_string().replace('\'', "'\\''");
                    filelist_content.push_str(&format!("file '{}'\n", escaped_path));
                }

                let duration_ms = track
                    .duration
                    .map(|d| (d * 1000.0).round() as u64)
                    .filter(|d| *d > 0)
                    .unwrap_or(0);

                if duration_ms > 0 {
                    let chapter_title = if track.title.trim().is_empty() {
                        format!("Track {}", index + 1)
                    } else {
                        track.title.clone()
                    };
                    chapter_entries.push((chapter_title, duration_ms));
                } else {
                    log::warn!(
                        "Could not determine duration for track id='{}' href='{}'",
                        track.id,
                        track.href
                    );
                }
            }
            Ok(None) => {
                missing_tracks += 1;
                log::warn!(
                    "Skipping missing audio track id='{}' href='{}'",
                    track.id,
                    track.href
                );
            }
            Err(e) => {
                missing_tracks += 1;
                log::warn!(
                    "Skipping unreadable audio track id='{}' href='{}': {}",
                    track.id,
                    track.href,
                    e
                );
            }
        }

        let processed_tracks = index + 1;
        let eta_ms = if total_tracks > 0 && processed_tracks > 0 {
            let elapsed_ms = export_started.elapsed().as_millis() as f64;
            let progress_fraction = processed_tracks as f64 / total_tracks as f64;
            if progress_fraction > 0.0 {
                let estimated_total_ms = elapsed_ms / progress_fraction;
                let remaining_ms = (estimated_total_ms - elapsed_ms).max(0.0);
                Some(remaining_ms.round() as u64)
            } else {
                None
            }
        } else {
            None
        };

        let percent = if total_tracks > 0 {
            ((processed_tracks * 10) / total_tracks).min(10) as u8
        } else {
            0
        };

        emit_m4b_progress(
            "extracting-audio",
            format!("Preparing track {}/{} for export", processed_tracks, total_tracks),
            processed_tracks,
            total_tracks,
            percent,
            eta_ms,
        );
    }
    
    if filelist_content.is_empty() {
        return Err(AppError::Store(
            format!(
                "No exportable audio tracks found ({} of {} tracks were missing or unreadable)",
                missing_tracks, total_tracks
            ),
        ));
    }

    if missing_tracks > 0 {
        log::warn!(
            "M4B export continuing with partial audio: {} of {} tracks missing/unreadable",
            missing_tracks,
            total_tracks
        );
    }
    
    // Write FFmpeg concat file list
    let filelist_path = temp_dir.join(format!("m4b_{}_filelist.txt", work_id));
    let mut filelist = fs::File::create(&filelist_path)
        .map_err(|e| AppError::Store(format!("Failed to create filelist: {}", e)))?;
    filelist.write_all(filelist_content.as_bytes())
        .map_err(|e| AppError::Store(format!("Failed to write filelist: {}", e)))?;

    // Write FFmpeg metadata with chapters
    let metadata_path = temp_dir.join(format!("m4b_{}_metadata.ffmeta", work_id));
    let mut metadata_content = String::new();
    metadata_content.push_str(";FFMETADATA1\n");
    metadata_content.push_str(&format!("title={}\n", escape_ffmetadata_value(&book.title)));
    metadata_content.push_str(&format!("artist={}\n", escape_ffmetadata_value(&book.author)));

    if !chapter_entries.is_empty() {
        let mut chapter_start_ms = 0u64;
        for (title, duration_ms) in &chapter_entries {
            let chapter_end_ms = chapter_start_ms.saturating_add(*duration_ms);
            metadata_content.push_str("\n[CHAPTER]\n");
            metadata_content.push_str("TIMEBASE=1/1000\n");
            metadata_content.push_str(&format!("START={}\n", chapter_start_ms));
            metadata_content.push_str(&format!("END={}\n", chapter_end_ms));
            metadata_content.push_str(&format!("title={}\n", escape_ffmetadata_value(title)));
            chapter_start_ms = chapter_end_ms;
        }
    }

    fs::write(&metadata_path, metadata_content)
        .map_err(|e| AppError::Store(format!("Failed to write metadata: {}", e)))?;

    emit_m4b_progress(
        "writing-metadata",
        "Writing chapter metadata...".to_string(),
        total_tracks,
        total_tracks,
        12,
        None,
    );
    
    log::info!("Starting FFmpeg with {} audio tracks via pipes", sorted_tracks.len());

    emit_m4b_progress(
        "encoding-m4b",
        "Encoding M4B output...".to_string(),
        total_tracks,
        total_tracks,
        15,
        None,
    );

    let total_duration_ms: u64 = chapter_entries.iter().map(|(_, duration_ms)| *duration_ms).sum();
    
    let mut ffmpeg_cmd = Command::new(&ffmpeg_path);
    #[cfg(unix)]
    {
        ffmpeg_cmd.arg0("aurorabook");
    }

    let mut child = ffmpeg_cmd
        .arg("-f").arg("concat")
        .arg("-safe").arg("0")
        .arg("-i").arg(filelist_path.to_str().unwrap())
        .arg("-i").arg(metadata_path.to_str().unwrap())
        .arg("-map_metadata").arg("1")
        .arg("-map_chapters").arg("1")
        .arg("-c").arg("aac")
        .arg("-b:a").arg("128k")
        .arg("-progress").arg("pipe:1")
        .arg("-nostats")
        .arg("-y")
        .arg(&output_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| AppError::Store(format!("Failed to execute FFmpeg: {}", e)))?;

    let ffmpeg_pid = child.id();
    register_m4b_export_pid(ffmpeg_pid);

    struct FfmpegPidGuard(u32);
    impl Drop for FfmpegPidGuard {
        fn drop(&mut self) {
            unregister_m4b_export_pid(self.0);
        }
    }
    let _ffmpeg_pid_guard = FfmpegPidGuard(ffmpeg_pid);
    
    // Guard to clean up temp files and pipes on early return
    struct TempFilesGuard {
        filelist_path: std::path::PathBuf,
        metadata_path: std::path::PathBuf,
        audio_pipes: Vec<std::path::PathBuf>,
    }
    impl Drop for TempFilesGuard {
        fn drop(&mut self) {
            let _ = fs::remove_file(&self.filelist_path);
            let _ = fs::remove_file(&self.metadata_path);
            for pipe in &self.audio_pipes {
                let _ = fs::remove_file(pipe);
            }
        }
    }
    let pipe_paths: Vec<_> = audio_pipe_handles.iter().map(|(p, _)| p.clone()).collect();
    let _temp_files_guard = TempFilesGuard {
        filelist_path: filelist_path.clone(),
        metadata_path: metadata_path.clone(),
        audio_pipes: pipe_paths,
    };

    let ffmpeg_stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Store("Failed to capture FFmpeg progress output".to_string()))?;
    let ffmpeg_stderr = child
        .stderr
        .take()
        .ok_or_else(|| AppError::Store("Failed to capture FFmpeg stderr output".to_string()))?;

    let stderr_handle = std::thread::spawn(move || {
        let mut reader = BufReader::new(ffmpeg_stderr);
        let mut stderr_buffer = String::new();
        let _ = reader.read_to_string(&mut stderr_buffer);
        stderr_buffer
    });

    let mut stdout_reader = BufReader::new(ffmpeg_stdout);
    let mut line = String::new();
    let mut latest_out_time_ms: u64 = 0;
    let mut latest_speed: Option<f64> = None;

    loop {
        line.clear();
        let bytes_read = stdout_reader
            .read_line(&mut line)
            .map_err(|e| AppError::Store(format!("Failed to read FFmpeg progress output: {}", e)))?;

        if bytes_read == 0 {
            break;
        }

        let progress_line = line.trim();

        if let Some(value) = progress_line.strip_prefix("out_time_ms=") {
            if let Ok(out_time_us) = value.parse::<u64>() {
                latest_out_time_ms = out_time_us / 1000;
            }
        } else if let Some(value) = progress_line.strip_prefix("speed=") {
            let speed_value = value.trim_end_matches('x');
            if let Ok(speed) = speed_value.parse::<f64>() {
                if speed.is_finite() && speed > 0.0 {
                    latest_speed = Some(speed);
                }
            }
        } else if progress_line == "progress=continue" || progress_line == "progress=end" {
            let percent = if total_duration_ms > 0 {
                let ratio = (latest_out_time_ms as f64 / total_duration_ms as f64).clamp(0.0, 1.0);
                let encode_percent = (ratio * 100.0).round() as u8;
                15 + ((encode_percent as u16 * 84) / 100) as u8
            } else {
                15
            };

            let eta_ms = if total_duration_ms > latest_out_time_ms {
                if let Some(speed) = latest_speed {
                    let remaining_audio_ms = (total_duration_ms - latest_out_time_ms) as f64;
                    Some((remaining_audio_ms / speed).round() as u64)
                } else {
                    None
                }
            } else {
                Some(0)
            };

            emit_m4b_progress(
                "encoding-m4b",
                "Encoding M4B output...".to_string(),
                total_tracks,
                total_tracks,
                percent.min(99),
                eta_ms,
            );
        }
    }

    let status = child
        .wait()
        .map_err(|e| AppError::Store(format!("Failed to wait for FFmpeg process: {}", e)))?;

    let stderr = stderr_handle
        .join()
        .unwrap_or_else(|_| "Failed to capture FFmpeg stderr output".to_string());
    
    if !status.success() {
        #[cfg(unix)]
        {
            use std::os::unix::process::ExitStatusExt;
            if let Some(signal) = status.signal() {
                if signal == 15 || signal == 2 {
                    return Err(AppError::Store("M4B export cancelled".to_string()));
                }
            }
        }

        return Err(AppError::Store(
            format!("FFmpeg conversion failed: {}", stderr),
        ));
    }
    
    // Wait for pipe writer threads to complete
    #[cfg(unix)]
    for (_, handle) in audio_pipe_handles {
        let _ = handle.join();
    }
    
    log::info!("M4B export completed: {}", output_path);

    emit_m4b_progress(
        "completed",
        "M4B export complete".to_string(),
        total_tracks,
        total_tracks,
        100,
        Some(0),
    );
    
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

    // Copy EPUB into app_data_dir/Library/{book_id}/book.epub (sandbox container; same root as library.db)
    let library_epub = crate::book_service::epub_file_storage::library_epub_path(&app, &book_id)
        .map_err(|e| AppError::Store(e))?;
    if let Some(parent) = library_epub.parent() {
        fs::create_dir_all(parent).map_err(|e| AppError::Io(e))?;
    }
    let src_pb = std::path::Path::new(&actual_path);
    if src_pb != library_epub.as_path() {
        fs::copy(src_pb, &library_epub).map_err(|e| AppError::Io(e))?;
    }
    let library_epub_str = library_epub.to_str().ok_or_else(|| {
        AppError::Store("Library EPUB path is not valid UTF-8".to_string())
    })?;

    // Derive title from path if not available
    let title = metadata.title
        .unwrap_or_else(|| derive_title_from_path(&source_path));
    
    // Determine conversion status: if book already has audio tracks, mark as Done
    let conversion_status = if !audio_tracks.is_empty() {
        crate::book_service::models::ConversionStatus::Done
    } else {
        crate::book_service::models::ConversionStatus::NotStarted
    };
    
    // Keep chapter content out of DB; chapter HTML and media are loaded lazily from EPUB.
    log::info!("Using metadata-only chapter ingestion; chapter HTML will be loaded from EPUB on demand");
    let mut chapters_for_storage = chapters.clone();
    for chapter in &mut chapters_for_storage {
        chapter.content_html = None;
        chapter.plain_text = None;
    }
    
    // Embedded audio is read from the canonical EPUB on demand (not duplicated in SQLite).

    // Ensure audio tracks are sorted by order before creating Book
    audio_tracks.sort_by_key(|t| t.order);
    
    // Log track order before creating Book to verify correct ordering
    log::info!("Audio tracks before creating Book (sorted by order):");
    for (idx, track) in audio_tracks.iter().enumerate() {
        log::info!("  Track #{}: href='{}', order={}", idx, track.href, track.order);
    }
    
    // Create Book object with chapter metadata only (content is loaded lazily from EPUB)
    let book = Book {
        id: book_id.clone(),
        title,
        author: metadata.creator.unwrap_or_else(|| "Unknown author".to_string()),
        chapters: chapters_for_storage,
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
    
    // Store book with chapter metadata only
    BookRepository::save(db.as_ref(), &book).await
        .map_err(|e| AppError::Store(e))?;
    
    // Store EPUB reference (file in app container Library/; no BLOB duplicate)
    use repositories::EpubRepository;
    log::info!(
        "Registering canonical EPUB at {} ({} bytes)",
        library_epub_str,
        epub_data_arc.len()
    );
    if let Err(e) = EpubRepository::save_file_backed(db.as_ref(), &source_path, &book_id, library_epub_str).await {
        log::error!("Failed to register canonical EPUB: {}", e);
    } else {
        log::debug!("Canonical EPUB registered successfully");
    }
    
    log::info!("Skipping chapter HTML/image persistence during ingest (EPUB-backed lazy loading enabled)");
    
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

