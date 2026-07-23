//! Tests for epub::book_update module
//!
//! Tests book update functionality:
//! - update_book_audio_tracks
//! - order_audio_tracks_by_chapters

use aurorabook_lib::epub::book_update::order_audio_tracks_by_chapters;
use aurorabook_lib::epub::parser::ManifestItem;
use aurorabook_lib::book_service::models::{AudioTrack, Chapter};
use std::collections::{HashMap, HashSet};

#[test]
fn test_order_audio_tracks_by_chapters() {
    // Test ordering audio tracks to match chapter order
    let audio_tracks = vec![
        AudioTrack {
            id: "track1".to_string(),
            title: "Chapter 1".to_string(),
            href: "Audio/chapter1.mp3".to_string(),
            url: None,
            duration: None,
            order: 0,
        },
        AudioTrack {
            id: "track2".to_string(),
            title: "Chapter 2".to_string(),
            href: "Audio/chapter2.mp3".to_string(),
            url: None,
            duration: None,
            order: 0,
        },
    ];
    
    // Create chapters in order: chapter1, chapter2
    let chapters = vec![
        Chapter {
            id: "ch1".to_string(),
            title: "Chapter 1".to_string(),
            content_html: None,
            plain_text: None,
            order: 0,
            href: "chapter1.xhtml".to_string(),
            word_count: None,
            estimated_page_count: None,
        },
        Chapter {
            id: "ch2".to_string(),
            title: "Chapter 2".to_string(),
            content_html: None,
            plain_text: None,
            order: 1,
            href: "chapter2.xhtml".to_string(),
            word_count: None,
            estimated_page_count: None,
        },
    ];
    
    // Create manifest items with media-overlay pointing to SMIL files
    let mut manifest_items = HashMap::new();
    manifest_items.insert("chapter1".to_string(), ManifestItem {
        id: "chapter1".to_string(),
        href: "chapter1.xhtml".to_string(),
        media_type: Some("application/xhtml+xml".to_string()),
        properties: None,
        media_overlay: Some("s001".to_string()),
    });
    manifest_items.insert("chapter2".to_string(), ManifestItem {
        id: "chapter2".to_string(),
        href: "chapter2.xhtml".to_string(),
        media_type: Some("application/xhtml+xml".to_string()),
        properties: None,
        media_overlay: Some("s002".to_string()),
    });
    manifest_items.insert("m001".to_string(), ManifestItem {
        id: "m001".to_string(),
        href: "Audio/chapter1.mp3".to_string(),
        media_type: Some("audio/mpeg".to_string()),
        properties: None,
        media_overlay: None,
    });
    manifest_items.insert("m002".to_string(), ManifestItem {
        id: "m002".to_string(),
        href: "Audio/chapter2.mp3".to_string(),
        media_type: Some("audio/mpeg".to_string()),
        properties: None,
        media_overlay: None,
    });
    
    let archive_paths: HashSet<String> = [
        "chapter1.xhtml",
        "chapter2.xhtml",
        "Audio/chapter1.mp3",
        "Audio/chapter2.mp3",
    ]
    .into_iter()
    .map(String::from)
    .collect();

    let ordered = order_audio_tracks_by_chapters(
        &audio_tracks,
        &chapters,
        &manifest_items,
        &archive_paths,
    );
    assert_eq!(ordered.len(), 2);
    assert_eq!(ordered[0].href, "Audio/chapter1.mp3");
    assert_eq!(ordered[0].order, 0);
    assert_eq!(ordered[1].href, "Audio/chapter2.mp3");
    assert_eq!(ordered[1].order, 1);
}

#[test]
fn test_order_audio_tracks_mismatch() {
    // Test when audio tracks don't match chapters
    let audio_tracks = vec![
        AudioTrack {
            id: "track1".to_string(),
            title: "Audio".to_string(),
            href: "Audio/other.mp3".to_string(),
            url: None,
            duration: None,
            order: 0,
        },
    ];
    
    let chapters = vec![
        Chapter {
            id: "ch1".to_string(),
            title: "Chapter 1".to_string(),
            content_html: None,
            plain_text: None,
            order: 0,
            href: "chapter1.xhtml".to_string(),
            word_count: None,
            estimated_page_count: None,
        },
    ];
    
    let mut manifest_items = HashMap::new();
    manifest_items.insert("chapter1".to_string(), ManifestItem {
        id: "chapter1".to_string(),
        href: "chapter1.xhtml".to_string(),
        media_type: Some("application/xhtml+xml".to_string()),
        properties: None,
        media_overlay: None,
    });
    manifest_items.insert("m001".to_string(), ManifestItem {
        id: "m001".to_string(),
        href: "Audio/other.mp3".to_string(),
        media_type: Some("audio/mpeg".to_string()),
        properties: None,
        media_overlay: None,
    });
    
    let archive_paths: HashSet<String> = [
        "chapter1.xhtml",
        "Audio/other.mp3",
    ]
    .into_iter()
    .map(String::from)
    .collect();

    let ordered = order_audio_tracks_by_chapters(
        &audio_tracks,
        &chapters,
        &manifest_items,
        &archive_paths,
    );
    // Should still include unmatched tracks at the end
    assert_eq!(ordered.len(), 1);
}

