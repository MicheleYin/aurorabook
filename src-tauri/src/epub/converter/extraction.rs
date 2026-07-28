use crate::utils::constants::*;
use crate::utils::errors::{AppError, AppResult};
use crate::utils::path_validation::{validate_epub_path, validate_file_size, validate_chapter_count};
use crate::utils::text::count_words_in_html;
use crate::epub::converter::types::ConversionChapter;
use anyhow::Context;

/// Extract chapters from EPUB data for conversion.
///
/// This function parses an EPUB file and extracts all chapters with their
/// full HTML content. It optimizes performance by opening the archive once
/// and caching all file contents to avoid repeated archive operations.
///
/// # Arguments
/// * `epub_data` - The EPUB file as a byte vector
///
/// # Returns
/// A tuple containing:
/// * `Vec<ConversionChapter>` - List of chapters with their content
/// * `(usize, usize, usize, usize, usize)` - Statistics tuple:
///   - Manifest item count
///   - Spine itemref count
///   - Missing manifest count
///   - Non-HTML file count
///   - Filtered count
///
/// # Errors
/// Returns `AppError::EpubParse` if the EPUB cannot be parsed.
/// Returns `AppError::ZipArchive` if the EPUB archive cannot be opened.
///
/// # Performance
/// This function opens the EPUB archive once and caches all file contents
/// in memory, avoiding the expensive operation of reopening the archive
/// for each chapter.
///
/// # Example
/// ```rust
/// let epub_data = std::fs::read("book.epub")?;
/// let (chapters, stats) = extract_chapters(epub_data)?;
/// println!("Extracted {} chapters", chapters.len());
/// ```
pub fn extract_chapters(epub_data: Vec<u8>) -> AppResult<(Vec<ConversionChapter>, (usize, usize, usize, usize, usize))> {
    use crate::epub::parser::extract_chapters_from_epub;
    use std::io::{Cursor, Read};
    use zip::ZipArchive;
    use uuid::Uuid;
    use std::collections::HashMap;
    
    // Validate EPUB file size
    validate_file_size(epub_data.len(), MAX_EPUB_SIZE, "EPUB")?;
    
    // Use the parser to get chapter metadata
    let (chapters_metadata, stats) = extract_chapters_from_epub(&epub_data)
        .map_err(|e| AppError::EpubParse(e))?;
    
    // Validate chapter count
    validate_chapter_count(chapters_metadata.len(), MAX_CHAPTERS)?;
    
    // Open archive once and cache all file contents
    let mut archive = ZipArchive::new(Cursor::new(&epub_data))
        .map_err(|e| AppError::ZipArchive(format!("Failed to open EPUB: {}", e)))?;
    
    // Find OPF path to determine base path
    use crate::epub::parser::{find_opf_path, derive_base_path_from_opf};
    let epub_slice: &[u8] = &epub_data;
    let mut temp_archive = ZipArchive::new(Cursor::new(epub_slice))
        .map_err(|e| AppError::EpubParse(format!("Failed to open EPUB for OPF search: {}", e)))?;
    let opf_path = find_opf_path(&mut temp_archive)
        .map_err(|e| AppError::EpubParse(format!("Failed to find OPF path: {}", e)))?;
    let base_path = derive_base_path_from_opf(&opf_path);
    
    let mut file_cache: HashMap<String, String> = HashMap::new();
    
    // Extract all files from archive into cache
    for i in 0..archive.len() {
        let mut file = match archive.by_index(i) {
            Ok(f) => f,
            Err(_) => continue,
        };
        
        let name = file.name().to_string();
        
        // Validate file path for security
        validate_epub_path(&name)?;
        
        // Validate file size before reading
        let file_size = file.size() as usize;
        validate_file_size(file_size, MAX_CHAPTER_SIZE, "Chapter file")?;
        
        let mut content = String::new();
        if file.read_to_string(&mut content).is_ok() {
            // Validate content size after reading
            validate_file_size(content.len(), MAX_CHAPTER_SIZE, "Chapter content")?;
            file_cache.insert(name, content);
        }
    }
    
    // Now extract content for each chapter using cached data
    let mut chapters = Vec::new();
    for (_index, chapter_meta) in chapters_metadata.iter().enumerate() {
        // Validate and sanitize chapter href path
        let validated_href = validate_epub_path(&chapter_meta.href)?;
        
        // Resolve chapter path using dynamic base path
        let chapter_path = if validated_href.starts_with("/") {
            validated_href[1..].to_string()
        } else if !base_path.is_empty() && validated_href.starts_with(&base_path) {
            validated_href.clone()
        } else {
            format!("{}{}", base_path, validated_href)
        };
        
        // Try alternative paths if primary path not found
        let mut content = file_cache.get(&chapter_path).cloned();
        if content.is_none() {
            // Try with the original validated href as fallback
            if let Some(cached_content) = file_cache.get(&validated_href) {
                content = Some(cached_content.clone());
            }
        }
        
        // Try more path variations if still not found
        if content.is_none() {
            // Try without leading slash
            let href_no_slash = validated_href.trim_start_matches('/');
            if let Some(cached_content) = file_cache.get(href_no_slash) {
                content = Some(cached_content.clone());
            }
        }
        
        if content.is_none() {
            // Try with base_path prefix if not already tried
            let href_with_base = if !base_path.is_empty() && !validated_href.starts_with(&base_path) {
                format!("{}{}", base_path, validated_href.trim_start_matches('/'))
            } else {
                String::new()
            };
            if !href_with_base.is_empty() {
                if let Some(cached_content) = file_cache.get(&href_with_base) {
                    content = Some(cached_content.clone());
                }
            }
        }
        
        // Debug: log what paths we're trying and what we found
        if content.is_none() {
            log::warn!("Chapter '{}' (href: '{}'): Not found at '{}' or '{}'. Available files (first 20): {:?}", 
                chapter_meta.title, validated_href, chapter_path, validated_href,
                file_cache.keys().take(20).collect::<Vec<_>>());
            // Try to find a file that matches the chapter name
            let chapter_name = validated_href.split('/').last().unwrap_or(&validated_href);
            let matching_files: Vec<_> = file_cache.keys()
                .filter(|k| k.contains(chapter_name) && (k.ends_with(".xhtml") || k.ends_with(".html")))
                .take(5)
                .collect();
            if !matching_files.is_empty() {
                log::warn!("Found potential matches for chapter '{}': {:?}", chapter_meta.title, matching_files);
            }
        } else {
            log::debug!("Chapter '{}' (href: '{}'): Found content ({} bytes)", 
                chapter_meta.title, validated_href, content.as_ref().unwrap().len());
        }
        
        // Use content found above, or empty string if not found
        let content = content.unwrap_or_else(|| {
            log::warn!("Using empty content for chapter '{}' (href: '{}') - file not found in EPUB", 
                chapter_meta.title, validated_href);
            String::new()
        });
        
        // Extract title from HTML if available
        let title = if let Some(start) = content.find("<h1>") {
            if let Some(end) = content[start+4..].find("</h1>") {
                content[start+4..start+4+end].trim().to_string()
            } else if let Some(start_title) = content.find("<title>") {
                if let Some(end_title) = content[start_title+7..].find("</title>") {
                    content[start_title+7..start_title+7+end_title].trim().to_string()
                } else {
                    chapter_meta.title.clone()
                }
            } else {
                chapter_meta.title.clone()
            }
        } else {
            chapter_meta.title.clone()
        };
        
        // Calculate word count for this chapter
        let word_count = count_words_in_html(&content);
        
        chapters.push(ConversionChapter {
            id: format!("{}-{}", Uuid::new_v4().to_string(), chapter_meta.id),
            title,
            href: validated_href,
            order: _index,
            content_html: content,
            word_count,
        });
    }
    
    Ok((chapters, stats))
}

