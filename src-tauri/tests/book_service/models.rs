//! Tests for book_service::models module
//! 
//! 
//!
//! Tests data structures and their behavior:
//! - Book model
//! - Chapter model
//! - AudioTrack model
//! - BookProgress model
//! - BookAudioState model
//! - AudioSyncMap model
//! - ConversionStatus enum
//! - LibraryFilter model

use aurorabook_lib::book_service::models::*;

#[test]
fn test_book_creation() {
    let book = Book {
        id: "book-1".to_string(),
        title: "Test Book".to_string(),
        author: "Test Author".to_string(),
        chapters: vec![],
        cover_url: None,
        source_path: "/test.epub".to_string(),
        publisher: None,
        published_year: None,
        subjects: None,
        file_size_bytes: None,
        audio_tracks: vec![],
        audio_state: None,
        audio_sync_map: None,
        progress: None,
        page_count: None,
        conversion_status: ConversionStatus::NotStarted,
        completed_chapters: vec![],
        voice_id: None,
        total_words: None,
        words_processed: None,
    };
    
    assert_eq!(book.id, "book-1");
    assert_eq!(book.title, "Test Book");
    assert_eq!(book.conversion_status, ConversionStatus::NotStarted);
}

#[test]
fn test_chapter_creation() {
    let chapter = Chapter {
        id: "ch1".to_string(),
        title: "Chapter 1".to_string(),
        content_html: Some("<p>Content</p>".to_string()),
        plain_text: Some("Content".to_string()),
        order: 0,
        href: "ch1.xhtml".to_string(),
        word_count: Some(1),
        estimated_page_count: Some(1),
    };
    
    assert_eq!(chapter.id, "ch1");
    assert_eq!(chapter.order, 0);
    assert!(chapter.content_html.is_some());
}

#[test]
fn test_audio_track_creation() {
    let track = AudioTrack {
        id: "track-1".to_string(),
        title: "Chapter 1 Audio".to_string(),
        href: "Audio/ch1.mp3".to_string(),
        url: Some("data:audio/mpeg;base64,...".to_string()),
        duration: Some(120.5),
    };
    
    assert_eq!(track.id, "track-1");
    assert_eq!(track.duration, Some(120.5));
}

#[test]
fn test_book_progress_creation() {
    let progress = BookProgress {
        current_chapter_id: "ch1".to_string(),
        current_chapter_href: "ch1.xhtml".to_string(),
        current_chapter_index: 0,
        current_chapter_element_id: Some("para-1".to_string()),
        current_chapter_element_index: Some(0),
        current_chapter_scroll_top: 100.0,
        current_chapter_scroll_height: 1000.0,
        current_chapter_client_height: 800.0,
        chapter_progress_percent: 0.1,
        book_progress_percent: 0.05,
        updated_at: "2024-01-01T00:00:00Z".to_string(),
    };
    
    assert_eq!(progress.current_chapter_index, 0);
    assert_eq!(progress.chapter_progress_percent, 0.1);
}

#[test]
fn test_book_audio_state_creation() {
    let audio_state = BookAudioState {
        current_track_id: "track-1".to_string(),
        current_track_href: "Audio/ch1.mp3".to_string(),
        current_track_index: 0,
        current_time_seconds: 30.5,
        updated_at: "2024-01-01T00:00:00Z".to_string(),
    };
    
    assert_eq!(audio_state.current_track_index, 0);
    assert_eq!(audio_state.current_time_seconds, 30.5);
}

#[test]
fn test_audio_sync_map_creation() {
    let sync_map = AudioSyncMap {
        segments: vec![AudioSyncSegment {
            text_element_id: "para-1".to_string(),
            chapter_href: "ch1.xhtml".to_string(),
            audio_track_href: "Audio/ch1.mp3".to_string(),
            clip_begin: 0.0,
            clip_end: 5.0,
        }],
    };
    
    assert_eq!(sync_map.segments.len(), 1);
    assert_eq!(sync_map.segments[0].clip_begin, 0.0);
}

#[test]
fn test_conversion_status_enum() {
    assert_eq!(ConversionStatus::default(), ConversionStatus::NotStarted);
    assert_ne!(ConversionStatus::NotStarted, ConversionStatus::Done);
    assert_ne!(ConversionStatus::Started, ConversionStatus::Done);
}

#[test]
fn test_library_filter_creation() {
    let filter = LibraryFilter {
        filter: Some("new".to_string()),
        search: Some("test".to_string()),
    };
    
    assert_eq!(filter.filter, Some("new".to_string()));
    assert_eq!(filter.search, Some("test".to_string()));
}

#[test]
fn test_book_with_all_fields() {
    let book = Book {
        id: "complete-book".to_string(),
        title: "Complete Book".to_string(),
        author: "Author".to_string(),
        chapters: vec![Chapter {
            id: "ch1".to_string(),
            title: "Chapter 1".to_string(),
            content_html: None,
            plain_text: None,
            order: 0,
            href: "ch1.xhtml".to_string(),
            word_count: None,
            estimated_page_count: None,
        }],
        cover_url: Some("data:image/png;base64,...".to_string()),
        source_path: "/book.epub".to_string(),
        publisher: Some("Publisher".to_string()),
        published_year: Some("2024".to_string()),
        subjects: Some(vec!["Fiction".to_string()]),
        file_size_bytes: Some(1024),
        audio_tracks: vec![AudioTrack {
            id: "track-1".to_string(),
            title: "Audio".to_string(),
            href: "Audio/ch1.mp3".to_string(),
            url: None,
            duration: None,
        }],
        audio_state: Some(BookAudioState {
            current_track_id: "track-1".to_string(),
            current_track_href: "Audio/ch1.mp3".to_string(),
            current_track_index: 0,
            current_time_seconds: 0.0,
            updated_at: "2024-01-01T00:00:00Z".to_string(),
        }),
        audio_sync_map: Some(AudioSyncMap { segments: vec![] }),
        progress: Some(BookProgress {
            current_chapter_id: "ch1".to_string(),
            current_chapter_href: "ch1.xhtml".to_string(),
            current_chapter_index: 0,
            current_chapter_element_id: None,
            current_chapter_element_index: None,
            current_chapter_scroll_top: 0.0,
            current_chapter_scroll_height: 1000.0,
            current_chapter_client_height: 800.0,
            chapter_progress_percent: 0.0,
            book_progress_percent: 0.0,
            updated_at: "2024-01-01T00:00:00Z".to_string(),
        }),
        page_count: Some(100),
        conversion_status: ConversionStatus::Done,
        completed_chapters: vec!["ch1.xhtml".to_string()],
        voice_id: Some("af_heart".to_string()),
        total_words: Some(1000),
        words_processed: Some(1000),
    };
    
    // Verify all fields are set
    assert!(book.cover_url.is_some());
    assert!(book.publisher.is_some());
    assert!(book.audio_tracks.len() > 0);
    assert!(book.audio_state.is_some());
    assert!(book.progress.is_some());
    assert_eq!(book.conversion_status, ConversionStatus::Done);
}

