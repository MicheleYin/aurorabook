//! Tests for epub::parser::utils module
//!
//! Tests utility functions:
//! - extract_year
//! - derive_title_from_path
//! - generate_audio_track_title

use aurorabook_lib::epub::parser::utils::*;

#[test]
fn test_extract_year_from_date() {
    assert_eq!(extract_year(Some(&"2024-01-01".to_string())), Some("2024".to_string()));
    assert_eq!(extract_year(Some(&"2023-12-31T00:00:00Z".to_string())), Some("2023".to_string()));
    assert_eq!(extract_year(Some(&"Published in 2022".to_string())), Some("2022".to_string()));
}

#[test]
fn test_extract_year_none() {
    assert_eq!(extract_year(None), None);
}

#[test]
fn test_extract_year_invalid() {
    assert_eq!(extract_year(Some(&"invalid".to_string())), None);
    assert_eq!(extract_year(Some(&"202".to_string())), None); // Too short
    assert_eq!(extract_year(Some(&"abc".to_string())), None);
}

#[test]
fn test_extract_year_with_text() {
    assert_eq!(extract_year(Some(&"Published: 2021-05-15".to_string())), Some("2021".to_string()));
}

#[test]
fn test_derive_title_from_path() {
    assert_eq!(derive_title_from_path("/path/to/book.epub"), "book");
    assert_eq!(derive_title_from_path("book.epub"), "book");
    assert_eq!(derive_title_from_path("My Great Book.epub"), "My Great Book");
}

#[test]
fn test_derive_title_from_path_no_extension() {
    assert_eq!(derive_title_from_path("/path/to/book"), "book");
    assert_eq!(derive_title_from_path("book"), "book");
}

#[test]
fn test_derive_title_from_path_empty() {
    assert_eq!(derive_title_from_path(""), "Unknown");
    assert_eq!(derive_title_from_path("/"), "Unknown");
}

#[test]
fn test_generate_audio_track_title() {
    assert_eq!(generate_audio_track_title("chapter1.mp3", 0), "chapter1");
    assert_eq!(generate_audio_track_title("chapter_1.wav", 0), "chapter 1");
    assert_eq!(generate_audio_track_title("chapter-1.m4a", 0), "chapter 1");
}

#[test]
fn test_generate_audio_track_title_with_spaces() {
    assert_eq!(generate_audio_track_title("chapter%201.mp3", 0), "chapter 1");
    assert_eq!(generate_audio_track_title("chapter%20one.mp3", 0), "chapter one");
}

#[test]
fn test_generate_audio_track_title_empty() {
    assert_eq!(generate_audio_track_title("", 0), "Track 1");
    assert_eq!(generate_audio_track_title(".mp3", 1), "Track 2");
}

#[test]
fn test_generate_audio_track_title_index() {
    // Index is used when filename is empty
    assert_eq!(generate_audio_track_title("", 0), "Track 1");
    assert_eq!(generate_audio_track_title("", 5), "Track 6");
}

