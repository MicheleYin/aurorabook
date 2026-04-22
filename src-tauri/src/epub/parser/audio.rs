use std::collections::HashMap;
use std::io::{Cursor, Read};
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use symphonia::default::{get_codecs, get_probe};
use zip::ZipArchive;

use super::types::ManifestItem;
use super::opf::derive_base_path_from_opf;
use super::utils::generate_audio_track_title;

/// Compute audio duration from audio bytes using Symphonia (pure Rust, no external binaries).
fn compute_audio_duration(audio_bytes: &[u8], _mime_type: &str) -> Option<f64> {
    if audio_bytes.is_empty() {
        return None;
    }

    let source = Cursor::new(audio_bytes.to_vec());
    let mss = MediaSourceStream::new(Box::new(source), Default::default());
    let hint = Hint::new();

    let probed = get_probe()
        .format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default())
        .ok()?;

    let mut format = probed.format;
    let track = format.default_track()?;
    let mut sample_rate = track.codec_params.sample_rate;

    // Fast path if container/codec metadata provides both frame count and sample rate.
    if let (Some(frames), Some(sr)) = (track.codec_params.n_frames, sample_rate) {
        if sr > 0 {
            return Some(frames as f64 / sr as f64);
        }
    }

    let track_id = track.id;
    let mut decoder = get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .ok()?;

    let mut total_frames: u64 = 0;
    loop {
        match format.next_packet() {
            Ok(packet) => {
                if packet.track_id() != track_id {
                    continue;
                }
                match decoder.decode(&packet) {
                    Ok(decoded) => {
                        if sample_rate.is_none() {
                            sample_rate = Some(decoded.spec().rate);
                        }
                        total_frames = total_frames.saturating_add(decoded.frames() as u64);
                    }
                    Err(SymphoniaError::DecodeError(_)) => {
                        // Corrupt packet; continue to salvage duration from remaining packets.
                        continue;
                    }
                    Err(_) => break,
                }
            }
            Err(SymphoniaError::IoError(_)) => break,
            Err(_) => break,
        }
    }

    let duration = match sample_rate {
        Some(sr) if sr > 0 && total_frames > 0 => Some(total_frames as f64 / sr as f64),
        _ => None,
    };

    if duration.is_none() {
        log::debug!("Failed to compute audio duration via Symphonia");
    }

    duration
}

