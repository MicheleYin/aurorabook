pub mod chunking;
pub mod audio;
pub mod smil;
pub mod opf;

pub use chunking::*;
pub use audio::*;
pub use smil::*;
pub use opf::*;

use crate::utils::constants::*;
use crate::utils::errors::{AppError, AppResult};
use crate::utils::path_validation::{validate_epub_path, validate_file_size, validate_chapter_count};
use anyhow::{Context, Result as AnyhowResult};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use tauri::{AppHandle, Emitter};

/// Conversion progress information for tracking EPUB to audiobook conversion.
///
/// This struct is emitted to the frontend during conversion to provide
/// real-time progress updates.
///
/// # Fields
/// * `current_chapter` - The chapter currently being processed (1-indexed)
/// * `total_chapters` - Total number of chapters to process
/// * `words_processed` - Number of words processed so far
/// * `total_words` - Total number of words across all chapters
/// * `words_in_current_chapter` - Number of words in the current chapter
/// * `current_step` - Current processing step (e.g., "generating-audio", "merging-audio")
/// * `message` - Human-readable progress message
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversionProgress {
    pub current_chapter: usize,
    pub total_chapters: usize,
    pub words_processed: usize,
    pub total_words: usize,
    pub words_in_current_chapter: usize,
    pub current_step: String,
    pub message: String,
}

/// Chapter data for EPUB to audiobook conversion.
///
/// Contains the full HTML content of a chapter along with its metadata.
///
/// # Fields
/// * `id` - Unique identifier for the chapter
/// * `title` - Chapter title extracted from HTML or metadata
/// * `href` - Relative path to the chapter file within the EPUB
/// * `content_html` - Full HTML content of the chapter
/// * `word_count` - Number of words in this chapter
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversionChapter {
    pub id: String,
    pub title: String,
    pub href: String,
    pub content_html: String,
    pub word_count: usize,
}

/// Options for EPUB to audiobook conversion.
///
/// Specifies the voice to use and which chapters to convert.
///
/// # Fields
/// * `voice_id` - Voice identifier (e.g., "af_heart", "af_bella")
/// * `chapters` - List of chapters to convert with their content
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversionOptions {
    pub voice_id: String,
    pub chapters: Vec<ConversionChapter>,
}

/// Emit progress update to frontend
pub fn emit_progress(app: &AppHandle, progress: ConversionProgress) {
    let _ = app.emit("conversion-progress", progress);
}

/// Count words in HTML content by extracting text and counting word boundaries.
///
/// This function parses HTML, extracts all text content, and counts words
/// by splitting on whitespace and filtering out empty strings.
///
/// # Arguments
/// * `html` - HTML content to count words in
///
/// # Returns
/// The number of words in the HTML content
fn count_words_in_html(html: &str) -> usize {
    use scraper::Html;
    
    let document = Html::parse_document(html);
    let text = document.root_element().text().collect::<String>();
    
    // Split by whitespace and count non-empty segments
    text.split_whitespace()
        .filter(|s| !s.is_empty())
        .count()
}

/// Get the number of CPU cores for parallel processing.
///
/// Returns the number of available CPU cores, with a minimum of 1.
/// This is used to determine how many parallel TTS tasks can run simultaneously.
///
/// # Returns
/// The number of CPU cores available for parallel processing (at least 1).
///
/// # Example
/// ```rust
/// let parallelism = get_parallelism();
/// println!("Using {} cores for parallel processing", parallelism);
/// ```
pub fn get_parallelism() -> usize {
    use num_cpus;
    let logical = num_cpus::get();

    // Reserve at least one core for the OS / UI thread / real-time tasks.
    let mut workers = logical.saturating_sub(1);

    // If the machine has many cores, avoid taking *all* of them.
    // Example: 32-core machines → use 24 cores.
    if logical >= 8 {
        workers = workers.min((logical as f64 * 0.50).round() as usize);
    }

    workers.max(1)

}

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
            content_html: content,
            word_count,
        });
    }
    
    Ok((chapters, stats))
}

/// Progress callback type for conversion progress updates
pub type ProgressCallback = Box<dyn Fn(ConversionProgress) + Send + Sync>;

/// EPUB conversion context containing paths and file storage
struct ConversionContext {
    opf_path: String,
    base_path: String,
    original_files: std::collections::HashMap<String, Vec<u8>>,
    audio_files: Vec<(usize, String)>,
    smil_files: Vec<(usize, String)>,
}

/// Result of processing a single chapter
struct ChapterProcessResult {
    chapter_index: usize,
    files: std::collections::HashMap<String, Vec<u8>>,
    audio_file: (usize, String),
    smil_file: (usize, String),
    words_processed: usize,
}

