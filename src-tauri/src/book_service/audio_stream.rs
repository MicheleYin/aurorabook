use crate::book_service::database::get_db_connection;
use crate::book_service::repositories::AudioRepository;
use crate::book_service::repositories::EpubRepository;
use crate::utils::errors::AppError;
use kokoros::tts::koko::WordAlignment;
use async_stream::stream;
use axum::{
    extract::{Path, Query, State},
    http::{header, HeaderMap, StatusCode},
    response::Response,
    routing::get,
    Router,
};
use serde::Serialize;
use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, OnceLock};
use tauri::AppHandle;
use tokio::net::TcpListener;
use tokio::signal;
use tokio::sync::{broadcast, oneshot};
use tower_http::cors::{Any, CorsLayer};

// Global flag to track if server has started
static SERVER_STARTED: OnceLock<Arc<std::sync::atomic::AtomicBool>> = OnceLock::new();

// Global variable to store the port number assigned by the OS
static SERVER_PORT: OnceLock<Arc<std::sync::atomic::AtomicU16>> = OnceLock::new();

// Global shutdown signal sender for graceful server shutdown
static SERVER_SHUTDOWN: OnceLock<Arc<std::sync::Mutex<Option<oneshot::Sender<()>>>>> =
    OnceLock::new();

fn get_server_started_flag() -> Arc<std::sync::atomic::AtomicBool> {
    SERVER_STARTED
        .get_or_init(|| Arc::new(std::sync::atomic::AtomicBool::new(false)))
        .clone()
}

fn get_server_port() -> Arc<std::sync::atomic::AtomicU16> {
    SERVER_PORT
        .get_or_init(|| Arc::new(std::sync::atomic::AtomicU16::new(0)))
        .clone()
}

fn get_server_shutdown() -> Arc<std::sync::Mutex<Option<oneshot::Sender<()>>>> {
    SERVER_SHUTDOWN
        .get_or_init(|| Arc::new(std::sync::Mutex::new(None)))
        .clone()
}

#[derive(serde::Deserialize)]
struct EpubResourceQuery {
    book_id: String,
    href: String,
    chapter_href: Option<String>,
}

async fn ensure_server_started_and_get_port(
    app: tauri::AppHandle,
) -> Result<u16, AppError> {
    let server_started = get_server_started_flag();
    let is_running = if server_started.load(std::sync::atomic::Ordering::Relaxed) {
        check_server_running().await
    } else {
        false
    };

    if !is_running {
        log::info!("Audio/resource server not running, starting it now...");
        match start_audio_server(app.clone()).await {
            Ok(_) => {
                tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;
            }
            Err(e) => {
                tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
                if let Err(e2) = start_audio_server(app.clone()).await {
                    return Err(AppError::Store(format!(
                        "Failed to start streaming server: {}; retry: {}",
                        e, e2
                    )));
                }
            }
        }

        let mut retries = 3;
        while retries > 0 && !check_server_running().await {
            tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
            retries -= 1;
        }

        if !check_server_running().await {
            return Err(AppError::Store(
                "Streaming server is not responding".to_string(),
            ));
        }
    }

    let port = get_server_port().load(std::sync::atomic::Ordering::Relaxed);
    if port == 0 {
        return Err(AppError::Store(
            "Streaming server port not initialized".to_string(),
        ));
    }

    Ok(port)
}

fn detect_resource_mime_type(path: &str, bytes: &[u8]) -> &'static str {
    let lower = path.to_ascii_lowercase();
    if lower.ends_with(".css") {
        "text/css"
    } else if lower.ends_with(".xhtml") || lower.ends_with(".html") || lower.ends_with(".htm") {
        "text/html"
    } else if lower.ends_with(".js") {
        "text/javascript"
    } else if lower.ends_with(".svg") {
        "image/svg+xml"
    } else if lower.ends_with(".png") {
        "image/png"
    } else if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        "image/jpeg"
    } else if lower.ends_with(".gif") {
        "image/gif"
    } else if lower.ends_with(".webp") {
        "image/webp"
    } else if lower.ends_with(".woff2") {
        "font/woff2"
    } else if lower.ends_with(".woff") {
        "font/woff"
    } else if lower.ends_with(".ttf") {
        "font/ttf"
    } else if lower.ends_with(".otf") {
        "font/otf"
    } else if lower.ends_with(".mp3") {
        "audio/mpeg"
    } else if lower.ends_with(".m4a") || lower.ends_with(".m4b") {
        "audio/mp4"
    } else if lower.ends_with(".ogg") {
        "audio/ogg"
    } else if lower.ends_with(".wav") {
        "audio/wav"
    } else if lower.ends_with(".mp4") {
        "video/mp4"
    } else if lower.ends_with(".webm") {
        "video/webm"
    } else if lower.ends_with(".vtt") {
        "text/vtt"
    } else if bytes.len() >= 4 {
        match &bytes[0..4] {
            [0x89, 0x50, 0x4E, 0x47] => "image/png",
            [0xFF, 0xD8, 0xFF, _] => "image/jpeg",
            [0x47, 0x49, 0x46, 0x38] => "image/gif",
            _ => "application/octet-stream",
        }
    } else {
        "application/octet-stream"
    }
}

fn is_external_resource_ref(v: &str) -> bool {
    let l = v.trim().to_ascii_lowercase();
    l.starts_with("data:")
        || l.starts_with("http://")
        || l.starts_with("https://")
        || l.starts_with("blob:")
        || l.starts_with("javascript:")
        || l.starts_with("mailto:")
        || l.starts_with('#')
}

fn build_epub_resource_absolute_url(
    port: u16,
    book_id: &str,
    href: &str,
    chapter_href: Option<&str>,
) -> String {
    fn enc(v: &str) -> String {
        percent_encoding::utf8_percent_encode(v, percent_encoding::NON_ALPHANUMERIC).to_string()
    }

    let mut url = format!(
        "http://localhost:{}/epub-resource?book_id={}&href={}",
        port,
        enc(book_id),
        enc(href)
    );
    if let Some(ch) = chapter_href {
        url.push_str("&chapter_href=");
        url.push_str(&enc(ch));
    }
    url
}

