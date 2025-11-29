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
/// This returns the chapter metadata only (no content)
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

/// Load chapter content from EPUB file
/// This function reads the EPUB from storage and extracts the chapter content
#[tauri::command]
pub async fn load_chapter_content(
    book_id: String,
    chapter_href: String,
    app: tauri::AppHandle,
) -> AppResult<Option<Chapter>> {
    use crate::epub::parser::find_opf_path;
    use crate::utils::path_validation::validate_epub_path;
    use std::io::{Cursor, Read};
    use zip::ZipArchive;
    
    // Find the book to get source_path
    let books = load_all_books(&app)
        .map_err(|e| AppError::Store(e))?;
    let book = books.into_iter()
        .find(|b| b.id == book_id)
        .ok_or_else(|| AppError::Store(format!("Book not found: {}", book_id)))?;
    
    // Get EPUB buffer from store
    let epub_data = get_epub_buffer_from_store(&app, &book.source_path)
        .map_err(|e| AppError::Store(e))?
        .ok_or_else(|| AppError::Store("EPUB not found in store".to_string()))?;
    
    // Load chapter content in a blocking task with timeout
    let epub_data_clone = epub_data.clone();
    let chapter_href_clone = chapter_href.clone();
    let chapter_content = tokio::time::timeout(
        std::time::Duration::from_secs(30), // 30 second timeout
        tokio::task::spawn_blocking(move || {
            let mut archive = ZipArchive::new(Cursor::new(epub_data_clone.as_slice()))
                .map_err(|e| format!("Failed to open EPUB: {}", e))?;
            
            // Find OPF path to determine OEBPS base
            let opf_path = find_opf_path(&mut archive)?;
            let oebps_base = if opf_path.contains("/") {
                opf_path.rfind("/")
                    .map(|pos| opf_path[..pos + 1].to_string())
                    .unwrap_or_else(|| "OEBPS/".to_string())
            } else {
                "OEBPS/".to_string()
            };
            
            // Resolve chapter path
            let validated_href = validate_epub_path(&chapter_href_clone)
                .map_err(|e| format!("Invalid chapter path: {}", e))?;
            
            let chapter_path = if validated_href.starts_with("/") {
                validated_href[1..].to_string()
            } else if validated_href.starts_with("OEBPS/") {
                validated_href.clone()
            } else {
                format!("{}{}", oebps_base, validated_href)
            };
            
            // Try to read the chapter file
            let mut content = String::new();
            let mut file = archive.by_name(&chapter_path)
                .map_err(|e| format!("Failed to find chapter at path '{}': {}", chapter_path, e))?;
            file.read_to_string(&mut content)
                .map_err(|e| format!("Failed to read chapter content: {}", e))?;
            
            Ok::<String, String>(content)
        })
    )
    .await
    .map_err(|_| AppError::EpubParse("Chapter loading timed out after 30 seconds".to_string()))?
    .map_err(|e| AppError::EpubParse(format!("Failed to load chapter: {}", e)))?
    .map_err(|e| AppError::EpubParse(e))?;
    
    // Find the chapter in the book to get metadata
    let mut chapter = book.chapters.into_iter()
        .find(|c| c.href == chapter_href || c.href == chapter_href.replace("OEBPS/", ""))
        .ok_or_else(|| AppError::Store("Chapter not found in book".to_string()))?;
    
    // Set the content
    chapter.content_html = Some(chapter_content);
    
    Ok(Some(chapter))
}

