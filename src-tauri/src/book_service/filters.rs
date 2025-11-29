use crate::book_service::models::{Book, LibraryFilter};
use crate::utils::constants::{MIN_PROGRESS_THRESHOLD, MAX_PROGRESS_THRESHOLD};

/// Apply filters and search to a list of books
pub fn filter_books(books: Vec<Book>, filter: Option<LibraryFilter>) -> Vec<Book> {
    let mut filtered = books;
    
    // Apply search filter
    if let Some(ref f) = filter {
        if let Some(ref search_term) = f.search {
            let search_lower = search_term.to_lowercase();
            filtered = filtered
                .into_iter()
                .filter(|book| {
                    book.title.to_lowercase().contains(&search_lower)
                        || book.author.to_lowercase().contains(&search_lower)
                })
                .collect();
        }
        
        // Apply quick filter
        if let Some(ref filter_type) = f.filter {
            filtered = match filter_type.as_str() {
                "new" => {
                    filtered
                        .into_iter()
                        .filter(|book| {
                            book.progress.as_ref()
                                .map(|p| p.book_progress_percent < MIN_PROGRESS_THRESHOLD)
                                .unwrap_or(true) // No progress means "new"
                        })
                        .collect()
                }
                "resume" => {
                    filtered
                        .into_iter()
                        .filter(|book| {
                            book.progress.as_ref()
                                .map(|p| {
                                    p.book_progress_percent >= MIN_PROGRESS_THRESHOLD
                                        && p.book_progress_percent < MAX_PROGRESS_THRESHOLD
                                })
                                .unwrap_or(false)
                        })
                        .collect()
                }
                "finished" => {
                    filtered
                        .into_iter()
                        .filter(|book| {
                            book.progress.as_ref()
                                .map(|p| p.book_progress_percent >= MAX_PROGRESS_THRESHOLD)
                                .unwrap_or(false)
                        })
                        .collect()
                }
                "recent" => {
                    let mut sorted = filtered;
                    sorted.reverse();
                    sorted
                }
                "author" => {
                    let mut sorted = filtered;
                    sorted.sort_by(|a, b| a.author.cmp(&b.author));
                    sorted
                }
                _ => filtered,
            };
        }
    }
    
    filtered
}

