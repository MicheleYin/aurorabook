use std::path::Path;
use crate::utils::errors::{AppError, AppResult};

/// Validate that a path within an EPUB archive is safe and doesn't escape the archive.
///
/// This function ensures that paths extracted from EPUB files don't contain
/// path traversal sequences (like `../`) or absolute paths that could escape
/// the EPUB archive boundaries.
///
/// # Arguments
/// * `href` - The href path from the EPUB manifest or spine
///
/// # Returns
/// A validated path if it's safe, or an error if it contains dangerous patterns.
///
/// # Security
/// This prevents path traversal attacks where malicious EPUB files could
/// reference files outside the archive by using `../` sequences.
///
/// # Example
/// ```rust
/// let safe_path = validate_epub_path("../etc/passwd")?; // Returns error
/// let safe_path = validate_epub_path("chapter1.xhtml")?; // Returns Ok
/// ```
pub fn validate_epub_path(href: &str) -> AppResult<String> {
    // Remove leading slash if present (normalize)
    let normalized = if href.starts_with('/') {
        &href[1..]
    } else {
        href
    };
    
    // Check for path traversal sequences
    if normalized.contains("..") {
        return Err(AppError::InvalidPath(format!(
            "Path contains traversal sequence: {}",
            href
        )));
    }
    
    // Check if path is absolute (shouldn't happen in EPUB, but check anyway)
    let path = Path::new(normalized);
    if path.is_absolute() {
        return Err(AppError::InvalidPath(format!(
            "Path is absolute (not allowed in EPUB): {}",
            href
        )));
    }
    
    // Check for null bytes (potential security issue)
    if normalized.contains('\0') {
        return Err(AppError::InvalidPath(format!(
            "Path contains null byte: {}",
            href
        )));
    }
    
    Ok(normalized.to_string())
}

/// Validate file size against maximum allowed size.
///
/// # Arguments
/// * `size` - File size in bytes
/// * `max_size` - Maximum allowed size in bytes
/// * `file_type` - Type of file for error message (e.g., "EPUB", "chapter")
///
/// # Returns
/// Ok(()) if size is within limits, error otherwise.
pub fn validate_file_size(size: usize, max_size: usize, file_type: &str) -> AppResult<()> {
    if size > max_size {
        return Err(AppError::FileTooLarge(size, max_size).with_context(format!(
            "{} file exceeds maximum size",
            file_type
        )));
    }
    Ok(())
}

/// Validate chapter count against maximum allowed.
///
/// # Arguments
/// * `count` - Number of chapters
/// * `max_count` - Maximum allowed chapters
///
/// # Returns
/// Ok(()) if count is within limits, error otherwise.
pub fn validate_chapter_count(count: usize, max_count: usize) -> AppResult<()> {
    if count > max_count {
        return Err(AppError::TooManyChapters(count, max_count));
    }
    Ok(())
}

