//! Tests for book_service::filters module
//!
//! Tests filtering and search functionality:
//! - Filter by status (new, resume, finished, recent, author)
//! - Search by title/author
//! - Combined filters and search

use aurorabook_lib::book_service::filters::filter_books;
use aurorabook_lib::book_service::models::*;

fn create_test_book(id: &str, title: &str, author: &str, progress: Option<f64>) -> Book {
    Book {
        id: id.to_string(),
        title: title.to_string(),
        author: author.to_string(),
        chapters: vec![],
        cover_url: None,
        source_path: format!("/test/{}.epub", id),
        publisher: None,
        published_year: None,
        subjects: None,
        file_size_bytes: None,
        audio_tracks: vec![],
        audio_state: None,
        audio_sync_map: None,
        progress: progress.map(|p| BookProgress {
            current_chapter_id: "ch1".to_string(),
            current_chapter_href: "ch1.xhtml".to_string(),
            current_chapter_index: 0,
            current_chapter_element_id: None,
            current_chapter_element_index: None,
            current_chapter_scroll_top: 0.0,
            current_chapter_scroll_height: 1000.0,
            current_chapter_client_height: 800.0,
            chapter_progress_percent: p,
            book_progress_percent: p,
            updated_at: "2024-01-01T00:00:00Z".to_string(),
        }),
        page_count: None,
        conversion_status: ConversionStatus::NotStarted,
        completed_chapters: vec![],
        voice_id: None,
        total_words: None,
        words_processed: None,
    }
}

#[test]
fn test_filter_all() {
    let books = vec![
        create_test_book("1", "Book 1", "Author 1", None),
        create_test_book("2", "Book 2", "Author 2", Some(0.5)),
    ];
    
    let filtered = filter_books(books.clone(), None);
    assert_eq!(filtered.len(), 2);
}

#[test]
fn test_filter_new() {
    let books = vec![
        create_test_book("1", "New Book", "Author", None), // No progress = new
        create_test_book("2", "Started Book", "Author", Some(0.005)), // < 1% = new
        create_test_book("3", "Resume Book", "Author", Some(0.5)), // > 1% = not new
    ];
    
    let filter = LibraryFilter {
        filter: Some("new".to_string()),
        search: None,
    };
    
    let filtered = filter_books(books, Some(filter));
    assert_eq!(filtered.len(), 2);
    assert!(filtered.iter().all(|b| {
        b.progress.as_ref()
            .map(|p| p.book_progress_percent < 0.01)
            .unwrap_or(true)
    }));
}

#[test]
fn test_filter_resume() {
    let books = vec![
        create_test_book("1", "New Book", "Author", Some(0.005)), // < 1% = not resume
        create_test_book("2", "Resume Book", "Author", Some(0.5)), // 1-99% = resume
        create_test_book("3", "Finished Book", "Author", Some(0.995)), // > 99% = not resume
    ];
    
    let filter = LibraryFilter {
        filter: Some("resume".to_string()),
        search: None,
    };
    
    let filtered = filter_books(books, Some(filter));
    assert_eq!(filtered.len(), 1);
    assert_eq!(filtered[0].title, "Resume Book");
}

#[test]
fn test_filter_finished() {
    let books = vec![
        create_test_book("1", "New Book", "Author", Some(0.5)), // < 99% = not finished
        create_test_book("2", "Finished Book", "Author", Some(0.995)), // >= 99% = finished
    ];
    
    let filter = LibraryFilter {
        filter: Some("finished".to_string()),
        search: None,
    };
    
    let filtered = filter_books(books, Some(filter));
    assert_eq!(filtered.len(), 1);
    assert_eq!(filtered[0].title, "Finished Book");
}

#[test]
fn test_filter_recent() {
    let books = vec![
        create_test_book("1", "First", "Author", None),
        create_test_book("2", "Second", "Author", None),
        create_test_book("3", "Third", "Author", None),
    ];
    
    let filter = LibraryFilter {
        filter: Some("recent".to_string()),
        search: None,
    };
    
    let filtered = filter_books(books.clone(), Some(filter));
    // Recent should reverse the order
    assert_eq!(filtered.len(), 3);
    assert_eq!(filtered[0].id, "3");
    assert_eq!(filtered[2].id, "1");
}

