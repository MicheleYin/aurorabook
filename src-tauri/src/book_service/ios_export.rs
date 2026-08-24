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
    fn aurora_export_last_error() -> *mut std::ffi::c_char;
    fn aurora_export_free_string(ptr: *mut std::ffi::c_char);
    fn aurora_place_export_file(
        source_path: *const std::ffi::c_char,
        destination_path_or_url: *const std::ffi::c_char,
    ) -> i32;
    fn aurora_place_export_last_error() -> *mut std::ffi::c_char;
    fn aurora_place_export_free_string(ptr: *mut std::ffi::c_char);
    fn aurora_share_file(file_path: *const std::ffi::c_char) -> i32;
    fn aurora_share_last_error() -> *mut std::ffi::c_char;
    fn aurora_share_free_string(ptr: *mut std::ffi::c_char);
}

#[cfg(target_os = "ios")]
fn take_c_string(ptr: *mut std::ffi::c_char, free_fn: unsafe extern "C" fn(*mut std::ffi::c_char)) -> Option<String> {
    if ptr.is_null() {
        return None;
    }
    // SAFETY: paired with Swift strdup + free helpers.
    unsafe {
        let msg = std::ffi::CStr::from_ptr(ptr)
            .to_string_lossy()
            .into_owned();
        free_fn(ptr);
        if msg.is_empty() {
            None
        } else {
            Some(msg)
        }
    }
}

#[cfg(target_os = "ios")]
fn take_ios_export_last_error() -> Option<String> {
    // SAFETY: Swift returns a strdup'd C string or null.
    unsafe { take_c_string(aurora_export_last_error(), aurora_export_free_string) }
}

#[cfg(target_os = "ios")]
fn take_place_export_last_error() -> Option<String> {
    // SAFETY: Swift returns a strdup'd C string or null.
    unsafe { take_c_string(aurora_place_export_last_error(), aurora_place_export_free_string) }
}

#[cfg(target_os = "ios")]
fn take_share_last_error() -> Option<String> {
    // SAFETY: Swift returns a strdup'd C string or null.
    unsafe { take_c_string(aurora_share_last_error(), aurora_share_free_string) }
}

/// Build a writable sandbox path under Documents/Exports for iOS exports.
///
/// Tauri's `save()` dialog returns File Provider URLs that Rust/`std::fs` cannot
/// create (ENOENT). Write into the app container instead, then present Share.
#[cfg(target_os = "ios")]
pub fn resolve_ios_sandbox_export_path(
    app: &tauri::AppHandle,
    suggested_name_or_path: &str,
    fallback_stem: &str,
    extension: &str,
) -> AppResult<std::path::PathBuf> {
    use crate::utils::path_resolver::ResourcePathResolver;
    use tauri::Manager;

    let docs = app
        .path()
        .document_dir()
        .map_err(|e| AppError::Store(format!("document_dir unavailable: {e}")))?;
    let exports = docs.join("Exports");
    std::fs::create_dir_all(&exports).map_err(|e| {
        AppError::Store(format!(
            "Failed to create Exports directory {}: {}",
            exports.display(),
            e
        ))
    })?;

    let normalized = ResourcePathResolver::normalize_file_path(suggested_name_or_path);
    let raw_name = Path::new(&normalized)
        .file_name()
        .and_then(|s| s.to_str())
        .filter(|s| !s.is_empty())
        .unwrap_or(fallback_stem);

    let mut stem = Path::new(raw_name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(fallback_stem)
        .to_string();
    if stem.trim().is_empty() {
        stem = fallback_stem.to_string();
    }
    // Keep filenames Files-friendly.
    let safe: String = stem
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => c,
        })
        .collect();
    let file_name = format!("{safe}.{extension}");
    Ok(exports.join(file_name))
}

/// Present the iOS share sheet for a sandbox file.
#[cfg(target_os = "ios")]
pub fn share_exported_file(path: &Path) -> AppResult<()> {
    let c_path = std::ffi::CString::new(path.to_string_lossy().as_ref())
        .map_err(|_| AppError::Encoding("Share path contains NUL".into()))?;
    // SAFETY: Swift @_cdecl reads the pointer only for the duration of the call.
    let code = unsafe { aurora_share_file(c_path.as_ptr()) };
    if code == 0 {
        return Ok(());
    }
    let detail = take_share_last_error().unwrap_or_else(|| format!("share failed (code {code})"));
    Err(AppError::Store(format!(
        "Failed to present share sheet for {}: {}",
        path.display(),
        detail
    )))
}

