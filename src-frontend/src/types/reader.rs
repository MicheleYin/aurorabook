use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum PlaybackState {
    Idle,
    Loading,
    Playing,
    Paused,
}

/// VoiceId is a string identifier for Kokoro voices (e.g., "af_heart", "am_adam")
pub type VoiceId = String;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AudioTrack {
    pub id: String,
    pub title: String,
    pub href: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>, // Optional - loaded lazily
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<f64>,
    pub order: usize, // Order matches corresponding chapter order
    #[serde(skip)]
    pub loading: bool, // Internal flag to track loading state
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AudioSyncSegment {
    pub text_element_id: String,
    pub chapter_href: String,
    pub audio_track_href: String,
    pub clip_begin: f64, // seconds
    pub clip_end: f64, // seconds
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AudioSyncMap {
    pub segments: Vec<AudioSyncSegment>,
    // Map from audioTrackHref + time to segment index for quick lookup (optional, not used by findCurrentAudioSegment)
    #[serde(skip)]
    pub lookup: Option<std::collections::HashMap<String, usize>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BookAudioState {
    pub current_track_id: String,
    pub current_track_href: String,
    pub current_track_index: usize,
    pub current_time_seconds: f64,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Chapter {
    pub id: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_html: Option<String>, // Optional - loaded lazily
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plain_text: Option<String>, // Optional - loaded lazily
    pub order: usize,
    pub href: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub word_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub estimated_page_count: Option<usize>,
    #[serde(skip)]
    pub loading: bool, // Internal flag to track loading state
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
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
    pub book_progress_percent: f64,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
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
    pub content_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub publisher: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub published_year: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subjects: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_size_bytes: Option<u64>,
    pub audio_tracks: Vec<AudioTrack>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio_state: Option<BookAudioState>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio_sync_map: Option<AudioSyncMap>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<BookProgress>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conversion_status: Option<String>, // "notStarted" | "started" | "done"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_chapters: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub voice_id: Option<VoiceId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_words: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub words_processed: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_opened_time: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NavItem {
    pub href: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subitems: Option<Vec<NavItem>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ReaderTheme {
    Light,
    Dark,
    System,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ReaderFont {
    Merriweather,
    Inter,
    Lora,
    FiraMono,
    Atkinson,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ReaderContentPadding {
    Compact,
    Comfortable,
    Spacious,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ReaderFontSize {
    Small,
    Medium,
    Large,
    XLarge,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReaderPreferences {
    pub theme: ReaderTheme,
    pub font_family: ReaderFont,
    pub content_padding: ReaderContentPadding,
    pub font_size: ReaderFontSize,
}
