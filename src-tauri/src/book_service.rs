use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::Manager;

const LIBRARY_STORE_PATH: &str = "library.store.json";
const LIBRARY_STORE_KEY: &str = "library";
const LIBRARY_STORE_VERSION: u32 = 1;

// EPUB store constants
const EPUB_STORE_PATH: &str = "epub-cache.store.json";
const EPUB_STORE_KEY_PREFIX: &str = "epub:";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioTrack {
    pub id: String,
    pub title: String,
    pub href: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioSyncSegment {
    pub text_element_id: String,
    pub chapter_href: String,
    pub audio_track_href: String,
    pub clip_begin: f64,
    pub clip_end: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioSyncMap {
    pub segments: Vec<AudioSyncSegment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookAudioState {
    pub current_track_id: String,
    pub current_track_href: String,
    pub current_track_index: usize,
    pub current_time_seconds: f64,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Chapter {
    pub id: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_html: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plain_text: Option<String>,
    pub order: usize,
    pub href: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub word_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub estimated_page_count: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookProgress {
    pub current_chapter_id: String,
    pub current_chapter_href: String,
    pub current_chapter_index: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_chapter_element_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_chapter_element_index: Option<usize>,
    pub current_chapter_scroll_top: f64,
    pub current_chapter_scroll_height: f64,
    pub current_chapter_client_height: f64,
    pub chapter_progress_percent: f64,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Book {
    pub id: String,
    pub title: String,
    pub author: String,
    pub chapters: Vec<Chapter>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_url: Option<String>,
    pub source_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub publisher: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub published_year: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subjects: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_size_bytes: Option<usize>,
    pub audio_tracks: Vec<AudioTrack>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio_state: Option<BookAudioState>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio_sync_map: Option<AudioSyncMap>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<BookProgress>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page_count: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PersistedLibraryEntry {
    source_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    author: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    publisher: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    published_year: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    subjects: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    progress: Option<BookProgress>,
    #[serde(skip_serializing_if = "Option::is_none")]
    page_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    audio_state: Option<BookAudioState>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PersistedLibraryFile {
    version: u32,
    books: Vec<Book>, // Store full Book objects
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryFilter {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filter: Option<String>, // "all", "new", "resume", "finished", "recent", "author"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search: Option<String>,
}

// Helper functions removed - using with_store directly

fn load_all_books(app: &tauri::AppHandle) -> Result<Vec<Book>, String> {
    use tauri_plugin_store::StoreBuilder;
    
    let store = StoreBuilder::new(app, LIBRARY_STORE_PATH)
        .build()
        .map_err(|e| format!("Failed to create library store: {}", e))?;
    
    let library_file_value = store.get(LIBRARY_STORE_KEY);
    
    let books = if let Some(value) = library_file_value {
        match serde_json::from_value::<PersistedLibraryFile>(value) {
            Ok(file) if file.version == LIBRARY_STORE_VERSION => file.books,
            _ => Vec::new(),
        }
    } else {
        Vec::new()
    };

    Ok(books)
}

fn save_all_books(app: &tauri::AppHandle, books: &[Book]) -> Result<(), String> {
    use tauri_plugin_store::StoreBuilder;
    
    let store = StoreBuilder::new(app, LIBRARY_STORE_PATH)
        .build()
        .map_err(|e| format!("Failed to create library store: {}", e))?;
    
    let library_file = PersistedLibraryFile {
        version: LIBRARY_STORE_VERSION,
        books: books.to_vec(),
    };

    store.set(LIBRARY_STORE_KEY, serde_json::to_value(&library_file).unwrap());
    store.save();

    Ok(())
}

/// Read all books with optional filtering and search
#[tauri::command]
pub async fn read_all_books(
    filter: Option<LibraryFilter>,
    app: tauri::AppHandle,
) -> Result<Vec<Book>, String> {
    let books = load_all_books(&app)?;
    
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
                            book.progress.is_none()
                                || book.progress.as_ref().unwrap().chapter_progress_percent < 0.01
                        })
                        .collect()
                }
                "resume" => {
                    filtered
                        .into_iter()
                        .filter(|book| {
                            book.progress.is_some()
                                && book.progress.as_ref().unwrap().chapter_progress_percent >= 0.01
                                && book.progress.as_ref().unwrap().chapter_progress_percent < 0.99
                        })
                        .collect()
                }
                "finished" => {
                    filtered
                        .into_iter()
                        .filter(|book| {
                            book.progress.is_some()
                                && book.progress.as_ref().unwrap().chapter_progress_percent >= 0.99
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
    
    Ok(filtered)
}

/// Read a single complete book by ID
#[tauri::command]
pub async fn read_one_book(
    book_id: String,
    app: tauri::AppHandle,
) -> Result<Option<Book>, String> {
    let books = load_all_books(&app)?;
    Ok(books.into_iter().find(|book| book.id == book_id))
}

/// Read a single chapter by book ID and chapter ID
#[tauri::command]
pub async fn read_single_chapter(
    book_id: String,
    chapter_id: String,
    app: tauri::AppHandle,
) -> Result<Option<Chapter>, String> {
    let books = load_all_books(&app)?;
    if let Some(book) = books.into_iter().find(|b| b.id == book_id) {
        Ok(book.chapters.into_iter().find(|c| c.id == chapter_id))
    } else {
        Ok(None)
    }
}

/// Read a single audio track by book ID and track ID
#[tauri::command]
pub async fn read_single_audio_track(
    book_id: String,
    track_id: String,
    app: tauri::AppHandle,
) -> Result<Option<AudioTrack>, String> {
    let books = load_all_books(&app)?;
    if let Some(book) = books.into_iter().find(|b| b.id == book_id) {
        Ok(book.audio_tracks.into_iter().find(|t| t.id == track_id))
    } else {
        Ok(None)
    }
}

/// Delete a book by ID
#[tauri::command]
pub async fn delete_book(
    book_id: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let mut books = load_all_books(&app)?;
    
    // Find the book to get its source_path for EPUB cleanup
    let book_to_delete = books.iter().find(|b| b.id == book_id);
    let source_path = book_to_delete.map(|b| b.source_path.clone());
    
    // Remove from library
    books.retain(|book| book.id != book_id);
    save_all_books(&app, &books)?;
    
    // Clean up EPUB from store if it exists
    if let Some(path) = source_path {
        use tauri_plugin_store::StoreBuilder;
        let epub_store = StoreBuilder::new(&app, EPUB_STORE_PATH)
            .build()
            .map_err(|e| format!("Failed to create EPUB store: {}", e))?;
        let key = format!("{}{}", EPUB_STORE_KEY_PREFIX, path);
        epub_store.delete(&key);
        epub_store.save();
    }
    
    Ok(())
}

/// Add a new book to the library
#[tauri::command]
pub async fn add_book(
    book: Book,
    epub_data: Option<Vec<u8>>,
    app: tauri::AppHandle,
) -> Result<Book, String> {
    let mut books = load_all_books(&app)?;
    
    // Check if book with same source_path already exists
    if books.iter().any(|b| b.source_path == book.source_path) {
        // Update existing book instead
        if let Some(existing_index) = books.iter().position(|b| b.source_path == book.source_path) {
            books[existing_index] = book.clone();
        }
    } else {
        books.push(book.clone());
    }
    
    // Store EPUB data if provided
    if let Some(data) = epub_data {
        use tauri_plugin_store::StoreBuilder;
        let epub_store = StoreBuilder::new(&app, EPUB_STORE_PATH)
            .build()
            .map_err(|e| format!("Failed to create EPUB store: {}", e))?;
        let key = format!("{}{}", EPUB_STORE_KEY_PREFIX, book.source_path);
        
        // Convert to base64
        use base64::{Engine as _, engine::general_purpose};
        let base64_data = general_purpose::STANDARD.encode(&data);
        
        epub_store.set(&key, serde_json::Value::String(base64_data));
        epub_store.save();
    }
    
    save_all_books(&app, &books)?;
    
    Ok(book)
}

/// Get EPUB buffer for a book
#[tauri::command]
pub async fn get_epub_buffer(
    source_path: String,
    app: tauri::AppHandle,
) -> Result<Option<Vec<u8>>, String> {
    use tauri_plugin_store::StoreBuilder;
    let epub_store = StoreBuilder::new(&app, EPUB_STORE_PATH)
        .build()
        .map_err(|e| format!("Failed to create EPUB store: {}", e))?;
    let key = format!("{}{}", EPUB_STORE_KEY_PREFIX, source_path);
    
    let base64_value = epub_store.get(&key);
    
    if let Some(value) = base64_value {
        let base64: String = serde_json::from_value(value)
            .map_err(|e| format!("Failed to deserialize EPUB data: {}", e))?;
        use base64::{Engine as _, engine::general_purpose};
        let data = general_purpose::STANDARD
            .decode(&base64)
            .map_err(|e| format!("Failed to decode EPUB: {}", e))?;
        Ok(Some(data))
    } else {
        Ok(None)
    }
}

