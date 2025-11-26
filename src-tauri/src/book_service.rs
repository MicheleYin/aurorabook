use serde::{Deserialize, Serialize};

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

/// Update book progress
#[tauri::command]
pub async fn update_book_progress(
    book_id: String,
    progress: BookProgress,
    app: tauri::AppHandle,
) -> Result<Book, String> {
    let mut books = load_all_books(&app)?;
    
    let book = books.iter_mut()
        .find(|b| b.id == book_id)
        .ok_or_else(|| format!("Book not found: {}", book_id))?;
    
    book.progress = Some(progress);
    let updated_book = book.clone();
    
    save_all_books(&app, &books)?;
    
    Ok(updated_book)
}

/// Update book audio state
#[tauri::command]
pub async fn update_book_audio_state(
    book_id: String,
    audio_state: BookAudioState,
    app: tauri::AppHandle,
) -> Result<Book, String> {
    let mut books = load_all_books(&app)?;
    
    let book = books.iter_mut()
        .find(|b| b.id == book_id)
        .ok_or_else(|| format!("Book not found: {}", book_id))?;
    
    book.audio_state = Some(audio_state);
    let updated_book = book.clone();
    
    save_all_books(&app, &books)?;
    
    Ok(updated_book)
}

// Helper structs for EPUB parsing
#[derive(Debug, Clone)]
struct ManifestItem {
    id: String,
    href: String,
    media_type: Option<String>,
    properties: Option<String>,
}

#[derive(Debug, Clone)]
struct EpubMetadata {
    title: Option<String>,
    creator: Option<String>,
    publisher: Option<String>,
    subjects: Vec<String>,
    pubdate: Option<String>,
    modified_date: Option<String>,
    cover_id: Option<String>,
}


// Find content.opf path from container.xml or common locations
fn find_opf_path(archive: &mut zip::ZipArchive<std::io::Cursor<&[u8]>>) -> Result<String, String> {
    use quick_xml::events::Event;
    use quick_xml::Reader;
    use std::io::Read;
    
    // Try container.xml first
    if let Ok(mut container_file) = archive.by_name("META-INF/container.xml") {
        let mut container_content = String::new();
        if container_file.read_to_string(&mut container_content).is_ok() {
            let mut reader = Reader::from_str(&container_content);
            reader.trim_text(true);
            let mut full_path = String::new();
            let mut media_type = String::new();
            
            loop {
                match reader.read_event() {
                    Ok(Event::Start(e)) => {
                        if e.name().as_ref() == b"rootfile" {
                            full_path.clear();
                            media_type.clear();
                            for attr in e.attributes() {
                                if let Ok(attr) = attr {
                                    match attr.key.as_ref() {
                                        b"full-path" => {
                                            full_path = String::from_utf8_lossy(&attr.value).to_string();
                                        }
                                        b"media-type" => {
                                            media_type = String::from_utf8_lossy(&attr.value).to_string();
                                        }
                                        _ => {}
                                    }
                                }
                            }
                            if media_type == "application/oebps-package+xml" && !full_path.is_empty() {
                                return Ok(full_path);
                            }
                        }
                    }
                    Ok(Event::Eof) => break,
                    _ => {}
                }
            }
        }
    }
    
    // Fallback to common paths
    let common_paths = [
        "OEBPS/content.opf",
        "content.opf",
        "OEBPS/package.opf",
        "package.opf",
    ];
    
    for path in &common_paths {
        if archive.by_name(path).is_ok() {
            return Ok(path.to_string());
        }
    }
    
    Ok("content.opf".to_string())
}

