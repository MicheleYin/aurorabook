//! Export audiobook tracks to a single MP3 using Symphonia decode + bundled LAME (mp3lame-encoder).
//! No FFmpeg required (used on iOS where FFmpeg is not bundled).

use super::repositories::{AudioRepository, BookRepository};
use super::get_db_connection;
use crate::tts_commands::encode_pcm_to_mp3_bytes;
use crate::utils::constants::DEFAULT_MP3_BITRATE;
use crate::utils::errors::{AppError, AppResult};
use std::io::{Cursor, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Instant;
use tauri::Emitter;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct Mp3ExportProgress {
    book_id: String,
    current_step: String,
    message: String,
    processed_tracks: usize,
    total_tracks: usize,
    percent: u8,
    eta_ms: Option<u64>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Mp3ExportStatus {
    in_progress: bool,
    book_id: Option<String>,
}

static MP3_EXPORT_IN_PROGRESS: AtomicBool = AtomicBool::new(false);
static ACTIVE_MP3_EXPORT_BOOK_ID: OnceLock<Mutex<Option<String>>> = OnceLock::new();

fn active_mp3_export_book_id_mutex() -> &'static Mutex<Option<String>> {
    ACTIVE_MP3_EXPORT_BOOK_ID.get_or_init(|| Mutex::new(None))
}

fn set_mp3_export_active(book_id: Option<String>) {
    if let Ok(mut m) = active_mp3_export_book_id_mutex().lock() {
        *m = book_id;
    }
}

pub fn active_mp3_export_book_id() -> Option<String> {
    active_mp3_export_book_id_mutex()
        .lock()
        .ok()
        .and_then(|m| m.clone())
}

#[tauri::command]
pub async fn get_mp3_export_status() -> AppResult<Mp3ExportStatus> {
    let in_progress = MP3_EXPORT_IN_PROGRESS.load(Ordering::Acquire);
    let book_id = active_mp3_export_book_id();
    Ok(Mp3ExportStatus {
        in_progress,
        book_id,
    })
}

fn hint_from_href(href: &str) -> symphonia::core::probe::Hint {
    let mut hint = symphonia::core::probe::Hint::new();
    let lower = href.to_lowercase();
    if lower.ends_with(".mp3") {
        hint.with_extension("mp3");
    } else if lower.ends_with(".m4a") || lower.ends_with(".mp4") || lower.ends_with(".aac") {
        hint.with_extension("m4a");
    } else if lower.ends_with(".ogg") {
        hint.with_extension("ogg");
    } else if lower.ends_with(".opus") {
        hint.with_extension("opus");
    } else if lower.ends_with(".wav") {
        hint.with_extension("wav");
    } else if lower.ends_with(".flac") {
        hint.with_extension("flac");
    } else {
        hint.with_extension("mp3");
    }
    hint
}

fn append_decoded_pcm(
    decoded: &symphonia::core::audio::AudioBufferRef<'_>,
    out: &mut Vec<u8>,
) -> AppResult<(u32, u32)> {
    use symphonia::core::audio::AudioBufferRef;
    use symphonia::core::audio::Signal;

    let spec = *decoded.spec();
    let rate = spec.rate;
    let n_ch = spec.channels.count();
    let frames = decoded.capacity();

    match decoded {
        AudioBufferRef::F32(buf) => {
            for f in 0..frames {
                for c in 0..n_ch {
                    let s = buf.chan(c)[f];
                    let i = (s.clamp(-1.0, 1.0) * 32767.0) as i16;
                    out.extend_from_slice(&i.to_le_bytes());
                }
            }
        }
        AudioBufferRef::S16(buf) => {
            for f in 0..frames {
                for c in 0..n_ch {
                    let s = buf.chan(c)[f];
                    out.extend_from_slice(&s.to_le_bytes());
                }
            }
        }
        _ => {
            return Err(AppError::Encoding(
                "Unsupported audio sample format in track (use MP3, M4A, or WAV)".into(),
            ));
        }
    }

    Ok((rate, n_ch as u32))
}

/// Decode one audio blob to 16-bit little-endian interleaved PCM.
fn decode_audio_blob_to_pcm(audio_bytes: &[u8], href: &str) -> AppResult<(Vec<u8>, u32, u32)> {
    use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
    use symphonia::core::errors::Error as SymphErr;
    use symphonia::core::formats::FormatOptions;
    use symphonia::core::io::MediaSourceStream;
    use symphonia::core::meta::MetadataOptions;

    let hint = hint_from_href(href);
    let cursor = Cursor::new(audio_bytes.to_vec());
    let mss = MediaSourceStream::new(Box::new(cursor), Default::default());

    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            mss,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|e| AppError::Encoding(format!("Audio probe failed: {}", e)))?;

    let mut format = probed.format;
    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or_else(|| AppError::Encoding("No decodable audio track".into()))?;

    let track_id = track.id;
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| AppError::Encoding(format!("Decoder init failed: {}", e)))?;

    let mut pcm: Vec<u8> = Vec::new();
    let mut rate_ch: Option<(u32, u32)> = None;

    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(SymphErr::IoError(e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(SymphErr::ResetRequired) => continue,
            Err(e) => return Err(AppError::Encoding(format!("Read failed: {}", e))),
        };

        if packet.track_id() != track_id {
            continue;
        }

        let decoded = decoder
            .decode(&packet)
            .map_err(|e| AppError::Encoding(format!("Decode failed: {}", e)))?;

        let (r, ch) = append_decoded_pcm(&decoded, &mut pcm)?;
        match rate_ch {
            None => rate_ch = Some((r, ch)),
            Some((pr, pch)) if pr == r && pch == ch => {}
            Some(_) => {
                return Err(AppError::Encoding(
                    "Inconsistent audio format within track".into(),
                ));
            }
        }
    }

    let (sr, ch) = rate_ch.unwrap_or((44100, 1));
    if pcm.is_empty() {
        return Err(AppError::Encoding("Decoded no PCM from track".into()));
    }
    Ok((pcm, sr, ch))
}

