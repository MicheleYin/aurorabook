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
    // Check if path is absolute (starts with /) and has multiple components
    // Reject paths like /absolute/path but allow /chapter1.xhtml (single component)
    if href.starts_with('/') {
        let without_slash = &href[1..];
        // If it has multiple path components (contains /), reject it as a system path
        // Single component paths like /chapter1.xhtml are common in EPUBs and should be normalized
        if without_slash.contains('/') {
            return Err(AppError::InvalidPath(format!(
                "Path is absolute with multiple components (not allowed in EPUB): {}",
                href
            )));
        }
    }
    
    // Remove leading slash if present (normalize)
    // EPUB paths often start with / but should be treated as relative
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
    
    // Check for null bytes (potential security issue)
    if normalized.contains('\0') {
        return Err(AppError::InvalidPath(format!(
            "Path contains null byte: {}",
            href
        )));
    }
    
    Ok(normalized.to_string())
}

/// Validate a relative path for use in SMIL files.
///
/// This function is more lenient than `validate_epub_path` because SMIL files
/// legitimately use relative paths with `../` sequences to reference audio files.
/// However, it still ensures the path doesn't contain dangerous patterns.
///
/// # Arguments
/// * `href` - The relative path from a SMIL file (e.g., "../Audio/chapter1.mp3")
/// * `base_path` - The base path of the SMIL file (e.g., "Text/chapter1.smil")
///
/// # Returns
/// A validated path if it's safe, or an error if it contains dangerous patterns.
///
/// # Security
/// This validates that when resolved, the path stays within the EPUB archive.
/// It allows `../` sequences but ensures they don't escape the archive root.
///
/// # Example
/// ```rust
/// let safe_path = validate_smil_relative_path("../Audio/chapter1.mp3", "Text/chapter1.smil")?; // Returns Ok
/// let safe_path = validate_smil_relative_path("../../etc/passwd", "Text/chapter1.smil")?; // Returns error (escapes archive)
/// ```
pub fn validate_smil_relative_path(href: &str, base_path: &str) -> AppResult<String> {
    // Check for null bytes (potential security issue)
    if href.contains('\0') {
        return Err(AppError::InvalidPath(format!(
            "Path contains null byte: {}",
            href
        )));
    }
    
    // Reject absolute paths that escape the archive
    // Absolute paths starting with / are allowed only if they're single-component
    if href.starts_with('/') {
        let without_slash = &href[1..];
        if without_slash.contains('/') {
            return Err(AppError::InvalidPath(format!(
                "Path is absolute with multiple components (not allowed in EPUB): {}",
                href
            )));
        }
    }
    
    // Resolve the relative path to check if it escapes the archive root
    // Count the number of ../ sequences
    let mut depth = 0;
    let mut remaining = href;
    
    while remaining.starts_with("../") {
        depth += 1;
        remaining = &remaining[3..];
    }
    
    // Count the depth of the base path (how many directories deep it is)
    let base_depth = base_path.matches('/').count();
    
    // If we go up more levels than the base path has, we'd escape the archive
    if depth > base_depth {
        return Err(AppError::InvalidPath(format!(
            "Path escapes EPUB archive root: {} (base: {}, depth: {}, base_depth: {})",
            href, base_path, depth, base_depth
        )));
    }
    
    // Normalize: remove leading slash if present
    let normalized = if href.starts_with('/') {
        &href[1..]
    } else {
        href
    };
    
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

