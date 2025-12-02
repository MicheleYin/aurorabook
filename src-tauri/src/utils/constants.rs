/// Audio sample rate for TTS generation (24kHz)
pub const SAMPLE_RATE: u32 = 24000;

/// Media type for XHTML content
pub const MEDIA_TYPE_XHTML: &str = "application/xhtml+xml";

/// Media type for HTML content
pub const MEDIA_TYPE_HTML: &str = "text/html";

/// Media type for HTML XML content
pub const MEDIA_TYPE_HTML_XML: &str = "application/html+xml";

/// Media type for SMIL files
pub const MEDIA_TYPE_SMIL: &str = "application/smil+xml";

/// Media type for MP3 audio
pub const MEDIA_TYPE_MP3: &str = "audio/mpeg";

/// Media type for WAV audio
pub const MEDIA_TYPE_WAV: &str = "audio/wav";

/// Default MP3 bitrate in kbps
pub const DEFAULT_MP3_BITRATE: u32 = 128;

/// Default LAME encoder quality (0-9, 2 is good balance)
pub const DEFAULT_LAME_QUALITY: u8 = 2;

/// Maximum EPUB file size (500MB)
pub const MAX_EPUB_SIZE: usize = 500 * 1024 * 1024;

/// Maximum number of chapters to process
pub const MAX_CHAPTERS: usize = 1000;

/// Maximum chapter size (50MB)
pub const MAX_CHAPTER_SIZE: usize = 50 * 1024 * 1024;

/// WAV file header size in bytes (standard WAV header is 44 bytes)
pub const WAV_HEADER_SIZE: usize = 44;

/// Minimum progress threshold (1%) - books below this are considered "new"
pub const MIN_PROGRESS_THRESHOLD: f64 = 0.01;

/// Maximum progress threshold (99%) - books above this are considered "finished"
pub const MAX_PROGRESS_THRESHOLD: f64 = 0.99;