fn rewrite_css_urls_for_endpoint(
    css_text: &str,
    port: u16,
    book_id: &str,
    css_member_path: &str,
) -> String {
    use regex::Regex;

    // Note: the `regex` crate does not support backreferences (`\1`), so quote
    // variants are matched with alternation instead.
    let import_url_re = match Regex::new(
        r#"(?is)@import\s+url\(\s*(?:"([^"]+)"|'([^']+)'|([^"')\s]+))\s*\)"#,
    ) {
        Ok(v) => v,
        Err(_) => return append_reader_css_width_guards(css_text),
    };
    let import_plain_re =
        match Regex::new(r#"(?is)@import\s+(?:"([^"]+)"|'([^']+)')"#) {
            Ok(v) => v,
            Err(_) => return append_reader_css_width_guards(css_text),
        };
    let url_re = match Regex::new(
        r#"(?is)url\(\s*(?:"([^"]+)"|'([^']+)'|([^"')\s]+))\s*\)"#,
    ) {
        Ok(v) => v,
        Err(_) => return append_reader_css_width_guards(css_text),
    };

    let capture_url = |caps: &regex::Captures| -> String {
        caps.get(1)
            .or_else(|| caps.get(2))
            .or_else(|| caps.get(3))
            .map(|m| m.as_str())
            .unwrap_or_default()
            .trim()
            .to_string()
    };

    let mut out = css_text.to_string();

    out = import_url_re
        .replace_all(&out, |caps: &regex::Captures| {
            let raw = capture_url(caps);
            if raw.is_empty() || is_external_resource_ref(&raw) {
                caps.get(0).map(|m| m.as_str()).unwrap_or_default().to_string()
            } else {
                let rewritten =
                    build_epub_resource_absolute_url(port, book_id, &raw, Some(css_member_path));
                format!("@import url(\"{rewritten}\")")
            }
        })
        .to_string();

    out = import_plain_re
        .replace_all(&out, |caps: &regex::Captures| {
            let raw = caps
                .get(1)
                .or_else(|| caps.get(2))
                .map(|m| m.as_str())
                .unwrap_or_default()
                .trim()
                .to_string();
            if raw.is_empty() || is_external_resource_ref(&raw) {
                caps.get(0).map(|m| m.as_str()).unwrap_or_default().to_string()
            } else {
                let rewritten =
                    build_epub_resource_absolute_url(port, book_id, &raw, Some(css_member_path));
                format!("@import url(\"{rewritten}\")")
            }
        })
        .to_string();

    out = url_re
        .replace_all(&out, |caps: &regex::Captures| {
            let raw = capture_url(caps);
            if raw.is_empty() || is_external_resource_ref(&raw) {
                caps.get(0).map(|m| m.as_str()).unwrap_or_default().to_string()
            } else {
                let rewritten =
                    build_epub_resource_absolute_url(port, book_id, &raw, Some(css_member_path));
                format!("url(\"{rewritten}\")")
            }
        })
        .to_string();

    append_reader_css_width_guards(&out)
}

fn append_reader_css_width_guards(css_text: &str) -> String {
    let mut out = String::with_capacity(css_text.len() + 1024);
    out.push_str(css_text);
    out.push_str(
        "\n\n/* Aurorabook reader guard: keep injected EPUB CSS within reader bounds */\n",
    );
    out.push_str(
        "[data-reader-chapter-content=\"true\"]{max-width:100%!important;overflow-x:clip;overflow-wrap:break-word;word-break:break-word;}\n",
    );
    out.push_str(
        "[data-reader-chapter-content=\"true\"] *{box-sizing:border-box;max-width:100%;}\n",
    );
    out.push_str(
        "[data-reader-chapter-content=\"true\"] :where(.width,.width1,.calibre,.calibre3,.calibre9,.calibre10,#button,section,article,div,p){margin-left:0!important;margin-right:0!important;padding-left:0!important;padding-right:0!important;}\n",
    );
    out.push_str(
        "[data-reader-chapter-content=\"true\"] :where(img,svg,canvas,video,iframe,table){max-width:100%!important;height:auto;}\n",
    );
    out
}


fn convert_f32_sentence_to_mp3(audio_samples: &[f32]) -> Result<Vec<u8>, String> {
    if audio_samples.is_empty() {
        return Ok(Vec::new());
    }

    use crate::epub::converter::audio::merge_wav_files;
    use crate::utils::audio::f32_to_pcm_le_bytes;
    use crate::utils::constants::{DEFAULT_MP3_BITRATE, SAMPLE_RATE, WAV_HEADER_SIZE};

    let audio_pcm = f32_to_pcm_le_bytes(audio_samples);
    let merged_wav = merge_wav_files(&[audio_pcm], SAMPLE_RATE);

    let pcm_data = if merged_wav.len() > WAV_HEADER_SIZE {
        merged_wav[WAV_HEADER_SIZE..].to_vec()
    } else {
        merged_wav
    };

    crate::tts_commands::convert_pcm_to_mp3(pcm_data, SAMPLE_RATE, 1, Some(DEFAULT_MP3_BITRATE))
        .map_err(|e| format!("MP3 conversion failed: {}", e))
}

fn parse_range_header(range_header: &str, total_len: usize) -> Option<(usize, usize)> {
    if total_len == 0 {
        return None;
    }

    let range_value = range_header.trim();
    if !range_value.starts_with("bytes=") {
        return None;
    }

    let spec = &range_value[6..];
    let mut parts = spec.splitn(2, '-');
    let start_part = parts.next().unwrap_or_default().trim();
    let end_part = parts.next().unwrap_or_default().trim();

    if start_part.is_empty() {
        // Suffix range: bytes=-500
        let suffix_len = end_part.parse::<usize>().ok()?;
        if suffix_len == 0 {
            return None;
        }
        let start = total_len.saturating_sub(suffix_len);
        let end = total_len.saturating_sub(1);
        return Some((start, end));
    }

    let start = start_part.parse::<usize>().ok()?;
    if start >= total_len {
        return None;
    }

    let end = if end_part.is_empty() {
        total_len - 1
    } else {
        end_part.parse::<usize>().ok()?.min(total_len - 1)
    };

    if end < start {
        return None;
    }

    Some((start, end))
}

#[derive(Clone)]
pub struct SentencePayload {
    pub sentence_index: usize,
    pub audio_bytes: Vec<u8>,
    pub duration_seconds: f64,
    pub sentence_text: String,
    pub word_alignments: Vec<WordAlignment>,
}