#[test]
fn test_filter_author() {
    let books = vec![
        create_test_book("1", "Book A", "Zebra", None),
        create_test_book("2", "Book B", "Apple", None),
        create_test_book("3", "Book C", "Banana", None),
    ];
    
    let filter = LibraryFilter {
        filter: Some("author".to_string()),
        search: None,
    };
    
    let filtered = filter_books(books, Some(filter));
    assert_eq!(filtered.len(), 3);
    // Should be sorted by author
    assert_eq!(filtered[0].author, "Apple");
    assert_eq!(filtered[1].author, "Banana");
    assert_eq!(filtered[2].author, "Zebra");
}

#[test]
fn test_search_by_title() {
    let books = vec![
        create_test_book("1", "The Great Gatsby", "Fitzgerald", None),
        create_test_book("2", "Moby Dick", "Melville", None),
        create_test_book("3", "Great Expectations", "Dickens", None),
    ];
    
    let filter = LibraryFilter {
        filter: None,
        search: Some("Great".to_string()),
    };
    
    let filtered = filter_books(books, Some(filter));
    assert_eq!(filtered.len(), 2);
    assert!(filtered.iter().any(|b| b.title.contains("Great")));
}

#[test]
fn test_search_by_author() {
    let books = vec![
        create_test_book("1", "Book 1", "Fitzgerald", None),
        create_test_book("2", "Book 2", "Melville", None),
        create_test_book("3", "Book 3", "Fitzgerald", None),
    ];
    
    let filter = LibraryFilter {
        filter: None,
        search: Some("Fitzgerald".to_string()),
    };
    
    let filtered = filter_books(books, Some(filter));
    assert_eq!(filtered.len(), 2);
    assert!(filtered.iter().all(|b| b.author == "Fitzgerald"));
}

#[test]
fn test_search_case_insensitive() {
    let books = vec![
        create_test_book("1", "The Great Gatsby", "Fitzgerald", None),
        create_test_book("2", "Moby Dick", "Melville", None),
    ];
    
    let filter = LibraryFilter {
        filter: None,
        search: Some("gatsby".to_string()),
    };
    
    let filtered = filter_books(books, Some(filter));
    assert_eq!(filtered.len(), 1);
    assert_eq!(filtered[0].title, "The Great Gatsby");
}

#[test]
fn test_combined_filter_and_search() {
    let books = vec![
        create_test_book("1", "New Book", "Author A", None), // New, matches search
        create_test_book("2", "New Book", "Author B", None), // New, matches search
        create_test_book("3", "Old Book", "Author A", Some(0.5)), // Not new, matches search
        create_test_book("4", "New Book", "Author C", None), // New, doesn't match search
    ];
    
    let filter = LibraryFilter {
        filter: Some("new".to_string()),
        search: Some("Author A".to_string()),
    };
    
    let filtered = filter_books(books, Some(filter));
    assert_eq!(filtered.len(), 1);
    assert_eq!(filtered[0].id, "1");
}

#[test]
fn test_empty_search() {
    let books = vec![
        create_test_book("1", "Book 1", "Author", None),
        create_test_book("2", "Book 2", "Author", None),
    ];
    
    let filter = LibraryFilter {
        filter: None,
        search: Some("".to_string()),
    };
    
    let filtered = filter_books(books.clone(), Some(filter));
    // Empty search should return all books
    assert_eq!(filtered.len(), 2);
}

#[test]
fn test_no_matching_books() {
    let books = vec![
        create_test_book("1", "Book 1", "Author", None),
    ];
    
    let filter = LibraryFilter {
        filter: None,
        search: Some("Nonexistent".to_string()),
    };
    
    let filtered = filter_books(books, Some(filter));
    assert_eq!(filtered.len(), 0);
}

