use serde::{Deserialize, Serialize};

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
    pub language: String,
    pub chapters: Vec<ConversionChapter>,
}

/// Event emitted when a chapter conversion is completed.
///
/// This event is sent to the frontend to trigger a book refresh
/// so the user can listen to the book as soon as one chapter is ready.
///
/// # Fields
/// * `book_id` - The book ID of the book being converted
/// * `source_path` - The source path of the book being converted (kept for backward compatibility)
/// * `chapter_index` - The chapter number that was just completed (1-indexed)
/// * `total_chapters` - Total number of chapters in the book
/// * `chapter_title` - The title of the chapter that was just completed
/// * `audio_generated` - Whether audio was actually generated for this chapter
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterCompletedEvent {
    pub book_id: String,
    pub source_path: String,
    pub chapter_index: usize,
    pub total_chapters: usize,
    pub chapter_title: String,
    pub audio_generated: bool,
}

/// Event emitted when a conversion is cancelled.
///
/// This event is sent to the frontend to trigger a book refresh
/// and update the UI to show the cancellation state.
///
/// # Fields
/// * `book_id` - The book ID of the book being converted
/// * `source_path` - The source path of the book being converted (kept for backward compatibility)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversionCancelledEvent {
    pub book_id: String,
    pub source_path: String,
}

/// EPUB conversion context containing paths and file storage
pub(crate) struct ConversionContext {
    pub opf_path: String,
    pub base_path: String,
    pub original_files: std::collections::HashMap<String, Vec<u8>>,
    pub audio_files: Vec<(usize, String)>,
    pub smil_files: Vec<(usize, String)>,
    pub vtt_files: Vec<(usize, String)>,
    pub chapter_data: Vec<(usize, String, Vec<kokoros::tts::koko::WordAlignment>)>, // (index, title, alignments)
}

/// Result of processing a single chapter
pub(crate) struct ChapterProcessResult {
    pub chapter_index: usize,
    pub files: std::collections::HashMap<String, Vec<u8>>,
    pub audio_file: (usize, String),
    pub smil_file: (usize, String),
    pub vtt_file: (usize, String),
    pub word_alignments: Vec<kokoros::tts::koko::WordAlignment>,
    pub words_processed: usize,
}
