//! Book update functionality after EPUB conversion
//!
//! This module provides functionality for updating book metadata,
//! audio tracks, and audio sync maps after conversion.

use tauri::AppHandle;
use crate::book_service::models::{Book, ConversionStatus};
use crate::book_service::database::get_db_connection;
use crate::book_service::repositories::BookRepository;
use crate::epub::parser::{find_opf_path, parse_opf_content, extract_audio_tracks_from_spine, extract_chapters_from_epub, parse_ncx_ordered_hrefs};
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
    
    // Compute durations for audio tracks and collect audio bytes for saving
    let mut audio_bytes_map = std::collections::HashMap::new();
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
        let (updated_tracks, bytes_map) = match tokio::task::spawn_blocking(move || {
            use crate::epub::parser::compute_audio_track_durations;
            let mut tracks = audio_tracks_clone;
            let bytes = compute_audio_track_durations(
                &epub_data_for_durations,
                &mut tracks,
                &opf_path_for_durations,
            );
            (tracks, bytes)
        })
        .await
        {
            Ok((tracks, bytes)) => (tracks, bytes),
            Err(e) => {
                log::warn!("Failed to compute audio track durations in background task: {}", e);
                (audio_tracks, std::collections::HashMap::new())
            }
        };
        audio_tracks = updated_tracks;
        audio_bytes_map = bytes_map;
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
    
    log::info!("Updating book in library with audio sync map: {}", 
        if audio_sync_map.is_some() { 
            format!("{} segments", audio_sync_map.as_ref().unwrap().segments.len()) 
        } else { 
            "None".to_string() 
        });
    
    // Update book in library
    update_book_in_library(app, source_path, audio_tracks, audio_sync_map, converted_epub.len(), audio_bytes_map).await
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
    let (_metadata, manifest_items, spine_items) = parse_opf_content(&opf_content)
        .map_err(|e| format!("Failed to parse OPF content: {}", e))?;
    
    log_manifest_items(&manifest_items);
    
    // Extract audio tracks from spine in order (ensures tracks match chapter order)
    let audio_tracks = extract_audio_tracks_from_spine(&spine_items, &manifest_items);
    log::info!("Extracted {} audio tracks from spine (in order)", audio_tracks.len());
    
    // Extract chapters from converted EPUB for building audio sync map
    let (mut chapters, _) = extract_chapters_from_epub(converted_epub)
        .map_err(|e| format!("Failed to extract chapters from converted EPUB: {}", e))?;
    
    log::info!("🔍 DEBUG: Extracted {} chapters from EPUB (BEFORE NCX sorting)", chapters.len());
    for (idx, chapter) in chapters.iter().enumerate() {
        log::info!("🔍 DEBUG: Chapter #{}: order={}, href='{}', title='{}'", idx, chapter.order, chapter.href, chapter.title);
    }
    
    // Sort chapters by NCX/TOC order if available
    let ncx_ordered_hrefs = {
        use std::io::Read;
        // Find NCX file from manifest
        let mut ncx_path: Option<String> = None;
        for item in manifest_items.values() {
            if item.media_type.as_ref().map(|mt| mt == "application/x-dtbncx+xml").unwrap_or(false) {
                ncx_path = Some(item.href.clone());
                break;
            }
        }
        
        if let Some(ncx_href) = ncx_path {
            // Try to read NCX file
            let base_path = if opf_path.contains("/") {
                opf_path.rfind("/").map(|pos| &opf_path[..pos + 1]).unwrap_or("")
            } else {
                ""
            };
            
            let ncx_paths = vec![
                ncx_href.clone(),
                format!("{}{}", base_path, ncx_href),
                format!("{}{}", base_path, "toc.ncx"),
                "toc.ncx".to_string(),
            ];
            
            let mut ordered_hrefs = None;
            for path in ncx_paths {
                if let Ok(mut ncx_file) = archive.by_name(&path) {
                    let mut ncx_content = String::new();
                    if ncx_file.read_to_string(&mut ncx_content).is_ok() {
                        if let Ok(hrefs) = parse_ncx_ordered_hrefs(&ncx_content) {
                            log::info!("🔍 DEBUG: Parsed {} ordered hrefs from NCX file '{}'", hrefs.len(), path);
                            for (idx, href) in hrefs.iter().enumerate() {
                                log::info!("🔍 DEBUG: NCX order #{}: href='{}'", idx, href);
                            }
                            ordered_hrefs = Some(hrefs);
                            break;
                        }
                    }
                }
            }
            ordered_hrefs
        } else {
            None
        }
    };
    
    // Sort chapters by NCX order if available
    if let Some(ref ordered_hrefs) = ncx_ordered_hrefs {
        use std::collections::HashMap;
        
        log::info!("🔍 DEBUG: Starting to sort chapters by NCX order. NCX has {} hrefs", ordered_hrefs.len());
        
        // Create a map of href -> chapter for quick lookup
        let mut chapter_map: HashMap<String, Vec<crate::book_service::models::Chapter>> = HashMap::new();
        for chapter in chapters {
            // Normalize href for matching
            let normalized_href = if chapter.href.starts_with("/") {
                chapter.href[1..].to_string()
            } else {
                chapter.href.clone()
            };
            log::debug!("🔍 DEBUG: Adding chapter to map: normalized_href='{}', original_href='{}'", normalized_href, chapter.href);
            chapter_map.entry(normalized_href.clone()).or_insert_with(Vec::new).push(chapter);
        }
        
        log::info!("🔍 DEBUG: Created chapter map with {} entries", chapter_map.len());
        
        // Rebuild chapters in NCX order
        let mut sorted_chapters = Vec::new();
        let mut order = 0;
        
        // Determine base path from OPF to handle path differences
        let base_path = if opf_path.contains("/") {
            opf_path.rfind("/").map(|pos| &opf_path[..pos + 1]).unwrap_or("")
        } else {
            ""
        };
        log::info!("🔍 DEBUG: Using base_path='{}' for matching", base_path);
        
        for (ncx_idx, ncx_href) in ordered_hrefs.iter().enumerate() {
            // Try to find matching chapter - try multiple path variations
            let normalized_ncx_href = if ncx_href.starts_with("/") {
                ncx_href[1..].to_string()
            } else {
                ncx_href.clone()
            };
            
            log::info!("🔍 DEBUG: NCX item #{}: looking for href='{}' (normalized='{}')", ncx_idx, ncx_href, normalized_ncx_href);
            
            // Try multiple matching strategies
            let mut matched_key: Option<String> = None;
            
            // Strategy 1: Exact match
            if chapter_map.contains_key(&normalized_ncx_href) {
                matched_key = Some(normalized_ncx_href.clone());
                log::info!("🔍 DEBUG: Found exact match for NCX href '{}'", normalized_ncx_href);
            }
            
            // Strategy 2: Try with base path (if NCX href doesn't have it)
            if matched_key.is_none() && !base_path.is_empty() && !normalized_ncx_href.starts_with(&base_path) {
                let href_with_base = format!("{}{}", base_path, normalized_ncx_href);
                if chapter_map.contains_key(&href_with_base) {
                    log::info!("🔍 DEBUG: Found match with base path: '{}'", href_with_base);
                    matched_key = Some(href_with_base);
                }
            }
            
            // Strategy 3: Try without base path (if chapter has base path)
            if matched_key.is_none() && !base_path.is_empty() && normalized_ncx_href.starts_with(&base_path) {
                let href_without_base = normalized_ncx_href[base_path.len()..].to_string();
                if chapter_map.contains_key(&href_without_base) {
                    log::info!("🔍 DEBUG: Found match without base path: '{}'", href_without_base);
                    matched_key = Some(href_without_base);
                }
            }
            
            // Strategy 4: Filename match (last resort)
            if matched_key.is_none() {
                let ncx_filename = normalized_ncx_href.split("/").last().unwrap_or(&normalized_ncx_href);
                log::debug!("🔍 DEBUG: No path match, trying filename match for '{}'", ncx_filename);
                for (href, _) in chapter_map.iter() {
                    let href_filename = href.split("/").last().unwrap_or(href);
                    if href_filename == ncx_filename {
                        matched_key = Some(href.clone());
                        log::info!("🔍 DEBUG: Found filename match: NCX filename '{}' matches chapter href '{}'", ncx_filename, href);
                        break;
                    }
                }
            }
            
            // Process matched chapter
            if let Some(key) = matched_key {
                if let Some(mut chapter_vec) = chapter_map.remove(&key) {
                    for mut chapter in chapter_vec.drain(..) {
                        chapter.order = order;
                        log::info!("🔍 DEBUG: Assigning order {} to chapter '{}' (href='{}')", order, chapter.title, chapter.href);
                        sorted_chapters.push(chapter);
                        order += 1;
                    }
                }
            } else {
                log::warn!("🔍 DEBUG: No match found for NCX href '{}' (tried exact, with/without base path, and filename)", normalized_ncx_href);
            }
        }
        
        // Add any remaining chapters that weren't in NCX
        let remaining_count = chapter_map.len();
        if remaining_count > 0 {
            log::warn!("🔍 DEBUG: {} chapters not found in NCX, adding them at the end", remaining_count);
        }
        for (_href, mut chapter_vec) in chapter_map {
            for mut chapter in chapter_vec.drain(..) {
                chapter.order = order;
                log::warn!("🔍 DEBUG: Assigning order {} to unmatched chapter '{}' (href='{}')", order, chapter.title, chapter.href);
                sorted_chapters.push(chapter);
                order += 1;
            }
        }
        
        chapters = sorted_chapters;
        log::info!("🔍 DEBUG: Sorted {} chapters by NCX order (AFTER sorting)", chapters.len());
        for (idx, chapter) in chapters.iter().enumerate() {
            log::info!("🔍 DEBUG: Sorted Chapter #{}: order={}, href='{}', title='{}'", idx, chapter.order, chapter.href, chapter.title);
        }
    } else {
        log::warn!("🔍 DEBUG: No NCX file found, using chapters in spine order");
    }
    
    // Build a map of actual file paths in the EPUB archive for path normalization
    let mut archive_file_paths = std::collections::HashSet::new();
    for i in 0..archive.len() {
        if let Ok(file) = archive.by_index(i) {
            let name = file.name().to_string();
            archive_file_paths.insert(name.clone());
            // Also add normalized versions (without leading slash, etc.)
            archive_file_paths.insert(name.trim_start_matches('/').to_string());
        }
    }
    
    // Audio tracks are already in spine order with correct sequential ordering (0, 1, 2, ...)
    // from extract_audio_tracks_from_spine. We don't need to reorder them since they're
    // already in the correct order. The order_audio_tracks_by_chapters function would
    // reorder them based on chapter order (which might be NCX order, not spine order),
    // so we skip it to preserve the spine order.
    // Note: Tracks are already matched to chapters via the media-overlay chain in extract_audio_tracks_from_spine
    log::info!("🔍 DEBUG: Audio tracks already in spine order, preserving order");
    for (idx, track) in audio_tracks.iter().enumerate() {
        log::info!("🔍 DEBUG: Audio Track #{}: order={}, href='{}', title='{}'", idx, track.order, track.href, track.title);
    }
    
    Ok((audio_tracks, chapters))
}

