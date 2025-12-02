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
        
        // Use content found above, or empty string if not found
        let content = content.unwrap_or_else(|| String::new());
        
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

/// Core EPUB to audiobook conversion logic using single TTS instance with durations
/// This function processes each chapter as a whole, using word alignments from
/// the TTS engine to generate accurate SMIL timing information.
/// 
/// Uses epub-builder crate to properly construct the EPUB with all original files,
/// new audio files, SMIL files, and updated metadata.
async fn convert_epub_core_with_durations(
    epub_data: Vec<u8>,
    options: ConversionOptions,
    progress_callback: ProgressCallback,
    engine: Arc<kokoros::tts::koko::TTSKokoParallel>,
    voice_id: String,
) -> AnyhowResult<Vec<u8>>
{
    use std::collections::HashMap;
    use std::io::{Cursor, Read};
    use zip::ZipArchive;
    
    // Calculate total words across all chapters
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
    
    // Find OPF path to determine base path for preserving EPUB structure
    use crate::epub::parser::{find_opf_path, derive_base_path_from_opf};
    let epub_slice: &[u8] = &epub_data;
    let mut temp_archive = ZipArchive::new(Cursor::new(epub_slice))
        .map_err(|e| anyhow::anyhow!("Failed to open EPUB for OPF search: {}", e))?;
    let opf_path = find_opf_path(&mut temp_archive)
        .map_err(|e| anyhow::anyhow!("Failed to find OPF path: {}", e))?;
    let base_path = derive_base_path_from_opf(&opf_path);
    
    // Load original EPUB as ZIP to extract all files
    let mut archive = ZipArchive::new(Cursor::new(&epub_data))
        .context("Failed to open EPUB")?;
    
    let mut audio_files: Vec<(usize, String)> = Vec::new();
    let mut smil_files: Vec<(usize, String)> = Vec::new();
    let mut original_files: HashMap<String, Vec<u8>> = HashMap::new();
    
    // Extract all existing files from original EPUB
    for i in 0..archive.len() {
        let mut file = archive.by_index(i)
            .with_context(|| format!("Failed to read file {} from EPUB", i))?;
        let name = file.name().to_string();
        
        // Skip mimetype, OPF, and files we'll replace (audio, SMIL, updated chapters)
        // We'll handle these separately
        if name == "mimetype" || name.as_str() == opf_path.as_str() {
            continue;
        }
        
        // Validate file path for security
        validate_epub_path(&name)
            .map_err(|e| anyhow::anyhow!("Invalid file path in EPUB: {}", e))?;
        
        // Validate file size before reading
        let file_size = file.size() as usize;
        validate_file_size(file_size, MAX_CHAPTER_SIZE, "EPUB file")
            .map_err(|e| anyhow::anyhow!("File size validation failed: {}", e))?;
        
        let mut data = Vec::new();
        std::io::copy(&mut file, &mut data)
            .with_context(|| format!("Failed to read file data for {}", name))?;
        original_files.insert(name, data);
    }
    
    // Validate chapter count
    validate_chapter_count(options.chapters.len(), MAX_CHAPTERS)?;
    
    // Track words processed across all chapters
    let mut words_processed = 0;
    
    // Process each chapter
    for (chapter_index, chapter) in options.chapters.iter().enumerate() {
        let chapter_word_count = chapter.word_count;
        
        progress_callback(ConversionProgress {
            current_chapter: chapter_index + 1,
            total_chapters: options.chapters.len(),
            words_processed,
            total_words,
            words_in_current_chapter: chapter_word_count,
            current_step: "generating-audio".to_string(),
            message: format!("Generating audio for chapter {}: {} ({} words)", chapter_index + 1, chapter.title, chapter_word_count),
        });
        
        // Validate chapter content size
        validate_file_size(chapter.content_html.len(), MAX_CHAPTER_SIZE, "Chapter HTML")?;
        
        // Validate chapter href path
        validate_epub_path(&chapter.href)?;
        
        // Extract all text with span IDs (no chunking)
        let (full_text, updated_html, span_mappings) = extract_text_with_spans(&chapter.content_html)
            .map_err(|e| AppError::EpubParse(format!("Failed to extract text from chapter HTML: {}", e)))?;
        
        if full_text.trim().is_empty() {
            // Chapter has no words, mark as complete
            // We'll still add the updated HTML to original_files
            let chapter_path = if chapter.href.starts_with("/") {
                chapter.href[1..].to_string()
            } else if !base_path.is_empty() && chapter.href.starts_with(&base_path) {
                chapter.href.clone()
            } else {
                format!("{}{}", base_path, chapter.href)
            };
            original_files.insert(chapter_path, updated_html.into_bytes());
            words_processed += chapter_word_count;
            continue;
        }
        
        // Generate TTS for entire chapter text using single engine instance
        let model_instance = engine.get_model_instance(0);
        let result = engine
            .tts_timestamped_raw_audio_with_instance(
                &full_text,
                "en",
                &voice_id,
                1.0,
                None, // initial_silence
                None, // request_id
                None, // instance_id
                None, // chunk_number
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
        
        // Map word alignments to spans based on word positions
        // Word alignments are in the order they appear in the spoken text
        // We need to map them to spans based on word indices in the extracted text
        let mut audio_segments: Vec<(String, f64, f64)> = Vec::new();
        
        // Extract words from full text for matching
        let text_words: Vec<&str> = full_text.split_whitespace().filter(|s| !s.is_empty()).collect();
        
        // Map spans to audio segments using word alignments
        // Each span has a start_word_idx and end_word_idx that correspond to word positions in the extracted text
        for (span_id, start_word_idx, end_word_idx) in span_mappings {
            // Find the corresponding word alignments for this span
            // Word alignments should roughly correspond to text words, but may include punctuation
            let mut span_start_time: Option<f64> = None;
            let mut span_end_time: Option<f64> = None;
            
            // Try to match word alignments to text words
            // Since alignments might include punctuation, we match by position
            let alignment_count = word_alignments.len();
            let text_word_count = text_words.len();
            
            if alignment_count > 0 && text_word_count > 0 {
                // Calculate approximate mapping: alignments per text word
                let alignments_per_word = alignment_count as f64 / text_word_count as f64;
                
                // Map span word indices to alignment indices
                let start_alignment_idx = (start_word_idx as f64 * alignments_per_word).floor() as usize;
                let end_alignment_idx = ((end_word_idx as f64 * alignments_per_word).ceil() as usize).min(alignment_count);
                
                if start_alignment_idx < alignment_count {
                    span_start_time = Some(word_alignments[start_alignment_idx].start_sec as f64);
                }
                if end_alignment_idx > 0 && end_alignment_idx <= alignment_count {
                    span_end_time = Some(word_alignments[end_alignment_idx - 1].end_sec as f64);
                }
            }
            
            // Use alignment times if found, otherwise estimate
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
                    // Fallback: estimate based on word count
                    let total_duration = if !word_alignments.is_empty() {
                        word_alignments.last().unwrap().end_sec as f64
                    } else {
                        audio_samples.len() as f64 / SAMPLE_RATE as f64
                    };
                    let _span_word_count = end_word_idx - start_word_idx;
                    let total_words = text_words.len().max(1);
                    let duration_per_word = total_duration / total_words as f64;
                    let estimated_start = (start_word_idx as f64) * duration_per_word;
                    let estimated_end = (end_word_idx as f64) * duration_per_word;
                    (estimated_start, estimated_end)
                }
            };
            
            audio_segments.push((span_id, start_time, end_time));
        }
        
        // Mark chapter words as fully processed
        words_processed += chapter_word_count;
        
        progress_callback(ConversionProgress {
            current_chapter: chapter_index + 1,
            total_chapters: options.chapters.len(),
            words_processed,
            total_words,
            words_in_current_chapter: chapter_word_count,
            current_step: "converting-audio".to_string(),
            message: format!("Converting audio to MP3 for chapter {}...", chapter_index + 1),
        });
        
        // Convert audio samples to PCM bytes and create WAV
        use crate::utils::audio::f32_to_pcm_le_bytes;
        let audio_pcm = f32_to_pcm_le_bytes(&audio_samples);
        let merged_wav = merge_wav_files(&[audio_pcm], SAMPLE_RATE);
        
        // Convert to MP3
        progress_callback(ConversionProgress {
            current_chapter: chapter_index + 1,
            total_chapters: options.chapters.len(),
            words_processed,
            total_words,
            words_in_current_chapter: chapter_word_count,
            current_step: "converting-audio".to_string(),
            message: format!("Converting audio to MP3 for chapter {}...", chapter_index + 1),
        });
        
        // Extract PCM from WAV (skip WAV header)
        use crate::utils::constants::WAV_HEADER_SIZE;
        let pcm_data = if merged_wav.len() > WAV_HEADER_SIZE {
            merged_wav[WAV_HEADER_SIZE..].to_vec()
        } else {
            merged_wav
        };
        
        // Convert to MP3
        let mp3_bytes = crate::tts_commands::convert_pcm_to_mp3(
            pcm_data,
            SAMPLE_RATE,
            1,
            Some(DEFAULT_MP3_BITRATE),
        )
        .map_err(|e| AppError::Encoding(format!("MP3 conversion failed: {}", e)))?;
        
        // Determine audio file path (validate to prevent path traversal)
        let chapter_href_base = chapter.href
            .split('/')
            .last()
            .unwrap_or(&format!("chapter{}", chapter_index + 1))
            .replace(".xhtml", "")
            .replace(".html", "");
        
        // Validate audio file name to prevent path traversal
        let validated_audio_name = validate_epub_path(&format!("Audio/{}.mp3", chapter_href_base))
            .map_err(|e| AppError::InvalidPath(format!("Invalid audio file name: {}", e)))?;
        
        // Use base path for audio file location
        let audio_href_zip = format!("{}{}", base_path, validated_audio_name);
        let audio_href_manifest = validated_audio_name;
        
        // Store audio file - will be added to epub-builder later
        original_files.insert(audio_href_zip.clone(), mp3_bytes);
        let audio_href_manifest_clone = audio_href_manifest.clone();
        audio_files.push((chapter_index, audio_href_manifest));
        
        // Update chapter HTML - preserve original path structure
        let chapter_path_zip = if chapter.href.starts_with("/") {
            chapter.href[1..].to_string()
        } else if !base_path.is_empty() && chapter.href.starts_with(&base_path) {
            chapter.href.clone()
        } else {
            format!("{}{}", base_path, chapter.href)
        };
        let chapter_path_zip_clone = chapter_path_zip.clone();
        // Replace or add updated chapter HTML
        original_files.insert(chapter_path_zip, updated_html.into_bytes());
        
        progress_callback(ConversionProgress {
            current_chapter: chapter_index + 1,
            total_chapters: options.chapters.len(),
            words_processed,
            total_words,
            words_in_current_chapter: chapter_word_count,
            current_step: "creating-smil".to_string(),
            message: format!("Creating SMIL file for chapter {}...", chapter_index + 1),
        });
        
        // Generate SMIL file - strip base path prefix if present
        let chapter_href_for_smil = if !base_path.is_empty() && chapter.href.starts_with(&base_path) {
            chapter.href[base_path.len()..].to_string()
        } else if chapter.href.starts_with("/") {
            chapter.href[1..].to_string()
        } else {
            chapter.href.clone()
        };
        
        // Validate SMIL paths to prevent path traversal
        let validated_chapter_href = validate_epub_path(&chapter_href_for_smil)
            .map_err(|e| AppError::InvalidPath(format!("Invalid chapter href for SMIL: {}", e)))?;
        
        let audio_href_for_smil = if validated_chapter_href.contains('/') {
            let depth = validated_chapter_href.matches('/').count();
            // Validate the constructed path
            let relative_path = format!("{}{}", "../".repeat(depth), audio_href_manifest_clone);
            validate_epub_path(&relative_path)
                .map_err(|e| AppError::InvalidPath(format!("Invalid audio href for SMIL: {}", e)))?
        } else {
            audio_href_manifest_clone
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
        // Validate SMIL manifest path
        let smil_href_manifest = validate_epub_path(
            &validated_chapter_href
                .replace(".xhtml", ".smil")
                .replace(".html", ".smil")
        )
        .map_err(|e| AppError::InvalidPath(format!("Invalid SMIL manifest path: {}", e)))?;
        
        // Store SMIL file - will be added to epub-builder later
        original_files.insert(smil_href_zip, smil_content.into_bytes());
        smil_files.push((chapter_index, smil_href_manifest));
    }
    
    progress_callback(ConversionProgress {
        current_chapter: options.chapters.len(),
        total_chapters: options.chapters.len(),
        words_processed,
        total_words,
        words_in_current_chapter: 0,
        current_step: "updating-epub".to_string(),
        message: "Building EPUB with epub-builder...".to_string(),
    });
    
    // Read original OPF to update it
    let original_opf_content = archive.by_name(&opf_path)
        .and_then(|mut f| {
            let mut content = String::new();
            f.read_to_string(&mut content)?;
            Ok(content)
        })
        .context("Failed to read original OPF")?;
    
    // Update content.opf with audio and SMIL files
    let updated_opf = update_content_opf(
        &original_opf_content,
        &audio_files,
        &smil_files,
        &options.chapters.iter().map(|c| c.href.clone()).collect::<Vec<_>>(),
    )
    .map_err(|e| anyhow::anyhow!("Failed to update content.opf: {}", e))?;
    
    // epub-builder creates its own OPF and structure, but we need to preserve the original
    // structure and use our updated OPF. Instead, we'll manually create the EPUB ZIP
    // but use epub-builder's ZIP library for proper EPUB structure compliance.
    // 
    // Actually, let's use epub-builder but then manually fix the container.xml and OPF
    // after generation, OR we can manually build the ZIP with all files.
    //
    // For now, let's manually build the EPUB ZIP to have full control over the structure
    use std::io::Write;
    use zip::{ZipWriter, write::FileOptions};
    
    let mut zip_writer = ZipWriter::new(Cursor::new(Vec::new()));
    let file_options = FileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    let mimetype_options = FileOptions::default()
        .compression_method(zip::CompressionMethod::Stored);
    
    // Add mimetype first (EPUB spec requirement - must be first, uncompressed)
    if let Some(mimetype_data) = original_files.get("mimetype") {
        zip_writer.start_file("mimetype", mimetype_options)
            .context("Failed to add mimetype to ZIP")?;
        zip_writer.write_all(mimetype_data)
            .context("Failed to write mimetype")?;
    } else {
        // Add default mimetype if not found
        zip_writer.start_file("mimetype", mimetype_options)
            .context("Failed to add mimetype to ZIP")?;
        zip_writer.write_all(b"application/epub+zip")
            .context("Failed to write mimetype")?;
    }
    
    // Add META-INF/container.xml (must reference the OPF)
    let container_xml = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="{}" media-type="application/oebps-package+xml" />
  </rootfiles>
</container>"#,
        opf_path
    );
    zip_writer.start_file("META-INF/container.xml", file_options)
        .context("Failed to add container.xml to ZIP")?;
    zip_writer.write_all(container_xml.as_bytes())
        .context("Failed to write container.xml")?;
    
    // Add all other META-INF files (preserve original ones like com.apple.ibooks.display-options.xml)
    let mut meta_inf_files: Vec<_> = original_files.iter()
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
    zip_writer.start_file(&opf_path, file_options)
        .context("Failed to add OPF to ZIP")?;
    zip_writer.write_all(updated_opf.as_bytes())
        .context("Failed to write OPF")?;
    
    // Add all other original files (excluding mimetype, container.xml, and OPF which we already added)
    let mut other_files: Vec<_> = original_files.iter()
        .filter(|(path, _)| {
            *path != "mimetype" 
            && *path != "META-INF/container.xml" 
            && *path != &opf_path
        })
        .collect();
    other_files.sort_by_key(|(path, _)| *path);
    
    for (file_path, file_data) in other_files {
        zip_writer.start_file(file_path, file_options)
            .with_context(|| format!("Failed to add file {} to ZIP", file_path))?;
        zip_writer.write_all(file_data)
            .with_context(|| format!("Failed to write file data for {}", file_path))?;
    }
    
    // Finalize ZIP
    let zip_data = zip_writer.finish()
        .context("Failed to finalize ZIP")?;
    
    let output = zip_data.into_inner();
    
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
) -> AppResult<Vec<u8>> {
    use crate::utils::path_resolver::ResourcePathResolver;
    
    // Create progress callback that emits to Tauri
    let app_progress = app.clone();
    let progress_callback: ProgressCallback = Box::new(move |progress| {
        emit_progress(&app_progress, progress);
    });
    
    // Calculate total words
    let total_words: usize = options.chapters.iter().map(|c| c.word_count).sum();
    
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
    
    // Create single TTS engine instance (reused for all chapters)
    let engine = kokoros::tts::koko::TTSKokoParallel::new_with_instances(
        &onnx_path_str,
        &voices_path_str,
        1, // Single instance
    )
    .await;
    
    log::info!("Created single TTS engine instance for conversion");
    
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
    let voice_id = options.voice_id.clone();
    
    convert_epub_core_with_durations(epub_data, options, progress_callback, engine_arc, voice_id)
        .await
        .map_err(|e| AppError::EpubParse(e.to_string()))
}

