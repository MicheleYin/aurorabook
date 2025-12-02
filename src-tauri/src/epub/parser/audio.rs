use std::collections::HashMap;
use std::io::{Cursor, Read};
use zip::ZipArchive;

use super::types::ManifestItem;
use super::opf::derive_base_path_from_opf;
use super::utils::generate_audio_track_title;

/// Compute audio duration from audio bytes using symphonia
fn compute_audio_duration(audio_bytes: &[u8], mime_type: &str) -> Option<f64> {
    use symphonia::core::formats::FormatOptions;
    use symphonia::core::io::MediaSourceStream;
    use symphonia::core::meta::MetadataOptions;
    use symphonia::core::probe::Hint;
    use symphonia::default::get_probe;
    
    // Create a hint based on MIME type
    let mut hint = Hint::new();
    if mime_type.contains("mpeg") || mime_type.contains("mp3") {
        hint.with_extension("mp3");
    } else if mime_type.contains("wav") {
        hint.with_extension("wav");
    } else if mime_type.contains("mp4") || mime_type.contains("m4a") {
        hint.with_extension("m4a");
    } else if mime_type.contains("ogg") {
        hint.with_extension("ogg");
    } else if mime_type.contains("opus") {
        hint.with_extension("opus");
    }
    
    // Create a media source stream from the bytes
    // Clone bytes to ensure we own them for 'static lifetime
    let audio_bytes_owned = audio_bytes.to_vec();
    let mss = MediaSourceStream::new(
        Box::new(std::io::Cursor::new(audio_bytes_owned)),
        Default::default(),
    );
    
    // Probe the format
    match get_probe().format(
        &hint,
        mss,
        &FormatOptions::default(),
        &MetadataOptions::default(),
    ) {
        Ok(probed) => {
            // Get the format
            let format = probed.format;
            
            // Get the first track
            let track = format.tracks().first()?;
            
            // Get the codec parameters
            let params = &track.codec_params;
            
            // Calculate duration from codec parameters
            if let (Some(time_base), Some(n_frames)) = (params.time_base, params.n_frames) {
                let duration_secs = time_base.calc_time(n_frames).seconds as f64;
                Some(duration_secs)
            } else {
                // If we can't get duration from codec params, return None
                // The duration will need to be computed when the track is actually played
                None
            }
        }
        Err(e) => {
            log::debug!("Failed to compute audio duration: {}", e);
            None
        }
    }
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
/// A vector of AudioTrack objects sorted by their href paths.
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
                });
            }
        }
    }
    
    // Sort by href to ensure consistent ordering
    audio_tracks.sort_by(|a, b| a.href.cmp(&b.href));
    
    audio_tracks
}

/// Compute durations for audio tracks by reading them from the EPUB archive
pub fn compute_audio_track_durations(
    epub_data: &[u8],
    audio_tracks: &mut [crate::book_service::models::AudioTrack],
    opf_path: &str,
) {
    use log::debug;
    
    let mut archive = match ZipArchive::new(Cursor::new(epub_data)) {
        Ok(archive) => archive,
        Err(e) => {
            log::warn!("Failed to open EPUB for duration computation: {}", e);
            return;
        }
    };
    
    // Determine base path from OPF location
    let base_path = derive_base_path_from_opf(opf_path);
    
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
        } else {
            debug!("Could not find audio file for track '{}'", track.href);
        }
    }
}