/// Normalize an EPUB href path to match the actual structure in the EPUB archive
/// This function tries to find the actual file path that exists in the archive
fn normalize_epub_href_to_archive(
    href: &str,
    archive_file_paths: &std::collections::HashSet<String>,
) -> Option<String> {
    // First, try exact match
    if archive_file_paths.contains(href) {
        return Some(href.to_string());
    }
    
    // Try without leading slash
    let no_leading_slash = href.trim_start_matches('/');
    if no_leading_slash != href && archive_file_paths.contains(no_leading_slash) {
        return Some(no_leading_slash.to_string());
    }
    
    // Try with leading slash
    let with_leading_slash = if !href.starts_with("/") {
        format!("/{}", href)
    } else {
        href.to_string()
    };
    if archive_file_paths.contains(&with_leading_slash) {
        return Some(with_leading_slash);
    }
    
    // Try to find by filename (case-insensitive search for actual files)
    let filename = href.split("/").last().unwrap_or(href);
    for archive_path in archive_file_paths {
        let archive_filename = archive_path.split("/").last().unwrap_or(archive_path);
        if archive_filename == filename {
            return Some(archive_path.clone());
        }
    }
    
    // Try common path variations
    let variations = vec![
        href.to_string(),
        no_leading_slash.to_string(),
        with_leading_slash.clone(),
        // Try with common prefixes
        format!("OEBPS/{}", no_leading_slash),
        format!("EPUB/{}", no_leading_slash),
        // Try without common prefixes
        href.strip_prefix("OEBPS/").unwrap_or(href).to_string(),
        href.strip_prefix("EPUB/").unwrap_or(href).to_string(),
        href.strip_prefix("/OEBPS/").unwrap_or(href).to_string(),
        href.strip_prefix("/EPUB/").unwrap_or(href).to_string(),
    ];
    
    for variant in variations {
        if archive_file_paths.contains(&variant) {
            return Some(variant);
        }
    }
    
    None
}