#[derive(Clone, Default)]
struct LiveChapterSnapshot {
    chapter_id: Option<String>,
    chapter_href: Option<String>,
    sentences: BTreeMap<usize, SentencePayload>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveSyncMarker {
    pub text_element_id: Option<String>,
    pub smil_id: Option<String>,
    pub chapter_id: Option<String>,
    pub chapter_href: Option<String>,
    pub sentence_index: Option<usize>,
    pub clip_begin: Option<f64>,
    pub clip_end: Option<f64>,
    pub sentence_text: Option<String>,
    pub word_alignments: Option<Vec<WordAlignment>>,
    pub current_word_index: Option<usize>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveSegmentMeta {
    pub sentence_index: usize,
    pub start_time_seconds: f64,
    pub duration_seconds: f64,
    pub byte_length: usize,
}

pub struct LiveStreamManager {
    channels: std::sync::Mutex<HashMap<String, broadcast::Sender<SentencePayload>>>,
    snapshots: std::sync::Mutex<HashMap<String, LiveChapterSnapshot>>,
    current_chapter_by_book: std::sync::Mutex<HashMap<String, (usize, u64)>>,
}

impl LiveStreamManager {
    fn now_unix_millis() -> u64 {
        use std::time::{SystemTime, UNIX_EPOCH};

        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0)
    }

    pub fn new() -> Self {
        Self {
            channels: std::sync::Mutex::new(HashMap::new()),
            snapshots: std::sync::Mutex::new(HashMap::new()),
            current_chapter_by_book: std::sync::Mutex::new(HashMap::new()),
        }
    }

    pub fn mark_current_chapter(&self, book_id: &str, chapter_index: usize) {
        let now_ms = Self::now_unix_millis();
        let mut map = self.current_chapter_by_book.lock().unwrap();
        map.insert(book_id.to_string(), (chapter_index, now_ms));
    }

    pub fn clear_current_chapter(&self, book_id: &str) {
        let mut map = self.current_chapter_by_book.lock().unwrap();
        map.remove(book_id);
    }

    pub fn current_chapter(&self, book_id: &str, max_staleness_ms: Option<u64>) -> Option<usize> {
        let now_ms = Self::now_unix_millis();
        let map = self.current_chapter_by_book.lock().unwrap();
        let (chapter_index, updated_at_ms) = map.get(book_id).copied()?;

        if let Some(max_age_ms) = max_staleness_ms {
            if now_ms.saturating_sub(updated_at_ms) > max_age_ms {
                return None;
            }
        }

        Some(chapter_index)
    }

    pub fn start_stream(
        &self,
        book_id: &str,
        chapter_index: usize,
        chapter_id: Option<String>,
        chapter_href: Option<String>,
    ) {
        self.mark_current_chapter(book_id, chapter_index);

        let key = format!("{}_{}", book_id, chapter_index);
        {
            let mut snapshots = self.snapshots.lock().unwrap();
            snapshots.insert(
                key.clone(),
                LiveChapterSnapshot {
                    chapter_id,
                    chapter_href,
                    sentences: BTreeMap::new(),
                },
            );
        }
        let mut map = self.channels.lock().unwrap();
        let (tx, _) = broadcast::channel(100);
        map.insert(key, tx);
    }
    
    pub fn get_or_create_channel(&self, book_id: &str, chapter_index: usize) -> broadcast::Sender<SentencePayload> {
        let key = format!("{}_{}", book_id, chapter_index);
        let mut map = self.channels.lock().unwrap();
        if let Some(tx) = map.get(&key) {
            return tx.clone();
        }
        let (tx, _) = broadcast::channel(100);
        map.insert(key, tx.clone());
        tx
    }
    
    pub fn push_sentence(
        &self,
        book_id: &str,
        chapter_index: usize,
        sentence_index: usize,
        audio: Vec<u8>,
        duration_seconds: f64,
        sentence_text: String,
        word_alignments: Vec<WordAlignment>,
    ) {
        if audio.is_empty() { return; }
        self.mark_current_chapter(book_id, chapter_index);

        let key = format!("{}_{}", book_id, chapter_index);
        let payload = SentencePayload {
            sentence_index,
            audio_bytes: audio,
            duration_seconds,
            sentence_text,
            word_alignments,
        };
        {
            let mut snapshots = self.snapshots.lock().unwrap();
            let snapshot = snapshots.entry(key.clone()).or_default();
            snapshot.sentences.insert(sentence_index, payload.clone());
        }
        let map = self.channels.lock().unwrap();
        if let Some(tx) = map.get(&key) {
            let _ = tx.send(payload);
        }
    }

    pub fn snapshot_sentences(&self, book_id: &str, chapter_index: usize) -> Vec<SentencePayload> {
        let key = format!("{}_{}", book_id, chapter_index);
        let snapshots = self.snapshots.lock().unwrap();
        snapshots
            .get(&key)
            .map(|snapshot| snapshot.sentences.values().cloned().collect())
            .unwrap_or_default()
    }

    pub fn snapshot_mp3(&self, book_id: &str, chapter_index: usize) -> Vec<u8> {
        self.snapshot_sentences(book_id, chapter_index)
            .into_iter()
            .flat_map(|sentence| sentence.audio_bytes)
            .collect()
    }

    pub fn duration_seconds(&self, book_id: &str, chapter_index: usize) -> f64 {
        self.snapshot_sentences(book_id, chapter_index)
            .into_iter()
            .map(|sentence| sentence.duration_seconds)
            .sum()
    }

    pub fn resolve_sync_marker(
        &self,
        book_id: &str,
        chapter_index: usize,
        current_time_seconds: f64,
    ) -> LiveSyncMarker {
        let key = format!("{}_{}", book_id, chapter_index);
        let snapshots = self.snapshots.lock().unwrap();
        let Some(snapshot) = snapshots.get(&key) else {
            return LiveSyncMarker {
                text_element_id: None,
                smil_id: None,
                chapter_id: None,
                chapter_href: None,
                sentence_index: None,
                clip_begin: None,
                clip_end: None,
                sentence_text: None,
                word_alignments: None,
                current_word_index: None,
            };
        };

        let mut elapsed = 0.0_f64;
        let mut selected_sentence_index: Option<usize> = None;
        let mut selected_clip_begin: Option<f64> = None;
        let mut selected_clip_end: Option<f64> = None;
        let mut selected_sentence_text: Option<String> = None;
        let mut selected_word_alignments: Option<Vec<WordAlignment>> = None;
        let mut selected_current_word_index: Option<usize> = None;

        for sentence in snapshot.sentences.values() {
            let start = elapsed;
            let end = elapsed + sentence.duration_seconds;
            if current_time_seconds <= end {
                selected_sentence_index = Some(sentence.sentence_index);
                selected_clip_begin = Some(start);
                selected_clip_end = Some(end);
                selected_sentence_text = Some(sentence.sentence_text.clone());
                selected_word_alignments = Some(sentence.word_alignments.clone());
                
                // Calculate current word index based on time within the sentence
                let time_in_sentence = current_time_seconds - start;
                let current_word_idx = sentence.word_alignments
                    .iter()
                    .position(|wa| (wa.start_sec as f64) <= time_in_sentence && time_in_sentence < (wa.end_sec as f64))
                    .unwrap_or(0);
                selected_current_word_index = Some(current_word_idx);
                break;
            }
            elapsed = end;
            selected_sentence_index = Some(sentence.sentence_index);
            selected_clip_begin = Some(start);
            selected_clip_end = Some(end);
            selected_sentence_text = Some(sentence.sentence_text.clone());
            selected_word_alignments = Some(sentence.word_alignments.clone());
            selected_current_word_index = Some(0);
        }

        let text_element_id = selected_sentence_index.map(|idx| format!("f{:06}", idx + 1));

        LiveSyncMarker {
            text_element_id: text_element_id.clone(),
            smil_id: text_element_id,
            chapter_id: snapshot.chapter_id.clone(),
            chapter_href: snapshot.chapter_href.clone(),
            sentence_index: selected_sentence_index,
            clip_begin: selected_clip_begin,
            clip_end: selected_clip_end,
            sentence_text: selected_sentence_text,
            word_alignments: selected_word_alignments,
            current_word_index: selected_current_word_index,
        }
    }

    pub fn segment_manifest(&self, book_id: &str, chapter_index: usize) -> Vec<LiveSegmentMeta> {
        let key = format!("{}_{}", book_id, chapter_index);
        let snapshots = self.snapshots.lock().unwrap();
        let Some(snapshot) = snapshots.get(&key) else {
            return Vec::new();
        };

        let mut elapsed = 0.0_f64;
        let mut manifest = Vec::with_capacity(snapshot.sentences.len());

        for sentence in snapshot.sentences.values() {
            manifest.push(LiveSegmentMeta {
                sentence_index: sentence.sentence_index,
                start_time_seconds: elapsed,
                duration_seconds: sentence.duration_seconds,
                byte_length: sentence.audio_bytes.len(),
            });
            elapsed += sentence.duration_seconds;
        }

        manifest
    }

    pub fn sentence_bytes(
        &self,
        book_id: &str,
        chapter_index: usize,
        sentence_index: usize,
    ) -> Option<Vec<u8>> {
        let key = format!("{}_{}", book_id, chapter_index);
        let snapshots = self.snapshots.lock().unwrap();
        snapshots
            .get(&key)
            .and_then(|snapshot| snapshot.sentences.get(&sentence_index))
            .map(|sentence| sentence.audio_bytes.clone())
    }
    
    pub fn end_stream(&self, book_id: &str, chapter_index: usize) {
        let key = format!("{}_{}", book_id, chapter_index);
        let mut map = self.channels.lock().unwrap();
        map.remove(&key);
    }

    /// Save checkpoint for chapter (for recovery if conversion is cancelled)
    /// Audio files are saved to filesystem to avoid SQLite BLOB performance issues
    pub async fn save_checkpoint(
        &self,
        pool: &sqlx::SqlitePool,
        base_dir: &std::path::Path,
        book_id: &str,
        chapter_index: usize,
        chapter_id: Option<String>,
        chapter_href: Option<String>,
        total_sentences: usize,
    ) -> Result<(), String> {
        use crate::book_service::repositories::ConversionCheckpointRepository;
        
        let mut sentences = self.snapshot_sentences(book_id, chapter_index);
        sentences.sort_by_key(|s| s.sentence_index);

        // Track contiguous sentence progress from index 0.
        // Sentence tasks complete out of order, so len() can overstate safe resume progress.
        let mut contiguous_processed = 0usize;
        for sentence in &sentences {
            if sentence.sentence_index == contiguous_processed {
                contiguous_processed += 1;
            } else if sentence.sentence_index > contiguous_processed {
                break;
            }
        }

        if contiguous_processed < sentences.len() {
            log::debug!(
                "Checkpoint for book={}, chapter={} has non-contiguous sentences: contiguous={}, total_saved={}",
                book_id,
                chapter_index,
                contiguous_processed,
                sentences.len()
            );
        }

        let audio_duration = self.duration_seconds(book_id, chapter_index);
        
        // Ensure checkpoint directory exists
        ConversionCheckpointRepository::ensure_checkpoint_dir(base_dir, book_id)?;

        // Save checkpoint metadata
        ConversionCheckpointRepository::save_checkpoint(
            pool,
            book_id,
            chapter_index,
            chapter_id,
            chapter_href,
            contiguous_processed,
            total_sentences,
            audio_duration,
        )
        .await?;

        // Save individual sentence alignments with file paths (not BLOBs)
        for sentence in sentences {
            // Save audio to disk
            let audio_file_path = ConversionCheckpointRepository::get_audio_file_path(
                base_dir,
                book_id,
                chapter_index,
                sentence.sentence_index,
            );
            
            std::fs::write(&audio_file_path, &sentence.audio_bytes)
                .map_err(|e| format!("Failed to write checkpoint audio file: {}", e))?;

            // Save metadata pointing to file (no BLOB in database)
            ConversionCheckpointRepository::save_sentence_alignment(
                pool,
                book_id,
                chapter_index,
                sentence.sentence_index,
                audio_file_path.to_str().unwrap_or(""),
                sentence.duration_seconds,
                &sentence.sentence_text,
                &sentence.word_alignments,
            )
            .await?;
        }

        Ok(())
    }

    /// Restore checkpoint data into memory (for resuming live stream after cancellation)
    pub async fn restore_checkpoint(
        &self,
        pool: &sqlx::SqlitePool,
        _base_dir: &std::path::Path,
        book_id: &str,
        chapter_index: usize,
        chapter_id: Option<String>,
        chapter_href: Option<String>,
    ) -> Result<usize, String> {
        use crate::book_service::repositories::ConversionCheckpointRepository;

        // Start a new stream session
        self.start_stream(book_id, chapter_index, chapter_id, chapter_href);

        // Load all saved sentences from checkpoint
        let sentences = ConversionCheckpointRepository::load_chapter_sentences(
            pool,
            book_id,
            chapter_index,
        )
        .await?;
        let mut sentences = sentences;
        sentences.sort_by_key(|s| s.sentence_index);
        let restored_count = sentences.len();

        // Restore each sentence into the live stream by loading audio from disk
        for sentence in sentences {
            // Load audio from file (no database BLOB read)
            let audio_bytes = std::fs::read(&sentence.audio_file_path)
                .map_err(|e| format!("Failed to read checkpoint audio file {}: {}", sentence.audio_file_path, e))?;

            self.push_sentence(
                book_id,
                chapter_index,
                sentence.sentence_index,
                audio_bytes,
                sentence.duration_seconds,
                sentence.sentence_text,
                sentence.word_alignments,
            );
        }

        log::info!(
            "Restored checkpoint for book={}, chapter={}: {} sentences",
            book_id,
            chapter_index,
            restored_count
        );

        Ok(restored_count)
    }

    /// Load saved sentence audio from checkpoint (for playback resumption)
    pub async fn load_saved_sentence(
        &self,
        pool: &sqlx::SqlitePool,
        _base_dir: &std::path::Path,
        book_id: &str,
        chapter_index: usize,
        sentence_index: usize,
    ) -> Result<Option<SentencePayload>, String> {
        use crate::book_service::repositories::ConversionCheckpointRepository;

        match ConversionCheckpointRepository::load_sentence_alignment(
            pool,
            book_id,
            chapter_index,
            sentence_index,
        )
        .await?
        {
            Some(sentence) => {
                // Load audio from file instead of database
                let audio_bytes = std::fs::read(&sentence.audio_file_path)
                    .map_err(|e| format!("Failed to read checkpoint audio file {}: {}", sentence.audio_file_path, e))?;

                Ok(Some(SentencePayload {
                    sentence_index: sentence.sentence_index,
                    audio_bytes,
                    duration_seconds: sentence.duration_seconds,
                    sentence_text: sentence.sentence_text,
                    word_alignments: sentence.word_alignments,
                }))
            }
            None => Ok(None),
        }
    }
}

static LIVE_STREAM_MANAGER: OnceLock<Arc<LiveStreamManager>> = OnceLock::new();

pub fn get_live_stream_manager() -> Arc<LiveStreamManager> {
    LIVE_STREAM_MANAGER
        .get_or_init(|| Arc::new(LiveStreamManager::new()))
        .clone()
}

async fn hydrate_live_stream_from_checkpoint(
    app: &tauri::AppHandle,
    book_id: &str,
    chapter_index: usize,
) {
    let manager = get_live_stream_manager();
    if manager.duration_seconds(book_id, chapter_index) > 0.0 {
        return;
    }

    use tauri::Manager;
    let Ok(app_data_dir) = app.path().app_data_dir() else {
        return;
    };

    let Ok(db) = get_db_connection(app).await else {
        return;
    };

    match manager
        .restore_checkpoint(
            db.as_ref(),
            &app_data_dir,
            book_id,
            chapter_index,
            None,
            None,
        )
        .await
    {
        Ok(restored) if restored > 0 => {
            log::info!(
                "Hydrated live stream from checkpoint: book_id={}, chapter_index={}, restored_sentences={}",
                book_id,
                chapter_index,
                restored
            );
        }
        Ok(_) => {}
        Err(e) => {
            log::debug!(
                "No live checkpoint hydration available for book_id={}, chapter_index={}: {}",
                book_id,
                chapter_index,
                e
            );
        }
    }
}

/// Generate a streaming URL for a live (in-progress) chapter conversion
/// The frontend calls this to listen to a chapter while it is still being converted.
#[tauri::command]
pub async fn get_audio_live_stream_url(
    book_id: String,
    chapter_index: usize,
    app: tauri::AppHandle,
) -> Result<String, AppError> {
    log::info!(
        "[get_audio_live_stream_url] request book_id={}, chapter_index={}",
        book_id,
        chapter_index
    );

    // Ensure the server is running
    let server_started = get_server_started_flag();
    let is_running = if server_started.load(std::sync::atomic::Ordering::Relaxed) {
        check_server_running().await
    } else {
        false
    };

    if !is_running {
        log::info!("Audio server not running, starting it now for live stream...");
        match start_audio_server(app.clone()).await {
            Ok(_) => {
                tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;
            }
            Err(e) => {
                log::error!("Failed to start audio server: {}", e);
                tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
                if let Err(e2) = start_audio_server(app.clone()).await {
                    return Err(AppError::Store(format!(
                        "Failed to start audio streaming server: {}",
                        e2
                    )));
                }
            }
        }

        let mut retries = 3;
        while retries > 0 && !check_server_running().await {
            tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
            retries -= 1;
        }

        if !check_server_running().await {
            return Err(AppError::Store(
                "Audio streaming server is not responding".to_string(),
            ));
        }
    }

    // Ensure paused/resumed sessions can still stream in-progress chapter audio
    // from persisted checkpoints even before conversion restarts.
    hydrate_live_stream_from_checkpoint(&app, &book_id, chapter_index).await;

    let port = get_server_port().load(std::sync::atomic::Ordering::Relaxed);
    if port == 0 {
        return Err(AppError::Store(
            "Audio streaming server port not initialized".to_string(),
        ));
    }

    let url = format!(
        "http://localhost:{}/audio-live/{}/{}",
        port, book_id, chapter_index
    );
    log::info!(
        "[get_audio_live_stream_url] resolved book_id={}, chapter_index={}, url={}",
        book_id,
        chapter_index,
        url
    );
    Ok(url)
}

/// Returns current generated duration in seconds for a live chapter.
/// Duration grows as sentence chunks are persisted during conversion.
#[tauri::command]
pub async fn get_live_chapter_duration(
    book_id: String,
    chapter_index: usize,
    app: tauri::AppHandle,
) -> Result<f64, AppError> {
    hydrate_live_stream_from_checkpoint(&app, &book_id, chapter_index).await;
    let manager = get_live_stream_manager();
    let duration = manager.duration_seconds(&book_id, chapter_index);
    log::info!(
        "[get_live_chapter_duration] book_id={}, chapter_index={}, duration_seconds={}",
        book_id,
        chapter_index,
        duration
    );
    Ok(duration)
}

/// Returns current live sync marker (SMIL/text element id + chapter info)
/// for the provided playback time.
#[tauri::command]
pub async fn get_live_sync_marker(
    book_id: String,
    chapter_index: usize,
    current_time_seconds: f64,
    app: tauri::AppHandle,
) -> Result<LiveSyncMarker, AppError> {
    hydrate_live_stream_from_checkpoint(&app, &book_id, chapter_index).await;
    let manager = get_live_stream_manager();
    Ok(manager.resolve_sync_marker(
        &book_id,
        chapter_index,
        current_time_seconds.max(0.0),
    ))
}

/// Returns a manifest of currently generated live audio segments for MSE playback.
#[tauri::command]
pub async fn get_live_segment_manifest(
    book_id: String,
    chapter_index: usize,
    app: tauri::AppHandle,
) -> Result<Vec<LiveSegmentMeta>, AppError> {
    hydrate_live_stream_from_checkpoint(&app, &book_id, chapter_index).await;
    let manager = get_live_stream_manager();
    let manifest = manager.segment_manifest(&book_id, chapter_index);
    log::info!(
        "[get_live_segment_manifest] book_id={}, chapter_index={}, segment_count={}",
        book_id,
        chapter_index,
        manifest.len()
    );
    Ok(manifest)
}

/// Returns bytes for a specific generated live segment (sentence).
#[tauri::command]
pub async fn get_live_segment_bytes(
    book_id: String,
    chapter_index: usize,
    sentence_index: usize,
    app: tauri::AppHandle,
) -> Result<Vec<u8>, AppError> {
    hydrate_live_stream_from_checkpoint(&app, &book_id, chapter_index).await;
    let manager = get_live_stream_manager();
    Ok(manager
        .sentence_bytes(&book_id, chapter_index, sentence_index)
        .unwrap_or_default())
}

/// Generate a streaming URL for an audio track
/// This URL can be used with HTML5 audio elements for streaming playback
/// This function ensures the server is running before returning the URL
#[tauri::command]
pub async fn get_audio_stream_url(
    book_id: String,
    track_id: String,
    app: tauri::AppHandle,
) -> Result<String, AppError> {
    log::info!(
        "[get_audio_stream_url] request book_id={}, track_id={}",
        book_id,
        track_id
    );

    // Validate that the track exists
    let db = get_db_connection(&app)
        .await
        .map_err(|e| AppError::Store(e))?;

    let can = AudioRepository::can_stream_track(db.as_ref(), &book_id, &track_id)
        .await
        .map_err(|e| AppError::Store(e))?;

    if !can {
        return Err(AppError::Store(
            "Audio track not found or EPUB file missing".to_string(),
        ));
    }

    // Ensure the server is running before returning the URL
    // This is especially important on iOS where the server may have been killed
    let server_started = get_server_started_flag();
    let is_running = if server_started.load(std::sync::atomic::Ordering::Relaxed) {
        // Check if it's actually responding
        check_server_running().await
    } else {
        false
    };

    if !is_running {
        log::info!("Audio server not running, starting it now...");
        // Try to start the server
        match start_audio_server(app.clone()).await {
            Ok(_) => {
                log::info!("Audio server started successfully");
                // Give it a moment to be ready
                tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;
            }
            Err(e) => {
                log::error!("Failed to start audio server: {}", e);
                // Try one more time after a short delay
                tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
                if let Err(e2) = start_audio_server(app.clone()).await {
                    log::error!("Failed to start audio server on retry: {}", e2);
                    return Err(AppError::Store(format!(
                        "Failed to start audio streaming server: {}",
                        e2
                    )));
                }
            }
        }

        // Verify it's actually running now
        let mut retries = 3;
        while retries > 0 && !check_server_running().await {
            log::warn!(
                "Server started but not responding yet, waiting... ({} retries left)",
                retries - 1
            );
            tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
            retries -= 1;
        }

        if !check_server_running().await {
            log::error!("Audio server failed to become responsive");
            return Err(AppError::Store(
                "Audio streaming server is not responding".to_string(),
            ));
        }
    }

    // Get the port number
    let port = get_server_port().load(std::sync::atomic::Ordering::Relaxed);
    if port == 0 {
        return Err(AppError::Store(
            "Audio streaming server port not initialized".to_string(),
        ));
    }

    // Return HTTP URL for the local streaming server
    let url = format!(
        "http://localhost:{}/audio/{}/{}",
        port, book_id, track_id
    );
    log::info!(
        "[get_audio_stream_url] resolved book_id={}, track_id={}, url={}",
        book_id,
        track_id,
        url
    );
    Ok(url)
}

#[tauri::command]
pub async fn get_epub_resource_url(
    book_id: String,
    href: String,
    chapter_href: Option<String>,
    app: tauri::AppHandle,
) -> Result<String, AppError> {
    let port = ensure_server_started_and_get_port(app).await?;

    Ok(build_epub_resource_absolute_url(
        port,
        &book_id,
        &href,
        chapter_href.as_deref(),
    ))
}


/// Health check endpoint
async fn health_check() -> &'static str {
    "OK"
}