/// Initialize EPUB conversion by finding OPF path and base path
pub(crate) fn initialize_conversion(epub_data: &[u8]) -> anyhow::Result<(String, String)> {
    use crate::epub::parser::{find_opf_path, derive_base_path_from_opf};
    use std::io::Cursor;
    use zip::ZipArchive;
    
    let epub_slice: &[u8] = epub_data;
    let mut temp_archive = ZipArchive::new(Cursor::new(epub_slice))
        .map_err(|e| anyhow::anyhow!("Failed to open EPUB for OPF search: {}", e))?;
    let opf_path = find_opf_path(&mut temp_archive)
        .map_err(|e| anyhow::anyhow!("Failed to find OPF path: {}", e))?;
    let base_path = derive_base_path_from_opf(&opf_path);
    
    Ok((opf_path, base_path))
}

/// Extract all files from the original EPUB archive
pub(crate) fn extract_original_files(
    epub_data: &[u8],
    opf_path: &str,
) -> anyhow::Result<std::collections::HashMap<String, Vec<u8>>> {
    use std::io::Cursor;
    use zip::ZipArchive;
    
    let mut archive = ZipArchive::new(Cursor::new(epub_data))
        .context("Failed to open EPUB")?;
    
    let mut original_files = std::collections::HashMap::new();
    
    for i in 0..archive.len() {
        let mut file = archive.by_index(i)
            .with_context(|| format!("Failed to read file {} from EPUB", i))?;
        let name = file.name().to_string();
        
        // Skip mimetype and OPF - we'll handle these separately
        if name == "mimetype" || name == opf_path {
            continue;
        }
        
        validate_epub_path(&name)
            .map_err(|e| anyhow::anyhow!("Invalid file path in EPUB: {}", e))?;
        
        let file_size = file.size() as usize;
        validate_file_size(file_size, MAX_CHAPTER_SIZE, "EPUB file")
            .map_err(|e| anyhow::anyhow!("File size validation failed: {}", e))?;
        
        let mut data = Vec::new();
        std::io::copy(&mut file, &mut data)
            .with_context(|| format!("Failed to read file data for {}", name))?;
        original_files.insert(name, data);
    }
    
    Ok(original_files)
}