/// Load an image from EPUB file and return as base64 data URL
/// This function resolves relative image paths relative to the chapter location
#[tauri::command]
pub async fn load_epub_image(
    book_id: String,
    image_href: String,
    chapter_href: Option<String>,
    app: tauri::AppHandle,
) -> AppResult<Option<String>> {
    use crate::epub::parser::find_opf_path;
    use crate::utils::path_validation::validate_epub_path;
    use std::io::{Cursor, Read};
    use zip::ZipArchive;
    use base64::{Engine as _, engine::general_purpose};
    use log::{debug, warn};
    
    // Find the book to get source_path
    let books = load_all_books(&app)
        .map_err(|e| AppError::Store(e))?;
    let book = books.into_iter()
        .find(|b| b.id == book_id)
        .ok_or_else(|| AppError::Store(format!("Book not found: {}", book_id)))?;
    
    // Get EPUB buffer from store
    let epub_data = get_epub_buffer_from_store(&app, &book.source_path)
        .map_err(|e| AppError::Store(e))?
        .ok_or_else(|| AppError::Store("EPUB not found in store".to_string()))?;
    
    // Load image in a blocking task
    let epub_data_clone = epub_data.clone();
    let image_href_clone = image_href.clone();
    let chapter_href_clone = chapter_href.clone();
    let image_data_url = tokio::time::timeout(
        std::time::Duration::from_secs(10), // 10 second timeout
        tokio::task::spawn_blocking(move || {
            let mut archive = ZipArchive::new(Cursor::new(epub_data_clone.as_slice()))
                .map_err(|e| format!("Failed to open EPUB: {}", e))?;
            
            // Find OPF path to determine OEBPS base
            let opf_path = find_opf_path(&mut archive)?;
            let oebps_base = if opf_path.contains("/") {
                opf_path.rfind("/")
                    .map(|pos| opf_path[..pos + 1].to_string())
                    .unwrap_or_else(|| "OEBPS/".to_string())
            } else {
                "OEBPS/".to_string()
            };
            
            // Resolve image path relative to chapter if provided, otherwise relative to OPF
            let image_path = if image_href_clone.starts_with("/") {
                // Absolute path from EPUB root
                image_href_clone[1..].to_string()
            } else if let Some(chapter) = &chapter_href_clone {
                // Resolve relative to chapter location
                let validated_chapter = validate_epub_path(chapter)
                    .map_err(|e| format!("Invalid chapter path: {}", e))?;
                
                let chapter_path = if validated_chapter.starts_with("/") {
                    validated_chapter[1..].to_string()
                } else if validated_chapter.starts_with("OEBPS/") {
                    validated_chapter.clone()
                } else {
                    format!("{}{}", oebps_base, validated_chapter)
                };
                
                // Get chapter directory
                let chapter_dir = if chapter_path.contains("/") {
                    chapter_path.rfind("/")
                        .map(|pos| chapter_path[..pos + 1].to_string())
                        .unwrap_or_else(|| oebps_base.clone())
                } else {
                    oebps_base.clone()
                };
                
                // Resolve image path relative to chapter directory
                let mut resolved_parts: Vec<&str> = chapter_dir.split("/").filter(|s| !s.is_empty()).collect();
                let image_parts: Vec<&str> = image_href_clone.split("/").collect();
                
                for part in image_parts {
                    if part == ".." {
                        resolved_parts.pop();
                    } else if part != "." && !part.is_empty() {
                        resolved_parts.push(part);
                    }
                }
                
                resolved_parts.join("/")
            } else {
                // Resolve relative to OPF location
                let opf_dir = if opf_path.contains("/") {
                    opf_path.rfind("/")
                        .map(|pos| opf_path[..pos + 1].to_string())
                        .unwrap_or_else(|| "OEBPS/".to_string())
                } else {
                    "OEBPS/".to_string()
                };
                
                let mut resolved_parts: Vec<&str> = opf_dir.split("/").filter(|s| !s.is_empty()).collect();
                let image_parts: Vec<&str> = image_href_clone.split("/").collect();
                
                for part in image_parts {
                    if part == ".." {
                        resolved_parts.pop();
                    } else if part != "." && !part.is_empty() {
                        resolved_parts.push(part);
                    }
                }
                
                resolved_parts.join("/")
            };
            
            debug!("Attempting to load image from path: '{}' (resolved from '{}')", image_path, image_href_clone);
            
            // Try to read the image from the archive
            let mut image_bytes = Vec::new();
            let mut found_image = false;
            
            // Try primary path first
            if let Ok(mut file) = archive.by_name(&image_path) {
                if file.read_to_end(&mut image_bytes).is_ok() && !image_bytes.is_empty() {
                    found_image = true;
                    debug!("Found image at primary path: '{}'", image_path);
                }
            }
            
            // Try alternative paths if primary didn't work
            if !found_image {
                let alt_paths = [
                    format!("OEBPS/{}", image_path),
                    format!("OPS/{}", image_path),
                    image_href_clone.clone(),
                    format!("OEBPS/{}", image_href_clone),
                    format!("OPS/{}", image_href_clone),
                ];
                
                for alt_path in &alt_paths {
                    if let Ok(mut file) = archive.by_name(alt_path) {
                        image_bytes.clear();
                        if file.read_to_end(&mut image_bytes).is_ok() && !image_bytes.is_empty() {
                            debug!("Found image at alternative path: '{}'", alt_path);
                            found_image = true;
                            break;
                        }
                    }
                }
            }
            
            if !found_image || image_bytes.is_empty() {
                warn!("Image not found at path '{}' or alternatives", image_path);
                return Ok::<Option<String>, String>(None);
            }
            
            // Determine MIME type from file extension or magic bytes
            let mime_type = if image_path.ends_with(".png") || image_href_clone.ends_with(".png") {
                "image/png"
            } else if image_path.ends_with(".jpg") || image_path.ends_with(".jpeg") ||
                      image_href_clone.ends_with(".jpg") || image_href_clone.ends_with(".jpeg") {
                "image/jpeg"
            } else if image_path.ends_with(".gif") || image_href_clone.ends_with(".gif") {
                "image/gif"
            } else if image_path.ends_with(".webp") || image_href_clone.ends_with(".webp") {
                "image/webp"
            } else if image_path.ends_with(".svg") || image_href_clone.ends_with(".svg") {
                "image/svg+xml"
            } else {
                // Try to detect from magic bytes
                if image_bytes.len() >= 4 {
                    match &image_bytes[0..4] {
                        [0x89, 0x50, 0x4E, 0x47] => "image/png",
                        [0xFF, 0xD8, 0xFF, _] => "image/jpeg",
                        [0x47, 0x49, 0x46, 0x38] => "image/gif",
                        _ => "image/jpeg", // Default fallback
                    }
                } else {
                    "image/jpeg"
                }
            };
            
            // Encode to base64
            let base64_data = general_purpose::STANDARD.encode(&image_bytes);
            
            // Create data URL
            let data_url = format!("data:{};base64,{}", mime_type, base64_data);
            
            debug!("Successfully loaded image ({} bytes, type: {})", image_bytes.len(), mime_type);
            
            Ok(Some(data_url))
        })
    )
    .await
    .map_err(|_| AppError::EpubParse("Image loading timed out after 10 seconds".to_string()))?
    .map_err(|e| AppError::EpubParse(format!("Failed to load image: {}", e)))?
    .map_err(|e| AppError::EpubParse(e))?;
    
    Ok(image_data_url)
}

