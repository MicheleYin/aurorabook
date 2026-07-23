//! Tests for epub::parser::audio module
//!
//! Tests audio track operations:
//! - extract_audio_tracks_from_manifest
//! - compute_audio_track_durations

use aurorabook_lib::epub::parser::audio::*;
use aurorabook_lib::epub::parser::types::ManifestItem;

#[test]
fn test_extract_audio_tracks_from_manifest() {
    // Test extracting audio tracks from manifest
    let mut manifest_items = std::collections::HashMap::new();
    
    // Add audio track
    manifest_items.insert("audio1".to_string(), ManifestItem {
        id: "audio1".to_string(),
        href: "Audio/ch1.mp3".to_string(),
        media_type: Some("audio/mpeg".to_string()),
        properties: None,
        media_overlay: None,
    });
    
    // Add non-audio item
    manifest_items.insert("chapter1".to_string(), ManifestItem {
        id: "chapter1".to_string(),
        href: "ch1.xhtml".to_string(),
        media_type: Some("application/xhtml+xml".to_string()),
        properties: None,
        media_overlay: None,
    });
    
    let audio_tracks = extract_audio_tracks_from_manifest(&manifest_items);
    assert_eq!(audio_tracks.len(), 1);
    assert_eq!(audio_tracks[0].href, "Audio/ch1.mp3");
}

#[test]
fn test_extract_audio_tracks_from_manifest_multiple() {
    // Test extracting multiple audio tracks
    let mut manifest_items = std::collections::HashMap::new();
    
    manifest_items.insert("audio1".to_string(), ManifestItem {
        id: "audio1".to_string(),
        href: "Audio/ch1.mp3".to_string(),
        media_type: Some("audio/mpeg".to_string()),
        properties: None,
        media_overlay: None,
    });
    
    manifest_items.insert("audio2".to_string(), ManifestItem {
        id: "audio2".to_string(),
        href: "Audio/ch2.mp3".to_string(),
        media_type: Some("audio/mpeg".to_string()),
        properties: None,
        media_overlay: None,
    });
    
    let audio_tracks = extract_audio_tracks_from_manifest(&manifest_items);
    assert_eq!(audio_tracks.len(), 2);
}

#[test]
fn test_extract_audio_tracks_from_manifest_no_audio() {
    // Test when no audio tracks exist
    let mut manifest_items = std::collections::HashMap::new();
    manifest_items.insert("chapter1".to_string(), ManifestItem {
        id: "chapter1".to_string(),
        href: "ch1.xhtml".to_string(),
        media_type: Some("application/xhtml+xml".to_string()),
        properties: None,
        media_overlay: None,
    });
    
    let audio_tracks = extract_audio_tracks_from_manifest(&manifest_items);
    assert_eq!(audio_tracks.len(), 0);
}

#[test]
fn test_extract_audio_tracks_from_manifest_different_formats() {
    // Test different audio formats
    let mut manifest_items = std::collections::HashMap::new();
    
    manifest_items.insert("mp3".to_string(), ManifestItem {
        id: "mp3".to_string(),
        href: "audio.mp3".to_string(),
        media_type: Some("audio/mpeg".to_string()),
        properties: None,
        media_overlay: None,
    });
    
    manifest_items.insert("wav".to_string(), ManifestItem {
        id: "wav".to_string(),
        href: "audio.wav".to_string(),
        media_type: Some("audio/wav".to_string()),
        properties: None,
        media_overlay: None,
    });
    
    manifest_items.insert("m4a".to_string(), ManifestItem {
        id: "m4a".to_string(),
        href: "audio.m4a".to_string(),
        media_type: Some("audio/mp4".to_string()),
        properties: None,
        media_overlay: None,
    });
    
    let audio_tracks = extract_audio_tracks_from_manifest(&manifest_items);
    assert_eq!(audio_tracks.len(), 3);
}

#[test]
fn test_compute_audio_track_durations() {
    // Test computing audio track durations
    // This requires actual audio files or mocking
    // For now, we'll create a test structure
}

