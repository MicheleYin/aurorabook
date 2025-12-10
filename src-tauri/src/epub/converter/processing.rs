use crate::utils::constants::*;
use crate::utils::errors::{AppError, AppResult};
use crate::utils::path_validation::{validate_epub_path, validate_file_size};
use crate::utils::text::count_words;
use crate::epub::converter::types::{ConversionChapter, ChapterProcessResult};
use crate::epub::converter::progress::ProgressCallback;
use crate::epub::converter::chunking::{extract_all_sentences, extract_text_with_spans};
use crate::epub::converter::smil::generate_smil_file;
use crate::epub::converter::audio::merge_wav_files;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, AtomicBool, Ordering};
use anyhow::Result as AnyhowResult;

/// Macro to check cancellation token and return early if cancelled
macro_rules! check_cancellation {
    ($token:expr) => {
        if let Some(ref token) = $token {
            if token.load(Ordering::Relaxed) {
                return Err(anyhow::anyhow!("Conversion cancelled by user"));
            }
        }
    };
}

/// Calculate total words processed from atomic counter and chapter word count
fn calculate_total_words_processed(
    words_processed_atomic: Option<&Arc<AtomicUsize>>,
    chapter_word_count: usize,
) -> (usize, usize) {
    let current_words_processed = words_processed_atomic
        .map(|atomic| atomic.load(Ordering::Relaxed))
        .unwrap_or(0);
    let total_words_processed = current_words_processed + chapter_word_count;
    (current_words_processed, total_words_processed)
}

