//! Book update functionality after EPUB conversion
//!
//! This module provides functionality for updating book metadata,
//! audio tracks, and audio sync maps after conversion.

use tauri::AppHandle;
use crate::book_service::models::{Book, ConversionStatus};
use crate::book_service::storage::{get_book_by_source_path, add_book};
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
/// Uses the same logic as ingestion to ensure consistency.
/// 
/// Returns the updated Book if found, or None if the book wasn't in the library.
pub async fn update_book_audio_tracks(
    converted_epub: &[u8],
    source_path: &str,
    app: &AppHandle,
) -> Result<Option<Book>, String> {
    // Parse EPUB to extract audio tracks (same as ingestion)
    let (mut audio_tracks, chapters) = extract_audio_data_from_epub(converted_epub)?;
    
    // Compute durations for audio tracks (same as ingestion)
    if !audio_tracks.is_empty() {
        let epub_data_for_durations = converted_epub.to_vec();
        // Get OPF path from the EPUB
        let opf_path = {
            let mut temp_archive = ZipArchive::new(Cursor::new(converted_epub))
                .map_err(|e| format!("Failed to open EPUB for OPF path: {}", e))?;
            find_opf_path(&mut temp_archive)
                .map_err(|e| format!("Failed to find OPF path: {}", e))?
        };
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
    
    // Build audio sync map from SMIL files (same as ingestion)
    let audio_sync_map = if !audio_tracks.is_empty() {
        log::info!("Building audio sync map for book with {} audio tracks", audio_tracks.len());
        let epub_data_for_smil = converted_epub.to_vec();
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
    
    // Order audio tracks to match chapter order
    // Audio tracks are named like "Audio/prologue.mp3" and should match chapters like "prologue.xhtml"
    let ordered_audio_tracks = order_audio_tracks_by_chapters(&audio_tracks, &chapters);
    log::info!("Ordered {} audio tracks to match {} chapters", ordered_audio_tracks.len(), chapters.len());
    
    Ok((ordered_audio_tracks, chapters))
}

/// Order audio tracks to match the chapter order.
/// 
/// This function matches audio tracks to chapters by comparing their base filenames
/// (e.g., "Audio/prologue.mp3" matches "prologue.xhtml") and orders the audio tracks
/// in the same sequence as the chapters appear in the spine.
pub fn order_audio_tracks_by_chapters(
    audio_tracks: &[crate::book_service::models::AudioTrack],
    chapters: &[crate::book_service::models::Chapter],
) -> Vec<crate::book_service::models::AudioTrack> {
    use std::collections::HashMap;
    
    // Helper to extract base filename (without extension and path)
    let get_base_name = |href: &str| -> String {
        href.split('/')
            .last()
            .unwrap_or(href)
            .split('.')
            .next()
            .unwrap_or(href)
            .to_lowercase()
    };
    
    // Create a map of base name -> audio track for quick lookup
    let mut audio_track_map: HashMap<String, Vec<crate::book_service::models::AudioTrack>> = HashMap::new();
    for track in audio_tracks {
        let base_name = get_base_name(&track.href);
        audio_track_map.entry(base_name).or_insert_with(Vec::new).push(track.clone());
    }
    
    // Build ordered list by matching chapters to audio tracks
    let mut ordered_tracks = Vec::new();
    let mut used_tracks: HashMap<String, usize> = HashMap::new(); // Track which index we're at for each base name
    
    for chapter in chapters {
        let chapter_base = get_base_name(&chapter.href);
        
        // Try to find matching audio track
        if let Some(tracks) = audio_track_map.get(&chapter_base) {
            let index = used_tracks.get(&chapter_base).copied().unwrap_or(0);
            if index < tracks.len() {
                ordered_tracks.push(tracks[index].clone());
                used_tracks.insert(chapter_base.clone(), index + 1);
                log::debug!("Matched audio track '{}' to chapter '{}'", tracks[index].href, chapter.href);
            }
        }
    }
    
    // Add any remaining audio tracks that didn't match chapters (shouldn't happen, but be safe)
    for (base_name, tracks) in &audio_track_map {
        let used_count = used_tracks.get(base_name).copied().unwrap_or(0);
        for track in tracks.iter().skip(used_count) {
            log::warn!("Audio track '{}' didn't match any chapter, appending to end", track.href);
            ordered_tracks.push(track.clone());
        }
    }
    
    ordered_tracks
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
    if let Ok(Some(mut book)) = get_book_by_source_path(app, source_path).await {
        // Preserve existing track IDs by matching tracks by href
        let preserved_tracks = preserve_existing_track_ids(&book.audio_tracks, audio_tracks);
        
        book.audio_tracks = preserved_tracks;
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
        
        add_book(app, &book).await
            .map_err(|e| format!("Failed to save book: {}", e))?;
        
        Ok(Some(updated_book))
    } else {
        log::warn!("Book with source_path '{}' not found in library, skipping audio track update", source_path);
        // Don't return error - book might not be in library yet
        Ok(None)
    }
}

/// Preserve existing track IDs by matching new tracks to existing ones by href
fn preserve_existing_track_ids(
    existing_tracks: &[crate::book_service::models::AudioTrack],
    new_tracks: Vec<crate::book_service::models::AudioTrack>,
) -> Vec<crate::book_service::models::AudioTrack> {
    use std::collections::HashMap;
    
    // Create a map of href -> existing track for quick lookup
    let existing_map: HashMap<String, &crate::book_service::models::AudioTrack> = existing_tracks
        .iter()
        .map(|track| (track.href.clone(), track))
        .collect();
    
    // Preserve IDs for tracks that already exist, use new IDs for new tracks
    let mut preserved_tracks = Vec::new();
    for mut new_track in new_tracks {
        if let Some(existing_track) = existing_map.get(&new_track.href) {
            // Preserve the existing ID and other properties that might be set
            new_track.id = existing_track.id.clone();
            // Preserve duration if it was already computed
            if existing_track.duration.is_some() && new_track.duration.is_none() {
                new_track.duration = existing_track.duration;
            }
            // Preserve URL if it was already loaded
            if existing_track.url.is_some() && new_track.url.is_none() {
                new_track.url = existing_track.url.clone();
            }
            log::debug!("Preserved existing track ID '{}' for href '{}'", existing_track.id, new_track.href);
        } else {
            log::debug!("New track with ID '{}' for href '{}'", new_track.id, new_track.href);
        }
        preserved_tracks.push(new_track);
    }
    
    log::info!("Preserved {} existing track IDs out of {} total tracks", 
        existing_map.len().min(preserved_tracks.len()), preserved_tracks.len());
    
    preserved_tracks
}

