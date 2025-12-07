//! Tests for epub::book_update module
//!
//! Tests book update functionality:
//! - update_book_audio_tracks
//! - order_audio_tracks_by_chapters

use aurorabook_lib::epub::book_update::order_audio_tracks_by_chapters;
use aurorabook_lib::book_service::models::{AudioTrack, Chapter};

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
        },
        AudioTrack {
            id: "track2".to_string(),
            title: "Chapter 2".to_string(),
            href: "Audio/chapter2.mp3".to_string(),
            url: None,
            duration: None,
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
    
    let ordered = order_audio_tracks_by_chapters(&audio_tracks, &chapters);
    assert_eq!(ordered.len(), 2);
    assert_eq!(ordered[0].href, "Audio/chapter1.mp3");
    assert_eq!(ordered[1].href, "Audio/chapter2.mp3");
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
    
    let ordered = order_audio_tracks_by_chapters(&audio_tracks, &chapters);
    // Should still include unmatched tracks at the end
    assert_eq!(ordered.len(), 1);
}

