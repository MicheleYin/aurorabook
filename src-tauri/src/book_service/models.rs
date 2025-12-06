use serde::{Deserialize, Serialize};

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
    pub content_hash: Option<String>,
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
    /// Whether conversion has been started (even if not completed)
    #[serde(default)]
    pub conversion_started: bool,
    /// List of chapter hrefs that have been successfully converted
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub completed_chapters: Vec<String>,
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

