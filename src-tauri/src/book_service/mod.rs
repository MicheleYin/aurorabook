pub mod models;
pub mod storage;
pub mod filters;

pub use models::*;
use storage::*;
use filters::*;
use crate::utils::errors::{AppError, AppResult};
use crate::utils::constants::MAX_EPUB_SIZE;
use crate::utils::path_validation::validate_file_size;
use crate::epub::parser::extract_audio_tracks_from_manifest;

/// Read all books with optional filtering and search
#[tauri::command]
pub async fn read_all_books(
    filter: Option<LibraryFilter>,
    app: tauri::AppHandle,
) -> AppResult<Vec<Book>> {
    let books = load_all_books(&app)
        .map_err(|e| AppError::Store(e))?;
    Ok(filter_books(books, filter))
}

/// Read a single complete book by ID
#[tauri::command]
pub async fn read_one_book(
    book_id: String,
    app: tauri::AppHandle,
) -> AppResult<Option<Book>> {
    let books = load_all_books(&app)
        .map_err(|e| AppError::Store(e))?;
    Ok(books.into_iter().find(|book| book.id == book_id))
}

/// Read a single chapter by book ID and chapter ID
#[tauri::command]
pub async fn read_single_chapter(
    book_id: String,
    chapter_id: String,
    app: tauri::AppHandle,
) -> AppResult<Option<Chapter>> {
    let books = load_all_books(&app)
        .map_err(|e| AppError::Store(e))?;
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
) -> AppResult<Option<AudioTrack>> {
    let books = load_all_books(&app)
        .map_err(|e| AppError::Store(e))?;
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
) -> AppResult<()> {
    let mut books = load_all_books(&app)
        .map_err(|e| AppError::Store(e))?;
    
    // Find the book to get its source_path for EPUB cleanup
    let book_to_delete = books.iter().find(|b| b.id == book_id);
    let source_path = book_to_delete.map(|b| b.source_path.clone());
    
    // Remove from library
    books.retain(|book| book.id != book_id);
    save_all_books(&app, &books)
        .map_err(|e| AppError::Store(e))?;
    
    // Clean up EPUB from store if it exists
    if let Some(path) = source_path {
        delete_epub_from_store(&app, &path)
            .map_err(|e| AppError::Store(e))?;
    }
    
    Ok(())
}

/// Add a new book to the library
#[tauri::command]
pub async fn add_book(
    book: Book,
    epub_data: Option<Vec<u8>>,
    app: tauri::AppHandle,
) -> AppResult<Book> {
    let mut books = load_all_books(&app)
        .map_err(|e| AppError::Store(e))?;
    
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
        save_epub_buffer_to_store(&app, &book.source_path, &data)
            .map_err(|e| AppError::Store(e))?;
    }
    
    save_all_books(&app, &books)
        .map_err(|e| AppError::Store(e))?;
    
    Ok(book)
}

/// Get EPUB buffer for a book
#[tauri::command]
pub async fn get_epub_buffer(
    source_path: String,
    app: tauri::AppHandle,
) -> AppResult<Option<Vec<u8>>> {
    get_epub_buffer_from_store(&app, &source_path)
        .map_err(|e| AppError::Store(e))
}

/// Update book progress
#[tauri::command]
pub async fn update_book_progress(
    book_id: String,
    progress: BookProgress,
    app: tauri::AppHandle,
) -> AppResult<Book> {
    let mut books = load_all_books(&app)
        .map_err(|e| AppError::Store(e))?;
    
    let book = books.iter_mut()
        .find(|b| b.id == book_id)
        .ok_or_else(|| AppError::Store(format!("Book not found: {}", book_id)))?;
    
    book.progress = Some(progress);
    let updated_book = book.clone();
    
    save_all_books(&app, &books)
        .map_err(|e| AppError::Store(e))?;
    
    Ok(updated_book)
}

/// Update book audio state
#[tauri::command]
pub async fn update_book_audio_state(
    book_id: String,
    audio_state: BookAudioState,
    app: tauri::AppHandle,
) -> AppResult<Book> {
    let mut books = load_all_books(&app)
        .map_err(|e| AppError::Store(e))?;
    
    let book = books.iter_mut()
        .find(|b| b.id == book_id)
        .ok_or_else(|| AppError::Store(format!("Book not found: {}", book_id)))?;
    
    book.audio_state = Some(audio_state);
    let updated_book = book.clone();
    
    save_all_books(&app, &books)
        .map_err(|e| AppError::Store(e))?;
    
    Ok(updated_book)
}

