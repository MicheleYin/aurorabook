// Module declarations
pub mod audio;
pub mod chunking;
mod conversion;
mod epub_builder;
mod extraction;
pub mod opf;
mod processing;
mod progress;
pub mod smil;
mod types;

// Re-export public types and functions
pub use audio::*;
pub use chunking::*;
pub use epub_builder::CachedEpubStructure;
pub use extraction::extract_chapters;
pub use opf::*;
pub use progress::ProgressCallback;
pub use progress::{emit_progress, get_parallelism};
pub use smil::*;
pub use types::*;

use crate::epub::converter::conversion::convert_epub_core_with_durations;
use crate::utils::errors::{AppError, AppResult};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use tauri::AppHandle;

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
    cancel_token: Option<Arc<AtomicBool>>,
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
            format!(
                "Starting conversion of {} chapters ({} words)...",
                num_chapters, total_words_remaining
            )
        },
    });

    // Find model files
    let (onnx_path, voices_path) = ResourcePathResolver::find_model_and_voices(Some(&app))?;

    // Note: Misaki G2P (misaki-rs) is self-contained and doesn't require 
    // external model files or resource directories.

    let onnx_path_str = onnx_path
        .to_str()
        .ok_or_else(|| AppError::Encoding("ONNX path contains invalid UTF-8".to_string()))?
        .to_string();
    let voices_path_str = voices_path
        .to_str()
        .ok_or_else(|| AppError::Encoding("Voices path contains invalid UTF-8".to_string()))?
        .to_string();

    // Create or get global TTS engine pool with round-robin distribution
    // This ensures engines and phonemizers are only loaded once
    let num_instances = get_parallelism();
    let engine_pool = crate::tts::engine::TtsEnginePool::get_or_create_global(
        &onnx_path_str,
        &voices_path_str,
        num_instances,
        crate::tts::engine::TtsEngineType::Onnx,
    )
    .await?;

    log::info!("Using global TTS engine pool with {} instances for conversion (parallelism: {}, chapters: {})", 
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

    let voice_id = options.voice_id.clone();

    convert_epub_core_with_durations(
        epub_data,
        options,
        progress_callback,
        engine_pool,
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
        println!(
            "Progress: {} - {} ({}/{})",
            progress.current_step,
            progress.message,
            progress.current_chapter,
            progress.total_chapters
        );
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
        message: format!(
            "Starting conversion of {} chapters ({} words)...",
            num_chapters, total_words
        ),
    });

    // Find model files (without AppHandle)
    let (onnx_path, voices_path) = ResourcePathResolver::find_model_and_voices(None)?;

    // Note: RuleBasedG2p (voirs-g2p) doesn't require resource directories
    // as it uses rule-based phonemization without model files

    let onnx_path_str = onnx_path
        .to_str()
        .ok_or_else(|| AppError::Encoding("ONNX path contains invalid UTF-8".to_string()))?
        .to_string();
    let voices_path_str = voices_path
        .to_str()
        .ok_or_else(|| AppError::Encoding("Voices path contains invalid UTF-8".to_string()))?
        .to_string();

    // Create or get global TTS engine pool with round-robin distribution
    // This ensures engines and phonemizers are only loaded once
    let num_instances = get_parallelism();
    let engine_pool = crate::tts::engine::TtsEnginePool::get_or_create_global(
        &onnx_path_str,
        &voices_path_str,
        num_instances,
        crate::tts::engine::TtsEngineType::Onnx,
    )
    .await?;

    log::info!("Using global TTS engine pool with {} instances for conversion (parallelism: {}, chapters: {})", 
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
        message: "TTS engine pool ready - ready to process chapters".to_string(),
    });

    let voice_id = options.voice_id.clone();

    convert_epub_core_with_durations(
        epub_data,
        options,
        progress_callback,
        engine_pool,
        num_instances,
        voice_id,
        None,                  // No AppHandle for standalone version
        None,                  // No source_path for standalone version
        cancel_token,          // Pass cancellation token
        0,                     // Initial words processed (standalone version starts fresh)
        total_words_remaining, // Total words across all chapters
        0,                     // Initial chapter index
        num_chapters_for_call, // Total chapters across all
    )
    .await
    .map_err(|e| AppError::EpubParse(e.to_string()))
}
