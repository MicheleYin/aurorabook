use crate::types::reader::Book;
use crate::components::library::types::LibraryFilterOption;

// Progress thresholds matching backend constants
const MIN_PROGRESS_THRESHOLD: f64 = 0.01;
const MAX_PROGRESS_THRESHOLD: f64 = 0.99;

#[derive(Debug, Clone, PartialEq)]
pub struct BookProgressSummary {
    pub current: usize,
    pub current_index: isize,
    pub total: usize,
    pub is_started: bool,
    pub is_finished: bool,
    pub label: String,
    pub percent: f64,
    pub current_chapter_title: Option<String>,
}

pub fn get_book_progress_summary(book: &Book) -> BookProgressSummary {
    let total = book.chapters.len();
    
    if total == 0 {
        return BookProgressSummary {
            current: 0,
            current_index: -1,
            total: 0,
            is_started: false,
            is_finished: false,
            label: "No chapters available".to_string(),
            percent: 0.0,
            current_chapter_title: None,
        };
    }

    let fallback_chapter = book.chapters.first();

    if book.progress.is_none() {
        let default_chapter_label = if total > 0 {
            Some(format!("Chapter 1 of {}", total))
        } else {
            None
        };

        return BookProgressSummary {
            current: 0,
            current_index: -1,
            total,
            is_started: false,
            is_finished: false,
            label: default_chapter_label.clone().unwrap_or_else(|| format!("0 of {} chapters", total)),
            percent: 0.0,
            current_chapter_title: fallback_chapter.map(|c| c.title.clone()),
        };
    }

    let progress = book.progress.as_ref().unwrap();
    let by_id_index = book.chapters.iter()
        .position(|chapter| chapter.id == progress.current_chapter_id)
        .map(|i| i as isize)
        .unwrap_or(-1);
    
    let raw_index_candidate = if progress.current_chapter_index > 0 {
        progress.current_chapter_index as isize
    } else {
        0
    };
    
    let raw_index = if by_id_index >= 0 { by_id_index } else { raw_index_candidate };
    let normalized_index = raw_index.max(0).min((total as isize).saturating_sub(1).max(0)) as usize;
    let current_chapter = book.chapters.get(normalized_index);
    
    let current = normalized_index + 1;
    let percent = progress.book_progress_percent;
    let is_started = percent >= MIN_PROGRESS_THRESHOLD;
    let is_finished = percent >= MAX_PROGRESS_THRESHOLD;
    
    let label = if total > 0 {
        format!("Chapter {} of {}", current, total)
    } else {
        "No chapters".to_string()
    };

    BookProgressSummary {
        current,
        current_index: normalized_index as isize,
        total,
        is_started,
        is_finished,
        label,
        percent,
        current_chapter_title: current_chapter.map(|c| c.title.clone()),
    }
}

pub fn get_library_book_status_from_summary(summary: &BookProgressSummary) -> crate::components::library::types::LibraryBookStatus {
    if !summary.is_started {
        crate::components::library::types::LibraryBookStatus::New
    } else if summary.is_finished {
        crate::components::library::types::LibraryBookStatus::Finished
    } else {
        crate::components::library::types::LibraryBookStatus::Resume
    }
}

pub fn get_library_book_status(book: &Book) -> crate::components::library::types::LibraryBookStatus {
    let summary = get_book_progress_summary(book);
    get_library_book_status_from_summary(&summary)
}

/// Filter books based on filter type and search term
pub fn filter_library(
    books: &[Book],
    filter: LibraryFilterOption,
    search_term: &str,
) -> Vec<Book> {
    let mut filtered: Vec<Book> = books.to_vec();

    // Apply search filter
    if !search_term.trim().is_empty() {
        let search_lower = search_term.to_lowercase();
        filtered.retain(|book| {
            book.title.to_lowercase().contains(&search_lower)
                || book.author.to_lowercase().contains(&search_lower)
        });
    }

    // Apply quick filter
    match filter {
        LibraryFilterOption::All => {
            // No additional filtering
        }
        LibraryFilterOption::New => {
            filtered.retain(|book| {
                book.progress.as_ref()
                    .map(|p| p.book_progress_percent < MIN_PROGRESS_THRESHOLD)
                    .unwrap_or(true) // No progress means "new"
            });
        }
        LibraryFilterOption::Resume => {
            filtered.retain(|book| {
                book.progress.as_ref()
                    .map(|p| {
                        p.book_progress_percent >= MIN_PROGRESS_THRESHOLD
                            && p.book_progress_percent < MAX_PROGRESS_THRESHOLD
                    })
                    .unwrap_or(false)
            });
        }
        LibraryFilterOption::Finished => {
            filtered.retain(|book| {
                book.progress.as_ref()
                    .map(|p| p.book_progress_percent >= MAX_PROGRESS_THRESHOLD)
                    .unwrap_or(false)
            });
        }
        LibraryFilterOption::Recent => {
            // Reverse the array to show most recently added first
            filtered.reverse();
        }
        LibraryFilterOption::Author => {
            // Sort by author name
            filtered.sort_by(|a, b| a.author.cmp(&b.author));
        }
    }

    filtered
}