/// Generate all possible path variations for matching (fallback when archive not available)
fn normalize_epub_href_for_matching(href: &str) -> Vec<String> {
    let mut variations = Vec::new();
    
    // Original
    variations.push(href.to_string());
    
    // Without leading slash
    let no_leading_slash = href.trim_start_matches('/');
    if no_leading_slash != href {
        variations.push(no_leading_slash.to_string());
    }
    
    // With leading slash
    if !href.starts_with("/") {
        variations.push(format!("/{}", href));
    }
    
    // Without OEBPS/ prefix
    let without_oebps = href
        .strip_prefix("OEBPS/")
        .or_else(|| href.strip_prefix("/OEBPS/"))
        .unwrap_or(href);
    if without_oebps != href {
        variations.push(without_oebps.to_string());
        // Also without leading slash
        let without_oebps_no_slash = without_oebps.trim_start_matches('/');
        if without_oebps_no_slash != without_oebps {
            variations.push(without_oebps_no_slash.to_string());
        }
    }
    
    // With OEBPS/ prefix
    if !href.starts_with("OEBPS/") && !href.starts_with("/OEBPS/") {
        let with_oebps = format!("OEBPS/{}", href.trim_start_matches('/'));
        variations.push(with_oebps.clone());
        // Also with leading slash
        variations.push(format!("/{}", with_oebps));
    }
    
    // Without EPUB/ prefix
    let without_epub = href
        .strip_prefix("EPUB/")
        .or_else(|| href.strip_prefix("/EPUB/"))
        .unwrap_or(href);
    if without_epub != href {
        variations.push(without_epub.to_string());
    }
    
    // With EPUB/ prefix
    if !href.starts_with("EPUB/") && !href.starts_with("/EPUB/") {
        let with_epub = format!("EPUB/{}", href.trim_start_matches('/'));
        variations.push(with_epub);
    }
    
    // Just filename (last resort)
    if let Some(filename) = href.split("/").last() {
        if filename != href {
            variations.push(filename.to_string());
        }
    }
    
    // Remove duplicates while preserving order
    let mut unique = Vec::new();
    for v in variations {
        if !unique.contains(&v) {
            unique.push(v);
        }
    }
    
    unique
}

