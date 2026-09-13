use serde::{Deserialize, Serialize};

/// Conversion status for a book
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConversionStatus {
    /// Conversion has not been started
    NotStarted,
    /// Conversion has been started but not completed
    Started,
    /// Conversion is complete (all chapters converted)
    Done,
}

impl Default for ConversionStatus {
    fn default() -> Self {
        ConversionStatus::NotStarted
    }
}

/// Audio track information
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioTrack {
    pub id: String,
    pub title: String,
    pub href: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<f64>,
    pub order: usize,
}

/// Word-level cue inside a sentence sync segment (chapter-relative seconds).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WordSyncCue {
    pub word: String,
    pub start_sec: f64,
    pub end_sec: f64,
}

/// Audio synchronization segment for highlighting text during playback
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioSyncSegment {
    pub text_element_id: String,
    pub chapter_href: String,
    pub audio_track_href: String,
    pub clip_begin: f64,
    pub clip_end: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub words: Option<Vec<WordSyncCue>>,
}

/// Audio synchronization map for a book
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioSyncMap {
    pub segments: Vec<AudioSyncSegment>,
}

/// Current audio playback state
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookAudioState {
    pub current_track_id: String,
    pub current_track_href: String,
    pub current_track_index: usize,
    pub current_time_seconds: f64,
    pub updated_at: String,
}

/// Chapter information
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Chapter {
    pub id: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_html: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plain_text: Option<String>,
    /// Wire name is `chapterOrder` (frontend). Accept legacy `order` on deserialize.
    #[serde(rename = "chapterOrder", alias = "order")]
    pub order: usize,
    pub href: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub word_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub estimated_page_count: Option<usize>,
}

/// Reading progress information
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookProgress {
    pub current_chapter_id: String,
    pub current_chapter_href: String,
    pub current_chapter_index: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_chapter_element_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_chapter_element_index: Option<usize>,
    pub current_chapter_scroll_top: f64,
    pub current_chapter_scroll_height: f64,
    pub current_chapter_client_height: f64,
    pub chapter_progress_percent: f64,
    /// Overall book progress across all chapters (0.0 to 1.0)
    /// Calculated as: (current_chapter_index + chapter_progress_percent) / total_chapters
    pub book_progress_percent: f64,
    pub updated_at: String,
}

/// Complete book information
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Book {
    pub id: String,
    pub title: String,
    pub author: String,
    pub chapters: Vec<Chapter>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_url: Option<String>,
    pub source_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub publisher: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub published_year: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subjects: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_size_bytes: Option<usize>,
    pub audio_tracks: Vec<AudioTrack>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio_state: Option<BookAudioState>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio_sync_map: Option<AudioSyncMap>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<BookProgress>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page_count: Option<usize>,
    /// Conversion status: not started, started, or done
    #[serde(default)]
    pub conversion_status: ConversionStatus,
    /// List of chapter hrefs that have been successfully converted
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub completed_chapters: Vec<String>,
    /// Voice ID used for TTS conversion
    #[serde(skip_serializing_if = "Option::is_none")]
    pub voice_id: Option<String>,
    /// Total number of words across all chapters
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_words: Option<usize>,
    /// Number of words that have been converted so far
    #[serde(skip_serializing_if = "Option::is_none")]
    pub words_processed: Option<usize>,
    /// Words already done when the current conversion session started (for resume ETA).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conversion_session_baseline_words: Option<usize>,
    /// When the current conversion session started (unix epoch millis as string).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conversion_session_started_at: Option<String>,
    /// Cumulative wall-clock ms spent converting across previous sessions.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conversion_elapsed_ms: Option<u64>,
    /// Timestamp when the book was last opened (RFC3339 format)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_opened_time: Option<String>,
}

/// Library filter options
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryFilter {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filter: Option<String>, // "all", "new", "resume", "finished", "recent", "author"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search: Option<String>,
}

/// App settings
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub theme: String, // "light", "cream", "dark", "pitch", "system"
    pub language: String, // "en", "es", "it", "zh"
    pub tts_language: String, // Supertonic 3 ISO code (30 langs; see AVAILABLE_LANGS)
    pub tts_voice_id: String,
    /// Supertonic synthesis quality: `fastest` (5 steps), `balanced` (10), `quality` (20).
    #[serde(default = "default_tts_synthesis_quality")]
    pub tts_synthesis_quality: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_scroll_enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio_playback_speed: Option<f64>,
    /// Last book opened in the reader (Kindle-style resume).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_opened_book_id: Option<String>,
    /// Last app page: `library`, `reader`, or `settings`.
    #[serde(default = "default_current_tab")]
    pub current_tab: String,
    /// Library layout: `grid` or `list`.
    #[serde(default = "default_library_view_mode")]
    pub library_view_mode: String,
    /// Floating audio player chrome: minimized vs expanded.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audio_player_minimized: Option<bool>,
    /// Reader immersive mode: `true` shows the header.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reader_header_visible: Option<bool>,
}

fn default_tts_synthesis_quality() -> String {
    "balanced".to_string()
}

fn default_current_tab() -> String {
    "library".to_string()
}

fn default_library_view_mode() -> String {
    "grid".to_string()
}

/// Persisted log row for the in-app log viewer (frontend + backend).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppLogEntry {
    pub timestamp: String,
    pub level: String,
    pub source: String,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReaderPreferences {
    pub theme: String, // "light", "cream", "dark", "pitch", "system"
    pub font_family: String,
    pub content_padding: String,
    pub font_size: String,
}

