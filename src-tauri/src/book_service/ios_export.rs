//! iOS audiobook export without FFmpeg.
//!
//! * **MP3** — in-process byte-concat of chapter MP3 tracks (LAME-encoded at conversion).
//! * **M4A / M4B** — AVFoundation via `swift/AudiobookExporter.swift`.

#![cfg_attr(not(target_os = "ios"), allow(dead_code, unused_variables))]

use crate::utils::errors::{AppError, AppResult};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};

#[cfg(target_os = "ios")]
use std::time::Duration;

static IOS_EXPORT_CANCEL: AtomicBool = AtomicBool::new(false);
static IOS_EXPORT_PROGRESS: AtomicU8 = AtomicU8::new(0);

/// Called from Swift during AVFoundation export.
#[no_mangle]
pub extern "C" fn on_aurora_export_progress(percent: u8) {
    IOS_EXPORT_PROGRESS.store(percent, Ordering::Relaxed);
}

/// Polled by Swift to honor cancel from Rust / UI.
#[no_mangle]
pub extern "C" fn aurora_export_is_cancelled() -> bool {
    IOS_EXPORT_CANCEL.load(Ordering::Acquire)
}

pub fn reset_ios_export_cancel() {
    IOS_EXPORT_CANCEL.store(false, Ordering::Release);
    IOS_EXPORT_PROGRESS.store(0, Ordering::Relaxed);
}

pub fn request_ios_export_cancel() {
    IOS_EXPORT_CANCEL.store(true, Ordering::Release);
}

pub fn ios_export_cancel_requested() -> bool {
    IOS_EXPORT_CANCEL.load(Ordering::Acquire)
}

pub fn ios_export_progress_percent() -> u8 {
    IOS_EXPORT_PROGRESS.load(Ordering::Relaxed)
}

#[cfg(target_os = "ios")]
extern "C" {
    fn aurora_export_audiobook(
        track_paths_json: *const std::ffi::c_char,
        chapter_titles_json: *const std::ffi::c_char,
        format: *const std::ffi::c_char,
        title: *const std::ffi::c_char,
        artist: *const std::ffi::c_char,
        album: *const std::ffi::c_char,
        output_path: *const std::ffi::c_char,
    ) -> i32;
}

#[derive(Debug, Clone)]
pub struct IosPreparedTrack {
    pub path: std::path::PathBuf,
    pub title: String,
    pub duration_seconds: Option<f64>,
}

/// Concatenate already-encoded MP3 chapter files into one MP3 (no re-encode).
pub fn export_mp3_byte_concat(
    output_path: &str,
    tracks: &[IosPreparedTrack],
    mut on_progress: impl FnMut(u8, usize, usize, String),
) -> AppResult<()> {
    if tracks.is_empty() {
        return Err(AppError::Store(
            "No exportable audio tracks found for MP3 export".to_string(),
        ));
    }

    let mut out: Vec<u8> = Vec::new();
    let total = tracks.len();

    for (index, track) in tracks.iter().enumerate() {
        if ios_export_cancel_requested() {
            return Err(AppError::Encoding("Audio export cancelled".to_string()));
        }

        let bytes = std::fs::read(&track.path).map_err(|e| {
            AppError::Store(format!(
                "Failed to read track for MP3 export ({}): {}",
                track.path.display(),
                e
            ))
        })?;

        if !looks_like_mp3(&bytes) {
            return Err(AppError::Encoding(format!(
                "Track '{}' is not an MP3 bitstream. Re-convert the book or export as M4A/M4B.",
                track.title
            )));
        }

        out.extend_from_slice(&bytes);
        let percent = ((index + 1) * 100 / total).min(99) as u8;
        on_progress(
            percent,
            index + 1,
            total,
            format!("Concatenating track {}/{}", index + 1, total),
        );
    }

    if ios_export_cancel_requested() {
        return Err(AppError::Encoding("Audio export cancelled".to_string()));
    }

    if let Some(parent) = Path::new(output_path).parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    std::fs::write(output_path, &out).map_err(|e| {
        AppError::Store(format!(
            "Failed to write MP3 export to {}: {}",
            output_path, e
        ))
    })?;

    on_progress(100, total, total, "MP3 export complete".to_string());
    Ok(())
}

fn looks_like_mp3(bytes: &[u8]) -> bool {
    if bytes.len() < 4 {
        return false;
    }
    // ID3v2 tag
    if bytes.starts_with(b"ID3") {
        return true;
    }
    // MPEG frame sync
    bytes[0] == 0xff && (bytes[1] & 0xe0) == 0xe0
}