/// Map word alignments to HTML span segments for SMIL synchronization
pub(crate) fn map_alignments_to_segments(
    span_mappings: Vec<(String, usize, usize)>,
    word_alignments: &[kokoros::tts::koko::WordAlignment],
    audio_samples: &[f32],
    full_text: &str,
) -> Vec<(String, f64, f64)> {
    let text_words: Vec<&str> = full_text.split_whitespace().filter(|s| !s.is_empty()).collect();
    // Note: We collect words here for alignment mapping, but word counting uses count_words()
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
pub(crate) fn convert_audio_to_mp3(audio_samples: &[f32]) -> AppResult<Vec<u8>> {
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
pub(crate) fn generate_audio_path(chapter_href: &str, chapter_index: usize, base_path: &str) -> AppResult<(String, String)> {
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
pub(crate) fn resolve_chapter_path(href: &str, base_path: &str) -> String {
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
pub(crate) async fn process_sentence(
    sentence: &str,
    sentence_index: usize,
    engine: &Arc<kokoros::tts::koko::TTSKokoParallel>,
    worker_id: usize,
    voice_id: &str,
    cancel_token: Option<Arc<AtomicBool>>,
) -> AnyhowResult<(Vec<f32>, Vec<kokoros::tts::koko::WordAlignment>, String)> {
    // Check for cancellation before starting TTS generation
    check_cancellation!(cancel_token);
    
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
    
    // Check for cancellation after TTS generation completes
    check_cancellation!(cancel_token);
    
    if audio_samples.is_empty() {
        return Ok((Vec::new(), Vec::new(), String::new()));
    }
    
    // Calculate word alignments from audio duration
    // Split text into words and distribute duration proportionally
    let words: Vec<&str> = text.split_whitespace().filter(|s| !s.is_empty()).collect();
    // Note: We collect words here for alignment, but word counting uses count_words()
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
pub(crate) async fn process_chapter(
    chapter: &ConversionChapter,
    chapter_index: usize,
    base_path: &str,
    engine: &Arc<kokoros::tts::koko::TTSKokoParallel>,
    _worker_id: usize, // Not used directly - each sentence gets its own worker_id via round-robin
    voice_id: &str,
    progress_callback: &ProgressCallback,
    total_words: usize,
    total_chapters: usize,
    words_processed_atomic: Option<Arc<AtomicUsize>>,
    num_instances: usize,
    cancel_token: Option<Arc<AtomicBool>>,
    app: Option<&tauri::AppHandle>,
    source_path: Option<&str>,
) -> AnyhowResult<ChapterProcessResult> {
    use crate::epub::converter::types::ConversionProgress;
    
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
    
    // Extract all sentences from chapter for round-robin processing (with spans)
    let sentences_with_spans = extract_all_sentences(&chapter.content_html)
        .map_err(|e| AppError::EpubParse(format!("Failed to extract sentences: {}", e)))?;
    
    // Extract just the text for TTS processing
    let sentences: Vec<String> = sentences_with_spans.iter().map(|s| s.text.clone()).collect();
    
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
        // Check for cancellation before spawning each sentence task
        check_cancellation!(cancel_token);
        
        let semaphore = Arc::clone(&semaphore);
        let engine = Arc::clone(engine);
        let sentence = sentence.clone();
        let voice_id = voice_id.to_string();
        let cancel_token_clone = cancel_token.as_ref().map(Arc::clone);
        
        let handle = tokio::spawn(async move {
            let _permit = semaphore.acquire().await
                .map_err(|e| anyhow::anyhow!("Failed to acquire semaphore: {}", e))?;
            
            // Check for cancellation after acquiring semaphore permit
            check_cancellation!(cancel_token_clone);
            
            // Round-robin distribution: sentence index % num_instances
            let worker_id = idx % num_instances;
            let result = process_sentence(&sentence, idx, &engine, worker_id, &voice_id, cancel_token_clone).await?;
            
            Ok::<(usize, Vec<f32>, Vec<kokoros::tts::koko::WordAlignment>, String), anyhow::Error>(
                (idx, result.0, result.1, result.2)
            )
        });
        
        handles.push(handle);
    }
    
    // Collect results and update progress as each sentence completes
    // Use a more responsive approach: check cancellation while waiting for results
    let mut sentence_results: Vec<(usize, Vec<f32>, Vec<kokoros::tts::koko::WordAlignment>, String)> = Vec::new();
    
    // Process handles with periodic cancellation checks
    for handle in handles {
        // Check for cancellation before waiting for next result
        check_cancellation!(cancel_token);
        
        // Use tokio::select to allow cancellation to interrupt waiting
        let result = if let Some(ref token) = cancel_token {
            let token_clone = Arc::clone(token);
            tokio::select! {
                result = handle => {
                    result
                }
                _ = async move {
                    // Poll cancellation token periodically while waiting (every 100ms)
                    let mut interval = tokio::time::interval(tokio::time::Duration::from_millis(100));
                    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
                    loop {
                        interval.tick().await;
                        if token_clone.load(Ordering::Relaxed) {
                            break;
                        }
                    }
                } => {
                    log::info!("Conversion cancelled while waiting for sentence result in chapter {}", chapter_index + 1);
                    return Err(anyhow::anyhow!("Conversion cancelled by user"));
                }
            }
        } else {
            handle.await
        };
        
        let result = result
            .map_err(|e| anyhow::anyhow!("Task join error: {}", e))??;
        
        // Check for cancellation after each sentence finishes processing
        check_cancellation!(cancel_token);
        
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
    check_cancellation!(cancel_token);
    
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
        if word_alignments.is_empty() {
            cumulative_duration += audio_samples.len() as f32 / SAMPLE_RATE as f32;
        } else {
            cumulative_duration = word_alignments.last().unwrap().end_sec + cumulative_duration;
        }
        
        // Check for cancellation after merging each sentence's audio
        check_cancellation!(cancel_token);
    }
    
    // Use extract_text_with_spans to get updated HTML with spans
    // This function generates the actual span IDs that will be in the HTML
    let (extracted_full_text, updated_html_with_spans, extracted_span_mappings) = extract_text_with_spans(&chapter.content_html, Some(&sentences_with_spans))
        .map_err(|e| AppError::EpubParse(format!("Failed to extract text with spans: {}", e)))?;
    let updated_html = updated_html_with_spans;
    
    // Update chapter HTML in database immediately after it's generated
    if let (Some(app_ref), Some(source_path_ref)) = (app, source_path) {
        use crate::book_service::database::get_db_connection;
        use crate::book_service::repositories::{BookRepository, ChapterRepository};
        if let Ok(db) = get_db_connection(app_ref).await {
            if let Ok(Some(book)) = BookRepository::find_by_source_path(db.as_ref(), source_path_ref).await {
                // Find chapter by href
                if let Ok(Some(chapter_entity)) = ChapterRepository::find_by_href(db.as_ref(), &book.id, &chapter.href).await {
                    if let Err(e) = ChapterRepository::update_content(db.as_ref(), &book.id, &chapter_entity.id, &updated_html, None).await {
                        log::warn!("Failed to update chapter HTML in database for '{}': {}", chapter.href, e);
                    } else {
                        log::debug!("Updated chapter HTML in database for '{}' ({} bytes)", chapter.href, updated_html.len());
                    }
                } else {
                    log::debug!("Chapter not found in database for href '{}', skipping HTML update", chapter.href);
                }
            }
        }
    }
    
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
        count_words(&extracted_full_text)
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
    
    // Calculate total words processed (use chapter.word_count from ingestion to avoid double-counting)
    let chapter_words = chapter.word_count;
    let (_, total_words_processed) = calculate_total_words_processed(
        words_processed_atomic.as_ref(),
        chapter_words,
    );
    
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
    
    // Update progress for SMIL creation (reuse same calculation)
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

