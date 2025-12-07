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
use std::sync::atomic::{AtomicUsize, AtomicBool, Ordering};
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

/// Event emitted when a chapter conversion is completed.
///
/// This event is sent to the frontend to trigger a book refresh
/// so the user can listen to the book as soon as one chapter is ready.
///
/// # Fields
/// * `source_path` - The source path of the book being converted
/// * `chapter_index` - The chapter number that was just completed (1-indexed)
/// * `total_chapters` - Total number of chapters in the book
/// * `chapter_title` - The title of the chapter that was just completed
/// * `audio_generated` - Whether audio was actually generated for this chapter
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChapterCompletedEvent {
    pub source_path: String,
    pub chapter_index: usize,
    pub total_chapters: usize,
    pub chapter_title: String,
    pub audio_generated: bool,
}

/// Event emitted when a conversion is cancelled.
///
/// This event is sent to the frontend to trigger a book refresh
/// and update the UI to show the cancellation state.
///
/// # Fields
/// * `source_path` - The source path of the book being converted
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversionCancelledEvent {
    pub source_path: String,
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
        workers = workers.min((logical as f64 * 0.75).round() as usize);
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

/// Process a single sentence: generate audio and return result
/// The new model doesn't provide timestamps, so we calculate them from audio duration
async fn process_sentence(
    sentence: &str,
    sentence_index: usize,
    engine: &Arc<kokoros::tts::koko::TTSKokoParallel>,
    worker_id: usize,
    voice_id: &str,
) -> AnyhowResult<(Vec<f32>, Vec<kokoros::tts::koko::WordAlignment>, String)> {
    let text = sentence.trim();
    if text.is_empty() {
        return Ok((Vec::new(), Vec::new(), String::new()));
    }
    
    let model_instance = engine.get_model_instance(worker_id);
    // Use tts_raw_audio_with_instance since the new model doesn't provide timestamps
    let audio_samples = engine
        .tts_raw_audio_with_instance(
            text,
            "en",
            voice_id,
            1.0,
            None, None, None, None,
            model_instance,
        )
        .map_err(|e| anyhow::anyhow!("TTS generation failed for sentence {}: {}", sentence_index, e))?;
    
    if audio_samples.is_empty() {
        return Ok((Vec::new(), Vec::new(), String::new()));
    }
    
    // Calculate word alignments from audio duration
    // Split text into words and distribute duration proportionally
    let words: Vec<&str> = text.split_whitespace().filter(|s| !s.is_empty()).collect();
    let audio_duration_sec = audio_samples.len() as f32 / SAMPLE_RATE as f32;
    
    let mut word_alignments = Vec::new();
    if !words.is_empty() {
        // Distribute duration evenly across words
        let duration_per_word = audio_duration_sec / words.len() as f32;
        for (idx, word) in words.iter().enumerate() {
            let start_sec = idx as f32 * duration_per_word;
            let end_sec = (idx + 1) as f32 * duration_per_word;
            word_alignments.push(kokoros::tts::koko::WordAlignment {
                word: word.to_string(),
                start_sec,
                end_sec,
            });
        }
    }
    
    Ok((audio_samples, word_alignments, text.to_string()))
}

/// Process a single chapter: generate audio, create SMIL, and store files
/// Returns a result struct with all generated files and metadata
/// 
/// This function processes HTML elements in parallel within the chapter,
/// then merges the audio segments in order.
async fn process_chapter(
    chapter: &ConversionChapter,
    chapter_index: usize,
    base_path: &str,
    engine: &Arc<kokoros::tts::koko::TTSKokoParallel>,
    _worker_id: usize,
    voice_id: &str,
    progress_callback: &ProgressCallback,
    total_words: usize,
    total_chapters: usize,
    words_processed_atomic: Option<Arc<AtomicUsize>>,
    num_instances: usize,
    cancel_token: Option<Arc<AtomicBool>>,
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
        message: format!("Generating audio for chapter {} ({} words)", chapter.title, chapter.word_count),
    });
    
    validate_file_size(chapter.content_html.len(), MAX_CHAPTER_SIZE, "Chapter HTML")?;
    validate_epub_path(&chapter.href)?;
    
    // Extract all sentences from chapter for round-robin processing
    let sentences = extract_all_sentences(&chapter.content_html)
        .map_err(|e| AppError::EpubParse(format!("Failed to extract sentences: {}", e)))?;
    
    let mut files = std::collections::HashMap::new();
    
    if sentences.is_empty() {
        log::debug!("Chapter {} has no sentences - skipping audio generation", chapter_index + 1);
        let chapter_path = resolve_chapter_path(&chapter.href, base_path);
        files.insert(chapter_path, chapter.content_html.clone().into_bytes());
        return Ok(ChapterProcessResult {
            chapter_index,
            files,
            audio_file: (chapter_index, String::new()),
            smil_file: (chapter_index, String::new()),
            words_processed: chapter.word_count,
        });
    }
    
    log::debug!("Chapter {}: Processing {} sentences in round-robin fashion", chapter_index + 1, sentences.len());
    
    // Create semaphore to limit concurrent sentence processing
    let semaphore = Arc::new(tokio::sync::Semaphore::new(num_instances));
    
    // Track sentences processed for proportional progress tracking
    let sentences_processed = Arc::new(AtomicUsize::new(0));
    let total_sentences = sentences.len();
    
    // Process all sentences in parallel with round-robin distribution
    let mut handles = Vec::new();
    for (idx, sentence) in sentences.iter().enumerate() {
        let semaphore = Arc::clone(&semaphore);
        let engine = Arc::clone(engine);
        let sentence = sentence.clone();
        let voice_id = voice_id.to_string();
        
        let handle = tokio::spawn(async move {
            let _permit = semaphore.acquire().await
                .map_err(|e| anyhow::anyhow!("Failed to acquire semaphore: {}", e))?;
            
            // Round-robin distribution: sentence index % num_instances
            let worker_id = idx % num_instances;
            let result = process_sentence(&sentence, idx, &engine, worker_id, &voice_id).await?;
            
            Ok::<(usize, Vec<f32>, Vec<kokoros::tts::koko::WordAlignment>, String), anyhow::Error>(
                (idx, result.0, result.1, result.2)
            )
        });
        
        handles.push(handle);
    }
    
    // Collect results and update progress as each sentence completes
    let mut sentence_results: Vec<(usize, Vec<f32>, Vec<kokoros::tts::koko::WordAlignment>, String)> = Vec::new();
    for handle in handles {
        let result = handle.await
            .map_err(|e| anyhow::anyhow!("Task join error: {}", e))??;
        
        // Check for cancellation after each sentence finishes processing
        if let Some(ref token) = cancel_token {
            if token.load(Ordering::Relaxed) {
                log::info!("Conversion cancelled after processing sentence in chapter {}", chapter_index + 1);
                return Err(anyhow::anyhow!("Conversion cancelled by user"));
            }
        }
        
        // Update progress after each sentence completes
        let (idx, audio, alignments, text) = result;
        
        // Increment sentences processed counter
        let sentences_done = sentences_processed.fetch_add(1, Ordering::Relaxed) + 1;
        
        // Calculate progress proportionally based on sentences processed
        let chapter_words_progress = if total_sentences > 0 {
            ((chapter.word_count as f64 * sentences_done as f64) / total_sentences as f64).round() as usize
        } else {
            chapter.word_count
        };
        
        // Get current total words processed from previous chapters
        let current_total = words_processed_atomic
            .as_ref()
            .map(|atomic| atomic.load(Ordering::Relaxed))
            .unwrap_or(0);
        
        // Update progress callback
        progress_callback(ConversionProgress {
            current_chapter: chapter_index + 1,
            total_chapters,
            words_processed: current_total + chapter_words_progress,
            total_words,
            words_in_current_chapter: chapter.word_count,
            current_step: "generating-audio".to_string(),
            message: format!("Processing chapter {}: {} ({}/{})", 
                chapter_index + 1, chapter.title, sentences_done, total_sentences),
        });
        
        sentence_results.push((idx, audio, alignments, text));
    }
    
    // Check for cancellation before merging audio segments
    if let Some(ref token) = cancel_token {
        if token.load(Ordering::Relaxed) {
            log::info!("Conversion cancelled before merging audio in chapter {}", chapter_index + 1);
            return Err(anyhow::anyhow!("Conversion cancelled by user"));
        }
    }
    
    // Sort by sentence index to maintain document order
    sentence_results.sort_by_key(|(idx, _, _, _)| *idx);
    
    // Merge audio segments in order and build word alignments
    let mut merged_audio: Vec<f32> = Vec::new();
    let mut all_word_alignments: Vec<kokoros::tts::koko::WordAlignment> = Vec::new();
    
    // Track cumulative audio duration for alignment offset
    let mut cumulative_duration = 0.0;
    
    for (_sentence_idx, audio_samples, word_alignments, _text) in sentence_results {
        if audio_samples.is_empty() {
            continue;
        }
        
        // Offset word alignments by cumulative duration
        let mut offset_alignments: Vec<kokoros::tts::koko::WordAlignment> = word_alignments
            .iter()
            .map(|wa| kokoros::tts::koko::WordAlignment {
                word: wa.word.clone(),
                start_sec: wa.start_sec + cumulative_duration,
                end_sec: wa.end_sec + cumulative_duration,
            })
            .collect();
        
        all_word_alignments.append(&mut offset_alignments);
        
        // Merge audio samples
        merged_audio.extend_from_slice(&audio_samples);
        
        // Update cumulative duration for next sentence
        if !word_alignments.is_empty() {
            cumulative_duration = word_alignments.last().unwrap().end_sec + cumulative_duration;
        } else {
            cumulative_duration += audio_samples.len() as f32 / SAMPLE_RATE as f32;
        }
        
        // Check for cancellation after merging each sentence's audio
        if let Some(ref token) = cancel_token {
            if token.load(Ordering::Relaxed) {
                log::info!("Conversion cancelled while merging audio in chapter {}", chapter_index + 1);
                return Err(anyhow::anyhow!("Conversion cancelled by user"));
            }
        }
    }
    
    // Use extract_text_with_spans to get updated HTML with spans
    // This function generates the actual span IDs that will be in the HTML
    let (extracted_full_text, updated_html_with_spans, extracted_span_mappings) = extract_text_with_spans(&chapter.content_html)
        .map_err(|e| AppError::EpubParse(format!("Failed to extract text with spans: {}", e)))?;
    let updated_html = updated_html_with_spans;
    
    // Extract actual span IDs from the generated HTML to ensure we only create segments for spans that exist
    use regex::Regex;
    use once_cell::sync::Lazy;
    static SPAN_ID_PATTERN: Lazy<Regex> = Lazy::new(|| {
        Regex::new(r#"<span\s+id="(f\d{6})""#).expect("Failed to compile span ID regex")
    });
    
    let mut actual_span_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
    for cap in SPAN_ID_PATTERN.captures_iter(&updated_html) {
        if let Some(span_id) = cap.get(1) {
            actual_span_ids.insert(span_id.as_str().to_string());
        }
    }
    
    // Filter span_mappings to only include spans that actually exist in the HTML
    let total_mappings = extracted_span_mappings.len();
    let filtered_span_mappings: Vec<(String, usize, usize)> = extracted_span_mappings
        .into_iter()
        .filter(|(span_id, _, _)| actual_span_ids.contains(span_id))
        .collect();
    
    log::debug!(
        "Filtered span mappings: {} total mappings, {} exist in HTML, {} after filtering",
        total_mappings,
        actual_span_ids.len(),
        filtered_span_mappings.len()
    );
    
    // Use the filtered span_mappings to ensure IDs match the HTML
    // Map alignments to segments using merged audio
    let audio_segments = map_alignments_to_segments(
        filtered_span_mappings.clone(),
        &all_word_alignments,
        &merged_audio,
        &extracted_full_text,
    );
    
    log::debug!(
        "Created {} audio segments from {} filtered span mappings (word alignments: {}, full text words: {})",
        audio_segments.len(),
        filtered_span_mappings.len(),
        all_word_alignments.len(),
        extracted_full_text.split_whitespace().filter(|s| !s.is_empty()).count()
    );
    
    // Verify all segment IDs exist in the HTML
    let segment_ids: std::collections::HashSet<String> = audio_segments.iter().map(|(id, _, _)| id.clone()).collect();
    let missing_ids: Vec<String> = segment_ids.iter()
        .filter(|id| !actual_span_ids.contains(*id))
        .cloned()
        .collect();
    if !missing_ids.is_empty() {
        log::warn!(
            "Found {} segment IDs that don't exist in HTML: {:?}",
            missing_ids.len(),
            missing_ids.iter().take(10).collect::<Vec<_>>()
        );
    }
    
    // Update progress with current total words processed (including current chapter)
    // Use chapter.word_count from ingestion to avoid double-counting nested elements
    let current_words_processed = words_processed_atomic
        .as_ref()
        .map(|atomic| atomic.load(Ordering::Relaxed))
        .unwrap_or(0);
    let chapter_words = chapter.word_count;
    let total_words_processed = current_words_processed + chapter_words;
    
    progress_callback(ConversionProgress {
        current_chapter: chapter_index + 1,
        total_chapters,
        words_processed: total_words_processed,
        total_words,
        words_in_current_chapter: chapter_words,
        current_step: "converting-audio".to_string(),
        message: format!("Converting audio to MP3 for chapter {}...", chapter_index + 1),
    });
    
    // Convert merged audio to MP3
    let mp3_bytes = convert_audio_to_mp3(&merged_audio)?;
    
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
    
    // Update progress with current total words processed (including current chapter)
    // Use chapter.word_count from ingestion to avoid double-counting nested elements
    let current_words_processed = words_processed_atomic
        .as_ref()
        .map(|atomic| atomic.load(Ordering::Relaxed))
        .unwrap_or(0);
    let chapter_words = chapter.word_count;
    let total_words_processed = current_words_processed + chapter_words;
    
    progress_callback(ConversionProgress {
        current_chapter: chapter_index + 1,
        total_chapters,
        words_processed: total_words_processed,
        total_words,
        words_in_current_chapter: chapter_words,
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
    
    // Use chapter.word_count from ingestion to avoid double-counting nested elements
    // This matches the word count calculated during ingestion
    let actual_words_processed = chapter.word_count;
    
    Ok(ChapterProcessResult {
        chapter_index,
        files,
        audio_file: (chapter_index, audio_href_manifest),
        smil_file: (chapter_index, smil_href_manifest),
        words_processed: actual_words_processed,
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
    chapter_title: Option<&str>,
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
        
        // Update book audio tracks so user can listen as soon as one chapter is ready
        use crate::epub::book_update::update_book_audio_tracks;
        if let Err(e) = update_book_audio_tracks(&epub_output, source_path_ref, app_ref).await {
            log::warn!("Failed to update book audio tracks after chapter {}: {}", chapter_index + 1, e);
            // Don't fail the conversion if audio track update fails
        } else {
            log::debug!("Updated book audio tracks after chapter {}", chapter_index + 1);
            
            // Mark chapter as completed in the book
            use crate::book_service::storage::{load_all_books, save_all_books};
            use crate::book_service::models::ConversionStatus;
            if let Ok(mut books) = load_all_books(app_ref).await {
                if let Some(book) = books.iter_mut().find(|b| b.source_path == source_path_ref) {
                    // Get the chapter href for this chapter
                    if chapter_index < chapter_hrefs.len() {
                        let chapter_href = &chapter_hrefs[chapter_index];
                        if !book.completed_chapters.contains(chapter_href) {
                            book.completed_chapters.push(chapter_href.clone());
                            log::debug!("Marked chapter {} as completed", chapter_href);
                            
                            // Check if all chapters are completed
                            if book.completed_chapters.len() >= book.chapters.len() {
                                book.conversion_status = ConversionStatus::Done;
                                log::info!("All chapters completed, marking conversion as done");
                            }
                            
                            // Save the updated book
                            if let Err(e) = save_all_books(app_ref, &books).await {
                                log::warn!("Failed to save completed chapter: {}", e);
                            }
                        }
                    }
                }
            }
            
            // Check if audio was generated for this chapter
            // Audio files are stored as (chapter_index, audio_path) tuples
            let audio_generated = context.audio_files.iter()
                .any(|(idx, _)| *idx == chapter_index);
            
            // Emit event to frontend to refetch the book
            let event = ChapterCompletedEvent {
                source_path: source_path_ref.to_string(),
                chapter_index: chapter_index + 1,
                total_chapters,
                chapter_title: chapter_title.unwrap_or(&format!("Chapter {}", chapter_index + 1)).to_string(),
                audio_generated,
            };
            
            if let Err(e) = app_ref.emit("chapter-completed", event) {
                log::warn!("Failed to emit chapter-completed event: {}", e);
            } else {
                log::debug!("Emitted chapter-completed event for chapter {} (audio_generated: {})", chapter_index + 1, audio_generated);
            }
        }
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
    _instance_counter: Arc<AtomicUsize>,
    num_instances: usize,
    voice_id: String,
    app: Option<AppHandle>,
    source_path: Option<String>,
    cancel_token: Option<Arc<AtomicBool>>,
    initial_words_processed: usize,
    total_words_all: usize,
    initial_chapter_index: usize,
    total_chapters_all: usize,
) -> AnyhowResult<Vec<u8>>
{
    // Wrap progress_callback in Arc for sharing across tasks
    let progress_callback = Arc::new(progress_callback);
    
    // Initialize atomic counter with words already processed
    let words_processed_atomic = Arc::new(AtomicUsize::new(initial_words_processed));
    
    progress_callback(ConversionProgress {
        current_chapter: initial_chapter_index,
        total_chapters: total_chapters_all,
        words_processed: initial_words_processed,
        total_words: total_words_all,
        words_in_current_chapter: 0,
        current_step: "initializing".to_string(),
        message: "Initializing EPUB conversion with single TTS engine...".to_string(),
    });
    
    validate_chapter_count(options.chapters.len(), MAX_CHAPTERS)?;
    
    // Initialize conversion context and read OPF
    let (mut context, original_opf_content) = initialize_conversion_context(&epub_data)?;
    let base_path = context.base_path.clone();
    let chapter_hrefs: Vec<String> = options.chapters.iter().map(|c| c.href.clone()).collect();
    
    // Process chapters sequentially (not in parallel)
    for (chapter_index, chapter) in options.chapters.iter().enumerate() {
        // Check for cancellation before processing each chapter
        if let Some(ref token) = cancel_token {
            if token.load(Ordering::Relaxed) {
                log::info!("Conversion cancelled at chapter {}", chapter_index + 1);
                return Err(anyhow::anyhow!("Conversion cancelled by user"));
            }
        }
        
        // Get worker_id using round-robin distribution (can use 0 since chapters are sequential)
        let worker_id = chapter_index % num_instances;
        
        log::debug!("Processing chapter {}: '{}' with engine instance {}", 
            chapter_index + 1, chapter.title, worker_id);
        
        // Get current total words processed before starting
        let current_total = words_processed_atomic.load(Ordering::Relaxed);
        progress_callback(ConversionProgress {
            current_chapter: initial_chapter_index + chapter_index + 1,
            total_chapters: total_chapters_all,
            words_processed: current_total,
            total_words: total_words_all,
            words_in_current_chapter: chapter.word_count,
            current_step: "generating-audio".to_string(),
            message: format!("Processing chapter {}: {} ({} words)", initial_chapter_index + chapter_index + 1, chapter.title, chapter.word_count),
        });
        
        // Process the chapter with atomic counter for progress tracking
        // HTML elements within the chapter will be processed in parallel
        let result = process_chapter(
            chapter,
            chapter_index,
            &base_path,
            &engine,
            worker_id,
            &voice_id,
            &*progress_callback,
            total_words_all,
            total_chapters_all,
            Some(Arc::clone(&words_processed_atomic)),
            num_instances,
            cancel_token.as_ref().map(Arc::clone),
        ).await?;
        
        // Store words processed before moving result
        let chapter_words_processed = result.words_processed;
        
        // Update atomic counter with words processed by this chapter
        // fetch_add returns the old value, so we add the new value to get the updated total
        let updated_total = words_processed_atomic.fetch_add(chapter_words_processed, Ordering::Relaxed) + chapter_words_processed;
        
        // Report progress with updated total
        progress_callback(ConversionProgress {
            current_chapter: initial_chapter_index + chapter_index + 1,
            total_chapters: total_chapters_all,
            words_processed: updated_total,
            total_words: total_words_all,
            words_in_current_chapter: chapter_words_processed, // Use actual words processed
            current_step: "completed".to_string(),
            message: format!("Completed chapter {}: {} ({} words processed, {} total)", initial_chapter_index + chapter_index + 1, chapter.title, chapter_words_processed, updated_total),
        });
        
        // Merge chapter result into context
        merge_chapter_result(&mut context, result);
        
        log::debug!("Finished processing chapter {}. Total: {} audio files, {} SMIL files", 
            chapter_index + 1, context.audio_files.len(), context.smil_files.len());
        
        // Check for cancellation before rebuilding
        if let Some(ref token) = cancel_token {
            if token.load(Ordering::Relaxed) {
                log::info!("Conversion cancelled after chapter {}", chapter_index + 1);
                // Save current progress before returning
                let words_processed = words_processed_atomic.load(Ordering::Relaxed);
                if let (Some(app_ref), Some(source_path_ref)) = (app.as_ref(), source_path.as_ref()) {
                    use crate::book_service::storage::{load_all_books, save_all_books};
                    if let Ok(mut books) = load_all_books(app_ref).await {
                        if let Some(book) = books.iter_mut().find(|b| b.source_path == *source_path_ref) {
                            if book.total_words.is_none() {
                                book.total_words = Some(total_words_all);
                            }
                            book.words_processed = Some(words_processed);
                            if let Err(e) = save_all_books(app_ref, &books).await {
                                log::warn!("Failed to save words_processed on cancellation: {}", e);
                            } else {
                                log::debug!("Saved words_processed on cancellation: {} / {}", words_processed, total_words_all);
                            }
                        }
                    }
                }
                return Err(anyhow::anyhow!("Conversion cancelled by user"));
            }
        }
        
        // Rebuild EPUB and save after each chapter
        let words_processed = words_processed_atomic.load(Ordering::Relaxed);
        rebuild_and_save_epub(
            &context,
            &original_opf_content,
            &chapter_hrefs,
            chapter_index,
            total_chapters_all,
            words_processed,
            total_words_all,
            chapter_words_processed, // Use actual words processed, not chapter.word_count
            &*progress_callback,
            app.as_ref(),
            source_path.as_deref(),
            Some(&chapter.title),
        ).await?;
        
        // Check for cancellation after rebuilding (in case it was cancelled during rebuild)
        if let Some(ref token) = cancel_token {
            if token.load(Ordering::Relaxed) {
                log::info!("Conversion cancelled after rebuilding chapter {}", chapter_index + 1);
                // Save current progress before returning
                let words_processed = words_processed_atomic.load(Ordering::Relaxed);
                if let (Some(app_ref), Some(source_path_ref)) = (app.as_ref(), source_path.as_ref()) {
                    use crate::book_service::storage::{load_all_books, save_all_books};
                    if let Ok(mut books) = load_all_books(app_ref).await {
                        if let Some(book) = books.iter_mut().find(|b| b.source_path == *source_path_ref) {
                            if book.total_words.is_none() {
                                book.total_words = Some(total_words_all);
                            }
                            book.words_processed = Some(words_processed);
                            if let Err(e) = save_all_books(app_ref, &books).await {
                                log::warn!("Failed to save words_processed on cancellation: {}", e);
                            } else {
                                log::debug!("Saved words_processed on cancellation: {} / {}", words_processed, total_words_all);
                            }
                        }
                    }
                }
                return Err(anyhow::anyhow!("Conversion cancelled by user"));
            }
        }
        
        // Note: We don't save words_processed to DB after each chapter anymore
        // It's tracked in atomics and will be saved only on cancellation or completion
    }
    
    log::debug!("All chapters processed. Total: {} audio files, {} SMIL files", 
        context.audio_files.len(), context.smil_files.len());
    
    // Build final EPUB
    let output = build_final_epub(&context, &original_opf_content, &chapter_hrefs)?;
    
    // Get final words processed count
    let final_words_processed = words_processed_atomic.load(Ordering::Relaxed);
    
    progress_callback(ConversionProgress {
        current_chapter: total_chapters_all,
        total_chapters: total_chapters_all,
        words_processed: final_words_processed,
        total_words: total_words_all,
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
    cancel_token: Option<Arc<std::sync::atomic::AtomicBool>>,
    initial_words_processed: Option<usize>,
    total_words_all: Option<usize>,
    initial_chapter_index: Option<usize>,
    total_chapters_all: Option<usize>,
) -> AppResult<Vec<u8>> {
    use crate::utils::path_resolver::ResourcePathResolver;
    
    // Create progress callback that emits to Tauri
    let app_progress = app.clone();
    let progress_callback: ProgressCallback = Box::new(move |progress| {
        emit_progress(&app_progress, progress);
    });
    
    // Calculate total words for remaining chapters
    let total_words_remaining: usize = options.chapters.iter().map(|c| c.word_count).sum();
    let num_chapters = options.chapters.len();
    
    // Use provided values if resuming, otherwise use defaults
    let words_processed_start = initial_words_processed.unwrap_or(0);
    let total_words_display = total_words_all.unwrap_or(total_words_remaining);
    let current_chapter_start = initial_chapter_index.unwrap_or(0);
    let total_chapters_display = total_chapters_all.unwrap_or(num_chapters);
    let num_chapters_for_call = num_chapters; // Store before options is moved
    
    // Emit initial progress event when conversion starts (with restored values if resuming)
    progress_callback(ConversionProgress {
        current_chapter: current_chapter_start,
        total_chapters: total_chapters_display,
        words_processed: words_processed_start,
        total_words: total_words_display,
        words_in_current_chapter: 0,
        current_step: "initializing".to_string(),
        message: if words_processed_start > 0 {
            format!("Resuming conversion: {} chapters remaining ({} words), {} words already processed out of {} total", 
                num_chapters, total_words_remaining, words_processed_start, total_words_display)
        } else {
            format!("Starting conversion of {} chapters ({} words)...", num_chapters, total_words_remaining)
        },
    });
    
    // Find model files
    let (onnx_path, voices_path) = ResourcePathResolver::find_model_and_voices(Some(&app))?;
    
    // Note: RuleBasedG2p (voirs-g2p) doesn't require resource directories
    // as it uses rule-based phonemization without model files
    
    let onnx_path_str = onnx_path.to_str()
        .ok_or_else(|| AppError::Encoding("ONNX path contains invalid UTF-8".to_string()))?
        .to_string();
    let voices_path_str = voices_path.to_str()
        .ok_or_else(|| AppError::Encoding("Voices path contains invalid UTF-8".to_string()))?
        .to_string();
    
    // Create TTS engine pool with at most get_parallelism() instances, capped by num_chapters
    let num_instances = get_parallelism();
    let engine = kokoros::tts::koko::TTSKokoParallel::new_with_instances(
        &onnx_path_str,
        &voices_path_str,
        num_instances,
    )
    .await;
    
    log::info!("Created {} TTS engine instances for conversion (parallelism: {}, chapters: {})", 
        num_instances, get_parallelism(), num_chapters);
    
    // Emit progress event for engine creation (use provided values if resuming)
    progress_callback(ConversionProgress {
        current_chapter: initial_chapter_index.unwrap_or(0),
        total_chapters: total_chapters_all.unwrap_or(options.chapters.len()),
        words_processed: initial_words_processed.unwrap_or(0),
        total_words: total_words_all.unwrap_or(total_words_remaining),
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
        cancel_token,
        initial_words_processed.unwrap_or(0),
        total_words_all.unwrap_or(total_words_remaining),
        initial_chapter_index.unwrap_or(0),
        total_chapters_all.unwrap_or(num_chapters_for_call),
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
    cancel_token: Option<Arc<AtomicBool>>,
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
    let num_chapters_for_call = num_chapters; // Store before options is moved
    
    // Emit initial progress event when conversion starts
    progress_callback(ConversionProgress {
        current_chapter: 0,
        total_chapters: num_chapters,
        words_processed: 0,
        total_words,
        words_in_current_chapter: 0,
        current_step: "initializing".to_string(),
        message: format!("Starting conversion of {} chapters ({} words)...", num_chapters, total_words),
    });
    
    // Find model files (without AppHandle)
    let (onnx_path, voices_path) = ResourcePathResolver::find_model_and_voices(None)?;
    
    // Note: RuleBasedG2p (voirs-g2p) doesn't require resource directories
    // as it uses rule-based phonemization without model files
    
    let onnx_path_str = onnx_path.to_str()
        .ok_or_else(|| AppError::Encoding("ONNX path contains invalid UTF-8".to_string()))?
        .to_string();
    let voices_path_str = voices_path.to_str()
        .ok_or_else(|| AppError::Encoding("Voices path contains invalid UTF-8".to_string()))?
        .to_string();
    
    // Create TTS engine pool with at most get_parallelism() instances, capped by num_chapters
    let num_instances = get_parallelism();
    let engine = kokoros::tts::koko::TTSKokoParallel::new_with_instances(
        &onnx_path_str,
        &voices_path_str,
        num_instances,
    )
    .await;
    
    log::info!("Created {} TTS engine instances for conversion (parallelism: {}, chapters: {})", 
        num_instances, get_parallelism(), num_chapters);
    
    // Calculate total words for remaining chapters
    let total_words_remaining: usize = options.chapters.iter().map(|c| c.word_count).sum();
    
    // Emit progress event for engine creation
    progress_callback(ConversionProgress {
        current_chapter: 0,
        total_chapters: num_chapters,
        words_processed: 0,
        total_words: total_words_remaining,
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
        cancel_token, // Pass cancellation token
        0, // Initial words processed (standalone version starts fresh)
        total_words_remaining, // Total words across all chapters
        0, // Initial chapter index
        num_chapters_for_call, // Total chapters across all
    )
        .await
        .map_err(|e| AppError::EpubParse(e.to_string()))
}