/// Order audio tracks to match the chapter order.
/// 
/// This function iterates through chapters (which are already in correct spine order)
/// and matches each chapter to its corresponding audio track using the OPF manifest:
/// - Chapters have `media-overlay` attributes pointing to SMIL files
/// - SMIL files reference audio tracks
/// - We match by following this chain: chapter → media-overlay → SMIL → audio
/// 
/// Falls back to ID pattern matching (e.g., p001 → s001 → m001) if media-overlay chain is incomplete.
/// Each audio track's order is set to match the order of its corresponding chapter.
/// 
/// Paths are normalized to match the actual EPUB archive structure.
pub fn order_audio_tracks_by_chapters(
    audio_tracks: &[crate::book_service::models::AudioTrack],
    chapters: &[crate::book_service::models::Chapter],
    manifest_items: &std::collections::HashMap<String, crate::epub::parser::ManifestItem>,
    archive_file_paths: &std::collections::HashSet<String>,
) -> Vec<crate::book_service::models::AudioTrack> {
    use std::collections::HashMap;
    
    // Build maps for efficient lookup
    // Map: chapter href -> chapter manifest item ID (with all path variations)
    let mut chapter_href_to_id: HashMap<String, String> = HashMap::new();
    // Map: audio track manifest ID -> audio track
    let mut audio_track_by_id: HashMap<String, crate::book_service::models::AudioTrack> = HashMap::new();
    // Map: audio track href -> audio track (for fallback lookup)
    let mut audio_track_by_href: HashMap<String, crate::book_service::models::AudioTrack> = HashMap::new();
    
    // Build audio track by href map first
    for track in audio_tracks {
        audio_track_by_href.insert(track.href.clone(), track.clone());
    }
    
    // Find chapter manifest items by href and audio tracks by manifest ID
    // Normalize manifest item hrefs to match actual EPUB archive structure
    for (id, item) in manifest_items {
        if let Some(ref mt) = item.media_type {
            if mt == "application/xhtml+xml" || mt == "text/html" || mt == "application/html+xml" {
                // Normalize the manifest item href to match actual archive structure
                let normalized_href = normalize_epub_href_to_archive(&item.href, archive_file_paths)
                    .unwrap_or_else(|| item.href.clone());
                
                // Insert normalized href
                chapter_href_to_id.insert(normalized_href.clone(), id.clone());
                
                // Also insert all path variations for fallback matching
                let href_variations = normalize_epub_href_for_matching(&normalized_href);
                for href_variant in href_variations {
                    chapter_href_to_id.insert(href_variant, id.clone());
                }
            } else if mt.starts_with("audio/") {
                // Find matching audio track by href (exact match)
                if let Some(track) = audio_track_by_href.get(&item.href) {
                    audio_track_by_id.insert(id.clone(), track.clone());
                    log::debug!("Mapped audio track manifest id '{}' (href: '{}') to track", id, item.href);
                } else {
                    log::warn!("Audio track in manifest (id: '{}', href: '{}') not found in audio_tracks list", id, item.href);
                }
            }
        }
    }
    
    // Helper to extract numeric suffix from ID (e.g., "p001" -> "001", "m001" -> "001")
    let extract_id_suffix = |id: &str| -> Option<String> {
        // Try to find trailing digits
        let mut suffix = String::new();
        for ch in id.chars().rev() {
            if ch.is_ascii_digit() {
                suffix.insert(0, ch);
            } else {
                break;
            }
        }
        if suffix.is_empty() { None } else { Some(suffix) }
    };
    
    // Build ordered list by iterating through chapters in order
    let mut ordered_tracks = Vec::new();
    let mut matched_audio_ids = std::collections::HashSet::new();
    
    // Iterate through chapters in order (chapters are already in correct spine order)
    for chapter in chapters {
        log::info!("🔍 DEBUG: Processing chapter: order={}, href='{}', title='{}'", chapter.order, chapter.href, chapter.title);
        // Find the manifest item for this chapter by href
        let mut matched_track: Option<crate::book_service::models::AudioTrack> = None;
        
        // Normalize chapter href to match actual EPUB archive structure
        let normalized_chapter_href = normalize_epub_href_to_archive(&chapter.href, archive_file_paths)
            .unwrap_or_else(|| chapter.href.clone());
        
        // Try to find manifest item using normalized href first, then fallback to variations
        let chapter_manifest_id = chapter_href_to_id.get(&normalized_chapter_href)
            .or_else(|| {
                // Fallback: try all path variations
                let chapter_href_variations = normalize_epub_href_for_matching(&normalized_chapter_href);
                chapter_href_variations.iter()
                    .find_map(|href_variant| chapter_href_to_id.get(href_variant))
            })
            .map(|id| id.clone());
        
        if let Some(ref chapter_manifest_id) = chapter_manifest_id {
            log::info!("🔍 DEBUG: Found chapter manifest ID '{}' for href '{}'", chapter_manifest_id, chapter.href);
            if let Some(chapter_item) = manifest_items.get(chapter_manifest_id) {
                log::info!("🔍 DEBUG: Chapter manifest item: id='{}', href='{}', media_overlay={:?}", 
                    chapter_manifest_id, chapter_item.href, chapter_item.media_overlay);
                // Strategy 1: Use media-overlay chain from OPF (chapter → SMIL → audio)
                // This is the PRIMARY method - tracks MUST be ordered by media-overlay chain, NOT alphabetically
                // The chain is: chapter (p001) → media-overlay (s001) → audio track (m001)
                if let Some(ref smil_id) = chapter_item.media_overlay {
                    log::info!("🔍 DEBUG: Chapter '{}' has media-overlay '{}', following chain to find audio track", chapter.title, smil_id);
                    
                    // Find SMIL file in manifest
                    if let Some(_smil_item) = manifest_items.get(smil_id) {
                        // Extract numeric suffix from SMIL ID (e.g., "s001" -> "001")
                        if let Some(suffix) = extract_id_suffix(smil_id) {
                            // Match SMIL ID to audio track ID using pattern: s001 -> m001
                            // Try common audio ID patterns: m{suffix}, audio{suffix}, a{suffix}
                            for prefix in &["m", "audio", "a"] {
                                let audio_id = format!("{}{}", prefix, suffix);
                                if let Some(track) = audio_track_by_id.get(&audio_id) {
                                    if !matched_audio_ids.contains(&audio_id) {
                                        matched_track = Some(track.clone());
                                        matched_audio_ids.insert(audio_id.clone());
                                        log::info!("🔍 DEBUG: Matched audio track '{}' (id: {}, href: '{}') to chapter '{}' (id: {}, href: '{}') via media-overlay chain: {} -> {} (order: {})", 
                                            track.title, audio_id, track.href, chapter.title, chapter_manifest_id, chapter.href, smil_id, audio_id, chapter.order);
                                        break;
                                    } else {
                                        log::warn!("🔍 DEBUG: Audio track '{}' (id: {}) already matched to another chapter, skipping", track.href, audio_id);
                                    }
                                }
                            }
                        } else {
                            log::warn!("🔍 DEBUG: Could not extract numeric suffix from SMIL ID '{}' for chapter '{}'", smil_id, chapter.title);
                        }
                    } else {
                        log::warn!("🔍 DEBUG: SMIL file '{}' referenced by media-overlay not found in manifest for chapter '{}'", smil_id, chapter.title);
                    }
                } else {
                    // Chapter has no media-overlay - it likely doesn't have audio
                    // Skip chapters without media-overlay to ensure tracks are only ordered by media-overlay chain
                    // This prevents accidental alphabetical ordering
                    log::debug!("🔍 DEBUG: Chapter '{}' (id: '{}', href: '{}') has no media-overlay, skipping audio track matching", 
                        chapter.title, chapter_manifest_id, chapter.href);
                }
            }
        }
        
        // Set order and append to ordered list
        // Use sequential ordering (0, 1, 2, ...) instead of chapter.order to ensure
        // tracks have correct sequential order regardless of chapter positions
        if let Some(mut track) = matched_track {
            track.order = ordered_tracks.len(); // Sequential order within audio tracks
            log::info!("🔍 DEBUG: Matched audio track '{}' (href: '{}') to chapter '{}' (track order: {}, chapter order: {})", 
                track.title, track.href, chapter.title, track.order, chapter.order);
            ordered_tracks.push(track);
        } else {
            log::warn!("🔍 DEBUG: Could not match audio track to chapter '{}' (href: '{}', order: {})", chapter.title, chapter.href, chapter.order);
        }
    }
    
    // Add any remaining audio tracks that didn't match chapters
    for track in audio_tracks {
        // Check if this track was matched by checking if its ID is in audio_track_by_id and matched
        let track_id = manifest_items.iter()
            .find(|(_, item)| item.href == track.href && item.media_type.as_ref().map(|mt| mt.starts_with("audio/")).unwrap_or(false))
            .map(|(id, _)| id);
        
        if let Some(id) = track_id {
            if !matched_audio_ids.contains(id) {
                let mut track = track.clone();
                // Continue sequential ordering for unmatched tracks
                track.order = ordered_tracks.len();
                log::warn!("Audio track '{}' (id: {}) didn't match any chapter, assigning order {}", track.href, id, track.order);
                ordered_tracks.push(track);
            }
        } else {
            // Track not in manifest, add it anyway
            let mut track = track.clone();
            // Continue sequential ordering for unmatched tracks
            track.order = ordered_tracks.len();
            log::warn!("Audio track '{}' not found in manifest, assigning order {}", track.href, track.order);
            ordered_tracks.push(track);
        }
    }
    
    // Sort by order to ensure correct sequence based on chapter order (via media-overlay chain)
    // This ensures tracks are ordered by their corresponding chapters' order, NOT alphabetically
    ordered_tracks.sort_by_key(|t| t.order);
    
    log::info!("Audio track ordering complete: {} tracks ordered (matched {} to chapters, {} unmatched)", 
        ordered_tracks.len(), 
        ordered_tracks.len().saturating_sub(audio_tracks.len().saturating_sub(chapters.len())),
        audio_tracks.len().saturating_sub(ordered_tracks.len()));
    
    // Log final order for debugging
    for (idx, track) in ordered_tracks.iter().enumerate() {
        log::debug!("Ordered audio track #{}: '{}' (href: '{}', order: {})", 
            idx, track.title, track.href, track.order);
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

/// Log EPUB archive file names for debugging
fn log_epub_files(archive: &mut ZipArchive<Cursor<&[u8]>>) {
    log::debug!("EPUB archive contains {} files", archive.len());
    for i in 0..archive.len() {
        if let Ok(file) = archive.by_index(i) {
            let name = file.name();
            if name.ends_with(".smil") || name.ends_with(".mp3") || name.ends_with(".m4a") || name.ends_with(".opus") {
                log::debug!("EPUB file #{}: {}", i, name);
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


/// Update book in library with new audio tracks and sync map
async fn update_book_in_library(
    app: &AppHandle,
    source_path: &str,
    audio_tracks: Vec<crate::book_service::models::AudioTrack>,
    audio_sync_map: Option<crate::book_service::models::AudioSyncMap>,
    epub_size: usize,
    audio_bytes_map: std::collections::HashMap<String, Vec<u8>>,
) -> Result<Option<Book>, String> {
    let db = get_db_connection(app).await?;
    if let Ok(Some(mut book)) = BookRepository::find_by_source_path(db.as_ref(), source_path).await {
        // Preserve existing track IDs by matching tracks by href
        let preserved_tracks = preserve_existing_track_ids(&book.audio_tracks, audio_tracks);
        
        book.audio_tracks = preserved_tracks.clone();
        book.audio_sync_map = audio_sync_map.clone();
        // Update file size with the converted EPUB size
        book.file_size_bytes = Some(epub_size);
        
        // Check if all chapters with text content are completed
        // Only count chapters that have text content (word_count > 0)
        let chapters_with_text: usize = book.chapters.iter()
            .filter(|ch| ch.word_count.map(|wc| wc > 0).unwrap_or(false))
            .count();
        
        // Only set status to Done if we've completed ALL chapters with text
        // Use strict equality to avoid false positives during partial conversions
        if book.completed_chapters.len() == chapters_with_text && chapters_with_text > 0 {
            book.conversion_status = ConversionStatus::Done;
            log::info!("All chapters with text content completed ({} of {} total chapters), marking conversion as done", 
                book.completed_chapters.len(), book.chapters.len());
        } else {
            // Ensure status remains Started if not all chapters are done
            // This prevents false "Done" status during partial conversions
            if book.conversion_status == ConversionStatus::Done && book.completed_chapters.len() < chapters_with_text {
                log::warn!("Conversion status was Done but only {}/{} chapters are completed, resetting to Started", 
                    book.completed_chapters.len(), chapters_with_text);
                book.conversion_status = ConversionStatus::Started;
            }
        }
        
        log::info!("Updated audio tracks for book '{}' ({} tracks), audio sync map ({} segments), and file size ({} bytes)", 
            book.title, 
            book.audio_tracks.len(), 
            book.audio_sync_map.as_ref().map(|m| m.segments.len()).unwrap_or(0),
            epub_size);
        
        // Clone the updated book before saving
        let updated_book = book.clone();
        
        // Save book metadata (this saves audio track metadata and audio sync map)
        log::debug!("Saving book with audio_sync_map: {}", 
            if book.audio_sync_map.is_some() { 
                format!("{} segments", book.audio_sync_map.as_ref().unwrap().segments.len()) 
            } else { 
                "None".to_string() 
            });
        BookRepository::save(db.as_ref(), &book).await
            .map_err(|e| format!("Failed to save book: {}", e))?;
        log::debug!("Book saved successfully, audio sync map should be persisted");
        
        // Save audio track data after metadata is saved
        use crate::book_service::repositories::AudioRepository;
        log::info!("Saving {} audio track data files to database", audio_bytes_map.len());
        for (href, audio_data) in audio_bytes_map {
            if let Err(e) = AudioRepository::save_data(db.as_ref(), &book.id, &href, &audio_data).await {
                log::warn!("Failed to save audio track data for '{}': {}", href, e);
            } else {
                log::debug!("Saved audio track data for '{}' ({} bytes)", href, audio_data.len());
            }
        }
        
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

