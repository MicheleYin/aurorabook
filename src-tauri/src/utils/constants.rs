/// Audio sample rate for TTS generation (24kHz)
/// Supertonic v2 ONNX pipeline outputs at the rate declared in `tts.json` (typically 44.1 kHz).
pub const SAMPLE_RATE: u32 = 44100;

/// Media type for XHTML content
pub const MEDIA_TYPE_XHTML: &str = "application/xhtml+xml";

/// Media type for HTML content
pub const MEDIA_TYPE_HTML: &str = "text/html";

/// Media type for HTML XML content
pub const MEDIA_TYPE_HTML_XML: &str = "application/html+xml";

/// Default MP3 bitrate in kbps (reduced for smaller file size)
pub const DEFAULT_MP3_BITRATE: u32 = 64;

/// Default LAME encoder quality (0-9, 5 is lower quality for smaller files)
pub const DEFAULT_LAME_QUALITY: u8 = 5;

/// Maximum EPUB file size (5GB)
pub const MAX_EPUB_SIZE: usize = 5 * 1024 * 1024 * 1024; // 50GB

/// Maximum number of chapters to process
pub const MAX_CHAPTERS: usize = 1000;

/// Maximum chapter size (500MB)
pub const MAX_CHAPTER_SIZE: usize = 500 * 1024 * 1024;

/// WAV file header size in bytes (standard WAV header is 44 bytes)
pub const WAV_HEADER_SIZE: usize = 44;

/// Minimum progress threshold (1%) - books below this are considered "new"
pub const MIN_PROGRESS_THRESHOLD: f64 = 0.01;

/// Maximum progress threshold (99%) - books above this are considered "finished"
pub const MAX_PROGRESS_THRESHOLD: f64 = 0.99;

/// Maximum sentence length in characters before splitting (prevents phonemizer failures)
/// This is a conservative limit to avoid issues with very long text chunks
pub const MAX_SENTENCE_LENGTH: usize = 1000;

/// Maximum sentence length in words before splitting
/// Enforced strictly: sentences with more than this will be split into multiple chunks
pub const MAX_SENTENCE_WORDS: usize = 1000;

/// Maximum chunk size for aggressive splitting when phonemizer fails
/// Used as a fallback when initial processing fails
pub const MAX_CHUNK_LENGTH: usize = 500;

/// Maximum chunk words for aggressive splitting
pub const MAX_CHUNK_WORDS: usize = 1000;