/// Ingest EPUB file - parse and store metadata
/// Returns the Book object with chapters containing only metadata (no content)
///
/// This function uses the epub::parser module to extract chapters and metadata
/// from an EPUB file, then creates a Book object and stores it in the library.
#[tauri::command]
pub async fn ingest_epub(
    epub_path: String,
    source_path: String,
    app: tauri::AppHandle,
) -> AppResult<Book> {
    use crate::epub::parser::{extract_chapters_from_epub, find_opf_path, parse_opf_content, find_cover_image, extract_year, derive_title_from_path};
    use std::io::{Cursor, Read};
    use zip::ZipArchive;
    use uuid::Uuid;
    use std::fs;
    
    // Handle file:// URL prefix
    let actual_path = if epub_path.starts_with("file://") {
        epub_path.replacen("file://", "", 1)
    } else {
        epub_path.clone()
    };
    
    // Read the EPUB file from the file path
    let epub_data = fs::read(&actual_path)
        .map_err(|e| AppError::Io(e).with_context(format!("Failed to read EPUB file from path '{}'", actual_path)))?;
    
    // Validate EPUB file size
    validate_file_size(epub_data.len(), MAX_EPUB_SIZE, "EPUB")?;
    
    // Validate EPUB signature (should start with PK for ZIP)
    if epub_data.len() < 4 || &epub_data[0..4] != b"PK\x03\x04" {
        return Err(AppError::EpubParse("Invalid EPUB file: not a valid ZIP archive".to_string()));
    }
    
    // Parse EPUB in a blocking task
    let epub_data_clone = epub_data.clone();
    let (chapters, _stats) = tokio::task::spawn_blocking(move || {
        extract_chapters_from_epub(&epub_data_clone)
    })
    .await
    .map_err(|e| AppError::EpubParse(format!("Failed to parse EPUB: {}", e)))?
    .map_err(|e| AppError::EpubParse(e))?;
    
    if chapters.is_empty() {
        return Err(AppError::EpubParse("No readable chapters found in EPUB".to_string()));
    }
    
    // Extract metadata from OPF in a separate blocking task
    let epub_data_for_metadata = epub_data.clone();
    let (metadata, manifest_items, _spine_items, opf_path) = tokio::task::spawn_blocking(move || {
        let epub_bytes = epub_data_for_metadata;
        let mut archive = ZipArchive::new(Cursor::new(epub_bytes.as_slice()))
            .map_err(|e| format!("Failed to open EPUB: {}", e))?;
        
        let opf_path = find_opf_path(&mut archive)?;
        let mut opf_file = archive.by_name(&opf_path)
            .map_err(|e| format!("Failed to find OPF at path '{}': {}", opf_path, e))?;
        
        let mut opf_content = String::new();
        opf_file.read_to_string(&mut opf_content)
            .map_err(|e| format!("Failed to read OPF: {}", e))?;
        
        let (metadata, manifest_items, spine_items) = parse_opf_content(&opf_content)?;
        Ok((metadata, manifest_items, spine_items, opf_path))
    })
    .await
    .map_err(|e| AppError::EpubParse(format!("Failed to extract metadata: {}", e)))?
    .map_err(|e| AppError::EpubParse(e).with_context("Failed to parse OPF content"))?;
    
    // Find cover image href
    let cover_href = find_cover_image(metadata.cover_id.as_ref(), &manifest_items);
    
    // Extract cover image as data URL if found
    let cover_url = if let Some(href) = cover_href {
        let epub_data_for_cover = epub_data.clone();
        let opf_path_for_cover = opf_path.clone();
        tokio::task::spawn_blocking(move || {
            crate::epub::parser::extract_cover_image_as_data_url(
                &epub_data_for_cover,
                &href,
                &opf_path_for_cover,
            )
        })
        .await
        .unwrap_or_else(|e| {
            log::warn!("Failed to extract cover image: {}", e);
            None
        })
    } else {
        None
    };
    
    // Extract published year from date
    let published_year = extract_year(metadata.pubdate.as_ref());
    
    // Extract audio tracks from manifest
    let audio_tracks = extract_audio_tracks_from_manifest(&manifest_items);
    
    // Generate book ID
    let book_id = Uuid::new_v4().to_string();
    
    // Derive title from path if not available
    let title = metadata.title
        .unwrap_or_else(|| derive_title_from_path(&source_path));
    
    // Create Book object
    let book = Book {
        id: book_id,
        title,
        author: metadata.creator.unwrap_or_else(|| "Unknown author".to_string()),
        chapters,
        cover_url,
        source_path: source_path.clone(),
        publisher: metadata.publisher,
        published_year,
        subjects: if metadata.subjects.is_empty() {
            None
        } else {
            Some(metadata.subjects)
        },
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