/// Handle live audio streaming HTTP requests
async fn handle_audio_live_stream(
    Path((book_id, chapter_index_str)): Path<(String, String)>,
    State(_app): State<Arc<AppHandle>>,
    headers: HeaderMap,
) -> Result<Response<axum::body::Body>, StatusCode> {
    log::debug!(
        "Live streaming audio: book_id='{}', chapter_index='{}'",
        book_id,
        chapter_index_str
    );

    let chapter_index = match chapter_index_str.parse::<usize>() {
        Ok(idx) => idx,
        Err(_) => return Err(StatusCode::BAD_REQUEST),
    };

    let live_stream_manager = get_live_stream_manager();

    // If the client asks for byte ranges, serve a finite snapshot with range support.
    if let Some(range_header) = headers.get(header::RANGE).and_then(|h| h.to_str().ok()) {
        let snapshot = live_stream_manager.snapshot_mp3(&book_id, chapter_index);

        let total_len = snapshot.len();
        if total_len == 0 {
            return Ok(Response::builder()
                .status(StatusCode::NO_CONTENT)
                .header("Content-Type", "audio/mpeg")
                .header("Accept-Ranges", "bytes")
                .header("Cache-Control", "no-cache")
                .header("Access-Control-Allow-Origin", "*")
                .body(axum::body::Body::empty())
                .unwrap());
        }

        let Some((start, end)) = parse_range_header(range_header, total_len) else {
            return Ok(Response::builder()
                .status(StatusCode::RANGE_NOT_SATISFIABLE)
                .header("Content-Range", format!("bytes */{}", total_len))
                .header("Accept-Ranges", "bytes")
                .header("Content-Type", "audio/mpeg")
                .header("Access-Control-Allow-Origin", "*")
                .body(axum::body::Body::empty())
                .unwrap());
        };

        let chunk = snapshot[start..=end].to_vec();
        return Ok(Response::builder()
            .status(StatusCode::PARTIAL_CONTENT)
            .header("Content-Type", "audio/mpeg")
            .header("Accept-Ranges", "bytes")
            .header("Content-Range", format!("bytes {}-{}/{}", start, end, total_len))
            .header("Content-Length", chunk.len().to_string())
            .header("Cache-Control", "no-cache")
            .header("Access-Control-Allow-Origin", "*")
            .body(axum::body::Body::from(chunk))
            .unwrap());
    }

    // Subscribe to new sentences early to avoid missing data between DB read and subscribe
    let mut rx = live_stream_manager.get_or_create_channel(&book_id, chapter_index).subscribe();

    let stream = stream! {
        // 1. Fetch existing persisted sentence chunks.
        // Emit only contiguous indices from 0, buffering any gaps until they can be emitted in order.
        let mut next_expected_sentence_index: usize = 0;
        let mut pending_chunks: BTreeMap<usize, Vec<u8>> = BTreeMap::new();

        for sentence in live_stream_manager.snapshot_sentences(&book_id, chapter_index) {
            if sentence.audio_bytes.is_empty() {
                continue;
            }

            if sentence.sentence_index < next_expected_sentence_index {
                continue;
            }

            if sentence.sentence_index == next_expected_sentence_index {
                yield Ok::<_, std::convert::Infallible>(axum::body::Bytes::from(sentence.audio_bytes));
                next_expected_sentence_index += 1;

                while let Some(buffered_chunk) = pending_chunks.remove(&next_expected_sentence_index) {
                    yield Ok::<_, std::convert::Infallible>(axum::body::Bytes::from(buffered_chunk));
                    next_expected_sentence_index += 1;
                }
            } else {
                pending_chunks.entry(sentence.sentence_index).or_insert(sentence.audio_bytes);
            }
        }

        // 2. Read newly completed sentences, preserving strict index order.
        loop {
            match rx.recv().await {
                Ok(payload) => {
                    if payload.audio_bytes.is_empty() {
                        continue;
                    }

                    if payload.sentence_index < next_expected_sentence_index {
                        continue;
                    }

                    if payload.sentence_index == next_expected_sentence_index {
                        yield Ok::<_, std::convert::Infallible>(axum::body::Bytes::from(payload.audio_bytes));
                        next_expected_sentence_index += 1;

                        while let Some(buffered_chunk) = pending_chunks.remove(&next_expected_sentence_index) {
                            yield Ok::<_, std::convert::Infallible>(axum::body::Bytes::from(buffered_chunk));
                            next_expected_sentence_index += 1;
                        }
                    } else {
                        pending_chunks.entry(payload.sentence_index).or_insert(payload.audio_bytes);
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                    // Channel closed means stream ended
                    break;
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                    // Receiver lagged behind, just continue receiving
                    continue;
                }
            }
        }
    };

    Ok(Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", "audio/mpeg")
        .header("Accept-Ranges", "bytes")
        // Not setting transfer-encoding chunked explicitly, as axum handles this for streams implicitly via chunked transfer encoding or raw stream transport down the pipe
        .header("Cache-Control", "no-cache")
        .header("Access-Control-Allow-Origin", "*")
        .body(axum::body::Body::from_stream(stream))
        .unwrap())
}


/// Handle audio streaming HTTP requests
async fn handle_audio_stream(
    Path((book_id, track_id)): Path<(String, String)>,
    State(app): State<Arc<AppHandle>>,
) -> Result<Response<axum::body::Body>, StatusCode> {
    log::debug!(
        "Streaming audio: book_id='{}', track_id='{}'",
        book_id,
        track_id
    );

    // Get database connection
    let db = get_db_connection(&*app)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let (audio_data, href) = AudioRepository::resolve_track_audio_bytes(db.as_ref(), &book_id, &track_id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;

    // Detect MIME type
    let mime_type = detect_audio_mime_type(&href, &href);

    log::info!(
        "Streaming audio track '{}' ({} bytes, type: {})",
        track_id,
        audio_data.len(),
        mime_type
    );

    // Create response with proper headers for streaming
    Ok(Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", mime_type)
        .header("Content-Length", audio_data.len().to_string())
        .header("Accept-Ranges", "bytes")
        .header("Cache-Control", "public, max-age=31536000")
        .header("Access-Control-Allow-Origin", "*")
        .body(axum::body::Body::from(audio_data))
        .unwrap())
}

async fn handle_epub_resource(
    Query(query): Query<EpubResourceQuery>,
    State(app): State<Arc<AppHandle>>,
) -> Result<Response<axum::body::Body>, StatusCode> {
    let db = get_db_connection(&*app)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let Some(epub_file_path) = EpubRepository::file_path_for_book_id(db.as_ref(), &query.book_id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    else {
        return Err(StatusCode::NOT_FOUND);
    };

    let href = query.href.clone();
    let chapter_href = query.chapter_href.clone();
    let path_for_task = epub_file_path.clone();
    let result = tokio::task::spawn_blocking(move || {
        crate::book_service::epub_file_storage::read_resource_from_epub_file(
            std::path::Path::new(&path_for_task),
            &href,
            chapter_href.as_deref(),
        )
    })
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let (mut resource_bytes, resolved_path) = result.map_err(|_| StatusCode::NOT_FOUND)?;
    let mime_type = detect_resource_mime_type(&resolved_path, &resource_bytes);

    if mime_type == "text/css" {
        if let Ok(css_text) = String::from_utf8(resource_bytes.clone()) {
            let port = get_server_port().load(std::sync::atomic::Ordering::Relaxed);
            let rewritten_css = rewrite_css_urls_for_endpoint(
                &css_text,
                port,
                &query.book_id,
                &resolved_path,
            );
            resource_bytes = rewritten_css.into_bytes();
        }
    }

    Ok(Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", mime_type)
        .header("Content-Length", resource_bytes.len().to_string())
        .header("Cache-Control", "public, max-age=86400")
        .header("Access-Control-Allow-Origin", "*")
        .body(axum::body::Body::from(resource_bytes))
        .unwrap())
}


/// Check if the server is running by attempting to connect to the port
pub async fn check_server_running() -> bool {
    let port = get_server_port().load(std::sync::atomic::Ordering::Relaxed);
    if port == 0 {
        return false;
    }

    // Simple check: try to connect to the port
    let addr = format!("127.0.0.1:{}", port);
    match tokio::net::TcpStream::connect(&addr).await {
        Ok(mut stream) => {
            // Try to make a simple HTTP request to verify it's our server
            use tokio::io::{AsyncReadExt, AsyncWriteExt};
            let request = format!("GET /health HTTP/1.1\r\nHost: localhost:{}\r\n\r\n", port);
            if stream.write_all(request.as_bytes()).await.is_ok() {
                let mut buffer = [0u8; 64];
                if let Ok(_) = tokio::time::timeout(
                    tokio::time::Duration::from_millis(100),
                    stream.read(&mut buffer),
                )
                .await
                {
                    // Check if we got an HTTP response
                    let response = String::from_utf8_lossy(&buffer);
                    response.contains("HTTP/1.1") && response.contains("200")
                } else {
                    false
                }
            } else {
                false
            }
        }
        Err(_) => false,
    }
}

/// Start the audio streaming HTTP server
pub async fn start_audio_server(
    app: AppHandle,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let server_started = get_server_started_flag();

    // Check if server already started
    if server_started.load(std::sync::atomic::Ordering::Relaxed) {
        // Verify it's actually running
        if check_server_running().await {
            log::debug!("Audio streaming server is already running");
            return Ok(());
        } else {
            log::warn!("Server flag says started but server is not responding, restarting...");
            server_started.store(false, std::sync::atomic::Ordering::Relaxed);
        }
    }

    log::info!("Initializing audio streaming server...");
    let app_state = Arc::new(app);

    let router = Router::new()
        .route("/health", get(health_check))
        .route("/audio/:book_id/:track_id", get(handle_audio_stream))
        .route("/epub-resource", get(handle_epub_resource))
        .route("/audio-live/:book_id/:chapter_index", get(handle_audio_live_stream))
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any),
        )
        .with_state(app_state);

    // Try to bind to an available port (port 0 lets the OS choose)
    log::info!("Attempting to bind to 127.0.0.1:0 (OS will assign available port)...");
    let listener = match TcpListener::bind("127.0.0.1:0").await {
        Ok(listener) => {
            // Get the actual port assigned by the OS
            let port = listener
                .local_addr()
                .map_err(|e| format!("Failed to get local address: {}", e))?
                .port();

            // Store the port number
            let server_port = get_server_port();
            server_port.store(port, std::sync::atomic::Ordering::Relaxed);

            log::info!("✓ Successfully bound to http://127.0.0.1:{}", port);
            listener
        }
        Err(e) => {
            log::error!("✗ Failed to bind to port: {}", e);
            return Err(format!("Failed to bind to port: {}", e).into());
        }
    };

    // Get the port for logging
    let port = get_server_port().load(std::sync::atomic::Ordering::Relaxed);

    // Create shutdown signal for graceful shutdown
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();

    // Store the shutdown sender in global state
    let shutdown_state = get_server_shutdown();
    {
        let mut guard = shutdown_state.lock().unwrap();
        *guard = Some(shutdown_tx);
    }

    // Spawn the server in a separate task with graceful shutdown support
    let server_handle = tokio::spawn(async move {
        log::info!(
            "🚀 Audio streaming server starting on http://127.0.0.1:{}",
            port
        );
        log::info!("   Health check: http://127.0.0.1:{}/health", port);

        // Create a shutdown signal that combines our custom shutdown with OS signals
        let shutdown = async {
            #[cfg(not(target_os = "ios"))]
            {
                // On non-iOS platforms, wait for either our custom shutdown signal or OS signals
                tokio::select! {
                    _ = shutdown_rx => {
                        log::info!("Received shutdown signal for audio streaming server");
                    }
                    _ = signal::ctrl_c() => {
                        log::info!("Received Ctrl+C, shutting down audio streaming server");
                    }
                }
            }
            #[cfg(target_os = "ios")]
            {
                // On iOS, only wait for our custom shutdown signal
                shutdown_rx.await;
                log::info!("Received shutdown signal for audio streaming server");
            }
        };

        // Serve with graceful shutdown
        if let Err(e) = axum::serve(listener, router)
            .with_graceful_shutdown(shutdown)
            .await
        {
            log::error!("Audio streaming server error: {}", e);
        } else {
            log::info!("Audio streaming server shut down gracefully");
        }
    });

    // Mark server as started
    server_started.store(true, std::sync::atomic::Ordering::Relaxed);

    // Give the server a moment to start accepting connections
    tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
    log::info!("Audio streaming server initialization complete");

    // Store the server handle (we could use this to wait for shutdown, but for now we just let it run)
    std::mem::forget(server_handle);

    Ok(())
}

/// Stop the audio streaming server gracefully
pub async fn stop_audio_server() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let server_started = get_server_started_flag();
    let shutdown_state = get_server_shutdown();

    // Check if server is running
    if !server_started.load(std::sync::atomic::Ordering::Relaxed) {
        log::debug!("Audio streaming server is not running, nothing to stop");
        return Ok(());
    }

    log::info!("Stopping audio streaming server...");

    // Send shutdown signal
    let shutdown_tx = {
        let mut guard = shutdown_state.lock().unwrap();
        guard.take()
    };

    if let Some(tx) = shutdown_tx {
        if let Err(_e) = tx.send(()) {
            log::warn!("Failed to send shutdown signal (server may have already stopped)");
        } else {
            log::info!("Shutdown signal sent to audio streaming server");
            // Give the server a moment to shut down gracefully
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        }
    }

    // Reset server state
    server_started.store(false, std::sync::atomic::Ordering::Relaxed);
    let server_port = get_server_port();
    server_port.store(0, std::sync::atomic::Ordering::Relaxed);

    log::info!("Audio streaming server stopped");
    Ok(())
}