/// Load an audio track from EPUB file and return as base64 data URL
/// This resolves relative audio paths relative to the OPF location
#[tauri::command]
pub async fn load_epub_audio(
    book_id: String,
    audio_href: String,
    app: tauri::AppHandle,
) -> AppResult<Option<String>> {
    use crate::epub::parser::find_opf_path;
    use std::io::{Cursor, Read};
    use zip::ZipArchive;
    use base64::{Engine as _, engine::general_purpose};
    use log::{debug, warn};
    
    // Find the book to get source_path
    let books = load_all_books(&app)
        .map_err(|e| AppError::Store(e))?;
    let book = books.into_iter()
        .find(|b| b.id == book_id)
        .ok_or_else(|| AppError::Store(format!("Book not found: {}", book_id)))?;
    
    // Get EPUB buffer from store
    let epub_data = get_epub_buffer_from_store(&app, &book.source_path)
        .map_err(|e| AppError::Store(e))?
        .ok_or_else(|| AppError::Store("EPUB not found in store".to_string()))?;
    
    // Load audio in a blocking task
    let epub_data_clone = epub_data.clone();
    let audio_href_clone = audio_href.clone();
    let audio_data_url = tokio::time::timeout(
        std::time::Duration::from_secs(30), // 30 second timeout for audio files
        tokio::task::spawn_blocking(move || {
            let mut archive = ZipArchive::new(Cursor::new(epub_data_clone.as_slice()))
                .map_err(|e| format!("Failed to open EPUB: {}", e))?;
            
            // Find OPF path to determine OEBPS base
            let opf_path = find_opf_path(&mut archive)?;
            let oebps_base = if opf_path.contains("/") {
                opf_path.rfind("/")
                    .map(|pos| opf_path[..pos + 1].to_string())
                    .unwrap_or_else(|| "OEBPS/".to_string())
            } else {
                "OEBPS/".to_string()
            };
            
            // Resolve audio path relative to OPF location
            let audio_path = if audio_href_clone.starts_with("/") {
                // Absolute path from EPUB root
                audio_href_clone[1..].to_string()
            } else {
                // Resolve relative to OPF location
                let mut resolved_parts: Vec<&str> = oebps_base.split("/").filter(|s| !s.is_empty()).collect();
                let audio_parts: Vec<&str> = audio_href_clone.split("/").collect();
                
                for part in audio_parts {
                    if part == ".." {
                        resolved_parts.pop();
                    } else if part != "." && !part.is_empty() {
                        resolved_parts.push(part);
                    }
                }
                
                resolved_parts.join("/")
            };
            
            debug!("Attempting to load audio from path: '{}' (resolved from '{}')", audio_path, audio_href_clone);
            
            // Try to read the audio from the archive
            let mut audio_bytes = Vec::new();
            let mut found_audio = false;
            
            // Try primary path first
            if let Ok(mut file) = archive.by_name(&audio_path) {
                if file.read_to_end(&mut audio_bytes).is_ok() && !audio_bytes.is_empty() {
                    found_audio = true;
                    debug!("Found audio at primary path: '{}'", audio_path);
                }
            }
            
            // Try alternative paths if primary didn't work
            if !found_audio {
                let alt_paths = [
                    format!("OEBPS/{}", audio_path),
                    format!("OPS/{}", audio_path),
                    audio_href_clone.clone(),
                    format!("OEBPS/{}", audio_href_clone),
                    format!("OPS/{}", audio_href_clone),
                ];
                
                for alt_path in &alt_paths {
                    if let Ok(mut file) = archive.by_name(alt_path) {
                        audio_bytes.clear();
                        if file.read_to_end(&mut audio_bytes).is_ok() && !audio_bytes.is_empty() {
                            debug!("Found audio at alternative path: '{}'", alt_path);
                            found_audio = true;
                            break;
                        }
                    }
                }
            }
            
            if !found_audio || audio_bytes.is_empty() {
                warn!("Audio not found at path '{}' or alternatives", audio_path);
                return Ok::<Option<String>, String>(None);
            }
            
            // Determine MIME type from file extension
            let mime_type = if audio_path.ends_with(".mp3") || audio_href_clone.ends_with(".mp3") {
                "audio/mpeg"
            } else if audio_path.ends_with(".wav") || audio_href_clone.ends_with(".wav") {
                "audio/wav"
            } else if audio_path.ends_with(".m4a") || audio_href_clone.ends_with(".m4a") {
                "audio/mp4"
            } else if audio_path.ends_with(".ogg") || audio_href_clone.ends_with(".ogg") {
                "audio/ogg"
            } else if audio_path.ends_with(".opus") || audio_href_clone.ends_with(".opus") {
                "audio/opus"
            } else {
                "audio/mpeg" // Default fallback
            };
            
            // Encode to base64
            let base64_data = general_purpose::STANDARD.encode(&audio_bytes);
            
            // Create data URL
            let data_url = format!("data:{};base64,{}", mime_type, base64_data);
            
            debug!("Successfully loaded audio ({} bytes, type: {})", audio_bytes.len(), mime_type);
            
            Ok(Some(data_url))
        })
    )
    .await
    .map_err(|_| AppError::EpubParse("Audio loading timed out after 30 seconds".to_string()))?
    .map_err(|e| AppError::EpubParse(format!("Failed to load audio: {}", e)))?
    .map_err(|e| AppError::EpubParse(e))?;
    
    Ok(audio_data_url)
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
    let result_book = if books.iter().any(|b| b.source_path == book.source_path) {
        // Update existing book instead, but preserve progress and state
        if let Some(existing_index) = books.iter().position(|b| b.source_path == book.source_path) {
            let existing_book = &books[existing_index];
            // Preserve progress, audio_state, and page_count from existing book
            let mut updated_book = book.clone();
            updated_book.progress = existing_book.progress.clone();
            updated_book.audio_state = existing_book.audio_state.clone();
            updated_book.page_count = existing_book.page_count;
            // Preserve the existing book ID to maintain continuity
            updated_book.id = existing_book.id.clone();
            
            // If audio_sync_map is missing but we have audio tracks, use the new one
            // This allows books imported before SMIL parsing to get sync maps
            if updated_book.audio_sync_map.is_none() && !updated_book.audio_tracks.is_empty() {
                log::info!("Rebuilding audio sync map for existing book (was missing)");
                // Keep the new audio_sync_map from the parsed book
            } else if existing_book.audio_sync_map.is_some() {
                // Preserve existing sync map if it exists
                updated_book.audio_sync_map = existing_book.audio_sync_map.clone();
            }
            
            books[existing_index] = updated_book.clone();
            updated_book
        } else {
            book.clone()
        }
    } else {
        books.push(book.clone());
        book.clone()
    };
    
    // Store EPUB data if provided
    if let Some(data) = epub_data {
        save_epub_buffer_to_store(&app, &book.source_path, &data)
            .map_err(|e| AppError::Store(e))?;
    }
    
    save_all_books(&app, &books)
        .map_err(|e| AppError::Store(e))?;
    
    Ok(result_book)
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

/// Rebuild audio sync map for an existing book
/// This is useful for books that were imported before SMIL parsing was added
#[tauri::command]
pub async fn rebuild_audio_sync_map(
    book_id: String,
    app: tauri::AppHandle,
) -> AppResult<Option<AudioSyncMap>> {
    use std::io::Cursor;
    use zip::ZipArchive;
    use crate::epub::converter::smil::build_audio_sync_map;
    
    let mut books = load_all_books(&app)
        .map_err(|e| AppError::Store(e))?;
    
    let book = books.iter()
        .find(|b| b.id == book_id)
        .ok_or_else(|| AppError::Store(format!("Book with ID {} not found", book_id)))?;
    
    if book.audio_tracks.is_empty() {
        log::warn!("Cannot rebuild audio sync map - book has no audio tracks");
        return Ok(None);
    }
    
    log::info!("Rebuilding audio sync map for book: {} ({} audio tracks)", book.title, book.audio_tracks.len());
    
    // Clone data needed for the blocking task
    let source_path = book.source_path.clone();
    let chapters = book.chapters.clone();
    
    // Get EPUB data from store
    let epub_data = get_epub_buffer_from_store(&app, &source_path)
        .map_err(|e| AppError::Store(e))?
        .ok_or_else(|| AppError::Store("EPUB data not found in store".to_string()))?;
    
    // Build audio sync map
    let audio_sync_map = tokio::task::spawn_blocking(move || {
        let mut archive = ZipArchive::new(Cursor::new(epub_data.as_slice()))
            .map_err(|e| format!("Failed to open EPUB: {}", e))?;
        
        build_audio_sync_map(&mut archive, &chapters)
            .map_err(|e| format!("Failed to build audio sync map: {}", e))
    })
    .await
    .map_err(|e| AppError::EpubParse(format!("Background task failed: {}", e)))?
    .map_err(|e| AppError::EpubParse(e))?;
    
    if let Some(ref sync_map) = audio_sync_map {
        log::info!("Successfully rebuilt audio sync map with {} segments", sync_map.segments.len());
        // Update the book in the books vector
        if let Some(book) = books.iter_mut().find(|b| b.id == book_id) {
            book.audio_sync_map = audio_sync_map.clone();
            save_all_books(&app, &books)
                .map_err(|e| AppError::Store(e))?;
        }
    } else {
        log::warn!("No audio sync segments found in SMIL files");
    }
    
    Ok(audio_sync_map)
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
    let mut audio_tracks = extract_audio_tracks_from_manifest(&manifest_items);
    
    // Compute durations for audio tracks
    if !audio_tracks.is_empty() {
        let epub_data_for_durations = epub_data.clone();
        let opf_path_for_durations = opf_path.clone();
        let audio_tracks_clone = audio_tracks.clone();
        audio_tracks = match tokio::task::spawn_blocking(move || {
            use crate::epub::parser::compute_audio_track_durations;
            let mut tracks = audio_tracks_clone;
            compute_audio_track_durations(
                &epub_data_for_durations,
                &mut tracks,
                &opf_path_for_durations,
            );
            tracks
        })
        .await
        {
            Ok(tracks) => tracks,
            Err(e) => {
                log::warn!("Failed to compute audio track durations in background task: {}", e);
                audio_tracks
            }
        };
    }
    
    // Build audio sync map from SMIL files if audio tracks exist
    let audio_sync_map = if !audio_tracks.is_empty() {
        log::info!("Building audio sync map for book with {} audio tracks", audio_tracks.len());
        let epub_data_for_smil = epub_data.clone();
        let chapters_for_smil = chapters.clone();
        tokio::task::spawn_blocking(move || {
            use std::io::Cursor;
            use zip::ZipArchive;
            use crate::epub::converter::smil::build_audio_sync_map;
            
            let mut archive = ZipArchive::new(Cursor::new(epub_data_for_smil.as_slice()))
                .map_err(|e| format!("Failed to open EPUB for SMIL parsing: {}", e))?;
            
            build_audio_sync_map(&mut archive, &chapters_for_smil)
                .map_err(|e| format!("Failed to build audio sync map: {}", e))
        })
        .await
        .unwrap_or_else(|e| {
            log::warn!("Failed to parse SMIL files in background task: {}", e);
            Ok(None)
        })
        .unwrap_or_else(|e| {
            log::warn!("Failed to build audio sync map: {}", e);
            None
        })
    } else {
        log::debug!("Skipping audio sync map - no audio tracks found");
        None
    };
    
    if let Some(ref sync_map) = audio_sync_map {
        log::info!("Successfully built audio sync map with {} segments", sync_map.segments.len());
    } else {
        log::debug!("No audio sync map available for this book");
    }
    
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
        audio_sync_map,
        progress: None,
        page_count: None,
    };
    
    // Store book and EPUB data
    add_book(book.clone(), Some(epub_data), app).await?;
    
    Ok(book)
}