/// Initialize EPUB conversion by finding OPF path and base path
fn initialize_conversion(epub_data: &[u8]) -> AnyhowResult<(String, String)> {
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
fn extract_original_files(
    epub_data: &[u8],
    opf_path: &str,
) -> AnyhowResult<std::collections::HashMap<String, Vec<u8>>> {
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

/// Map word alignments to HTML span segments for SMIL synchronization
fn map_alignments_to_segments(
    span_mappings: Vec<(String, usize, usize)>,
    word_alignments: &[kokoros::tts::koko::WordAlignment],
    audio_samples: &[f32],
    full_text: &str,
) -> Vec<(String, f64, f64)> {
    let text_words: Vec<&str> = full_text.split_whitespace().filter(|s| !s.is_empty()).collect();
    let mut audio_segments = Vec::new();
    
    for (span_id, start_word_idx, end_word_idx) in span_mappings {
        let mut span_start_time: Option<f64> = None;
        let mut span_end_time: Option<f64> = None;
        
        let alignment_count = word_alignments.len();
        let text_word_count = text_words.len();
        
        if alignment_count > 0 && text_word_count > 0 {
            let alignments_per_word = alignment_count as f64 / text_word_count as f64;
            let start_alignment_idx = (start_word_idx as f64 * alignments_per_word).floor() as usize;
            let end_alignment_idx = ((end_word_idx as f64 * alignments_per_word).ceil() as usize).min(alignment_count);
            
            if start_alignment_idx < alignment_count {
                span_start_time = Some(word_alignments[start_alignment_idx].start_sec as f64);
            }
            if end_alignment_idx > 0 && end_alignment_idx <= alignment_count {
                span_end_time = Some(word_alignments[end_alignment_idx - 1].end_sec as f64);
            }
        }
        
        let (start_time, end_time) = match (span_start_time, span_end_time) {
            (Some(start), Some(end)) => (start, end),
            (Some(start), None) => {
                let end = if !word_alignments.is_empty() {
                    word_alignments.last().unwrap().end_sec as f64
                } else {
                    audio_samples.len() as f64 / SAMPLE_RATE as f64
                };
                (start, end)
            }
            (None, Some(end)) => (0.0, end),
            (None, None) => {
                let total_duration = if !word_alignments.is_empty() {
                    word_alignments.last().unwrap().end_sec as f64
                } else {
                    audio_samples.len() as f64 / SAMPLE_RATE as f64
                };
                let total_words = text_words.len().max(1);
                let duration_per_word = total_duration / total_words as f64;
                let estimated_start = (start_word_idx as f64) * duration_per_word;
                let estimated_end = (end_word_idx as f64) * duration_per_word;
                (estimated_start, estimated_end)
            }
        };
        
        audio_segments.push((span_id, start_time, end_time));
    }
    
    audio_segments
}

/// Convert audio samples to MP3 bytes
fn convert_audio_to_mp3(audio_samples: &[f32]) -> AppResult<Vec<u8>> {
    use crate::utils::audio::f32_to_pcm_le_bytes;
    use crate::utils::constants::WAV_HEADER_SIZE;
    
    let audio_pcm = f32_to_pcm_le_bytes(audio_samples);
    let merged_wav = merge_wav_files(&[audio_pcm], SAMPLE_RATE);
    
    let pcm_data = if merged_wav.len() > WAV_HEADER_SIZE {
        merged_wav[WAV_HEADER_SIZE..].to_vec()
    } else {
        merged_wav
    };
    
    crate::tts_commands::convert_pcm_to_mp3(
        pcm_data,
        SAMPLE_RATE,
        1,
        Some(DEFAULT_MP3_BITRATE),
    )
    .map_err(|e| AppError::Encoding(format!("MP3 conversion failed: {}", e)))
}

/// Generate audio file path for a chapter
fn generate_audio_path(chapter_href: &str, chapter_index: usize, base_path: &str) -> AppResult<(String, String)> {
    let chapter_href_base = chapter_href
        .split('/')
        .last()
        .unwrap_or(&format!("chapter{}", chapter_index + 1))
        .replace(".xhtml", "")
        .replace(".html", "");
    
    let validated_audio_name = validate_epub_path(&format!("Audio/{}.mp3", chapter_href_base))
        .map_err(|e| AppError::InvalidPath(format!("Invalid audio file name: {}", e)))?;
    
    let audio_href_zip = format!("{}{}", base_path, validated_audio_name);
    let audio_href_manifest = validated_audio_name;
    
    Ok((audio_href_zip, audio_href_manifest))
}

/// Resolve chapter path for ZIP storage
fn resolve_chapter_path(href: &str, base_path: &str) -> String {
    if href.starts_with("/") {
        href[1..].to_string()
    } else if !base_path.is_empty() && href.starts_with(base_path) {
        href.to_string()
    } else {
        format!("{}{}", base_path, href)
    }
}

/// Process a single chapter: generate audio, create SMIL, and store files
/// Returns a result struct with all generated files and metadata
async fn process_chapter(
    chapter: &ConversionChapter,
    chapter_index: usize,
    base_path: &str,
    engine: &Arc<kokoros::tts::koko::TTSKokoParallel>,
    worker_id: usize,
    voice_id: &str,
    progress_callback: &ProgressCallback,
    total_words: usize,
    total_chapters: usize,
    words_processed_atomic: Option<Arc<AtomicUsize>>,
) -> AnyhowResult<ChapterProcessResult> {
    log::debug!("Processing chapter {}: '{}' (href: '{}', content_html: {} bytes, word_count: {})", 
        chapter_index + 1, chapter.title, chapter.href, chapter.content_html.len(), chapter.word_count);
    
    // Warn if chapter has no content
    if chapter.content_html.is_empty() {
        log::warn!("Chapter {} '{}' (href: '{}') has no content - skipping audio/SMIL generation", 
            chapter_index + 1, chapter.title, chapter.href);
    }
    
    // Get current total words processed from atomic counter if available
    let current_words_processed = words_processed_atomic
        .as_ref()
        .map(|atomic| atomic.load(Ordering::Relaxed))
        .unwrap_or(0);
    
    progress_callback(ConversionProgress {
        current_chapter: chapter_index + 1,
        total_chapters,
        words_processed: current_words_processed,
        total_words,
        words_in_current_chapter: chapter.word_count,
        current_step: "generating-audio".to_string(),
        message: format!("Generating audio for chapter {}: {} ({} words)", chapter_index + 1, chapter.title, chapter.word_count),
    });
    
    validate_file_size(chapter.content_html.len(), MAX_CHAPTER_SIZE, "Chapter HTML")?;
    validate_epub_path(&chapter.href)?;
    
    let (full_text, updated_html, span_mappings) = extract_text_with_spans(&chapter.content_html)
        .map_err(|e| AppError::EpubParse(format!("Failed to extract text from chapter HTML: {}", e)))?;
    
    let mut files = std::collections::HashMap::new();
    
    if full_text.trim().is_empty() {
        log::debug!("Chapter {} has no text content after extraction - skipping audio generation", chapter_index + 1);
        let chapter_path = resolve_chapter_path(&chapter.href, base_path);
        files.insert(chapter_path, updated_html.into_bytes());
        return Ok(ChapterProcessResult {
            chapter_index,
            files,
            audio_file: (chapter_index, String::new()),
            smil_file: (chapter_index, String::new()),
            words_processed: chapter.word_count,
        });
    }
    
    // Generate TTS audio using round-robin engine instance
    let model_instance = engine.get_model_instance(worker_id);
    let result = engine
        .tts_timestamped_raw_audio_with_instance(
            &full_text,
            "en",
            voice_id,
            1.0,
            None, None, None, None,
            model_instance,
        )
        .map_err(|e| AppError::TtsGeneration(format!("TTS generation failed: {}", e)))?;
    
    let (audio_samples, word_alignments) = match result {
        Some((audio, alignments)) => (audio, alignments),
        None => {
            return Err(anyhow::anyhow!(
                "Chapter {}: TTS engine did not return word alignments. Model may not support durations.",
                chapter_index + 1
            ));
        }
    };
    
    // Map alignments to segments
    let audio_segments = map_alignments_to_segments(
        span_mappings,
        &word_alignments,
        &audio_samples,
        &full_text,
    );
    
    // Update progress with current total words processed
    let current_words_processed = words_processed_atomic
        .as_ref()
        .map(|atomic| atomic.load(Ordering::Relaxed))
        .unwrap_or(0);
    
    progress_callback(ConversionProgress {
        current_chapter: chapter_index + 1,
        total_chapters,
        words_processed: current_words_processed,
        total_words,
        words_in_current_chapter: chapter.word_count,
        current_step: "converting-audio".to_string(),
        message: format!("Converting audio to MP3 for chapter {}...", chapter_index + 1),
    });
    
    // Convert to MP3
    let mp3_bytes = convert_audio_to_mp3(&audio_samples)?;
    
    // Generate audio file paths
    let (audio_href_zip, audio_href_manifest) = generate_audio_path(&chapter.href, chapter_index, base_path)?;
    
    // Store audio file
    files.insert(audio_href_zip.clone(), mp3_bytes);
    log::debug!("Generated audio file: chapter_index={}, href={}", 
        chapter_index, audio_href_manifest);
    
    // Store updated chapter HTML
    let chapter_path_zip = resolve_chapter_path(&chapter.href, base_path);
    let chapter_path_zip_clone = chapter_path_zip.clone();
    files.insert(chapter_path_zip, updated_html.into_bytes());
    
    // Update progress with current total words processed
    let current_words_processed = words_processed_atomic
        .as_ref()
        .map(|atomic| atomic.load(Ordering::Relaxed))
        .unwrap_or(0);
    
    progress_callback(ConversionProgress {
        current_chapter: chapter_index + 1,
        total_chapters,
        words_processed: current_words_processed,
        total_words,
        words_in_current_chapter: chapter.word_count,
        current_step: "creating-smil".to_string(),
        message: format!("Creating SMIL file for chapter {}...", chapter_index + 1),
    });
    
    // Generate SMIL file
    let chapter_href_for_smil = if !base_path.is_empty() && chapter.href.starts_with(base_path) {
        chapter.href[base_path.len()..].to_string()
    } else if chapter.href.starts_with("/") {
        chapter.href[1..].to_string()
    } else {
        chapter.href.clone()
    };
    
    let validated_chapter_href = validate_epub_path(&chapter_href_for_smil)
        .map_err(|e| AppError::InvalidPath(format!("Invalid chapter href for SMIL: {}", e)))?;
    
    let audio_href_for_smil = if validated_chapter_href.contains('/') {
        let depth = validated_chapter_href.matches('/').count();
        let relative_path = format!("{}{}", "../".repeat(depth), audio_href_manifest);
        validate_epub_path(&relative_path)
            .map_err(|e| AppError::InvalidPath(format!("Invalid audio href for SMIL: {}", e)))?
    } else {
        audio_href_manifest.clone()
    };
    
    let smil_content = generate_smil_file(
        &validated_chapter_href,
        &audio_href_for_smil,
        &audio_segments,
    )
    .map_err(|e| AppError::XmlParse(format!("SMIL generation failed: {}", e)))?;
    
    let smil_href_zip = chapter_path_zip_clone
        .replace(".xhtml", ".smil")
        .replace(".html", ".smil");
    
    let smil_href_manifest = validate_epub_path(
        &validated_chapter_href
            .replace(".xhtml", ".smil")
            .replace(".html", ".smil")
    )
    .map_err(|e| AppError::InvalidPath(format!("Invalid SMIL manifest path: {}", e)))?;
    
    files.insert(smil_href_zip, smil_content.into_bytes());
    log::debug!("Generated SMIL file: chapter_index={}, href={}", 
        chapter_index, smil_href_manifest);
    
    Ok(ChapterProcessResult {
        chapter_index,
        files,
        audio_file: (chapter_index, audio_href_manifest),
        smil_file: (chapter_index, smil_href_manifest),
        words_processed: chapter.word_count,
    })
}

/// Build the final EPUB ZIP file with all content
fn build_epub_zip(
    context: &ConversionContext,
    updated_opf: &str,
) -> AnyhowResult<Vec<u8>> {
    use std::io::{Cursor, Write};
    use zip::{ZipWriter, write::FileOptions};
    
    let mut zip_writer = ZipWriter::new(Cursor::new(Vec::new()));
    let file_options = FileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    let mimetype_options = FileOptions::default()
        .compression_method(zip::CompressionMethod::Stored);
    
    // Add mimetype first (EPUB spec requirement)
    if let Some(mimetype_data) = context.original_files.get("mimetype") {
        zip_writer.start_file("mimetype", mimetype_options)
            .context("Failed to add mimetype to ZIP")?;
        zip_writer.write_all(mimetype_data)
            .context("Failed to write mimetype")?;
    } else {
        zip_writer.start_file("mimetype", mimetype_options)
            .context("Failed to add mimetype to ZIP")?;
        zip_writer.write_all(b"application/epub+zip")
            .context("Failed to write mimetype")?;
    }
    
    // Add META-INF/container.xml
    let container_xml = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="{}" media-type="application/oebps-package+xml" />
  </rootfiles>
</container>"#,
        context.opf_path
    );
    zip_writer.start_file("META-INF/container.xml", file_options)
        .context("Failed to add container.xml to ZIP")?;
    zip_writer.write_all(container_xml.as_bytes())
        .context("Failed to write container.xml")?;
    
    // Add other META-INF files
    let mut meta_inf_files: Vec<_> = context.original_files.iter()
        .filter(|(path, _)| path.starts_with("META-INF/") && *path != "META-INF/container.xml")
        .collect();
    meta_inf_files.sort_by_key(|(path, _)| *path);
    
    for (file_path, file_data) in meta_inf_files {
        zip_writer.start_file(file_path, file_options)
            .with_context(|| format!("Failed to add {} to ZIP", file_path))?;
        zip_writer.write_all(file_data)
            .with_context(|| format!("Failed to write {}", file_path))?;
    }
    
    // Add updated OPF
    zip_writer.start_file(&context.opf_path, file_options)
        .context("Failed to add OPF to ZIP")?;
    zip_writer.write_all(updated_opf.as_bytes())
        .context("Failed to write OPF")?;
    
    // Add all other files
    let mut other_files: Vec<_> = context.original_files.iter()
        .filter(|(path, _)| {
            *path != "mimetype" 
            && *path != "META-INF/container.xml" 
            && *path != &context.opf_path
        })
        .collect();
    other_files.sort_by_key(|(path, _)| *path);
    
    for (file_path, file_data) in other_files {
        zip_writer.start_file(file_path, file_options)
            .with_context(|| format!("Failed to add file {} to ZIP", file_path))?;
        zip_writer.write_all(file_data)
            .with_context(|| format!("Failed to write file data for {}", file_path))?;
    }
    
    let zip_data = zip_writer.finish()
        .context("Failed to finalize ZIP")?;
    
    Ok(zip_data.into_inner())
}

/// Initialize conversion context and read original OPF content
fn initialize_conversion_context(
    epub_data: &[u8],
) -> AnyhowResult<(ConversionContext, String)> {
    use std::io::{Cursor, Read};
    use zip::ZipArchive;
    
    let (opf_path, base_path) = initialize_conversion(epub_data)?;
    let original_files = extract_original_files(epub_data, &opf_path)?;
    
    let context = ConversionContext {
        opf_path: opf_path.clone(),
        base_path,
        original_files,
        audio_files: Vec::new(),
        smil_files: Vec::new(),
    };
    
    // Read original OPF content
    let mut archive = ZipArchive::new(Cursor::new(epub_data))
        .context("Failed to open EPUB for OPF read")?;
    let original_opf_content = archive.by_name(&opf_path)
        .and_then(|mut f| {
            let mut content = String::new();
            f.read_to_string(&mut content)?;
            Ok(content)
        })
        .context("Failed to read original OPF")?;
    
    Ok((context, original_opf_content))
}

/// Merge a chapter processing result into the conversion context
fn merge_chapter_result(
    context: &mut ConversionContext,
    result: ChapterProcessResult,
) {
    // Merge files into context
    for (path, data) in result.files {
        context.original_files.insert(path, data);
    }
    
    // Add audio and SMIL file entries only if they're not empty
    if !result.audio_file.1.is_empty() {
        context.audio_files.push(result.audio_file);
    }
    if !result.smil_file.1.is_empty() {
        context.smil_files.push(result.smil_file);
    }
    
    // Sort audio and SMIL files by chapter index to maintain order
    context.audio_files.sort_by_key(|(idx, _)| *idx);
    context.smil_files.sort_by_key(|(idx, _)| *idx);
}

/// Rebuild EPUB with current progress and save to Tauri store
async fn rebuild_and_save_epub(
    context: &ConversionContext,
    original_opf_content: &str,
    chapter_hrefs: &[String],
    chapter_index: usize,
    total_chapters: usize,
    words_processed: usize,
    total_words: usize,
    words_in_current_chapter: usize,
    progress_callback: &ProgressCallback,
    app: Option<&AppHandle>,
    source_path: Option<&str>,
) -> AnyhowResult<Vec<u8>> {
    // Update progress
    progress_callback(ConversionProgress {
        current_chapter: chapter_index + 1,
        total_chapters,
        words_processed,
        total_words,
        words_in_current_chapter,
        current_step: "saving-epub".to_string(),
        message: format!("Saving EPUB after chapter {}...", chapter_index + 1),
    });
    
    // Update OPF with current progress
    let updated_opf = update_content_opf(
        original_opf_content,
        &context.audio_files,
        &context.smil_files,
        chapter_hrefs,
    )
    .map_err(|e| anyhow::anyhow!("Failed to update content.opf: {}", e))?;
    
    // Build EPUB with current progress
    let epub_output = build_epub_zip(context, &updated_opf)?;
    
    // Save to Tauri store if app and source_path are provided
    if let (Some(app_ref), Some(source_path_ref)) = (app, source_path) {
        use crate::book_service::storage::save_epub_buffer_to_store;
        save_epub_buffer_to_store(app_ref, source_path_ref, &epub_output).await
            .map_err(|e| anyhow::anyhow!("Failed to save EPUB to store: {}", e))?;
        log::debug!("Saved EPUB to store after chapter {}", chapter_index + 1);
    }
    
    Ok(epub_output)
}

/// Build final EPUB with all completed chapters
fn build_final_epub(
    context: &ConversionContext,
    original_opf_content: &str,
    chapter_hrefs: &[String],
) -> AnyhowResult<Vec<u8>> {
    let updated_opf = update_content_opf(
        original_opf_content,
        &context.audio_files,
        &context.smil_files,
        chapter_hrefs,
    )
    .map_err(|e| anyhow::anyhow!("Failed to update content.opf: {}", e))?;
    
    build_epub_zip(context, &updated_opf)
}

/// Core EPUB to audiobook conversion logic using TTS engine pool with round-robin distribution
/// This function processes each chapter as a whole, using word alignments from
/// the TTS engine to generate accurate SMIL timing information.
/// Chapters are processed in parallel with a semaphore limiting concurrent operations
/// to the number of available engine instances.
/// After each chapter, it rebuilds the EPUB and saves it to the Tauri store.
async fn convert_epub_core_with_durations(
    epub_data: Vec<u8>,
    options: ConversionOptions,
    progress_callback: ProgressCallback,
    engine: Arc<kokoros::tts::koko::TTSKokoParallel>,
    instance_counter: Arc<AtomicUsize>,
    num_instances: usize,
    voice_id: String,
    app: Option<AppHandle>,
    source_path: Option<String>,
) -> AnyhowResult<Vec<u8>>
{
    // Wrap progress_callback in Arc for sharing across tasks
    let progress_callback = Arc::new(progress_callback);
    let total_words: usize = options.chapters.iter().map(|c| c.word_count).sum();
    
    progress_callback(ConversionProgress {
        current_chapter: 0,
        total_chapters: options.chapters.len(),
        words_processed: 0,
        total_words,
        words_in_current_chapter: 0,
        current_step: "initializing".to_string(),
        message: "Initializing EPUB conversion with single TTS engine...".to_string(),
    });
    
    validate_chapter_count(options.chapters.len(), MAX_CHAPTERS)?;
    
    // Initialize conversion context and read OPF
    let (mut context, original_opf_content) = initialize_conversion_context(&epub_data)?;
    let base_path = context.base_path.clone();
    let chapter_hrefs: Vec<String> = options.chapters.iter().map(|c| c.href.clone()).collect();
    
    // Create semaphore to limit concurrent operations to available engine instances
    let semaphore = Arc::new(tokio::sync::Semaphore::new(num_instances));
    
    // Atomic counter to track total words processed across all parallel tasks
    let words_processed_atomic = Arc::new(AtomicUsize::new(0));
    
    // Process chapters in parallel with semaphore limiting
    let mut handles = Vec::new();
    for (chapter_index, chapter) in options.chapters.iter().enumerate() {
        let semaphore = Arc::clone(&semaphore);
        let engine = Arc::clone(&engine);
        let instance_counter = Arc::clone(&instance_counter);
        let progress_callback = Arc::clone(&progress_callback);
        let words_processed_atomic = Arc::clone(&words_processed_atomic);
        let base_path = base_path.clone();
        let voice_id = voice_id.clone();
        let chapter = chapter.clone();
        let total_chapters = options.chapters.len();
        
        let handle = tokio::spawn(async move {
            // Acquire semaphore permit (blocks if all engines are busy)
            let _permit = semaphore.acquire().await
                .map_err(|e| anyhow::anyhow!("Failed to acquire semaphore: {}", e))?;
            
            // Get worker_id using round-robin distribution
            let worker_id = instance_counter.fetch_add(1, Ordering::Relaxed) % num_instances;
            
            log::debug!("Processing chapter {}: '{}' with engine instance {}", 
                chapter_index + 1, chapter.title, worker_id);
            
            // Get current total words processed before starting
            let current_total = words_processed_atomic.load(Ordering::Relaxed);
            progress_callback(ConversionProgress {
                current_chapter: chapter_index + 1,
                total_chapters,
                words_processed: current_total,
                total_words,
                words_in_current_chapter: chapter.word_count,
                current_step: "generating-audio".to_string(),
                message: format!("Processing chapter {}: {} ({} words)", chapter_index + 1, chapter.title, chapter.word_count),
            });
            
            // Process the chapter with atomic counter for progress tracking
            let result = process_chapter(
                &chapter,
                chapter_index,
                &base_path,
                &engine,
                worker_id,
                &voice_id,
                &*progress_callback,
                total_words,
                total_chapters,
                Some(Arc::clone(&words_processed_atomic)),
            ).await?;
            
            // Update atomic counter with words processed by this task
            let updated_total = words_processed_atomic.fetch_add(result.words_processed, Ordering::Relaxed) + result.words_processed;
            
            // Report progress with updated total
            progress_callback(ConversionProgress {
                current_chapter: chapter_index + 1,
                total_chapters,
                words_processed: updated_total,
                total_words,
                words_in_current_chapter: chapter.word_count,
                current_step: "completed".to_string(),
                message: format!("Completed chapter {}: {} ({} words processed, {} total)", chapter_index + 1, chapter.title, result.words_processed, updated_total),
            });
            
            Ok::<(usize, ChapterProcessResult), anyhow::Error>((chapter_index, result))
        });
        
        handles.push(handle);
    }
    
    // Collect results and merge them in order
    let mut results: Vec<(usize, ChapterProcessResult)> = Vec::new();
    for handle in handles {
        let result = handle.await
            .map_err(|e| anyhow::anyhow!("Task join error: {}", e))??;
        results.push(result);
    }
    
    // Sort by chapter index to maintain order
    results.sort_by_key(|(idx, _)| *idx);
    
    // Merge results in order
    // Use atomic counter value as the source of truth for words processed
    let words_processed = words_processed_atomic.load(Ordering::Relaxed);
    for (chapter_index, result) in results {
        // Verify words_processed matches (should already be updated by tasks)
        merge_chapter_result(&mut context, result);
        
        log::debug!("Finished processing chapter {}. Total: {} audio files, {} SMIL files", 
            chapter_index + 1, context.audio_files.len(), context.smil_files.len());
        
        // Rebuild EPUB and save after each chapter
        let chapter = &options.chapters[chapter_index];
        rebuild_and_save_epub(
            &context,
            &original_opf_content,
            &chapter_hrefs,
            chapter_index,
            options.chapters.len(),
            words_processed,
            total_words,
            chapter.word_count,
            &*progress_callback,
            app.as_ref(),
            source_path.as_deref(),
        ).await?;
    }
    
    log::debug!("All chapters processed. Total: {} audio files, {} SMIL files", 
        context.audio_files.len(), context.smil_files.len());
    
    // Build final EPUB
    let output = build_final_epub(&context, &original_opf_content, &chapter_hrefs)?;
    
    progress_callback(ConversionProgress {
        current_chapter: options.chapters.len(),
        total_chapters: options.chapters.len(),
        words_processed,
        total_words,
        words_in_current_chapter: 0,
        current_step: "complete".to_string(),
        message: "Completing conversion...".to_string(),
    });
    
    Ok(output)
}

/// Converts an EPUB file to an audiobook format with synchronized audio.
///
/// This function processes each chapter in the EPUB, generates text-to-speech
/// audio for the content, creates SMIL synchronization files for media overlay,
/// and updates the EPUB metadata to include audio tracks and synchronization data.
///
/// The conversion process:
/// 1. Creates a TTS engine pool for efficient parallel processing
/// 2. For each chapter:
///    - Chunks the HTML content into sentences
///    - Generates TTS audio for each chunk in parallel
///    - Merges audio chunks into a single MP3 file
///    - Creates a SMIL file for text-audio synchronization
///    - Updates chapter HTML with span tags for highlighting
/// 3. Updates the EPUB's content.opf with audio and SMIL file references
/// 4. Packages everything into a new EPUB file
///
/// # Arguments
/// * `epub_data` - The original EPUB file as a byte vector
/// * `options` - Conversion options including voice ID and chapters to convert
/// * `app` - Tauri application handle for emitting progress updates to the frontend
///
/// # Returns
/// A new EPUB file (as byte vector) with embedded audio tracks and SMIL files.
/// The returned EPUB is a complete audiobook that can be played in EPUB readers
/// with media overlay support.
///
/// # Errors
/// Returns `AppError::TtsGeneration` if TTS engine creation or audio generation fails.
/// Returns `AppError::EpubParse` if EPUB processing fails.
/// Returns `AppError::ZipArchive` if ZIP operations fail.
/// Returns `AppError::XmlParse` if SMIL or OPF generation fails.
/// Returns `AppError::Encoding` if audio encoding fails.
///
/// # Performance
/// Uses a TTS engine pool to avoid creating engines per task, significantly
/// improving performance for large EPUBs with many chapters.
///
/// # Example
/// ```rust
/// use crate::epub::converter::{ConversionOptions, ConversionChapter};
///
/// let epub_data = std::fs::read("book.epub")?;
/// let options = ConversionOptions {
///     voice_id: "af_heart".to_string(),
///     chapters: vec![/* chapters */],
/// };
/// let converted_epub = convert_epub_to_audiobook(epub_data, options, app).await?;
/// std::fs::write("audiobook.epub", converted_epub)?;
/// ```
pub async fn convert_epub_to_audiobook(
    epub_data: Vec<u8>,
    options: ConversionOptions,
    app: AppHandle,
    source_path: Option<String>,
) -> AppResult<Vec<u8>> {
    use crate::utils::path_resolver::ResourcePathResolver;
    
    // Create progress callback that emits to Tauri
    let app_progress = app.clone();
    let progress_callback: ProgressCallback = Box::new(move |progress| {
        emit_progress(&app_progress, progress);
    });
    
    // Calculate total words
    let total_words: usize = options.chapters.iter().map(|c| c.word_count).sum();
    let num_chapters = options.chapters.len();
    // Emit initial progress event when conversion starts
    progress_callback(ConversionProgress {
        current_chapter: 0,
        total_chapters: options.chapters.len(),
        words_processed: 0,
        total_words,
        words_in_current_chapter: 0,
        current_step: "initializing".to_string(),
        message: format!("Starting conversion of {} chapters ({} words)...", options.chapters.len(), total_words),
    });
    
    // Find model files
    let (onnx_path, voices_path) = ResourcePathResolver::find_model_and_voices(Some(&app))?;
    
    let onnx_path_str = onnx_path.to_str()
        .ok_or_else(|| AppError::Encoding("ONNX path contains invalid UTF-8".to_string()))?
        .to_string();
    let voices_path_str = voices_path.to_str()
        .ok_or_else(|| AppError::Encoding("Voices path contains invalid UTF-8".to_string()))?
        .to_string();
    
    // Create TTS engine pool with at most get_parallelism() instances, capped by num_chapters
    let num_instances = get_parallelism().min(num_chapters);
    let engine = kokoros::tts::koko::TTSKokoParallel::new_with_instances(
        &onnx_path_str,
        &voices_path_str,
        num_instances,
    )
    .await;
    
    log::info!("Created {} TTS engine instances for conversion (parallelism: {}, chapters: {})", 
        num_instances, get_parallelism(), num_chapters);
    
    // Emit progress event for engine creation
    progress_callback(ConversionProgress {
        current_chapter: 0,
        total_chapters: options.chapters.len(),
        words_processed: 0,
        total_words,
        words_in_current_chapter: 0,
        current_step: "initializing".to_string(),
        message: "TTS engine created - ready to process chapters".to_string(),
    });
    
    let engine_arc = std::sync::Arc::new(engine);
    let instance_counter = Arc::new(AtomicUsize::new(0));
    let voice_id = options.voice_id.clone();
    
    convert_epub_core_with_durations(
        epub_data, 
        options, 
        progress_callback, 
        engine_arc,
        instance_counter,
        num_instances,
        voice_id,
        Some(app),
        source_path,
    )
        .await
        .map_err(|e| AppError::EpubParse(e.to_string()))

    
}

/// Standalone version of `convert_epub_to_audiobook` for testing (no AppHandle required).
///
/// This function is identical to `convert_epub_to_audiobook` but doesn't require
/// a Tauri AppHandle, making it suitable for unit tests. It uses a console-based
/// progress callback instead of emitting Tauri events.
///
/// # Arguments
/// * `epub_data` - The original EPUB file as a byte vector
/// * `options` - Conversion options including voice ID and chapters to convert
///
/// # Returns
/// A new EPUB file (as byte vector) with embedded audio tracks and SMIL files.
///
/// # Example
/// ```rust
/// use crate::epub::converter::{ConversionOptions, ConversionChapter};
///
/// let epub_data = std::fs::read("book.epub")?;
/// let options = ConversionOptions {
///     voice_id: "af_heart".to_string(),
///     chapters: vec![/* chapters */],
/// };
/// let converted_epub = convert_epub_to_audiobook_standalone(epub_data, options).await?;
/// std::fs::write("audiobook.epub", converted_epub)?;
/// ```
pub async fn convert_epub_to_audiobook_standalone(
    epub_data: Vec<u8>,
    options: ConversionOptions,
) -> AppResult<Vec<u8>> {
    use crate::utils::path_resolver::ResourcePathResolver;
    
    // Create console-based progress callback for testing
    let progress_callback: ProgressCallback = Box::new(|progress| {
        println!("Progress: {} - {} ({}/{})", 
            progress.current_step, 
            progress.message,
            progress.current_chapter,
            progress.total_chapters);
    });
    
    // Calculate total words
    let total_words: usize = options.chapters.iter().map(|c| c.word_count).sum();
    let num_chapters = options.chapters.len();
    
    // Emit initial progress event when conversion starts
    progress_callback(ConversionProgress {
        current_chapter: 0,
        total_chapters: options.chapters.len(),
        words_processed: 0,
        total_words,
        words_in_current_chapter: 0,
        current_step: "initializing".to_string(),
        message: format!("Starting conversion of {} chapters ({} words)...", options.chapters.len(), total_words),
    });
    
    // Find model files (without AppHandle)
    let (onnx_path, voices_path) = ResourcePathResolver::find_model_and_voices(None)?;
    
    let onnx_path_str = onnx_path.to_str()
        .ok_or_else(|| AppError::Encoding("ONNX path contains invalid UTF-8".to_string()))?
        .to_string();
    let voices_path_str = voices_path.to_str()
        .ok_or_else(|| AppError::Encoding("Voices path contains invalid UTF-8".to_string()))?
        .to_string();
    
    // Create TTS engine pool with at most get_parallelism() instances, capped by num_chapters
    let num_instances = get_parallelism().min(num_chapters);
    let engine = kokoros::tts::koko::TTSKokoParallel::new_with_instances(
        &onnx_path_str,
        &voices_path_str,
        num_instances,
    )
    .await;
    
    log::info!("Created {} TTS engine instances for conversion (parallelism: {}, chapters: {})", 
        num_instances, get_parallelism(), num_chapters);
    
    // Emit progress event for engine creation
    progress_callback(ConversionProgress {
        current_chapter: 0,
        total_chapters: options.chapters.len(),
        words_processed: 0,
        total_words,
        words_in_current_chapter: 0,
        current_step: "initializing".to_string(),
        message: "TTS engine created - ready to process chapters".to_string(),
    });
    
    let engine_arc = std::sync::Arc::new(engine);
    let instance_counter = Arc::new(AtomicUsize::new(0));
    let voice_id = options.voice_id.clone();
    
    convert_epub_core_with_durations(
        epub_data, 
        options, 
        progress_callback, 
        engine_arc,
        instance_counter,
        num_instances,
        voice_id,
        None, // No AppHandle for standalone version
        None, // No source_path for standalone version
    )
        .await
        .map_err(|e| AppError::EpubParse(e.to_string()))
}


