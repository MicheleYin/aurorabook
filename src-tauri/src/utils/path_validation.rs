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

/// Decode URL-encoded file path.
///
/// On iOS, file paths from the file picker may be URL-encoded (e.g., `%20` for spaces).
/// This function decodes common URL-encoded characters in file paths.
///
/// # Arguments
/// * `path` - The URL-encoded path string
///
/// # Returns
/// The decoded path string
///
/// # Example
/// ```
/// let encoded = "file:///path/to/my%20book.epub";
/// let decoded = decode_url_path(encoded);
/// // Returns: "file:///path/to/my book.epub"
/// ```
pub fn decode_url_path(path: &str) -> String {
    // Handle URL-encoded characters
    // This decodes percent-encoded sequences like %20 (space), %2F (/), etc.
    // Important for iOS file picker which returns URL-encoded paths
    let mut result = String::with_capacity(path.len());
    let mut chars = path.chars().peekable();
    
    while let Some(ch) = chars.next() {
        if ch == '%' {
            // Try to decode %XX hex sequence
            let mut hex_str = String::new();
            let mut valid_hex = true;
            
            for _ in 0..2 {
                if let Some(&next_ch) = chars.peek() {
                    if next_ch.is_ascii_hexdigit() {
                        hex_str.push(chars.next().unwrap());
                    } else {
                        // Not a valid hex sequence, treat % as literal
                        valid_hex = false;
                        result.push(ch);
                        break;
                    }
                } else {
                    // Not enough characters, treat % as literal
                    valid_hex = false;
                    result.push(ch);
                    break;
                }
            }
            
            if valid_hex && hex_str.len() == 2 {
                // Try to decode the hex value
                if let Ok(byte_val) = u8::from_str_radix(&hex_str, 16) {
                    // Decode the byte value to a character
                    // All ASCII bytes (0-127) are valid UTF-8, so decode them
                    // This handles common cases like %20 (space), %2F (/), etc.
                    if byte_val <= 127 {
                        result.push(byte_val as char);
                    } else {
                        // For non-ASCII bytes (>127), keep them encoded
                        // as they might be part of a multi-byte UTF-8 sequence
                        // and we can't decode a single byte in isolation
                        result.push('%');
                        result.push_str(&hex_str);
                    }
                } else {
                    // Invalid hex, keep the original
                    result.push('%');
                    result.push_str(&hex_str);
                }
            }
        } else {
            result.push(ch);
        }
    }
    
    result
}