#[cfg(not(target_os = "ios"))]
pub fn resolve_ios_sandbox_export_path(
    _app: &tauri::AppHandle,
    _suggested_name_or_path: &str,
    _fallback_stem: &str,
    _extension: &str,
) -> AppResult<std::path::PathBuf> {
    Err(AppError::Store(
        "resolve_ios_sandbox_export_path is iOS-only".into(),
    ))
}

#[cfg(not(target_os = "ios"))]
pub fn share_exported_file(_path: &Path) -> AppResult<()> {
    Ok(())
}

/// Write/copy a sandbox file to a user-chosen destination.
///
/// On iOS the destination is often a security-scoped `file://` URL from the save
/// dialog (File Provider Storage). Use Swift URL + NSFileCoordinator rather than
/// Rust `std::fs` against the path string.
#[cfg(target_os = "ios")]
pub fn place_export_file(source: &Path, destination_raw: &str) -> AppResult<()> {
    let c_source = std::ffi::CString::new(source.to_string_lossy().as_ref())
        .map_err(|_| AppError::Encoding("Source path contains NUL".into()))?;
    let c_dest = std::ffi::CString::new(destination_raw)
        .map_err(|_| AppError::Encoding("Destination path contains NUL".into()))?;

    // SAFETY: Swift @_cdecl reads the pointers only for the duration of the call.
    let code = unsafe { aurora_place_export_file(c_source.as_ptr(), c_dest.as_ptr()) };
    if code == 0 {
        return Ok(());
    }
    let detail = take_place_export_last_error()
        .unwrap_or_else(|| format!("place failed (code {code})"));
    Err(AppError::Store(format!(
        "Failed to write export to {}: {}",
        destination_raw, detail
    )))
}

#[cfg(not(target_os = "ios"))]
pub fn place_export_file(source: &Path, destination_raw: &str) -> AppResult<()> {
    use crate::utils::path_resolver::ResourcePathResolver;
    let dest = ResourcePathResolver::prepare_writable_output_path(destination_raw)?;
    if dest.exists() {
        let _ = std::fs::remove_file(&dest);
    }
    std::fs::copy(source, &dest).map_err(|e| {
        AppError::Store(format!(
            "Failed to write export to {}: {}",
            dest.display(),
            e
        ))
    })?;
    Ok(())
}

#[derive(Debug, Clone)]
pub struct IosPreparedTrack {
    pub path: std::path::PathBuf,
    pub title: String,
    pub duration_seconds: Option<f64>,
}

/// Concatenate already-encoded MP3 chapter files into one MP3 (no re-encode).
///
/// `output_path` may be a plain path or an iOS `file://` save-dialog URL. The
/// bitstream is always written to a sandbox temp file first, then placed at the
/// destination (security-scoped copy on iOS).
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

    let temp = tempfile::Builder::new()
        .suffix(".mp3")
        .tempfile()
        .map_err(|e| AppError::Store(format!("Failed to create MP3 export temp file: {e}")))?;
    std::fs::write(temp.path(), &out).map_err(|e| {
        AppError::Store(format!(
            "Failed to write MP3 export temp {}: {}",
            temp.path().display(),
            e
        ))
    })?;

    // Prefer direct write into the app sandbox. Only use security-scoped placement
    // when the destination is still a `file://` URL from an old save-dialog flow.
    if output_path.trim().to_ascii_lowercase().starts_with("file:") {
        place_export_file(temp.path(), output_path)?;
    } else {
        let dest = Path::new(output_path);
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent).map_err(|e| {
                AppError::Store(format!(
                    "Failed to create export directory {}: {}",
                    parent.display(),
                    e
                ))
            })?;
        }
        std::fs::copy(temp.path(), dest).map_err(|e| {
            AppError::Store(format!(
                "Failed to write MP3 export to {}: {}",
                dest.display(),
                e
            ))
        })?;
    }

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
        _ => {
            let detail = take_ios_export_last_error()
                .unwrap_or_else(|| format!("code {code}"));
            Err(AppError::Encoding(format!(
                "AVFoundation {} export failed: {}",
                format.to_uppercase(),
                detail
            )))
        }
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
