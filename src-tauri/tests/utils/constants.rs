//! Tests for utils::constants module
//!
//! Tests that constants are defined correctly

use aurorabook_lib::utils::constants;

#[test]
fn test_sample_rate() {
    assert_eq!(constants::SAMPLE_RATE, 44100);
}

#[test]
fn test_media_types() {
    assert_eq!(constants::MEDIA_TYPE_XHTML, "application/xhtml+xml");
    assert_eq!(constants::MEDIA_TYPE_HTML, "text/html");
    assert_eq!(constants::MEDIA_TYPE_HTML_XML, "application/html+xml");
}

#[test]
fn test_mp3_constants() {
    assert_eq!(constants::DEFAULT_MP3_BITRATE, 64);
}

#[test]
fn test_size_limits() {
    assert!(constants::MAX_EPUB_SIZE > 0);
    assert!(constants::MAX_CHAPTER_SIZE > 0);
    assert!(constants::MAX_CHAPTERS > 0);
}

#[test]
fn test_progress_thresholds() {
    assert!(constants::MIN_PROGRESS_THRESHOLD >= 0.0);
    assert!(constants::MIN_PROGRESS_THRESHOLD < constants::MAX_PROGRESS_THRESHOLD);
    assert!(constants::MAX_PROGRESS_THRESHOLD <= 1.0);
}

#[test]
fn test_wav_header_size() {
    assert_eq!(constants::WAV_HEADER_SIZE, 44);
}