// Parse OPF file and extract all needed data in one pass
fn parse_opf_content(opf_content: &str) -> Result<(EpubMetadata, std::collections::HashMap<String, ManifestItem>, Vec<(String, String)>), String> {
    use quick_xml::events::Event;
    use quick_xml::Reader;
    
    let mut metadata = EpubMetadata {
        title: None,
        creator: None,
        publisher: None,
        subjects: Vec::new(),
        pubdate: None,
        modified_date: None,
        cover_id: None,
    };
    
    let mut manifest_items: std::collections::HashMap<String, ManifestItem> = std::collections::HashMap::new();
    let mut spine_items = Vec::new();
    
    let mut reader = Reader::from_str(opf_content);
    reader.trim_text(true);
    
    let mut in_metadata = false;
    let mut in_manifest = false;
    let mut in_spine = false;
    let mut current_item: Option<ManifestItem> = None;
    
    // Helper to extract text from current element
    let extract_text = |reader: &mut Reader<&[u8]>, end_tag: &[u8]| -> Result<String, String> {
        let mut text = String::new();
        loop {
            match reader.read_event() {
                Ok(Event::Text(t)) => {
                    text.push_str(&String::from_utf8_lossy(&t.into_inner()));
                }
                Ok(Event::End(e)) if e.name().as_ref() == end_tag => break,
                Ok(Event::Eof) => break,
                Err(e) => return Err(format!("XML parse error: {}", e)),
                _ => {}
            }
        }
        Ok(text.trim().to_string())
    };
    
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => {
                let name_vec: Vec<u8> = e.name().as_ref().to_vec();
                let name_bytes = name_vec.as_slice();
                
                if name_bytes == b"metadata" {
                    in_metadata = true;
                } else if name_bytes == b"manifest" {
                    in_manifest = true;
                } else if name_bytes == b"spine" {
                    in_spine = true;
                } else if in_metadata {
                    if name_bytes == b"title" || name_bytes == b"creator" || name_bytes == b"publisher" || name_bytes == b"subject" {
                        if let Ok(text) = extract_text(&mut reader, name_bytes) {
                            if !text.is_empty() {
                                if name_bytes == b"title" {
                                    metadata.title = Some(text);
                                } else if name_bytes == b"creator" {
                                    metadata.creator = Some(text);
                                } else if name_bytes == b"publisher" {
                                    metadata.publisher = Some(text);
                                } else if name_bytes == b"subject" {
                                    metadata.subjects.push(text);
                                }
                            }
                        }
                    } else if name_bytes == b"date" {
                        let mut event_type = String::new();
                        for attr in e.attributes() {
                            if let Ok(attr) = attr {
                                if attr.key.as_ref() == b"event" {
                                    event_type = String::from_utf8_lossy(&attr.value).to_string();
                                }
                            }
                        }
                        if let Ok(text) = extract_text(&mut reader, name_bytes) {
                            if !text.is_empty() && (event_type == "publication" || metadata.pubdate.is_none()) {
                                metadata.pubdate = Some(text);
                            }
                        }
                    } else if name_bytes == b"meta" {
                            let mut name_attr = String::new();
                            let mut content_attr = String::new();
                            let mut is_modified = false;
                            
                            for attr in e.attributes() {
                                if let Ok(attr) = attr {
                                    match attr.key.as_ref() {
                                        b"name" => {
                                            name_attr = String::from_utf8_lossy(&attr.value).to_string();
                                        }
                                        b"content" => {
                                            content_attr = String::from_utf8_lossy(&attr.value).to_string();
                                        }
                                        b"property" => {
                                            if String::from_utf8_lossy(&attr.value) == "dcterms:modified" {
                                                is_modified = true;
                                            }
                                        }
                                        _ => {}
                                    }
                                }
                            }
                            
                            if is_modified {
                                if let Ok(text) = extract_text(&mut reader, name_bytes) {
                                    if !text.is_empty() {
                                        metadata.modified_date = Some(text);
                                    }
                                }
                            } else if name_attr == "cover" && !content_attr.is_empty() {
                                metadata.cover_id = Some(content_attr);
                            }
                        }
                } else if in_manifest && name_bytes == b"item" {
                    let mut item = ManifestItem {
                        id: String::new(),
                        href: String::new(),
                        media_type: None,
                        properties: None,
                    };
                    
                    for attr in e.attributes() {
                        if let Ok(attr) = attr {
                            match attr.key.as_ref() {
                                b"id" => item.id = String::from_utf8_lossy(&attr.value).to_string(),
                                b"href" => item.href = String::from_utf8_lossy(&attr.value).to_string(),
                                b"media-type" => {
                                    item.media_type = Some(String::from_utf8_lossy(&attr.value).to_string());
                                }
                                b"properties" => {
                                    item.properties = Some(String::from_utf8_lossy(&attr.value).to_string());
                                }
                                _ => {}
                            }
                        }
                    }
                    
                    if !item.id.is_empty() {
                        current_item = Some(item);
                    }
                } else if in_spine && name_bytes == b"itemref" {
                    let mut idref = String::new();
                    for attr in e.attributes() {
                        if let Ok(attr) = attr {
                            if attr.key.as_ref() == b"idref" {
                                idref = String::from_utf8_lossy(&attr.value).to_string();
                                break;
                            }
                        }
                    }
                    if !idref.is_empty() {
                        if let Some(item) = manifest_items.get(&idref) {
                            spine_items.push((idref, item.href.clone()));
                        }
                    }
                }
            }
            Ok(Event::End(e)) => {
                let name_vec: Vec<u8> = e.name().as_ref().to_vec();
                let name_bytes = name_vec.as_slice();
                if name_bytes == b"metadata" {
                    in_metadata = false;
                } else if name_bytes == b"manifest" {
                    in_manifest = false;
                } else if name_bytes == b"spine" {
                    in_spine = false;
                } else if name_bytes == b"item" && in_manifest {
                    if let Some(item) = current_item.take() {
                        manifest_items.insert(item.id.clone(), item);
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(format!("XML parse error: {}", e)),
            _ => {}
        }
    }
    
    Ok((metadata, manifest_items, spine_items))
}

// Parse navigation document to extract chapter titles
fn parse_navigation(nav_content: &str) -> Result<std::collections::HashMap<String, String>, String> {
    use quick_xml::events::Event;
    use quick_xml::Reader;
    
    let mut nav_map = std::collections::HashMap::new();
    let mut reader = Reader::from_str(nav_content);
    reader.trim_text(true);
    
    let mut in_nav_toc = false;
    let mut current_href = String::new();
    let mut current_label = String::new();
    
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => {
                let name_vec: Vec<u8> = e.name().as_ref().to_vec();
                let name_bytes = name_vec.as_slice();
                if name_bytes == b"nav" {
                    for attr in e.attributes() {
                        if let Ok(attr) = attr {
                            if attr.key.as_ref() == b"epub:type" {
                                let epub_type = String::from_utf8_lossy(&attr.value);
                                if epub_type == "toc" {
                                    in_nav_toc = true;
                                }
                            }
                        }
                    }
                } else if in_nav_toc && name_bytes == b"a" {
                    for attr in e.attributes() {
                        if let Ok(attr) = attr {
                            if attr.key.as_ref() == b"href" {
                                current_href = String::from_utf8_lossy(&attr.value).to_string();
                                // Remove fragment
                                if let Some(pos) = current_href.find('#') {
                                    current_href = current_href[..pos].to_string();
                                }
                            }
                        }
                    }
                }
            }
            Ok(Event::Text(t)) => {
                if in_nav_toc && !current_href.is_empty() {
                    current_label.push_str(&String::from_utf8_lossy(&t.into_inner()));
                }
            }
            Ok(Event::End(e)) => {
                let name_vec: Vec<u8> = e.name().as_ref().to_vec();
                let name_bytes = name_vec.as_slice();
                if name_bytes == b"a" && !current_href.is_empty() && !current_label.trim().is_empty() {
                    nav_map.insert(current_href.clone(), current_label.trim().to_string());
                    current_href.clear();
                    current_label.clear();
                } else if name_bytes == b"nav" {
                    in_nav_toc = false;
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(format!("XML parse error: {}", e)),
            _ => {}
        }
    }
    
    Ok(nav_map)
}

// Find cover image from manifest
fn find_cover_image(
    cover_id: Option<&String>,
    manifest_items: &std::collections::HashMap<String, ManifestItem>,
) -> Option<String> {
    // Try cover ID first
    if let Some(id) = cover_id {
        if let Some(item) = manifest_items.get(id) {
            return Some(item.href.clone());
        }
    }
    
    // Try properties="cover-image"
    for item in manifest_items.values() {
        if let Some(props) = &item.properties {
            if props.contains("cover-image") {
                return Some(item.href.clone());
            }
        }
    }
    
    // Try id or href containing "cover" with image media type
    for item in manifest_items.values() {
        if let Some(mt) = &item.media_type {
            if mt.starts_with("image/") && (item.id.contains("cover") || item.href.contains("cover")) {
                return Some(item.href.clone());
            }
        }
    }
    
    None
}

// Extract published year from date string
fn extract_year(date: Option<&String>) -> Option<String> {
    date.and_then(|d| {
        d.chars()
            .filter(|c| c.is_ascii_digit())
            .take(4)
            .collect::<String>()
            .parse::<String>()
            .ok()
            .filter(|s| s.len() == 4)
    })
}

// Derive title from file path
fn derive_title_from_path(path: &str) -> String {
    path.split('/')
        .last()
        .unwrap_or("Unknown")
        .replace(".epub", "")
        .to_string()
}

// Generate audio track title from filename
fn generate_audio_track_title(filename: &str, index: usize) -> String {
    let decoded = filename.replace("%20", " ").replace("%2D", "-");
    let base_title = decoded
        .replace(".mp3", "")
        .replace(".wav", "")
        .replace(".m4a", "")
        .replace("_", " ")
        .replace("-", " ")
        .trim()
        .to_string();
    
    if base_title.is_empty() {
        format!("Track {}", index + 1)
    } else {
        base_title
    }
}

/// Ingest EPUB file - parse and store metadata (minimum necessary data, in line with read_all)
/// Returns the Book object with chapters containing only metadata (no content)
#[tauri::command]
pub async fn ingest_epub(
    epub_url: String,
    source_path: String,
    app: tauri::AppHandle,
) -> Result<Book, String> {
    use std::io::{Cursor, Read};
    use zip::ZipArchive;
    use quick_xml::events::Event;
    use quick_xml::Reader;
    use uuid::Uuid;
    
    // Read the EPUB file from the file path
    let file_path = if epub_url.starts_with("file://") {
        epub_url.strip_prefix("file://").unwrap_or(&epub_url).to_string()
    } else {
        epub_url
    };
    
    let epub_data = tauri::plugin::fs::read_file(&app, file_path.into())
        .await
        .map_err(|e| format!("Failed to read EPUB file: {}", e))?
        .to_vec();
    
    // Validate EPUB signature (should start with PK for ZIP)
    if epub_data.len() < 4 || &epub_data[0..4] != b"PK\x03\x04" {
        return Err("Invalid EPUB file: not a valid ZIP archive".to_string());
    }
    
    // Parse EPUB in a blocking task
    let epub_data_clone = epub_data.clone();
    let parsed_data = tokio::task::spawn_blocking(move || {
        // Open ZIP archive
        let mut archive = ZipArchive::new(Cursor::new(&epub_data_clone))
            .map_err(|e| format!("Failed to open EPUB: {}", e))?;
        
        // Find content.opf path from META-INF/container.xml
        let opf_path = {
            let mut found_path = None;
            
            if let Ok(mut container_file) = archive.by_name("META-INF/container.xml") {
                let mut container_content = String::new();
                if container_file.read_to_string(&mut container_content).is_ok() {
                    let mut reader = Reader::from_str(&container_content);
                    reader.trim_text(true);
                    let mut full_path = String::new();
                    let mut media_type = String::new();
                    
                    loop {
                        match reader.read_event() {
                            Ok(Event::Start(e)) => {
                                if e.name().as_ref() == b"rootfile" {
                                    full_path.clear();
                                    media_type.clear();
                                    for attr in e.attributes() {
                                        if let Ok(attr) = attr {
                                            match attr.key.as_ref() {
                                                b"full-path" => {
                                                    full_path = String::from_utf8_lossy(&attr.value).to_string();
                                                }
                                                b"media-type" => {
                                                    media_type = String::from_utf8_lossy(&attr.value).to_string();
                                                }
                                                _ => {}
                                            }
                                        }
                                    }
                                    if media_type == "application/oebps-package+xml" && !full_path.is_empty() {
                                        found_path = Some(full_path);
                                        break;
                                    }
                                }
                            }
                            Ok(Event::Eof) => break,
                            _ => {}
                        }
                    }
                }
            }
            
            found_path.unwrap_or_else(|| {
                let common_paths = vec![
                    "OEBPS/content.opf",
                    "content.opf",
                    "OEBPS/package.opf",
                    "package.opf",
                ];
                
                for path in common_paths {
                    if archive.by_name(path).is_ok() {
                        return path.to_string();
                    }
                }
                
                "content.opf".to_string()
            })
        };
        
        // Read and parse content.opf
        let mut opf_file = archive.by_name(&opf_path)
            .map_err(|e| format!("Failed to find content.opf at path '{}': {}", opf_path, e))?;
        
        let mut opf_content = String::new();
        opf_file.read_to_string(&mut opf_content)
            .map_err(|e| format!("Failed to read content.opf: {}", e))?;
        
        // Parse OPF content using helper function
        let (metadata, manifest_items, spine_items) = parse_opf_content(&opf_content)?;
        
        // Determine OEBPS base path
        let oebps_base = if opf_path.contains("/") {
            opf_path[..opf_path.rfind("/").unwrap() + 1].to_string()
        } else {
            "OEBPS/".to_string()
        };
        
        // Parse navigation to get chapter titles
        let nav_map = {
            // Try to find nav.xhtml (EPUB 3)
            let nav_item = manifest_items.values()
                .find(|item| {
                    item.media_type.as_ref()
                        .map(|m| m == "application/xhtml+xml")
                        .unwrap_or(false)
                        && item.href.contains("nav")
                });
            
            if let Some(nav_item) = nav_item {
                let nav_path = if nav_item.href.starts_with("OEBPS/") {
                    nav_item.href.clone()
                } else {
                    format!("{}{}", oebps_base, nav_item.href)
                };
                
                // Reopen archive to read nav file
                let mut archive2 = ZipArchive::new(Cursor::new(&epub_data_clone))
                    .map_err(|e| format!("Failed to reopen EPUB: {}", e))?;
                
                let nav_content_opt = if let Ok(mut nav_file) = archive2.by_name(&nav_path) {
                    let mut nav_content = String::new();
                    if nav_file.read_to_string(&mut nav_content).is_ok() {
                        Some(nav_content)
                    } else {
                        None
                    }
                } else {
                    None
                };
                
                // Drop archive2 before using nav_content
                drop(archive2);
                
                if let Some(nav_content) = nav_content_opt {
                    parse_navigation(&nav_content).unwrap_or_else(|_| std::collections::HashMap::new())
                } else {
                    std::collections::HashMap::new()
                }
            } else {
                std::collections::HashMap::new()
            }
        };
        
        // Extract chapters from spine (only metadata, no content)
        let mut chapters: Vec<Chapter> = Vec::new();
        for (index, (idref, href)) in spine_items.iter().enumerate() {
            if let Some(item) = manifest_items.get(idref) {
                // Only include HTML/XHTML chapters, exclude navigation/toc
                let is_html_content = item.media_type.as_ref()
                    .map(|mt| mt == "application/xhtml+xml" || mt == "text/html" || mt == "application/html+xml")
                    .unwrap_or(false)
                    || href.ends_with(".xhtml")
                    || href.ends_with(".html");
                
                if is_html_content {
                    let href_lower = href.to_lowercase();
                    // Exclude navigation, toc, and copyright pages
                    if !href_lower.contains("toc")
                        && !href_lower.contains("nav")
                        && !href_lower.contains("copyright")
                        && !href_lower.contains("cover")
                        && !href_lower.contains("titlepage") {
                        
                        // Extract title from navigation if available, otherwise use href
                        let lookup_key = href.split('#').next().unwrap_or(href).to_string();
                        let title = nav_map.get(&lookup_key)
                            .cloned()
                            .unwrap_or_else(|| format!("Section {}", index + 1));
                        
                        chapters.push(Chapter {
                            id: format!("{}-{}", Uuid::new_v4().to_string(), idref),
                            title,
                            content_html: None, // Lazy loading - no content
                            plain_text: None,  // Lazy loading - no content
                            order: index,
                            href: href.clone(),
                            word_count: None,
                            estimated_page_count: None,
                        });
                    }
                }
            }
        }
        
        // Extract cover image using helper function
        let cover_url = find_cover_image(metadata.cover_id.as_ref(), &manifest_items);
        
        // Extract audio tracks (metadata only)
        let mut audio_tracks: Vec<AudioTrack> = Vec::new();
        for (index, (id, item)) in manifest_items.iter().enumerate() {
            if let Some(mt) = &item.media_type {
                if mt.starts_with("audio/") {
                    let filename = item.href.split('/').last().unwrap_or(id);
                    let title = generate_audio_track_title(filename, index);
                    
                    audio_tracks.push(AudioTrack {
                        id: format!("{}-audio-{}", Uuid::new_v4().to_string(), id),
                        title,
                        href: item.href.clone(),
                        url: None, // Lazy loading
                        duration: None,
                    });
                }
            }
        }
        
        // Extract published year from date
        let published_year = extract_year(metadata.pubdate.as_ref())
            .or_else(|| extract_year(metadata.modified_date.as_ref()));
        
        Ok::<_, String>((
            metadata.title,
            metadata.creator,
            metadata.publisher,
            if metadata.subjects.is_empty() { None } else { Some(metadata.subjects) },
            published_year,
            cover_url,
            chapters,
            audio_tracks,
        ))
    })
    .await
    .map_err(|e| format!("Failed to parse EPUB: {}", e))??;
    
    let (
        metadata_title,
        metadata_creator,
        metadata_publisher,
        metadata_subjects,
        published_year,
        cover_url,
        chapters,
        audio_tracks,
    ) = parsed_data;
    
    if chapters.is_empty() {
        return Err("No readable chapters found in EPUB".to_string());
    }
    
    // Generate book ID
    let book_id = Uuid::new_v4().to_string();
    
    // Derive title from path if not available
    let title = metadata_title.unwrap_or_else(|| derive_title_from_path(&source_path));
    
    // Create Book object
    let book = Book {
        id: book_id,
        title,
        author: metadata_creator.unwrap_or_else(|| "Unknown author".to_string()),
        chapters,
        cover_url,
        source_path: source_path.clone(),
        publisher: metadata_publisher,
        published_year,
        subjects: metadata_subjects,
        file_size_bytes: Some(epub_data.len()),
        audio_tracks,
        audio_state: None,
        audio_sync_map: None,
        progress: None,
        page_count: None,
    };
    
    // Store book and EPUB data
    add_book(book.clone(), Some(epub_data), app).await?;
    
    Ok(book)
}