/// Extract audio tracks from EPUB manifest items in spine order.
///
/// This function iterates through the spine items in order and extracts audio tracks
/// by following the media-overlay chain: chapter → SMIL → audio. This ensures
/// audio tracks are in the same order as chapters appear in the spine/TOC.
///
/// # Arguments
/// * `spine_items` - Vector of spine items as (idref, href) pairs in reading order
/// * `manifest_items` - HashMap of manifest item IDs to ManifestItem objects
///
/// # Returns
/// A vector of AudioTrack objects in spine order. Each track's order field is set
/// to match its position in the spine.
pub fn extract_audio_tracks_from_spine(
    spine_items: &[(String, String)],
    manifest_items: &HashMap<String, ManifestItem>,
) -> Vec<crate::book_service::models::AudioTrack> {
    use crate::book_service::models::AudioTrack;
    use uuid::Uuid;
    use log::debug;
    
    let mut audio_tracks: Vec<AudioTrack> = Vec::new();
    let mut matched_audio_ids = std::collections::HashSet::new();
    
    // Helper to extract numeric suffix from ID (e.g., "p001" -> "001", "m001" -> "001")
    let extract_id_suffix = |id: &str| -> Option<String> {
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
    
    // Log spine items for debugging
    log::info!("🔍 DEBUG: Processing {} spine items in order:", spine_items.len());
    for (idx, (idref, href)) in spine_items.iter().enumerate() {
        log::info!("  Spine #{}: idref='{}', href='{}'", idx, idref, href);
    }
    
    // Iterate through spine items in order
    for (spine_index, (idref, _href)) in spine_items.iter().enumerate() {
        // Get the manifest item for this spine item
        if let Some(chapter_item) = manifest_items.get(idref) {
            // Check if this chapter has a media-overlay (SMIL file)
            if let Some(ref smil_id) = chapter_item.media_overlay {
                log::info!("🔍 DEBUG: Spine item #{} (idref: '{}', href: '{}') has media-overlay '{}'", spine_index, idref, chapter_item.href, smil_id);
                
                // Find SMIL file in manifest
                if let Some(_smil_item) = manifest_items.get(smil_id) {
                    // Extract numeric suffix from SMIL ID (e.g., "s001" -> "001")
                    if let Some(suffix) = extract_id_suffix(smil_id) {
                        // Match SMIL ID to audio track ID using pattern: s001 -> m001
                        // Try common audio ID patterns: m{suffix}, audio{suffix}, a{suffix}
                        let mut found_audio = false;
                        for prefix in &["m", "audio", "a"] {
                            let audio_id = format!("{}{}", prefix, suffix);
                            if let Some(audio_item) = manifest_items.get(&audio_id) {
                                // Check if this is actually an audio file
                                if let Some(ref media_type) = audio_item.media_type {
                                    if media_type.starts_with("audio/") {
                                        // Check if we've already matched this audio track
                                        if !matched_audio_ids.contains(&audio_id) {
                                            // Generate a title from the filename
                                            let filename = audio_item.href.split('/').last().unwrap_or(&audio_item.href);
                                            let track_order = audio_tracks.len(); // Sequential order starting from 0
                                            let title = generate_audio_track_title(filename, track_order);
                                            
                                            log::info!("🔍 DEBUG: Matched audio track '{}' (id: {}, href: '{}') to spine position {} (track order: {})", 
                                                title, audio_id, audio_item.href, spine_index, track_order);
                                            
                                            audio_tracks.push(AudioTrack {
                                                id: Uuid::new_v4().to_string(),
                                                title,
                                                href: audio_item.href.clone(),
                                                url: None,
                                                duration: None,
                                                order: track_order, // Sequential order within audio tracks (0, 1, 2, ...)
                                            });
                                            
                                            matched_audio_ids.insert(audio_id.clone());
                                            found_audio = true;
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                        
                        if !found_audio {
                            debug!("Could not find audio track for SMIL '{}' (suffix: '{}')", smil_id, suffix);
                        }
                    } else {
                        debug!("Could not extract numeric suffix from SMIL ID '{}'", smil_id);
                    }
                } else {
                    debug!("SMIL file '{}' referenced by media-overlay not found in manifest", smil_id);
                }
            }
        }
    }
    
    // Add any remaining audio tracks that weren't matched via spine (fallback)
    // This ensures we don't lose any audio tracks, but they'll be added at the end
    let mut unmatched_audio_tracks = Vec::new();
    for (id, item) in manifest_items.iter() {
        if let Some(media_type) = &item.media_type {
            if media_type.starts_with("audio/") && !matched_audio_ids.contains(id) {
                let filename = item.href.split('/').last().unwrap_or(&item.href);
                let track_order = audio_tracks.len() + unmatched_audio_tracks.len(); // Continue sequential ordering
                let title = generate_audio_track_title(filename, track_order);
                
                unmatched_audio_tracks.push(AudioTrack {
                    id: Uuid::new_v4().to_string(),
                    title,
                    href: item.href.clone(),
                    url: None,
                    duration: None,
                    order: track_order, // Continue sequential order after matched tracks
                });
            }
        }
    }
    
    // Append unmatched tracks at the end
    audio_tracks.extend(unmatched_audio_tracks);
    
    debug!("Extracted {} audio tracks in spine order ({} matched via spine, {} unmatched)", 
        audio_tracks.len(), 
        audio_tracks.len().saturating_sub(spine_items.len().saturating_sub(audio_tracks.len())),
        audio_tracks.len().saturating_sub(spine_items.len()));
    
    audio_tracks
}

/// Extract audio tracks from EPUB manifest items.
///
/// This function scans the manifest for items with audio media types
/// (audio/mpeg, audio/wav, audio/mp4, etc.) and creates AudioTrack objects
/// for each one found.
///
/// # Arguments
/// * `manifest_items` - HashMap of manifest item IDs to ManifestItem objects
///
/// # Returns
/// A vector of AudioTrack objects. The order is not guaranteed and should be
/// sorted by calling `order_audio_tracks_by_chapters` to match chapter order.
///
/// # Deprecated
/// This function is deprecated in favor of `extract_audio_tracks_from_spine` which
/// extracts audio tracks in spine order. Use this function only when spine items
/// are not available.
pub fn extract_audio_tracks_from_manifest(
    manifest_items: &HashMap<String, ManifestItem>,
) -> Vec<crate::book_service::models::AudioTrack> {
    use crate::book_service::models::AudioTrack;
    use uuid::Uuid;
    
    let mut audio_tracks: Vec<AudioTrack> = Vec::new();
    
    // Collect all audio items from manifest
    for (_id, item) in manifest_items.iter() {
        if let Some(media_type) = &item.media_type {
            // Check if this is an audio file
            if media_type.starts_with("audio/") {
                // Generate a title from the filename
                let filename = item.href.split('/').last().unwrap_or(&item.href);
                let track_index = audio_tracks.len();
                let title = generate_audio_track_title(filename, track_index);
                
                audio_tracks.push(AudioTrack {
                    id: Uuid::new_v4().to_string(),
                    title,
                    href: item.href.clone(),
                    url: None, // Will be loaded lazily when needed
                    duration: None, // Will be determined when audio is loaded
                    order: 0, // Will be set after ordering by chapters
                });
            }
        }
    }
    
    // Don't sort by href - let order_audio_tracks_by_chapters handle ordering
    // based on chapter order (spine/NCX order) instead of alphabetical href order
    
    audio_tracks
}

/// Compute durations for audio tracks by reading them from the EPUB archive
/// Returns a map of href -> audio bytes for saving to database
pub fn compute_audio_track_durations(
    epub_data: &[u8],
    audio_tracks: &mut [crate::book_service::models::AudioTrack],
    opf_path: &str,
) -> std::collections::HashMap<String, Vec<u8>> {
    use log::debug;
    use std::collections::HashMap;
    
    let mut archive = match ZipArchive::new(Cursor::new(epub_data)) {
        Ok(archive) => archive,
        Err(e) => {
            log::warn!("Failed to open EPUB for duration computation: {}", e);
            return HashMap::new();
        }
    };
    
    // Determine base path from OPF location
    let base_path = derive_base_path_from_opf(opf_path);
    
    let mut audio_bytes_map = HashMap::new();
    
    for track in audio_tracks.iter_mut() {
        // Resolve audio path relative to OPF location
        let audio_path = if track.href.starts_with("/") {
            track.href[1..].to_string()
        } else {
            let mut resolved_parts: Vec<&str> = base_path.split("/").filter(|s| !s.is_empty()).collect();
            let audio_parts: Vec<&str> = track.href.split("/").collect();
            
            for part in audio_parts {
                if part == ".." {
                    resolved_parts.pop();
                } else if part != "." && !part.is_empty() {
                    resolved_parts.push(part);
                }
            }
            
            resolved_parts.join("/")
        };
        
        // Try to read the audio file
        let mut audio_bytes = Vec::new();
        let mut found_audio = false;
        
        // Try primary path first
        if let Ok(mut file) = archive.by_name(&audio_path) {
            if file.read_to_end(&mut audio_bytes).is_ok() && !audio_bytes.is_empty() {
                found_audio = true;
            }
        }
        
        // Try alternative paths if primary didn't work
        if !found_audio {
            let mut alt_paths = vec![
                track.href.clone(),
            ];
            
            // Add base path variants if base path exists
            if !base_path.is_empty() {
                alt_paths.push(format!("{}{}", base_path, audio_path));
                alt_paths.push(format!("{}{}", base_path, track.href));
            }
            
            for alt_path in &alt_paths {
                if let Ok(mut file) = archive.by_name(alt_path) {
                    audio_bytes.clear();
                    if file.read_to_end(&mut audio_bytes).is_ok() && !audio_bytes.is_empty() {
                        found_audio = true;
                        break;
                    }
                }
            }
        }
        
        if found_audio && !audio_bytes.is_empty() {
            // Determine MIME type from file extension
            let mime_type = if track.href.ends_with(".mp3") {
                "audio/mpeg"
            } else if track.href.ends_with(".wav") {
                "audio/wav"
            } else if track.href.ends_with(".m4a") {
                "audio/mp4"
            } else if track.href.ends_with(".ogg") {
                "audio/ogg"
            } else if track.href.ends_with(".opus") {
                "audio/opus"
            } else {
                "audio/mpeg" // Default fallback
            };
            
            // Compute duration
            if let Some(duration) = compute_audio_duration(&audio_bytes, mime_type) {
                track.duration = Some(duration);
                debug!("Computed duration for track '{}': {:.2}s", track.href, duration);
            } else {
                debug!("Failed to compute duration for track '{}'", track.href);
            }
            
            // Store audio bytes for saving to database
            audio_bytes_map.insert(track.href.clone(), audio_bytes);
        } else {
            debug!("Could not find audio file for track '{}'", track.href);
        }
    }
    
    audio_bytes_map
}

