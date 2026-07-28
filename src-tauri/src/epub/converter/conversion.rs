use crate::epub::converter::chunking::extract_all_sentences;
use crate::epub::converter::epub_builder::initialize_conversion_context;
use crate::epub::converter::epub_builder::{
    build_final_epub, merge_chapter_result, rebuild_and_save_epub,
};
use crate::epub::converter::processing::{
    generate_audio_path, process_chapter, resolve_chapter_path,
};
use crate::epub::converter::progress::ProgressCallback;
use crate::epub::converter::types::{ConversionOptions, ConversionProgress};
use crate::tts::engine::TtsEnginePool;
use crate::utils::constants::*;
use crate::utils::errors::AppError;
use crate::utils::path_validation::validate_chapter_count;
use anyhow::Result as AnyhowResult;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use tauri::AppHandle;

/// Save conversion progress to database when cancellation occurs
async fn save_progress_on_cancellation(
    app: &AppHandle,
    source_path: &str,
    words_processed: usize,
    total_words: usize,
) {
    use crate::book_service::database::get_db_connection;
    use crate::book_service::repositories::BookRepository;

    if let Ok(db) = get_db_connection(app).await {
        if let Ok(Some(mut book)) =
            BookRepository::find_by_source_path(db.as_ref(), source_path).await
        {
            if book.total_words.is_none() {
                book.total_words = Some(total_words);
            }
            book.words_processed = Some(words_processed);
            if let Err(e) = BookRepository::save(db.as_ref(), &book).await {
                log::warn!("Failed to save words_processed on cancellation: {}", e);
            } else {
                log::debug!(
                    "Saved words_processed on cancellation: {} / {}",
                    words_processed,
                    total_words
                );
            }
        }
    }
}

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
    engine_pool: Arc<TtsEnginePool>,
    num_instances: usize,
    voice_id: String,
    language: String,
    app: Option<AppHandle>,
    source_path: Option<String>,
    cancel_token: Option<Arc<AtomicBool>>,
    initial_words_processed: usize,
    total_words_all: usize,
    initial_chapter_index: usize,
    total_chapters_all: usize,
) -> AnyhowResult<Vec<u8>> {
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
    // Note: cached_structure is not available at this level, so we parse it
    // The structure is cached at the command level to avoid re-parsing during chapter loading
    let (mut context, original_opf_content) = initialize_conversion_context(&epub_data, None)?;
    let base_path = context.base_path.clone();
    let chapter_hrefs: Vec<String> = options.chapters.iter().map(|c| c.href.clone()).collect();

    // Rehydrate previously generated chapter outputs from partial EPUB contents.
    // This is critical when resuming conversion: rebuilds must preserve audio/SMIL
    // entries generated in prior runs, not just chapters processed in this run.
    for (chapter_index, chapter_href) in chapter_hrefs.iter().enumerate() {
        if let Ok((audio_href_zip, audio_href_manifest)) =
            generate_audio_path(chapter_href, chapter_index, &base_path)
        {
            if context.original_files.contains_key(&audio_href_zip)
                && !context
                    .audio_files
                    .iter()
                    .any(|(idx, href)| *idx == chapter_index && *href == audio_href_manifest)
            {
                context.audio_files.push((chapter_index, audio_href_manifest));
            }
        }

        let chapter_zip_path = resolve_chapter_path(chapter_href, &base_path);
        let smil_zip_path = chapter_zip_path
            .replace(".xhtml", ".smil")
            .replace(".html", ".smil");

        if context.original_files.contains_key(&smil_zip_path) {
            let chapter_href_for_smil = if !base_path.is_empty() && chapter_href.starts_with(&base_path) {
                chapter_href[base_path.len()..].to_string()
            } else if chapter_href.starts_with('/') {
                chapter_href[1..].to_string()
            } else {
                chapter_href.clone()
            };

            let smil_href_manifest = chapter_href_for_smil
                .replace(".xhtml", ".smil")
                .replace(".html", ".smil");

            if !context
                .smil_files
                .iter()
                .any(|(idx, href)| *idx == chapter_index && *href == smil_href_manifest)
            {
                context.smil_files.push((chapter_index, smil_href_manifest));
            }
        }
    }

    context.audio_files.sort_by_key(|(idx, _)| *idx);
    context.smil_files.sort_by_key(|(idx, _)| *idx);

    // Update chapter HTML files in context with the HTML from database (which may have been updated)
    // This ensures we use the latest HTML from the database instead of old HTML from the EPUB
    for chapter in &options.chapters {
        let chapter_path = resolve_chapter_path(&chapter.href, &base_path);
        // Overwrite the chapter file with the HTML from database
        context
            .original_files
            .insert(chapter_path, chapter.content_html.clone().into_bytes());
        log::debug!(
            "Updated chapter HTML in context for '{}' ({} bytes)",
            chapter.href,
            chapter.content_html.len()
        );
    }

    // Get DB pool and book_id for sentence-level persistence
    let (db_pool, resolved_book_id) = if let (Some(app_ref), Some(sp)) = (app.as_ref(), source_path.as_ref()) {
        use crate::book_service::database::get_db_connection;
        use crate::book_service::repositories::BookRepository;
        if let Ok(pool) = get_db_connection(app_ref).await {
            let bid = BookRepository::find_by_source_path(pool.as_ref(), sp).await
                .ok().flatten().map(|b| b.id);
            (Some(pool), bid)
        } else {
            (None, None)
        }
    } else {
        (None, None)
    };

    // Process chapters sequentially (not in parallel)
    for (chapter_index, chapter) in options.chapters.iter().enumerate() {
        let chapter_storage_index = chapter.order;

        // Check for cancellation before processing each chapter
        if let Some(ref token) = cancel_token {
            if token.load(Ordering::Relaxed) {
                log::info!("Conversion cancelled at chapter {}", chapter_index + 1);
                return Err(anyhow::anyhow!("Conversion cancelled by user"));
            }
        }

        // Check if chapter has valid text before processing
        let sentences_with_spans = extract_all_sentences(&chapter.content_html).map_err(|e| {
            AppError::EpubParse(format!(
                "Failed to extract sentences from chapter '{}': {}",
                chapter.title, e
            ))
        })?;

        // Check if there are any valid (non-empty, non-whitespace) sentences
        let has_valid_text = sentences_with_spans
            .iter()
            .any(|s| !s.text.trim().is_empty());

        if !has_valid_text {
            log::warn!(
                "Chapter {} '{}' (href: '{}') has no valid text - skipping conversion",
                initial_chapter_index + chapter_index + 1,
                chapter.title,
                chapter.href
            );

            // Still add the chapter HTML file to the output, but skip audio/SMIL generation
            let chapter_path = resolve_chapter_path(&chapter.href, &base_path);
            context
                .original_files
                .insert(chapter_path, chapter.content_html.clone().into_bytes());

            // Update progress to show chapter was skipped
            let current_total = words_processed_atomic.load(Ordering::Relaxed);
            progress_callback(ConversionProgress {
                current_chapter: initial_chapter_index + chapter_index + 1,
                total_chapters: total_chapters_all,
                words_processed: current_total,
                total_words: total_words_all,
                words_in_current_chapter: 0,
                current_step: "skipping".to_string(),
                message: format!(
                    "Skipping chapter {}: {} (no valid text)",
                    initial_chapter_index + chapter_index + 1,
                    chapter.title
                ),
            });

            // Mark chapter as completed even though we're skipping it
            // This ensures the completion check will pass when all chapters are processed
            if let (Some(app_ref), Some(source_path_ref)) = (app.as_ref(), source_path.as_ref()) {
                use crate::book_service::database::get_db_connection;
                use crate::book_service::models::ConversionStatus;
                use crate::book_service::repositories::BookRepository;
                
                if let Ok(db) = get_db_connection(app_ref).await {
                    if let Ok(Some(mut book)) =
                        BookRepository::find_by_source_path(db.as_ref(), source_path_ref).await
                    {
                        // Get the chapter href for this chapter
                        if chapter_index < chapter_hrefs.len() {
                            let chapter_href = &chapter_hrefs[chapter_index];
                            if !book.completed_chapters.contains(chapter_href) {
                                book.completed_chapters.push(chapter_href.clone());
                                log::debug!("Marked skipped chapter {} as completed", chapter_href);

                                // Check if all chapters with text content are completed
                                // Only count chapters that have text content (word_count > 0)
                                let chapters_with_text: usize = book
                                    .chapters
                                    .iter()
                                    .filter(|ch| ch.word_count.map(|wc| wc > 0).unwrap_or(false))
                                    .count();

                                // Only set status to Done if we've completed ALL chapters with text
                                if book.completed_chapters.len() == chapters_with_text
                                    && chapters_with_text > 0
                                {
                                    book.conversion_status = ConversionStatus::Done;
                                    log::info!("All chapters with text content completed ({} of {} total chapters), marking conversion as done", 
                                        book.completed_chapters.len(), book.chapters.len());
                                }

                                // Save the updated book
                                if let Err(e) = BookRepository::save(db.as_ref(), &book).await {
                                    log::warn!("Failed to save skipped chapter: {}", e);
                                }
                            }
                        }
                    }
                }
            }

            continue;
        }

        // Get worker_id using round-robin distribution (not used directly in process_chapter,
        // but kept for potential future use or API consistency)
        let worker_id = chapter_index % num_instances;

        log::debug!(
            "Processing chapter {}: '{}' with engine instance {}",
            chapter_index + 1,
            chapter.title,
            worker_id
        );

        // Get current total words processed before starting
        let current_total = words_processed_atomic.load(Ordering::Relaxed);
        progress_callback(ConversionProgress {
            current_chapter: initial_chapter_index + chapter_index + 1,
            total_chapters: total_chapters_all,
            words_processed: current_total,
            total_words: total_words_all,
            words_in_current_chapter: chapter.word_count,
            current_step: "generating-audio".to_string(),
            message: format!(
                "Processing chapter {}: {} ({} words)",
                initial_chapter_index + chapter_index + 1,
                chapter.title,
                chapter.word_count
            ),
        });

        // Get the ONNX engine from the pool
        let engine = engine_pool
            .get_onnx_engine()
            .ok_or_else(|| anyhow::anyhow!("ONNX engine not initialized in engine pool"))?;

        // Process the chapter with atomic counter for progress tracking
        // HTML elements within the chapter will be processed in parallel
        let result = process_chapter(
            chapter,
            chapter_index,
            chapter_storage_index,
            &base_path,
            engine,
            worker_id,
            &voice_id,
            &language,
            &*progress_callback,
            total_words_all,
            total_chapters_all,
            Some(Arc::clone(&words_processed_atomic)),
            num_instances,
            cancel_token.as_ref().map(Arc::clone),
            app.as_ref(),
            source_path.as_deref(),
            db_pool.clone(),
            resolved_book_id.as_deref(),
        )
        .await?;

        // Store words processed before moving result
        let chapter_words_processed = result.words_processed;

        // Update atomic counter with words processed by this chapter
        // fetch_add returns the old value, so we add the new value to get the updated total
        let updated_total = words_processed_atomic
            .fetch_add(chapter_words_processed, Ordering::Relaxed)
            + chapter_words_processed;

        // Report progress with updated total
        progress_callback(ConversionProgress {
            current_chapter: initial_chapter_index + chapter_index + 1,
            total_chapters: total_chapters_all,
            words_processed: updated_total,
            total_words: total_words_all,
            words_in_current_chapter: chapter_words_processed, // Use actual words processed
            current_step: "completed".to_string(),
            message: format!(
                "Completed chapter {}: {} ({} words processed, {} total)",
                initial_chapter_index + chapter_index + 1,
                chapter.title,
                chapter_words_processed,
                updated_total
            ),
        });

        // Merge chapter result into context
        merge_chapter_result(&mut context, result, &chapter.title);

        log::debug!(
            "Finished processing chapter {}. Total: {} audio files, {} SMIL files",
            chapter_index + 1,
            context.audio_files.len(),
            context.smil_files.len()
        );

        // Check for cancellation before rebuilding
        if let Some(ref token) = cancel_token {
            if token.load(Ordering::Relaxed) {
                log::info!("Conversion cancelled after chapter {}", chapter_index + 1);
                // Save current progress before returning
                let words_processed = words_processed_atomic.load(Ordering::Relaxed);
                if let (Some(app_ref), Some(source_path_ref)) = (app.as_ref(), source_path.as_ref())
                {
                    save_progress_on_cancellation(
                        app_ref,
                        source_path_ref,
                        words_processed,
                        total_words_all,
                    )
                    .await;
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
        )
        .await?;

        // Check for cancellation after rebuilding (in case it was cancelled during rebuild)
        if let Some(ref token) = cancel_token {
            if token.load(Ordering::Relaxed) {
                log::info!(
                    "Conversion cancelled after rebuilding chapter {}",
                    chapter_index + 1
                );
                // Save current progress before returning
                let words_processed = words_processed_atomic.load(Ordering::Relaxed);
                if let (Some(app_ref), Some(source_path_ref)) = (app.as_ref(), source_path.as_ref())
                {
                    save_progress_on_cancellation(
                        app_ref,
                        source_path_ref,
                        words_processed,
                        total_words_all,
                    )
                    .await;
                }
                return Err(anyhow::anyhow!("Conversion cancelled by user"));
            }
        }

        // Note: We don't save words_processed to DB after each chapter anymore
        // It's tracked in atomics and will be saved only on cancellation or completion
    }

    log::debug!(
        "All chapters processed. Total: {} audio files, {} SMIL files",
        context.audio_files.len(),
        context.smil_files.len()
    );

    // Build final EPUB
    let output = build_final_epub(&mut context, &original_opf_content, &chapter_hrefs)?;

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
