use crate::utils::constants::*;
use crate::utils::errors::AppError;
use crate::utils::path_validation::validate_chapter_count;
use crate::epub::converter::types::{ConversionOptions, ConversionProgress};
use crate::epub::converter::progress::ProgressCallback;
use crate::epub::converter::epub_builder::initialize_conversion_context;
use crate::epub::converter::processing::{process_chapter, resolve_chapter_path};
use crate::epub::converter::chunking::extract_all_sentences;
use crate::epub::converter::epub_builder::{merge_chapter_result, rebuild_and_save_epub, build_final_epub};
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, AtomicBool, Ordering};
use anyhow::Result as AnyhowResult;
use tauri::AppHandle;

/// Core EPUB to audiobook conversion logic using TTS engine pool with round-robin distribution
/// This function processes each chapter as a whole, using word alignments from
/// the TTS engine to generate accurate SMIL timing information.
/// Chapters are processed in parallel with a semaphore limiting concurrent operations
/// to the number of available engine instances.
/// After each chapter, it rebuilds the EPUB and saves it to the Tauri store.
pub(crate) async fn convert_epub_core_with_durations(
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
        
        // Check if chapter has valid text before processing
        let sentences_with_spans = extract_all_sentences(&chapter.content_html)
            .map_err(|e| AppError::EpubParse(format!("Failed to extract sentences from chapter '{}': {}", chapter.title, e)))?;
        
        // Check if there are any valid (non-empty, non-whitespace) sentences
        let has_valid_text = sentences_with_spans.iter().any(|s| !s.text.trim().is_empty());
        
        if !has_valid_text {
            log::warn!("Chapter {} '{}' (href: '{}') has no valid text - skipping conversion", 
                initial_chapter_index + chapter_index + 1, chapter.title, chapter.href);
            
            // Still add the chapter HTML file to the output, but skip audio/SMIL generation
            let chapter_path = resolve_chapter_path(&chapter.href, &base_path);
            context.original_files.insert(chapter_path, chapter.content_html.clone().into_bytes());
            
            // Update progress to show chapter was skipped
            let current_total = words_processed_atomic.load(Ordering::Relaxed);
            progress_callback(ConversionProgress {
                current_chapter: initial_chapter_index + chapter_index + 1,
                total_chapters: total_chapters_all,
                words_processed: current_total,
                total_words: total_words_all,
                words_in_current_chapter: 0,
                current_step: "skipping".to_string(),
                message: format!("Skipping chapter {}: {} (no valid text)", initial_chapter_index + chapter_index + 1, chapter.title),
            });
            
            continue;
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
                    use crate::book_service::storage::{get_book_by_source_path, add_book};
                    if let Ok(Some(mut book)) = get_book_by_source_path(app_ref, source_path_ref).await {
                        if book.total_words.is_none() {
                            book.total_words = Some(total_words_all);
                        }
                        book.words_processed = Some(words_processed);
                        if let Err(e) = add_book(app_ref, &book).await {
                            log::warn!("Failed to save words_processed on cancellation: {}", e);
                        } else {
                            log::debug!("Saved words_processed on cancellation: {} / {}", words_processed, total_words_all);
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
                    use crate::book_service::storage::{get_book_by_source_path, add_book};
                    if let Ok(Some(mut book)) = get_book_by_source_path(app_ref, source_path_ref).await {
                        if book.total_words.is_none() {
                            book.total_words = Some(total_words_all);
                        }
                        book.words_processed = Some(words_processed);
                        if let Err(e) = add_book(app_ref, &book).await {
                            log::warn!("Failed to save words_processed on cancellation: {}", e);
                        } else {
                            log::debug!("Saved words_processed on cancellation: {} / {}", words_processed, total_words_all);
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