/// Export all audiobook tracks as one concatenated MP3 file (basic: one MP3 frame stream per track appended).
#[tauri::command]
pub async fn export_as_mp3(
    book_id: String,
    output_path: String,
    app: tauri::AppHandle,
) -> AppResult<()> {
    if MP3_EXPORT_IN_PROGRESS
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err(AppError::Store(
            "Another MP3 export is already in progress. Please wait for it to finish."
                .to_string(),
        ));
    }

    set_mp3_export_active(Some(book_id.clone()));

    struct Mp3ExportLockGuard;
    impl Drop for Mp3ExportLockGuard {
        fn drop(&mut self) {
            set_mp3_export_active(None);
            MP3_EXPORT_IN_PROGRESS.store(false, Ordering::Release);
        }
    }
    let _guard = Mp3ExportLockGuard;

    let db = get_db_connection(&app).await.map_err(|e| AppError::Store(e))?;

    let book = BookRepository::find_by_id(db.as_ref(), &book_id)
        .await
        .map_err(|e| AppError::Store(e))?
        .ok_or_else(|| AppError::Store(format!("Book not found: {}", book_id)))?;

    let mut sorted_tracks = book.audio_tracks.clone();
    sorted_tracks.sort_by_key(|t| t.order);
    let total_tracks = sorted_tracks.len();
    let started = Instant::now();

    let emit = |step: &str,
                message: String,
                processed: usize,
                total: usize,
                percent: u8,
                eta_ms: Option<u64>| {
        let _ = app.emit(
            "mp3-export-progress",
            Mp3ExportProgress {
                book_id: book_id.clone(),
                current_step: step.to_string(),
                message,
                processed_tracks: processed,
                total_tracks: total,
                percent,
                eta_ms,
            },
        );
    };

    emit(
        "initializing",
        "Starting MP3 export...".to_string(),
        0,
        total_tracks,
        0,
        None,
    );

    let mut out_file = std::fs::File::create(&output_path)
        .map_err(|e| AppError::Store(format!("Failed to create output file: {}", e)))?;

    let mut wrote_any = false;
    let mut missing = 0usize;

    for (index, track) in sorted_tracks.iter().enumerate() {
        match AudioRepository::resolve_track_audio_bytes(db.as_ref(), &book_id, &track.id).await {
            Ok(Some((audio_bytes, href))) => {
                emit(
                    "extracting-audio",
                    format!("Decoding track {}/{}", index + 1, total_tracks),
                    index,
                    total_tracks,
                    if total_tracks > 0 {
                        ((index * 50) / total_tracks).min(49) as u8
                    } else {
                        0
                    },
                    None,
                );

                let (pcm, sample_rate, channels) = match decode_audio_blob_to_pcm(&audio_bytes, &href) {
                    Ok(v) => v,
                    Err(e) => {
                        log::warn!("Skipping track {} ({}): {}", track.id, href, e);
                        missing += 1;
                        continue;
                    }
                };

                emit(
                    "encoding-mp3",
                    format!("Encoding track {}/{}", index + 1, total_tracks),
                    index + 1,
                    total_tracks,
                    if total_tracks > 0 {
                        (50 + ((index + 1) * 49) / total_tracks).min(99) as u8
                    } else {
                        0
                    },
                    None,
                );

                let mp3_chunk = encode_pcm_to_mp3_bytes(
                    pcm,
                    sample_rate,
                    channels,
                    Some(DEFAULT_MP3_BITRATE),
                )?;

                out_file
                    .write_all(&mp3_chunk)
                    .map_err(|e| AppError::Store(format!("Failed to write MP3 data: {}", e)))?;
                wrote_any = true;
            }
            Ok(None) => {
                missing += 1;
                log::warn!("Missing audio track id='{}'", track.id);
            }
            Err(e) => {
                missing += 1;
                log::warn!("Unreadable track id='{}': {}", track.id, e);
            }
        }

        let processed = index + 1;
        let eta_ms = if total_tracks > 0 && processed > 0 {
            let elapsed_ms = started.elapsed().as_millis() as f64;
            let f = processed as f64 / total_tracks as f64;
            if f > 0.0 {
                let est = elapsed_ms / f;
                Some((est - elapsed_ms).max(0.0).round() as u64)
            } else {
                None
            }
        } else {
            None
        };
        emit(
            "encoding-mp3",
            format!("Processed {} / {} tracks", processed, total_tracks),
            processed,
            total_tracks,
            if total_tracks > 0 {
                (50 + (processed * 49) / total_tracks).min(99) as u8
            } else {
                0
            },
            eta_ms,
        );
    }

    if !wrote_any {
        return Err(AppError::Store(format!(
            "No exportable audio tracks ({} missing or failed)",
            missing
        )));
    }

    emit(
        "completed",
        "MP3 export complete".to_string(),
        total_tracks,
        total_tracks,
        100,
        Some(0),
    );

    log::info!("MP3 export completed: {}", output_path);
    Ok(())
}