/// Export M4A or M4B via AVFoundation.
///
/// Runs the Swift FFI on a worker thread and polls `IOS_EXPORT_PROGRESS` on the
/// calling thread so progress callbacks do not need to be `'static`.
#[cfg(target_os = "ios")]
pub fn export_m4a_m4b_avfoundation(
    output_path: &str,
    tracks: &[IosPreparedTrack],
    format: &str, // "m4a" | "m4b"
    title: &str,
    artist: &str,
    album: &str,
    mut on_progress: impl FnMut(u8),
) -> AppResult<()> {
    if tracks.is_empty() {
        return Err(AppError::Store(
            "No exportable audio tracks found for MP4 export".to_string(),
        ));
    }

    let paths: Vec<String> = tracks
        .iter()
        .map(|t| t.path.to_string_lossy().into_owned())
        .collect();
    let titles: Vec<String> = tracks.iter().map(|t| t.title.clone()).collect();

    let paths_json = serde_json::to_string(&paths)
        .map_err(|e| AppError::Encoding(format!("Failed to serialize track paths: {e}")))?;
    let titles_json = serde_json::to_string(&titles)
        .map_err(|e| AppError::Encoding(format!("Failed to serialize chapter titles: {e}")))?;

    let c_paths = std::ffi::CString::new(paths_json)
        .map_err(|_| AppError::Encoding("Track paths contain NUL".into()))?;
    let c_titles = std::ffi::CString::new(titles_json)
        .map_err(|_| AppError::Encoding("Chapter titles contain NUL".into()))?;
    let c_format = std::ffi::CString::new(format)
        .map_err(|_| AppError::Encoding("Format contains NUL".into()))?;
    let c_title = std::ffi::CString::new(title)
        .map_err(|_| AppError::Encoding("Title contains NUL".into()))?;
    let c_artist = std::ffi::CString::new(artist)
        .map_err(|_| AppError::Encoding("Artist contains NUL".into()))?;
    let c_album = std::ffi::CString::new(album)
        .map_err(|_| AppError::Encoding("Album contains NUL".into()))?;
    let c_out = std::ffi::CString::new(output_path)
        .map_err(|_| AppError::Encoding("Output path contains NUL".into()))?;

    IOS_EXPORT_PROGRESS.store(0, Ordering::Relaxed);
    on_progress(0);

    // SAFETY: All `CString` values are valid NUL-terminated UTF-8 and live for
    // the duration of `aurora_export_audiobook` (they are moved into the worker
    // thread and dropped after the FFI returns). The Swift `@_cdecl` entry point
    // only reads the pointers; it does not retain them past the call.
    let join = std::thread::spawn(move || {
        // Codacy: audited Swift @_cdecl FFI — same bridge pattern as native_player.rs.
        unsafe {
            aurora_export_audiobook(
                c_paths.as_ptr(),
                c_titles.as_ptr(),
                c_format.as_ptr(),
                c_title.as_ptr(),
                c_artist.as_ptr(),
                c_album.as_ptr(),
                c_out.as_ptr(),
            )
        }
    });

    let mut last = 0u8;
    while !join.is_finished() {
        let p = IOS_EXPORT_PROGRESS.load(Ordering::Relaxed);
        if p != last {
            last = p;
            on_progress(p);
        }
        std::thread::sleep(Duration::from_millis(100));
    }

    let code = join
        .join()
        .map_err(|_| AppError::Encoding("AVFoundation export thread panicked".into()))?;

    match code {
        0 => {
            on_progress(100);
            Ok(())
        }
        2 => Err(AppError::Encoding("Audio export cancelled".to_string())),
        _ => Err(AppError::Encoding(format!(
            "AVFoundation {} export failed (code {})",
            format.to_uppercase(),
            code
        ))),
    }
}

#[cfg(not(target_os = "ios"))]
pub fn export_m4a_m4b_avfoundation(
    _output_path: &str,
    _tracks: &[IosPreparedTrack],
    _format: &str,
    _title: &str,
    _artist: &str,
    _album: &str,
    _on_progress: impl FnMut(u8),
) -> AppResult<()> {
    Err(AppError::Encoding(
        "AVFoundation export is only available on iOS".into(),
    ))
}

/// Formats this build can export (parity: MP3 / M4A / M4B on all targets).
#[tauri::command]
pub fn get_supported_audio_export_formats() -> Vec<String> {
    vec![
        "mp3".to_string(),
        "m4a".to_string(),
        "m4b".to_string(),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_mp3_frame_sync_and_id3() {
        assert!(looks_like_mp3(&[0xff, 0xfb, 0x90, 0x00]));
        assert!(looks_like_mp3(b"ID3\x03\x00\x00\x00"));
        assert!(!looks_like_mp3(b"RIFF"));
        assert!(!looks_like_mp3(&[]));
    }

    #[test]
    fn byte_concat_writes_ordered_mp3() {
        let dir = tempfile::tempdir().unwrap();
        let t1 = dir.path().join("a.mp3");
        let t2 = dir.path().join("b.mp3");
        // Minimal fake frames with sync headers
        std::fs::write(&t1, [0xff, 0xfb, 0x90, 0x00, 1, 2]).unwrap();
        std::fs::write(&t2, [0xff, 0xfb, 0x90, 0x00, 3, 4]).unwrap();
        let out = dir.path().join("out.mp3");
        export_mp3_byte_concat(
            out.to_str().unwrap(),
            &[
                IosPreparedTrack {
                    path: t1,
                    title: "A".into(),
                    duration_seconds: Some(1.0),
                },
                IosPreparedTrack {
                    path: t2,
                    title: "B".into(),
                    duration_seconds: Some(1.0),
                },
            ],
            |_, _, _, _| {},
        )
        .unwrap();
        let bytes = std::fs::read(&out).unwrap();
        assert_eq!(
            bytes,
            [0xff, 0xfb, 0x90, 0x00, 1, 2, 0xff, 0xfb, 0x90, 0x00, 3, 4]
        );
    }

    #[test]
    fn byte_concat_rejects_non_mp3() {
        let dir = tempfile::tempdir().unwrap();
        let t1 = dir.path().join("a.wav");
        std::fs::write(&t1, b"RIFF....WAVE").unwrap();
        let out = dir.path().join("out.mp3");
        let err = export_mp3_byte_concat(
            out.to_str().unwrap(),
            &[IosPreparedTrack {
                path: t1,
                title: "Bad".into(),
                duration_seconds: None,
            }],
            |_, _, _, _| {},
        )
        .unwrap_err();
        assert!(err.to_string().contains("not an MP3"));
    }
}
