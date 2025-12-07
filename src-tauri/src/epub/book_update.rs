//! Book update functionality after EPUB conversion
//!
//! This module provides functionality for updating book metadata,
//! audio tracks, and audio sync maps after conversion.

use tauri::AppHandle;
use crate::book_service::models::{Book, ConversionStatus};
use crate::book_service::storage::{load_all_books, save_all_books};
use crate::epub::parser::{find_opf_path, parse_opf_content, extract_audio_tracks_from_manifest, extract_chapters_from_epub};
use crate::epub::converter::smil::build_audio_sync_map;
use std::io::Cursor;
use zip::ZipArchive;

/// Update book audio tracks and audio sync map after conversion
/// 
/// This function parses the converted EPUB to extract audio tracks from the manifest
/// and builds the audio sync map from SMIL files, then updates the corresponding book
/// in the library store.
/// 
/// Returns the updated Book if found, or None if the book wasn't in the library.
pub async fn update_book_audio_tracks(
    converted_epub: &[u8],
    source_path: &str,
    app: &AppHandle,
) -> Result<Option<Book>, String> {
    // Parse EPUB to extract audio tracks
    let (audio_tracks, chapters) = extract_audio_data_from_epub(converted_epub)?;
    
    // Build audio sync map from SMIL files
    let audio_sync_map = build_audio_sync_map_from_epub(converted_epub, &chapters)?;
    
    // Update book in library
    update_book_in_library(app, source_path, audio_tracks, audio_sync_map, converted_epub.len()).await
}

/// Extract audio tracks and chapters from converted EPUB
fn extract_audio_data_from_epub(
    converted_epub: &[u8],
) -> Result<(Vec<crate::book_service::models::AudioTrack>, Vec<crate::book_service::models::Chapter>), String> {
    let mut archive = ZipArchive::new(Cursor::new(converted_epub))
        .map_err(|e| format!("Failed to open converted EPUB: {}", e))?;
    
    let opf_path = find_opf_path(&mut archive)
        .map_err(|e| format!("Failed to find OPF path: {}", e))?;
    
    let opf_content = {
        use std::io::Read;
        let mut opf_file = archive.by_name(&opf_path)
            .map_err(|e| format!("Failed to find OPF at path '{}': {}", opf_path, e))?;
        let mut content = String::new();
        opf_file.read_to_string(&mut content)
            .map_err(|e| format!("Failed to read OPF: {}", e))?;
        content
    };
    let (_metadata, manifest_items, _spine_items) = parse_opf_content(&opf_content)
        .map_err(|e| format!("Failed to parse OPF content: {}", e))?;
    
    log_manifest_items(&manifest_items);
    
    let audio_tracks = extract_audio_tracks_from_manifest(&manifest_items);
    log::info!("Extracted {} audio tracks from manifest", audio_tracks.len());
    
    // Extract chapters from converted EPUB for building audio sync map
    let (chapters, _) = extract_chapters_from_epub(converted_epub)
        .map_err(|e| format!("Failed to extract chapters from converted EPUB: {}", e))?;
    
    log::debug!("Extracted {} chapters for SMIL parsing", chapters.len());
    for chapter in &chapters {
        log::debug!("Chapter href: {}", chapter.href);
    }
    
    Ok((audio_tracks, chapters))
}


/// Log manifest items for debugging
fn log_manifest_items(manifest_items: &std::collections::HashMap<String, crate::epub::parser::ManifestItem>) {
    log::debug!("Parsed manifest with {} items", manifest_items.len());
    for (id, item) in manifest_items {
        if let Some(ref mt) = item.media_type {
            if mt.starts_with("audio/") || mt == "application/smil+xml" {
                log::debug!("Found {} item: id={}, href={}, media-type={}", 
                    if mt.starts_with("audio/") { "audio" } else { "SMIL" },
                    id, item.href, mt);
            }
        }
    }
}

/// Build audio sync map from SMIL files in EPUB
fn build_audio_sync_map_from_epub(
    converted_epub: &[u8],
    chapters: &[crate::book_service::models::Chapter],
) -> Result<Option<crate::book_service::models::AudioSyncMap>, String> {
    let mut archive_for_smil = ZipArchive::new(Cursor::new(converted_epub))
        .map_err(|e| format!("Failed to open converted EPUB for SMIL parsing: {}", e))?;
    
    log_epub_files(&mut archive_for_smil);
    
    let audio_sync_map = build_audio_sync_map(&mut archive_for_smil, chapters)
        .map_err(|e| format!("Failed to build audio sync map: {}", e))?;
    
    if let Some(ref sync_map) = audio_sync_map {
        log::info!("Built audio sync map with {} segments", sync_map.segments.len());
    } else {
        log::warn!("No audio sync map built - no SMIL files found or no segments parsed");
    }
    
    Ok(audio_sync_map)
}

/// Log EPUB files for debugging
fn log_epub_files(archive: &mut ZipArchive<Cursor<&[u8]>>) {
    log::debug!("EPUB contains {} files", archive.len());
    for i in 0..archive.len() {
        if let Ok(file) = archive.by_index(i) {
            let name = file.name();
            if name.ends_with(".smil") || name.ends_with(".mp3") {
                log::debug!("Found file in EPUB: {}", name);
            }
        }
    }
}

/// Update book in library with new audio tracks and sync map
async fn update_book_in_library(
    app: &AppHandle,
    source_path: &str,
    audio_tracks: Vec<crate::book_service::models::AudioTrack>,
    audio_sync_map: Option<crate::book_service::models::AudioSyncMap>,
    epub_size: usize,
) -> Result<Option<Book>, String> {
    let mut books = load_all_books(app).await
        .map_err(|e| format!("Failed to load books: {}", e))?;
    
    if let Some(book) = books.iter_mut().find(|b| b.source_path == source_path) {
        book.audio_tracks = audio_tracks.clone();
        book.audio_sync_map = audio_sync_map;
        // Update file size with the converted EPUB size
        book.file_size_bytes = Some(epub_size);
        
        // Check if all chapters are completed
        if book.completed_chapters.len() >= book.chapters.len() {
            book.conversion_status = ConversionStatus::Done;
            log::info!("All chapters completed, marking conversion as done");
        }
        
        log::info!("Updated audio tracks for book '{}' ({} tracks), audio sync map, and file size ({} bytes)", 
            book.title, book.audio_tracks.len(), epub_size);
        
        // Clone the updated book before saving
        let updated_book = book.clone();
        
        save_all_books(app, &books).await
            .map_err(|e| format!("Failed to save books: {}", e))?;
        
        Ok(Some(updated_book))
    } else {
        log::warn!("Book with source_path '{}' not found in library, skipping audio track update", source_path);
        // Don't return error - book might not be in library yet
        Ok(None)
    }
}