/// Standalone conversion function that doesn't require AppHandle.
///
/// This is a version of `convert_epub_to_audiobook` that can be used outside
/// of a Tauri application context. It uses console logging instead of Tauri
/// events for progress updates.
///
/// # Arguments
/// * `epub_data` - The original EPUB file as a byte vector
/// * `options` - Conversion options including voice ID and chapters to convert
///
/// # Returns
/// A new EPUB file (as byte vector) with embedded audio tracks and SMIL files.
///
/// # Errors
/// Returns `AppError::ResourceNotFound` if model files cannot be found.
/// Returns `AppError::TtsGeneration` if TTS engine creation or audio generation fails.
/// Returns `AppError::EpubParse` if EPUB processing fails.
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
    
    // Find model files (standalone version - no AppHandle needed)
    let (onnx_path, voices_path) = ResourcePathResolver::find_model_and_voices(None)?;
    
    let onnx_path_str = onnx_path.to_str()
        .ok_or_else(|| AppError::Encoding("ONNX path contains invalid UTF-8".to_string()))?
        .to_string();
    let voices_path_str = voices_path.to_str()
        .ok_or_else(|| AppError::Encoding("Voices path contains invalid UTF-8".to_string()))?
        .to_string();
    
    // Create progress callback that logs to structured logger
    let progress_callback: ProgressCallback = Box::new(|progress| {
        log::info!("[{}] Chapter {}/{}: {}", 
            progress.current_step, 
            progress.current_chapter, 
            progress.total_chapters,
            progress.message
        );
    });
    
    // Create single TTS engine instance (reused for all chapters)
    let engine = kokoros::tts::koko::TTSKokoParallel::new_with_instances(
        &onnx_path_str,
        &voices_path_str,
        1, // Single instance
    )
    .await;
    
    log::info!("Created single TTS engine instance for conversion");
    
    let engine_arc = std::sync::Arc::new(engine);
    let voice_id = options.voice_id.clone();
    
    convert_epub_core_with_durations(epub_data, options, progress_callback, engine_arc, voice_id)
        .await
        .map_err(|e| AppError::EpubParse(e.to_string()))
}

