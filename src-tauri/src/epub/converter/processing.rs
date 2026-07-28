use crate::epub::converter::audio::merge_wav_files;
use crate::epub::converter::chunking::{extract_all_sentences, extract_text_with_spans};
use crate::epub::converter::progress::ProgressCallback;
use crate::epub::converter::smil::generate_smil_file;
use crate::epub::converter::types::{ChapterProcessResult, ConversionChapter};
use crate::utils::constants::*;
use crate::utils::errors::{AppError, AppResult};
use crate::utils::path_validation::{validate_epub_path, validate_file_size};
use crate::utils::text::count_words;
use anyhow::Result as AnyhowResult;
use tauri::Manager;
use std::collections::{BTreeMap, HashSet};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use tokio::task::JoinSet;

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
    let text_words: Vec<&str> = full_text
        .split_whitespace()
        .filter(|s| !s.is_empty())
        .collect();
    // Note: We collect words here for alignment mapping, but word counting uses count_words()
    let mut audio_segments = Vec::new();

    for (span_id, start_word_idx, end_word_idx) in span_mappings {
        let mut span_start_time: Option<f64> = None;
        let mut span_end_time: Option<f64> = None;

        let alignment_count = word_alignments.len();
        let text_word_count = text_words.len();

        if alignment_count > 0 && text_word_count > 0 {
            let alignments_per_word = alignment_count as f64 / text_word_count as f64;
            let start_alignment_idx =
                (start_word_idx as f64 * alignments_per_word).floor() as usize;
            let end_alignment_idx =
                ((end_word_idx as f64 * alignments_per_word).ceil() as usize).min(alignment_count);

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
                let end = word_alignments
                    .last()
                    .map(|wa| wa.end_sec as f64)
                    .unwrap_or_else(|| audio_samples.len() as f64 / SAMPLE_RATE as f64);
                (start, end)
            }
            (None, Some(end)) => (0.0, end),
            (None, None) => {
                let total_duration = word_alignments
                    .last()
                    .map(|wa| wa.end_sec as f64)
                    .unwrap_or_else(|| audio_samples.len() as f64 / SAMPLE_RATE as f64);
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
/// Returns empty vector if input is empty (prevents crashes on empty audio)
pub(crate) fn convert_audio_to_mp3(audio_samples: &[f32]) -> AppResult<Vec<u8>> {
    // Handle empty audio gracefully - return empty MP3 bytes instead of failing
    if audio_samples.is_empty() {
        log::debug!("Skipping MP3 conversion for empty audio samples");
        return Ok(Vec::new());
    }

    use crate::utils::audio::f32_to_pcm_le_bytes;
    use crate::utils::constants::WAV_HEADER_SIZE;

    let audio_pcm = f32_to_pcm_le_bytes(audio_samples);
    let merged_wav = merge_wav_files(&[audio_pcm], SAMPLE_RATE);

    let pcm_data = if merged_wav.len() > WAV_HEADER_SIZE {
        merged_wav[WAV_HEADER_SIZE..].to_vec()
    } else {
        merged_wav
    };

    crate::tts_commands::convert_pcm_to_mp3(pcm_data, SAMPLE_RATE, 1, Some(DEFAULT_MP3_BITRATE))
        .map_err(|e| AppError::Encoding(format!("MP3 conversion failed: {}", e)))
}

/// Generate audio file path for a chapter
pub(crate) fn generate_audio_path(
    chapter_href: &str,
    chapter_index: usize,
    base_path: &str,
) -> AppResult<(String, String)> {
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

/// Clean and normalize text before processing
/// Removes non-alphabetic, non-numeric characters (except punctuation), normalizes whitespace,
/// and converts to lowercase before sending to phonemizer
/// Number conversion will happen during normalization in the phonemizer
fn clean_text_for_tts(text: &str) -> String {
    let mut cleaned = text.trim().to_string();

    // Replace multiple newlines with single space
    cleaned = cleaned.replace("\n\n\n", " ");
    cleaned = cleaned.replace("\n\n", " ");
    cleaned = cleaned.replace('\n', " ");

    // Replace tabs and carriage returns with spaces
    cleaned = cleaned.replace('\r', " ");
    cleaned = cleaned.replace('\t', " ");

    // Replace multiple spaces with single space
    while cleaned.contains("  ") {
        cleaned = cleaned.replace("  ", " ");
    }

    cleaned.trim().to_string()
}

/// Split a long sentence into smaller chunks to avoid phonemizer failures
/// Enforces a strict maximum of MAX_SENTENCE_WORDS (10) words per chunk
/// Splits on word boundaries, respecting MAX_SENTENCE_LENGTH and MAX_SENTENCE_WORDS limits
fn split_long_sentence(text: &str) -> Vec<String> {
    let text = clean_text_for_tts(text);
    if text.is_empty() {
        return Vec::new();
    }

    // Check if splitting is needed based on character count
    let char_count = text.chars().count();
    let max_length = MAX_SENTENCE_LENGTH;

    // If text is within limits, return as single chunk
    if char_count <= max_length {
        return vec![text];
    }

    log::debug!(
        "Splitting long sentence: {} chars (max: {} chars per chunk)",
        char_count,
        max_length
    );

    // Split by words to respect max_length while keeping words intact
    let chunks = split_by_words(&text, max_length, MAX_SENTENCE_WORDS);

    log::debug!(
        "Split sentence into {} chunks (original: {} chars)",
        chunks.len(),
        char_count
    );

    chunks
}

/// Split text by words respecting character and word limits
fn split_by_words(text: &str, max_length: usize, max_words: usize) -> Vec<String> {
    let words: Vec<&str> = text.split_whitespace().filter(|s| !s.is_empty()).collect();
    let mut chunks = Vec::new();
    let mut current_chunk = String::new();
    let mut current_word_count = 0;

    for word in words {
        let test_chunk = if current_chunk.is_empty() {
            word.to_string()
        } else {
            format!("{} {}", current_chunk, word)
        };

        let test_char_count = test_chunk.chars().count();
        let test_word_count = current_word_count + 1;

        // Check if adding this word would exceed limits
        if test_char_count > max_length || test_word_count > max_words {
            // Save current chunk and start a new one
            if !current_chunk.is_empty() {
                chunks.push(current_chunk);
            }
            current_chunk = word.to_string();
            current_word_count = 1;
        } else {
            current_chunk = test_chunk;
            current_word_count = test_word_count;
        }
    }

    // Add the last chunk if it's not empty
    if !current_chunk.is_empty() {
        chunks.push(current_chunk);
    }

    chunks
}

/// Process a single sentence: generate audio and return result.
/// Word timings are estimated uniformly from audio duration (Supertonic path does not expose per-token durations in this integration).
/// Automatically splits very long sentences to avoid synthesis failures on huge spans.
pub(crate) async fn process_sentence(
    sentence: &str,
    sentence_index: usize,
    engine: &Arc<kokoros::tts::koko::TTSKokoParallel>,
    worker_id: usize,
    voice_id: &str,
    language: &str,
    cancel_token: Option<Arc<AtomicBool>>,
) -> AnyhowResult<(Vec<f32>, Vec<kokoros::tts::koko::WordAlignment>, String)> {
    // Check for cancellation before starting TTS generation
    check_cancellation!(cancel_token);

    let text = sentence.trim();
    if text.is_empty() {
        return Ok((Vec::new(), Vec::new(), String::new()));
    }

    // Split long sentences into smaller chunks to avoid phonemizer failures
    let chunks = split_long_sentence(text);
    if chunks.is_empty() {
        return Ok((Vec::new(), Vec::new(), String::new()));
    }

    // If only one chunk, process it directly (common case)
    if chunks.len() == 1 {
        return process_single_chunk(
            &chunks[0],
            sentence_index,
            0,
            engine,
            worker_id,
            voice_id,
            language,
            cancel_token,
        )
        .await;
    }

    // Process multiple chunks and merge results
    let mut all_audio_samples = Vec::new();
    let mut all_word_alignments = Vec::new();
    let mut cumulative_duration = 0.0;

    for (chunk_idx, chunk) in chunks.iter().enumerate() {
        check_cancellation!(cancel_token);

        let (audio_samples, word_alignments, _) = process_single_chunk(
            chunk,
            sentence_index,
            chunk_idx,
            engine,
            worker_id,
            voice_id,
            language,
            cancel_token.as_ref().map(Arc::clone),
        )
        .await?;

        if audio_samples.is_empty() {
            log::warn!(
                "Empty audio for sentence {} chunk {}: '{}'",
                sentence_index,
                chunk_idx,
                chunk.chars().take(50).collect::<String>()
            );
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
        all_audio_samples.extend_from_slice(&audio_samples);

        // Update cumulative duration
        cumulative_duration += audio_samples.len() as f32 / SAMPLE_RATE as f32;
    }

    Ok((all_audio_samples, all_word_alignments, text.to_string()))
}

/// Process a single chunk of text without retry logic (internal helper)
async fn process_chunk_direct(
    text: &str,
    engine: &Arc<kokoros::tts::koko::TTSKokoParallel>,
    worker_id: usize,
    voice_id: &str,
    language: &str,
) -> Result<Vec<f32>, String> {
    let model_instance = engine.get_model_instance(worker_id);
    engine
        .tts_raw_audio_with_instance(
            text,
            language,
            voice_id,
            1.0,
            None,
            None,
            None,
            None,
            model_instance,
        )
        .map_err(|e| e.to_string())
}

/// Process a single chunk of text (helper function for process_sentence)
/// If phonemization fails, automatically retries with smaller chunks
async fn process_single_chunk(
    text: &str,
    sentence_index: usize,
    chunk_index: usize,
    engine: &Arc<kokoros::tts::koko::TTSKokoParallel>,
    worker_id: usize,
    voice_id: &str,
    language: &str,
    cancel_token: Option<Arc<AtomicBool>>,
) -> AnyhowResult<(Vec<f32>, Vec<kokoros::tts::koko::WordAlignment>, String)> {
    let text = clean_text_for_tts(text);
    if text.is_empty() {
        return Ok((Vec::new(), Vec::new(), String::new()));
    }

    // Try processing the chunk
    let result = process_chunk_direct(&text, engine, worker_id, voice_id, language).await;

    // If phonemization failed with "No tokens generated", try splitting further
    match result {
        Ok(audio_samples) => {
            // Success - continue with normal processing
            check_cancellation!(cancel_token);

            if audio_samples.is_empty() {
                log::warn!(
                    "Empty audio samples returned for sentence {} chunk {}: '{}'",
                    sentence_index,
                    chunk_index,
                    text.chars().take(50).collect::<String>()
                );
                return Ok((Vec::new(), Vec::new(), String::new()));
            }

            // Calculate word alignments from audio duration
            let words: Vec<&str> = text.split_whitespace().filter(|s| !s.is_empty()).collect();
            let audio_duration_sec = audio_samples.len() as f32 / SAMPLE_RATE as f32;

            let mut word_alignments = Vec::new();
            if !words.is_empty() {
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

            Ok((audio_samples, word_alignments, text))
        }
        Err(e) => {
            let error_str = e.to_string();
            let is_no_tokens_error = error_str.contains("No tokens generated");

            if is_no_tokens_error {
                // Phonemization failed - try splitting into smaller chunks
                let char_count = text.chars().count();
                let word_count = count_words(&text);

                log::warn!(
                    "Phonemization failed for sentence {} chunk {} ({} chars, {} words), attempting aggressive split",
                    sentence_index, chunk_index, char_count, word_count
                );

                // Split into much smaller chunks and process each
                let smaller_chunks = split_by_words(&text, MAX_CHUNK_LENGTH, MAX_CHUNK_WORDS);

                if smaller_chunks.len() > 1 {
                    log::info!(
                        "Split failed chunk into {} smaller chunks for retry",
                        smaller_chunks.len()
                    );

                    // Process each smaller chunk and merge (without recursion - use direct processing)
                    let mut all_audio = Vec::new();
                    let mut all_alignments = Vec::new();
                    let mut cumulative_duration = 0.0;

                    for (sub_idx, sub_chunk) in smaller_chunks.iter().enumerate() {
                        check_cancellation!(cancel_token);

                        // Use direct processing to avoid recursion
                        match process_chunk_direct(sub_chunk, engine, worker_id, voice_id, language).await {
                            Ok(audio) => {
                                if !audio.is_empty() {
                                    // Calculate alignments for this sub-chunk
                                    let words: Vec<&str> = sub_chunk
                                        .split_whitespace()
                                        .filter(|s| !s.is_empty())
                                        .collect();
                                    let audio_duration_sec =
                                        audio.len() as f32 / SAMPLE_RATE as f32;

                                    let mut sub_alignments = Vec::new();
                                    if !words.is_empty() {
                                        let duration_per_word =
                                            audio_duration_sec / words.len() as f32;
                                        for (idx, word) in words.iter().enumerate() {
                                            let start_sec = idx as f32 * duration_per_word
                                                + cumulative_duration;
                                            let end_sec = (idx + 1) as f32 * duration_per_word
                                                + cumulative_duration;
                                            sub_alignments.push(
                                                kokoros::tts::koko::WordAlignment {
                                                    word: word.to_string(),
                                                    start_sec,
                                                    end_sec,
                                                },
                                            );
                                        }
                                    }

                                    all_alignments.extend(sub_alignments);
                                    all_audio.extend_from_slice(&audio);
                                    cumulative_duration += audio_duration_sec;
                                }
                            }
                            Err(sub_err) => {
                                log::warn!(
                                    "Failed to process sub-chunk {} of sentence {} chunk {}: {}. Skipping this sub-chunk.",
                                    sub_idx, sentence_index, chunk_index, sub_err
                                );
                                // Continue with other chunks rather than failing completely
                            }
                        }
                    }

                    if !all_audio.is_empty() {
                        return Ok((all_audio, all_alignments, text));
                    }
                }

                // If we get here, phonemization failed completely (even after splitting)
                // Return empty audio instead of crashing - this allows conversion to continue
                log::warn!(
                    "Phonemization completely failed for sentence {} chunk {} ({} chars, {} words): {}. Returning empty audio to allow conversion to continue.",
                    sentence_index,
                    chunk_index,
                    text.chars().count(),
                    word_count,
                    e
                );
                return Ok((Vec::new(), Vec::new(), String::new()));
            }

            // For other errors (not "No tokens generated"), still return error but log it
            log::error!(
                "TTS generation failed for sentence {} chunk {}: {}. Text: '{}'",
                sentence_index,
                chunk_index,
                e,
                text.chars().take(100).collect::<String>()
            );

            // For production safety, return empty audio instead of crashing on unknown errors
            // This prevents the entire conversion from failing due to a single chunk
            log::warn!(
                "Returning empty audio for failed chunk to prevent app crash. Conversion will continue."
            );
            Ok((Vec::new(), Vec::new(), String::new()))
        }
    }
}

/// Process a single chapter: generate audio, create SMIL, and store files
/// Returns a result struct with all generated files and metadata
///
/// This function processes HTML elements in parallel within the chapter,
/// then merges the audio segments in order.
pub(crate) async fn process_chapter(
    chapter: &ConversionChapter,
    chapter_index: usize,
    chapter_storage_index: usize,
    base_path: &str,
    engine: &Arc<kokoros::tts::koko::TTSKokoParallel>,
    _worker_id: usize, // Not used directly - each sentence gets its own worker_id via round-robin
    voice_id: &str,
    language: &str,
    progress_callback: &ProgressCallback,
    total_words: usize,
    total_chapters: usize,
    words_processed_atomic: Option<Arc<AtomicUsize>>,
    num_instances: usize,
    cancel_token: Option<Arc<AtomicBool>>,
    app: Option<&tauri::AppHandle>,
    source_path: Option<&str>,
    db_pool: Option<Arc<sqlx::SqlitePool>>,
    book_id: Option<&str>,
) -> AnyhowResult<ChapterProcessResult> {
    use crate::epub::converter::types::ConversionProgress;

    log::debug!(
        "Processing chapter {}: '{}' (href: '{}', content_html: {} bytes, word_count: {})",
        chapter_index + 1,
        chapter.title,
        chapter.href,
        chapter.content_html.len(),
        chapter.word_count
    );

    // Warn if chapter has no content
    if chapter.content_html.is_empty() {
        log::warn!(
            "Chapter {} '{}' (href: '{}') has no content - skipping audio/SMIL generation",
            chapter_index + 1,
            chapter.title,
            chapter.href
        );
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
        message: format!(
            "Generating audio for chapter {} ({} words)",
            chapter.title, chapter.word_count
        ),
    });

    validate_file_size(chapter.content_html.len(), MAX_CHAPTER_SIZE, "Chapter HTML")?;
    validate_epub_path(&chapter.href)?;

    // Extract all sentences from chapter for round-robin processing (with spans)
    let sentences_with_spans = extract_all_sentences(&chapter.content_html)
        .map_err(|e| AppError::EpubParse(format!("Failed to extract sentences: {}", e)))?;

    // Extract just the text for TTS processing
    let sentences: Vec<String> = sentences_with_spans
        .iter()
        .map(|s| s.text.clone())
        .collect();
    let sentence_word_counts: Vec<usize> = sentences
        .iter()
        .map(|s| count_words(s))
        .collect();

    let mut files = std::collections::HashMap::new();

    if sentences.is_empty() {
        log::debug!(
            "Chapter {} has no sentences - skipping audio generation",
            chapter_index + 1
        );
        let chapter_path = resolve_chapter_path(&chapter.href, base_path);
        files.insert(chapter_path, chapter.content_html.clone().into_bytes());
        return Ok(ChapterProcessResult {
            chapter_index,
            files,
            audio_file: (chapter_index, String::new()),
            smil_file: (chapter_index, String::new()),
            vtt_file: (chapter_index, String::new()),
            word_alignments: Vec::new(),
            words_processed: chapter.word_count,
        });
    }

    log::debug!(
        "Chapter {}: Processing {} sentences in round-robin fashion",
        chapter_index + 1,
        sentences.len()
    );

    // Create semaphore to limit concurrent sentence processing
    let semaphore = Arc::new(tokio::sync::Semaphore::new(num_instances));

    // Track sentences processed for proportional progress tracking
    let sentences_processed = Arc::new(AtomicUsize::new(0));
    let total_sentences = sentences.len();

    // If a checkpoint exists for this live chapter, restore sentence audio/alignments and
    // skip regenerating those sentences when conversion resumes.
    let mut restored_sentence_indices: HashSet<usize> = HashSet::new();
    let mut restored_words_in_chapter = 0usize;
    let mut restored_sentence_meta: Vec<(
        usize,
        f32,
        Vec<kokoros::tts::koko::WordAlignment>,
        String,
    )> = Vec::new();
    let mut sentence_mp3_chunks: BTreeMap<usize, Vec<u8>> = BTreeMap::new();

    if let Some(bid) = book_id {
        let manager = crate::book_service::audio_stream::get_live_stream_manager();
        manager.start_stream(
            bid,
            chapter_storage_index,
            Some(chapter.id.clone()),
            Some(chapter.href.clone()),
        );

        if let (Some(db_ref), Some(app_ref)) = (db_pool.as_ref(), app) {
            use crate::book_service::repositories::ConversionCheckpointRepository;

            match ConversionCheckpointRepository::load_chapter_sentences(
                db_ref.as_ref(),
                bid,
                chapter_storage_index,
            )
            .await
            {
                Ok(saved_sentences) if !saved_sentences.is_empty() => {
                    let mut saved_sentences = saved_sentences;
                    saved_sentences.sort_by_key(|saved| saved.sentence_index);

                    for saved in saved_sentences {
                        let audio_bytes = match std::fs::read(&saved.audio_file_path) {
                            Ok(bytes) => bytes,
                            Err(e) => {
                                log::warn!(
                                    "Failed to read checkpoint audio file '{}' for sentence {}: {}",
                                    saved.audio_file_path,
                                    saved.sentence_index,
                                    e
                                );
                                continue;
                            }
                        };

                        // Restore sentence chunk to live stream playback buffer.
                        manager.push_sentence(
                            bid,
                            chapter_storage_index,
                            saved.sentence_index,
                            audio_bytes.clone(),
                            saved.duration_seconds,
                            saved.sentence_text.clone(),
                            saved.word_alignments.clone(),
                        );

                        // Restore for final chapter merge without re-running TTS or re-encoding.
                        sentence_mp3_chunks.insert(saved.sentence_index, audio_bytes);
                        if restored_sentence_indices.insert(saved.sentence_index) {
                            let restored_sentence_words = sentence_word_counts
                                .get(saved.sentence_index)
                                .copied()
                                .unwrap_or_else(|| count_words(&saved.sentence_text));
                            restored_words_in_chapter = restored_words_in_chapter
                                .saturating_add(restored_sentence_words);
                        }
                        restored_sentence_meta.push((
                            saved.sentence_index,
                            saved.duration_seconds as f32,
                            saved.word_alignments,
                            saved.sentence_text,
                        ));
                    }

                    let restored_count = restored_sentence_indices.len();
                    if restored_count > 0 {
                        sentences_processed.store(0, Ordering::Relaxed);
                        log::info!(
                            "Resuming chapter {} with {} restored sentences and {} restored words ({} remaining sentences)",
                            chapter_index + 1,
                            restored_count,
                            restored_words_in_chapter,
                            total_sentences.saturating_sub(restored_count)
                        );

                        progress_callback(ConversionProgress {
                            current_chapter: chapter_index + 1,
                            total_chapters,
                            words_processed: current_words_processed,
                            total_words,
                            words_in_current_chapter: chapter.word_count,
                            current_step: "generating-audio".to_string(),
                            message: format!(
                                "Resumed chapter {}: restored {} sentences ({} words)",
                                chapter.title,
                                restored_count,
                                restored_words_in_chapter
                            ),
                        });
                    }
                }
                Ok(_) => {}
                Err(e) => {
                    log::warn!(
                        "Failed to load checkpoint sentences for chapter {}: {}",
                        chapter_index + 1,
                        e
                    );
                }
            }
        }
    }

    // Process all sentences in parallel with round-robin distribution.
    // JoinSet lets us observe completions as they happen instead of waiting in spawn order.
    let mut handles = JoinSet::new();
    for (idx, sentence) in sentences.iter().enumerate() {
        if restored_sentence_indices.contains(&idx) {
            continue;
        }

        // Check for cancellation before spawning each sentence task
        check_cancellation!(cancel_token);

        let semaphore = Arc::clone(&semaphore);
        let engine = Arc::clone(engine);
        let sentence = sentence.clone();
        let voice_id = voice_id.to_string();
        let language = language.to_string();
        let cancel_token_clone = cancel_token.as_ref().map(Arc::clone);

        handles.spawn(async move {
            let _permit = semaphore
                .acquire()
                .await
                .map_err(|e| anyhow::anyhow!("Failed to acquire semaphore: {}", e))?;

            // Check for cancellation after acquiring semaphore permit
            check_cancellation!(cancel_token_clone);

            // Round-robin distribution: sentence index % num_instances
            let worker_id = idx % num_instances;

            // Process sentence - panics will be caught by tokio and converted to JoinError
            // which we handle when awaiting the handle
            let result = process_sentence(
                &sentence,
                idx,
                &engine,
                worker_id,
                &voice_id,
                &language,
                cancel_token_clone,
            )
            .await
            .map_err(|e| {
                let err_msg = e.to_string();
                if err_msg.contains("Conversion cancelled by user") {
                    log::info!("Sentence {} cancelled", idx);
                } else {
                    log::error!("Error processing sentence {}: {}", idx, err_msg);
                }
                e
            })?;

            Ok::<
                (
                    usize,
                    Vec<f32>,
                    Vec<kokoros::tts::koko::WordAlignment>,
                    String,
                ),
                anyhow::Error,
            >((idx, result.0, result.1, result.2))
        });
    }

    // Collect results and update progress as each sentence completes
    // Use a more responsive approach: check cancellation while waiting for results
    let mut sentence_results: Vec<(
        usize,
        Vec<f32>,
        Vec<kokoros::tts::koko::WordAlignment>,
        String,
    )> = Vec::new();
    let mut sentence_meta: Vec<(usize, f32, Vec<kokoros::tts::koko::WordAlignment>, String)> =
        restored_sentence_meta;
    let total_sentences_to_process = total_sentences.saturating_sub(restored_sentence_indices.len());
    let mut newly_processed_words_in_chapter = 0usize;

    // Process sentence results in completion order so pooled workers emit progress promptly.
    while !handles.is_empty() {
        // Check for cancellation before waiting for next result
        check_cancellation!(cancel_token);

        // Use tokio::select to allow cancellation to interrupt waiting
        let result = if let Some(ref token) = cancel_token {
            let token_clone = Arc::clone(token);
            tokio::select! {
                result = handles.join_next() => {
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

                    // Best-effort checkpoint flush so resume can continue from partial progress.
                    if let (Some(bid), Some(db_ref), Some(app_ref)) = (book_id, db_pool.as_ref(), app) {
                        match app_ref.path().app_data_dir() {
                            Ok(app_data_dir) => {
                                let manager = crate::book_service::audio_stream::get_live_stream_manager();
                                if let Err(e) = manager
                                    .save_checkpoint(
                                        db_ref.as_ref(),
                                        &app_data_dir,
                                        bid,
                                        chapter_storage_index,
                                        Some(chapter.id.clone()),
                                        Some(chapter.href.clone()),
                                        total_sentences,
                                    )
                                    .await
                                {
                                    log::warn!(
                                        "Failed to save cancellation checkpoint for chapter {}: {}",
                                        chapter_index + 1,
                                        e
                                    );
                                }
                            }
                            Err(e) => {
                                log::warn!(
                                    "Failed to resolve app data directory while saving cancellation checkpoint: {}",
                                    e
                                );
                            }
                        }
                    }

                    return Err(anyhow::anyhow!("Conversion cancelled by user"));
                }
            }
        } else {
            handles.join_next().await
        };

        let Some(result) = result else {
            break;
        };

        // Handle task join result - if task panicked, JoinError will be returned
        let result = match result {
            Ok(Ok(result)) => result, // Task completed successfully
            Ok(Err(e)) => {
                // Task completed but returned an error
                return Err(anyhow::anyhow!("Sentence processing failed: {}", e));
            }
            Err(e) => {
                // Task panicked - convert to error instead of propagating panic
                log::error!(
                    "Task panicked while processing sentence in chapter {}: {:?}",
                    chapter_index + 1,
                    e
                );
                return Err(anyhow::anyhow!("Task panicked while processing sentence: {:?}. This may indicate a bug in the TTS engine or phonemizer.", e));
            }
        };

        // Check for cancellation after each sentence finishes processing
        check_cancellation!(cancel_token);

        // Update progress after each sentence completes
        let (idx, audio, alignments, text) = result;

        // Increment sentences processed counter
        let sentences_done = sentences_processed.fetch_add(1, Ordering::Relaxed) + 1;

        // Calculate progress based on newly processed words only.
        let sentence_words = sentence_word_counts
            .get(idx)
            .copied()
            .unwrap_or_else(|| count_words(&text));
        newly_processed_words_in_chapter = newly_processed_words_in_chapter
            .saturating_add(sentence_words)
            .min(chapter.word_count);

        let chapter_words_progress = if total_sentences_to_process > 0 {
            ((chapter.word_count as f64 * sentences_done as f64)
                / total_sentences_to_process as f64)
                .round() as usize
        } else {
            chapter.word_count
        }
        .max(newly_processed_words_in_chapter)
        .min(chapter.word_count);

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
            message: format!(
                "Processing chapter {}: {} ({}/{})",
                chapter_index + 1,
                chapter.title,
                sentences_done,
                total_sentences_to_process.max(1)
            ),
        });

        // Push completed sentence to the in-memory live stream manager.
        if !audio.is_empty() {
            if let Some(bid) = book_id {
                if let Ok(mp3_chunk) = convert_audio_to_mp3(&audio) {
                    let manager = crate::book_service::audio_stream::get_live_stream_manager();
                    sentence_mp3_chunks.insert(idx, mp3_chunk.clone());
                    manager.push_sentence(
                        bid,
                        chapter_storage_index,
                        idx,
                        mp3_chunk,
                        audio.len() as f64 / SAMPLE_RATE as f64,
                        text.clone(),
                        alignments.clone(),
                    );
                }
            }
        }

        sentence_meta.push((
            idx,
            audio.len() as f32 / SAMPLE_RATE as f32,
            alignments.clone(),
            text.clone(),
        ));

        sentence_results.push((idx, audio, alignments, text));

        // Persist periodic snapshots so sentence-level resume works after mid-chapter cancel.
        if sentences_done % 5 == 0 {
            if let (Some(bid), Some(db_ref), Some(app_ref)) = (book_id, db_pool.as_ref(), app) {
                match app_ref.path().app_data_dir() {
                    Ok(app_data_dir) => {
                        let manager = crate::book_service::audio_stream::get_live_stream_manager();
                        if let Err(e) = manager
                            .save_checkpoint(
                                db_ref.as_ref(),
                                &app_data_dir,
                                bid,
                                chapter_storage_index,
                                Some(chapter.id.clone()),
                                Some(chapter.href.clone()),
                                total_sentences,
                            )
                            .await
                        {
                            log::warn!(
                                "Failed to save periodic checkpoint for chapter {}: {}",
                                chapter_index + 1,
                                e
                            );
                        }
                    }
                    Err(e) => {
                        log::warn!(
                            "Failed to resolve app data directory while saving periodic checkpoint: {}",
                            e
                        );
                    }
                }
            }
        }
    }

    // Save checkpoint periodically during live conversion for recovery if process is cancelled
    if let Some(bid) = book_id {
        if let Some(db_ref) = db_pool.as_ref() {
            if let Some(app_ref) = app {
                let app_data_dir = match app_ref.path().app_data_dir() {
                    Ok(dir) => dir,
                    Err(e) => {
                        log::warn!("Failed to get app data directory for checkpoint: {}", e);
                        std::path::PathBuf::new()
                    }
                };

                let manager = crate::book_service::audio_stream::get_live_stream_manager();
                if let Err(e) = manager.save_checkpoint(
                    db_ref.as_ref(),
                    &app_data_dir,
                    bid,
                    chapter_storage_index,
                    Some(chapter.id.clone()),
                    Some(chapter.href.clone()),
                    sentences.len(),
                ).await {
                    log::warn!("Failed to save conversion checkpoint for chapter {}: {}", chapter_index + 1, e);
                } else {
                    log::debug!("Saved conversion checkpoint for chapter {}: {} sentences processed", 
                        chapter_index + 1, sentence_results.len());
                }
            } else {
                log::debug!("No app handle available, skipping checkpoint save");
            }
        }
    }

    // End the live stream for this chapter now that all sentences are done
    if let Some(bid) = book_id {
        let manager = crate::book_service::audio_stream::get_live_stream_manager();
        manager.end_stream(bid, chapter_storage_index);
    }

    // Check for cancellation before merging audio segments
    check_cancellation!(cancel_token);

    // Sort by sentence index to maintain document order
    sentence_meta.sort_by_key(|(idx, _, _, _)| *idx);

    // Merge alignment segments in order
    let merged_audio: Vec<f32> = Vec::new();
    let mut all_word_alignments: Vec<kokoros::tts::koko::WordAlignment> = Vec::new();

    // Track cumulative audio duration for alignment offset
    let mut cumulative_duration = 0.0;

    for (_sentence_idx, sentence_duration_sec, word_alignments, _text) in sentence_meta {
        if sentence_duration_sec <= 0.0 && word_alignments.is_empty() {
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

        // Update cumulative duration for next sentence
        cumulative_duration = word_alignments
            .last()
            .map(|wa| wa.end_sec + cumulative_duration)
            .unwrap_or_else(|| cumulative_duration + sentence_duration_sec);

        // Check for cancellation after merging each sentence's audio
        check_cancellation!(cancel_token);
    }

    // Use extract_text_with_spans to get updated HTML with spans
    // This function generates the actual span IDs that will be in the HTML
    let (extracted_full_text, updated_html_with_spans, extracted_span_mappings) =
        extract_text_with_spans(&chapter.content_html, Some(&sentences_with_spans)).map_err(
            |e| AppError::EpubParse(format!("Failed to extract text with spans: {}", e)),
        )?;
    let updated_html = updated_html_with_spans;

    // Update chapter HTML in database immediately after it's generated
    if let (Some(app_ref), Some(source_path_ref)) = (app, source_path) {
        use crate::book_service::database::get_db_connection;
        use crate::book_service::repositories::{BookRepository, ChapterRepository};
        if let Ok(db) = get_db_connection(app_ref).await {
            if let Ok(Some(book)) =
                BookRepository::find_by_source_path(db.as_ref(), source_path_ref).await
            {
                // Find chapter by href
                match ChapterRepository::find_by_href(db.as_ref(), &book.id, &chapter.href).await {
                    Ok(Some(chapter_entity)) => {
                        log::info!("Updating chapter HTML in database: book_id={}, chapter_id={}, href='{}', html_size={} bytes", 
                            book.id, chapter_entity.id, chapter.href, updated_html.len());
                        match ChapterRepository::update_content(
                            db.as_ref(),
                            &book.id,
                            &chapter_entity.id,
                            &updated_html,
                            None,
                        )
                        .await
                        {
                            Ok(()) => {
                                log::info!("✓ Successfully updated chapter HTML in database for '{}' ({} bytes)", chapter.href, updated_html.len());
                            }
                            Err(e) => {
                                log::error!(
                                    "✗ Failed to update chapter HTML in database for '{}': {}",
                                    chapter.href,
                                    e
                                );
                            }
                        }
                    }
                    Ok(None) => {
                        log::warn!("Chapter not found in database for href '{}' (book_id: {}), skipping HTML update", chapter.href, book.id);
                    }
                    Err(e) => {
                        log::warn!("Error finding chapter in database for href '{}': {}, skipping HTML update", chapter.href, e);
                    }
                }
            } else {
                log::warn!(
                    "Book not found in database for source_path '{}', cannot update chapter HTML",
                    source_path_ref
                );
            }
        } else {
            log::warn!("Failed to get database connection, cannot update chapter HTML");
        }
    } else {
        log::debug!("No app or source_path available, skipping chapter HTML database update");
    }

    // Extract actual span IDs from the generated HTML to ensure we only create segments for spans that exist
    use once_cell::sync::Lazy;
    use regex::Regex;
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
    let segment_ids: std::collections::HashSet<String> =
        audio_segments.iter().map(|(id, _, _)| id.clone()).collect();
    let missing_ids: Vec<String> = segment_ids
        .iter()
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
    let (_, total_words_processed) =
        calculate_total_words_processed(words_processed_atomic.as_ref(), chapter_words);

    progress_callback(ConversionProgress {
        current_chapter: chapter_index + 1,
        total_chapters,
        words_processed: total_words_processed,
        total_words,
        words_in_current_chapter: chapter_words,
        current_step: "converting-audio".to_string(),
        message: format!(
            "Converting audio to MP3 for chapter {}...",
            chapter_index + 1
        ),
    });

    // Build chapter MP3 from per-sentence MP3 chunks (restored + newly generated)
    // to avoid expensive re-encoding and to support resume without recomputing sentences.
    let mp3_bytes = if sentence_mp3_chunks.is_empty() {
        log::warn!(
            "No audio generated for chapter {} '{}' - creating empty MP3 file",
            chapter_index + 1,
            chapter.title
        );
        Vec::new() // Return empty MP3 bytes
    } else {
        let mut concatenated = Vec::new();
        for chunk in sentence_mp3_chunks.values() {
            concatenated.extend_from_slice(chunk);
        }
        concatenated
    };

    // Generate audio file paths
    let (audio_href_zip, audio_href_manifest) =
        generate_audio_path(&chapter.href, chapter_index, base_path)?;

    // Store audio file
    files.insert(audio_href_zip.clone(), mp3_bytes);
    log::debug!(
        "Generated audio file: chapter_index={}, href={}",
        chapter_index,
        audio_href_manifest
    );

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
        // Use validate_smil_relative_path which allows ../ sequences
        use crate::utils::path_validation::validate_smil_relative_path;
        validate_smil_relative_path(&relative_path, &validated_chapter_href)
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
            .replace(".html", ".smil"),
    )
    .map_err(|e| AppError::InvalidPath(format!("Invalid SMIL manifest path: {}", e)))?;

    files.insert(smil_href_zip, smil_content.into_bytes());
    log::debug!(
        "Generated SMIL file: chapter_index={}, href={}",
        chapter_index,
        smil_href_manifest
    );

    // Generate VTT file for this chapter (only if we have audio/alignments)
    let (vtt_href_zip, vtt_href_manifest) =
        if !all_word_alignments.is_empty() && !audio_href_manifest.is_empty() {
            use crate::epub::converter::vtt::generate_chapter_vtt;
            let vtt_content = generate_chapter_vtt(&all_word_alignments, &chapter.title);

            // Generate VTT file path (similar to audio file path)
            let vtt_zip = audio_href_zip.replace(".mp3", ".vtt");
            let vtt_manifest = audio_href_manifest.replace(".mp3", ".vtt");

            files.insert(vtt_zip.clone(), vtt_content.into_bytes());
            log::debug!(
                "Generated VTT file: chapter_index={}, href={}",
                chapter_index,
                vtt_manifest
            );
            (vtt_zip, vtt_manifest)
        } else {
            log::debug!(
                "Skipping VTT generation for chapter {}: no audio/alignments",
                chapter_index
            );
            (String::new(), String::new())
        };

    // Use chapter.word_count from ingestion to avoid double-counting nested elements
    // This matches the word count calculated during ingestion
    let actual_words_processed = chapter.word_count;

    // Clean up conversion checkpoint after successful completion
    if let Some(bid) = book_id {
        if let Some(db_ref) = db_pool.as_ref() {
            use crate::book_service::repositories::ConversionCheckpointRepository;
            
            // Delete checkpoint now that chapter is successfully converted
            if let Err(e) = ConversionCheckpointRepository::delete_checkpoint(
                db_ref.as_ref(),
                bid,
                chapter_index,
            ).await {
                log::warn!("Failed to clean up conversion checkpoint for chapter {}: {}", chapter_index + 1, e);
            } else {
                log::debug!("Cleaned up conversion checkpoint for chapter {}", chapter_index + 1);
            }
            
            // Also delete stored sentence alignments to free database space
            if let Err(e) = ConversionCheckpointRepository::delete_chapter_sentences(
                db_ref.as_ref(),
                bid,
                chapter_index,
            ).await {
                log::warn!("Failed to delete sentence alignments for chapter {}: {}", chapter_index + 1, e);
            }
        }
    }

    Ok(ChapterProcessResult {
        chapter_index,
        files,
        audio_file: (chapter_index, audio_href_manifest),
        smil_file: (chapter_index, smil_href_manifest),
        vtt_file: (chapter_index, vtt_href_manifest),
        word_alignments: all_word_alignments,
        words_processed: actual_words_processed,
    })
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::AtomicUsize;
    use std::sync::Arc;

    use crate::tts::koko::WordAlignment;
    use crate::utils::constants::{MAX_SENTENCE_WORDS, SAMPLE_RATE};

    use super::{
        calculate_total_words_processed, clean_text_for_tts, generate_audio_path,
        map_alignments_to_segments, resolve_chapter_path, split_long_sentence,
    };

    #[test]
    fn calculates_total_words_from_atomic_counter() {
        let words = Arc::new(AtomicUsize::new(125));

        assert_eq!(calculate_total_words_processed(Some(&words), 25), (125, 150));
        assert_eq!(calculate_total_words_processed(None, 25), (0, 25));
    }

    #[test]
    fn cleans_text_for_tts_by_normalizing_whitespace() {
        let cleaned = clean_text_for_tts("\n\t Hello   world\r\n\nthis   works \t");

        assert_eq!(cleaned, "Hello world this works");
    }

    #[test]
    fn splits_long_sentence_without_exceeding_word_limit() {
        let text = (0..120)
            .map(|index| format!("supercalifragilisticexpialidocious{index}"))
            .collect::<Vec<_>>()
            .join(" ");

        let chunks = split_long_sentence(&text);

        assert!(chunks.len() > 1);
        assert!(chunks.iter().all(|chunk| !chunk.is_empty()));
        assert!(
            chunks
                .iter()
                .all(|chunk| chunk.split_whitespace().count() <= MAX_SENTENCE_WORDS)
        );
        assert_eq!(split_long_sentence("short sentence"), vec!["short sentence"]);
    }

    #[test]
    fn generates_audio_paths_and_resolves_chapter_paths() {
        let (zip_path, manifest_path) =
            generate_audio_path("OPS/chapter-1.xhtml", 0, "EPUB/").unwrap();

        assert_eq!(zip_path, "EPUB/Audio/chapter-1.mp3");
        assert_eq!(manifest_path, "Audio/chapter-1.mp3");
        assert_eq!(resolve_chapter_path("/OPS/ch1.xhtml", "EPUB/"), "OPS/ch1.xhtml");
        assert_eq!(resolve_chapter_path("EPUB/ch1.xhtml", "EPUB/"), "EPUB/ch1.xhtml");
        assert_eq!(resolve_chapter_path("ch1.xhtml", "EPUB/"), "EPUB/ch1.xhtml");
    }

    #[test]
    fn maps_alignments_using_real_timing_when_available() {
        let alignments = vec![
            WordAlignment {
                word: "one".to_string(),
                start_sec: 0.0,
                end_sec: 0.5,
            },
            WordAlignment {
                word: "two".to_string(),
                start_sec: 0.5,
                end_sec: 1.0,
            },
            WordAlignment {
                word: "three".to_string(),
                start_sec: 1.0,
                end_sec: 1.5,
            },
            WordAlignment {
                word: "four".to_string(),
                start_sec: 1.5,
                end_sec: 2.0,
            },
        ];

        let segments = map_alignments_to_segments(
            vec![("f000001".to_string(), 1, 3)],
            &alignments,
            &vec![0.0; SAMPLE_RATE as usize * 2],
            "one two three four",
        );

        assert_eq!(segments, vec![("f000001".to_string(), 0.5, 1.5)]);
    }

    #[test]
    fn estimates_alignment_timing_when_no_word_timings_exist() {
        let segments = map_alignments_to_segments(
            vec![("f000002".to_string(), 1, 3)],
            &[],
            &vec![0.0; SAMPLE_RATE as usize * 4],
            "one two three four",
        );

        assert_eq!(segments, vec![("f000002".to_string(), 1.0, 3.0)]);
    }
}
