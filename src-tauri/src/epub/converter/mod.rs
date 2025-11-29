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
        
        // Resolve chapter path
        let chapter_path = if validated_href.starts_with("/") {
            validated_href[1..].to_string()
        } else if validated_href.starts_with("OEBPS/") {
            validated_href.clone()
        } else {
            format!("{}{}", OEBPS_PREFIX, validated_href)
        };
        
        // Read chapter content from cache (no need to reopen archive)
        let content = file_cache.get(&chapter_path)
            .cloned()
            .unwrap_or_else(|| String::new());
        
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

/// Core EPUB to audiobook conversion logic
/// This function contains the shared conversion logic that can be used
/// with or without AppHandle by providing appropriate callbacks.
async fn convert_epub_core<F, Fut>(
    epub_data: Vec<u8>,
    options: ConversionOptions,
    progress_callback: ProgressCallback,
    tts_generator: F,
) -> AnyhowResult<Vec<u8>>
where
    F: Fn(String, String) -> Fut + Send + Sync + Clone + 'static,
    Fut: std::future::Future<Output = AppResult<Vec<u8>>> + Send + 'static,
{
    use std::collections::HashMap;
    use std::io::{Cursor, Write};
    use zip::{ZipArchive, ZipWriter};
    use zip::write::FileOptions;
    
    let parallelism = get_parallelism();
    
    // Calculate total words across all chapters
    let total_words: usize = options.chapters.iter().map(|c| c.word_count).sum();
    
    progress_callback(ConversionProgress {
        current_chapter: 0,
        total_chapters: options.chapters.len(),
        words_processed: 0,
        total_words,
        words_in_current_chapter: 0,
        current_step: "initializing".to_string(),
        message: format!("Initializing TTS engine (using {} cores)...", parallelism),
    });
    
    // Load EPUB as ZIP
    let mut archive = ZipArchive::new(Cursor::new(&epub_data))
        .context("Failed to open EPUB")?;
    
    let mut audio_files: Vec<(usize, String)> = Vec::new();
    let mut smil_files: Vec<(usize, String)> = Vec::new();
    let mut zip_files: HashMap<String, Vec<u8>> = HashMap::new();
    
    // Extract all existing files
    for i in 0..archive.len() {
        let mut file = archive.by_index(i)
            .with_context(|| format!("Failed to read file {} from EPUB", i))?;
        let name = file.name().to_string();
        
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
        zip_files.insert(name, data);
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
        
        // Chunk the chapter text
        let (chunks, updated_html) = chunk_text(&chapter.content_html)
            .map_err(|e| AppError::EpubParse(format!("Failed to chunk chapter HTML: {}", e)))?;
        
        if chunks.is_empty() {
            // Update chapter HTML in ZIP
            let chapter_path = if chapter.href.starts_with("OEBPS/") {
                chapter.href.clone()
            } else {
                format!("OEBPS/{}", chapter.href)
            };
            zip_files.insert(chapter_path, updated_html.into_bytes());
            // Chapter has no words, mark as complete
            words_processed += chapter_word_count;
            continue;
        }
        
        // Calculate words per chunk for progress tracking
        let total_chunk_words: usize = chunks.iter().map(|(_, text)| {
            text.split_whitespace().filter(|s| !s.is_empty()).count()
        }).sum();
        let words_per_chunk = if chunks.len() > 0 {
            total_chunk_words / chunks.len()
        } else {
            0
        };
        let mut chunks_processed = 0;
        
        // Generate audio for chunks
        let mut audio_data_arrays: Vec<Vec<u8>> = Vec::new();
        let mut audio_segments: Vec<(String, f64, f64)> = Vec::new();
        let mut current_time = 0.0;
        let sample_rate = SAMPLE_RATE as f64;
        
        // Process in batches
        for i in (0..chunks.len()).step_by(parallelism) {
            let batch: Vec<_> = chunks.iter().skip(i).take(parallelism).collect();
            
            // Generate TTS for batch in parallel
            let mut handles = Vec::new();
            for (chunk_id, text) in &batch {
                let text_clone = text.clone();
                let voice_id_clone = options.voice_id.clone();
                let generator = tts_generator.clone();
                
                let handle = tokio::spawn(async move {
                    generator(text_clone, voice_id_clone).await
                });
                handles.push((chunk_id.clone(), handle));
            }
            
            // Collect results
            for (chunk_id, handle) in handles {
                let audio_pcm = handle.await
                    .with_context(|| format!("TTS task failed for chunk {}", chunk_id))?
                    .map_err(|e| e.with_context(format!("chunk {}", chunk_id)))?;
                
                // Convert PCM bytes to f32 samples for duration calculation
                let num_samples = audio_pcm.len() / 2;
                let duration = num_samples as f64 / sample_rate;
                
                audio_data_arrays.push(audio_pcm);
                audio_segments.push((
                    chunk_id,
                    current_time,
                    current_time + duration,
                ));
                current_time += duration;
                
                // Update progress as chunks are processed
                chunks_processed += 1;
                let estimated_words_processed_in_chapter = (chunks_processed * words_per_chunk).min(chapter_word_count);
                let current_words_processed = words_processed + estimated_words_processed_in_chapter;
                
                // Emit progress update every few chunks to avoid too many updates
                if chunks_processed % parallelism == 0 || chunks_processed == chunks.len() {
                    progress_callback(ConversionProgress {
                        current_chapter: chapter_index + 1,
                        total_chapters: options.chapters.len(),
                        words_processed: current_words_processed,
                        total_words,
                        words_in_current_chapter: chapter_word_count,
                        current_step: "generating-audio".to_string(),
                        message: format!("Generating audio for chapter {}: {} ({}/{} words)", 
                            chapter_index + 1, chapter.title, estimated_words_processed_in_chapter, chapter_word_count),
                    });
                }
            }
        }
        
        // Mark chapter words as fully processed
        words_processed += chapter_word_count;
        
        if audio_data_arrays.is_empty() {
            // Create minimal silence
            let silence_samples = SAMPLE_RATE as usize;
            let silence_pcm = vec![0u8; silence_samples * 2];
            audio_data_arrays.push(silence_pcm);
            audio_segments.push((
                chunks[0].0.clone(),
                0.0,
                1.0,
            ));
        }
        
        progress_callback(ConversionProgress {
            current_chapter: chapter_index + 1,
            total_chapters: options.chapters.len(),
            words_processed,
            total_words,
            words_in_current_chapter: chapter_word_count,
            current_step: "merging-audio".to_string(),
            message: format!("Merging audio for chapter {}...", chapter_index + 1),
        });
        
        // Merge audio
        let merged_wav = merge_wav_files(&audio_data_arrays, SAMPLE_RATE);
        
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
        
        let audio_href_zip = format!("OEBPS/{}", validated_audio_name);
        let audio_href_manifest = validated_audio_name;
        
        zip_files.insert(audio_href_zip.clone(), mp3_bytes);
        let audio_href_manifest_clone = audio_href_manifest.clone();
        audio_files.push((chapter_index, audio_href_manifest));
        
        // Update chapter HTML
        let chapter_path_zip = if chapter.href.starts_with("OEBPS/") {
            chapter.href.clone()
        } else {
            format!("OEBPS/{}", chapter.href)
        };
        let chapter_path_zip_clone = chapter_path_zip.clone();
        zip_files.insert(chapter_path_zip, updated_html.into_bytes());
        
        progress_callback(ConversionProgress {
            current_chapter: chapter_index + 1,
            total_chapters: options.chapters.len(),
            words_processed,
            total_words,
            words_in_current_chapter: chapter_word_count,
            current_step: "creating-smil".to_string(),
            message: format!("Creating SMIL file for chapter {}...", chapter_index + 1),
        });
        
        // Generate SMIL file
        let chapter_href_for_smil = if chapter.href.starts_with("OEBPS/") {
            chapter.href[6..].to_string()
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
        
        zip_files.insert(smil_href_zip, smil_content.into_bytes());
        smil_files.push((chapter_index, smil_href_manifest));
    }
    
    progress_callback(ConversionProgress {
        current_chapter: options.chapters.len(),
        total_chapters: options.chapters.len(),
        words_processed,
        total_words,
        words_in_current_chapter: 0,
        current_step: "updating-epub".to_string(),
        message: "Updating EPUB metadata...".to_string(),
    });
    
    // Update content.opf
    if let Some(opf_content) = zip_files.get("OEBPS/content.opf") {
        let opf_str = String::from_utf8(opf_content.clone())
            .context("Invalid UTF-8 in OPF")?;
        
        let updated_opf = update_content_opf(
            &opf_str,
            &audio_files,
            &smil_files,
            &options.chapters.iter().map(|c| c.href.clone()).collect::<Vec<_>>(),
        )
        .map_err(|e| anyhow::anyhow!("Failed to update content.opf: {}", e))?;
        
        zip_files.insert("OEBPS/content.opf".to_string(), updated_opf.into_bytes());
    }
    
    // Create new ZIP
    let mut zip_writer = ZipWriter::new(Cursor::new(Vec::new()));
    let file_options = FileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    let mimetype_options = FileOptions::default()
        .compression_method(zip::CompressionMethod::Stored);
    
    // Add mimetype first (EPUB spec requirement)
    if let Some(mimetype_data) = zip_files.get("mimetype") {
        zip_writer.start_file("mimetype", mimetype_options)
            .context("Failed to add mimetype to ZIP")?;
        zip_writer.write_all(mimetype_data)
            .context("Failed to write mimetype")?;
    }
    
    // Add all other files
    let mut file_names: Vec<String> = zip_files.keys()
        .filter(|name| *name != "mimetype")
        .cloned()
        .collect();
    file_names.sort();
    
    for file_name in file_names {
        let data = &zip_files[&file_name];
        zip_writer.start_file(&file_name, file_options)
            .with_context(|| format!("Failed to add file {} to ZIP", file_name))?;
        zip_writer.write_all(data)
            .with_context(|| format!("Failed to write file data for {}", file_name))?;
    }
    
    let zip_data = zip_writer.finish()
        .context("Failed to finalize ZIP")?;
    
    progress_callback(ConversionProgress {
        current_chapter: options.chapters.len(),
        total_chapters: options.chapters.len(),
        words_processed,
        total_words,
        words_in_current_chapter: 0,
        current_step: "complete".to_string(),
        message: "Completing conversion...".to_string(),
    });
    
    Ok(zip_data.into_inner())
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
    use crate::tts::engine::TtsEnginePool;
    
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
    
    // Create TTS engine pool once (reused for all generations)
    let parallelism = get_parallelism();
    let engine_pool = TtsEnginePool::new(
        &onnx_path_str,
        &voices_path_str,
        parallelism,
    )
    .await
    .map_err(|e| AppError::TtsGeneration(format!("Failed to create TTS engine pool: {}", e)))?;
    
    log::info!("Created TTS engine pool with {} instances for parallel processing", parallelism);
    
    // Emit progress event for engine pool creation
    progress_callback(ConversionProgress {
        current_chapter: 0,
        total_chapters: options.chapters.len(),
        words_processed: 0,
        total_words,
        words_in_current_chapter: 0,
        current_step: "initializing".to_string(),
        message: format!("TTS engine pool created with {} instances", parallelism),
    });
    
    // Create TTS generator that uses the shared engine pool
    let engine_pool_arc = std::sync::Arc::new(engine_pool);
    let tts_generator = move |text: String, voice_id: String| {
        let pool = engine_pool_arc.clone();
        async move {
            pool.generate_audio_pcm(&text, "en", &voice_id, 1.0)
                .await
        }
    };
    
    convert_epub_core(epub_data, options, progress_callback, tts_generator)
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
    use crate::tts::engine::TtsEnginePool;
    
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
    
    // Create TTS engine pool once (reused for all generations)
    let parallelism = get_parallelism();
    let engine_pool = TtsEnginePool::new(
        &onnx_path_str,
        &voices_path_str,
        parallelism,
    )
    .await
    .map_err(|e| AppError::TtsGeneration(format!("Failed to create TTS engine pool: {}", e)))?;
    
    log::info!("Created TTS engine pool with {} instances for parallel processing", parallelism);
    
    // Create TTS generator that uses the shared engine pool
    let engine_pool_arc = std::sync::Arc::new(engine_pool);
    let tts_generator = move |text: String, voice_id: String| {
        let pool = engine_pool_arc.clone();
        async move {
            pool.generate_audio_pcm(&text, "en", &voice_id, 1.0)
                .await
        }
    };
    
    convert_epub_core(epub_data, options, progress_callback, tts_generator)
        .await
        .map_err(|e| AppError::EpubParse(e.to_string()))
}