/// Restart the audio streaming server (useful when app comes back to foreground on iOS)
pub async fn restart_audio_server(
    app: AppHandle,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Stop the server first if it's running
    let _ = stop_audio_server().await;

    // Wait a moment before restarting
    tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;

    log::info!("Restarting audio streaming server...");
    start_audio_server(app).await
}

/// Detect audio MIME type from file extension
fn detect_audio_mime_type(audio_path: &str, audio_href: &str) -> &'static str {
    let path_lower = audio_path.to_lowercase();
    let href_lower = audio_href.to_lowercase();

    if path_lower.ends_with(".mp3") || href_lower.ends_with(".mp3") {
        "audio/mpeg"
    } else if path_lower.ends_with(".m4a") || href_lower.ends_with(".m4a") {
        "audio/mp4"
    } else if path_lower.ends_with(".ogg") || href_lower.ends_with(".ogg") {
        "audio/ogg"
    } else if path_lower.ends_with(".wav") || href_lower.ends_with(".wav") {
        "audio/wav"
    } else if path_lower.ends_with(".webm") || href_lower.ends_with(".webm") {
        "audio/webm"
    } else if path_lower.ends_with(".flac") || href_lower.ends_with(".flac") {
        "audio/flac"
    } else {
        // Default to MP3 if unknown
        "audio/mpeg"
    }
}
