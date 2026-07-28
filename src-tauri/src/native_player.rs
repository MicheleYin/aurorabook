//! Native AVPlayer bridge for iOS.
//!
//! On iOS the WebView's `<audio>` element is backed by an HTTP server that iOS
//! kills when the app is backgrounded. This module drives `AVPlayer` directly
//! through a Swift bridge, giving us:
//!
//!  * Playback that survives backgrounding (AVAudioSession .playback category)
//!  * Working lock-screen / Control-Centre controls (MPRemoteCommandCenter)
//!  * No dependency on the local streaming server staying alive
//!
//! # Bridge design
//!
//! Swift (`NativePlayer.swift`) exports `@_cdecl` C-compatible functions.
//! Rust declares them as `extern "C"` and calls them directly after linking.
//! Swift calls the Rust symbol `on_native_player_event` via `@_silgen_name`.

#![cfg_attr(not(target_os = "ios"), allow(dead_code, unused_variables))]

use std::ffi::CString;
use std::sync::OnceLock;

use serde_json::json;
use tauri::{AppHandle, Emitter, Manager};

use crate::utils::errors::{AppError, AppResult};

// ─── Global AppHandle (set once at init) ─────────────────────────────────────

static PLAYER_APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

// ─── Swift FFI declarations ───────────────────────────────────────────────────

#[cfg(target_os = "ios")]
extern "C" {
    fn aurora_player_load(
        file_path: *const std::ffi::c_char,
        title: *const std::ffi::c_char,
        artist: *const std::ffi::c_char,
        duration: f64,
    );
    fn aurora_player_play();
    fn aurora_player_pause();
    fn aurora_player_seek(seconds: f64);
    fn aurora_player_set_rate(rate: f32);
    fn aurora_player_current_time() -> f64;
    fn aurora_player_is_playing() -> bool;
}

// ─── Rust callback (called by Swift's MPRemoteCommandCenter handlers) ─────────

/// event_type codes:
///   1=play  2=pause  3=seek(value=secs)  4=next  5=prev
///   6=timeUpdate(value=secs)  7=ended
pub(crate) fn native_player_event_payload(
    event_type: u8,
    value: f64,
) -> Option<serde_json::Value> {
    match event_type {
        1 => Some(json!({ "type": "play" })),
        2 => Some(json!({ "type": "pause" })),
        3 => Some(json!({ "type": "seek", "time": value })),
        4 => Some(json!({ "type": "next" })),
        5 => Some(json!({ "type": "prev" })),
        6 => Some(json!({ "type": "timeUpdate", "time": value })),
        7 => Some(json!({ "type": "ended" })),
        _ => None,
    }
}

/// Swift calls this via `@_silgen_name("on_native_player_event")`.
///
/// event_type codes:
///   1=play  2=pause  3=seek(value=secs)  4=next  5=prev
///   6=timeUpdate(value=secs)  7=ended
#[no_mangle]
pub extern "C" fn on_native_player_event(event_type: u8, value: f64) {
    let Some(app) = PLAYER_APP_HANDLE.get() else {
        return;
    };

    let Some(payload) = native_player_event_payload(event_type, value) else {
        return;
    };

    let _ = app.emit("native-player-event", payload);
}

// ─── Initialise ───────────────────────────────────────────────────────────────

/// Call once during app setup to store the `AppHandle` for event emission.
pub fn init(app: &AppHandle) {
    let _ = PLAYER_APP_HANDLE.set(app.clone());
}

// ─── Audio cache helper ───────────────────────────────────────────────────────

/// Resolve audio bytes and write them to a stable cache path on disk.
/// Returns the path — AVPlayer requires a `file://` URL, not SQLite bytes.
#[cfg(target_os = "ios")]
async fn cache_track_file(
    app: &AppHandle,
    book_id: &str,
    track_id: &str,
) -> AppResult<std::path::PathBuf> {
    use crate::book_service::{database::get_db_connection, repositories::AudioRepository};

    let cache_dir = app
        .path()
        .cache_dir()
        .map_err(|e| AppError::Store(format!("cache_dir unavailable: {e}")))?
        .join("aurora_player");

    tokio::fs::create_dir_all(&cache_dir)
        .await
        .map_err(|e| AppError::Store(format!("Failed to create player cache dir: {e}")))?;

    let db = get_db_connection(app).await?;
    let Some((bytes, href)) =
        AudioRepository::resolve_track_audio_bytes(db.as_ref(), book_id, track_id)
            .await
            .map_err(AppError::Store)?
    else {
        return Err(AppError::Store(format!(
            "Audio track not found: book={book_id} track={track_id}"
        )));
    };

    let ext = std::path::Path::new(&href)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("mp3");

    let file_path = cache_dir.join(format!("{track_id}.{ext}"));

    // Skip the write if an identically-sized file already exists.
    if let Ok(meta) = tokio::fs::metadata(&file_path).await {
        if meta.len() == bytes.len() as u64 {
            return Ok(file_path);
        }
    }

    tokio::fs::write(&file_path, &bytes)
        .await
        .map_err(|e| AppError::Store(format!("Failed to write audio cache file: {e}")))?;

    Ok(file_path)
}

// ─── Tauri commands ───────────────────────────────────────────────────────────

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IosPlayerLoadOptions {
    pub book_id: String,
    pub track_id: String,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub duration: Option<f64>,
}

/// Cache audio to disk and hand it to AVPlayer (iOS only; no-op on other platforms).
#[tauri::command]
pub async fn ios_player_load(options: IosPlayerLoadOptions, app: AppHandle) -> AppResult<()> {
    #[cfg(target_os = "ios")]
    {
        let file_path = cache_track_file(&app, &options.book_id, &options.track_id).await?;
        let path_str = file_path.to_string_lossy();

        let c_path = CString::new(path_str.as_bytes())
            .map_err(|e| AppError::Store(format!("Invalid path string: {e}")))?;
        let c_title = CString::new(options.title.unwrap_or_default().as_str())
            .map_err(|e| AppError::Store(format!("Invalid title string: {e}")))?;
        let c_artist = CString::new(options.artist.unwrap_or_default().as_str())
            .map_err(|e| AppError::Store(format!("Invalid artist string: {e}")))?;

        // SAFETY: `c_path`, `c_title`, and `c_artist` are valid NUL-terminated CStrings
        // that live for the duration of this call. `aurora_player_load` is a `@_cdecl`
        // Swift function with a well-defined signature that only reads the pointers.
        unsafe {
            aurora_player_load(
                c_path.as_ptr(),
                c_title.as_ptr(),
                c_artist.as_ptr(),
                options.duration.unwrap_or(0.0),
            );
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn ios_player_play() -> AppResult<()> {
    #[cfg(target_os = "ios")]
    // SAFETY: `aurora_player_play` is a `@_cdecl` Swift function with no pointer args.
    unsafe {
        aurora_player_play();
    }
    Ok(())
}

#[tauri::command]
pub async fn ios_player_pause() -> AppResult<()> {
    #[cfg(target_os = "ios")]
    // SAFETY: `aurora_player_pause` is a `@_cdecl` Swift function with no pointer args.
    unsafe {
        aurora_player_pause();
    }
    Ok(())
}

#[tauri::command]
pub async fn ios_player_seek(seconds: f64) -> AppResult<()> {
    #[cfg(target_os = "ios")]
    // SAFETY: `aurora_player_seek` is a `@_cdecl` Swift function with a plain f64 arg.
    unsafe {
        aurora_player_seek(seconds);
    }
    Ok(())
}

#[tauri::command]
pub async fn ios_player_set_rate(rate: f32) -> AppResult<()> {
    #[cfg(target_os = "ios")]
    // SAFETY: `aurora_player_set_rate` is a `@_cdecl` Swift function with a plain f32 arg.
    unsafe {
        aurora_player_set_rate(rate);
    }
    Ok(())
}

#[tauri::command]
pub async fn ios_player_current_time() -> AppResult<f64> {
    // SAFETY: `aurora_player_current_time` is a `@_cdecl` Swift function returning a plain f64.
    #[cfg(target_os = "ios")]
    return Ok(unsafe { aurora_player_current_time() });
    #[cfg(not(target_os = "ios"))]
    Ok(0.0)
}

#[tauri::command]
pub async fn ios_player_is_playing() -> AppResult<bool> {
    // SAFETY: `aurora_player_is_playing` is a `@_cdecl` Swift function returning a plain bool.
    #[cfg(target_os = "ios")]
    return Ok(unsafe { aurora_player_is_playing() });
    #[cfg(not(target_os = "ios"))]
    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn maps_all_known_native_player_event_codes() {
        assert_eq!(
            native_player_event_payload(1, 0.0),
            Some(json!({ "type": "play" }))
        );
        assert_eq!(
            native_player_event_payload(2, 0.0),
            Some(json!({ "type": "pause" }))
        );
        assert_eq!(
            native_player_event_payload(3, 12.5),
            Some(json!({ "type": "seek", "time": 12.5 }))
        );
        assert_eq!(
            native_player_event_payload(4, 0.0),
            Some(json!({ "type": "next" }))
        );
        assert_eq!(
            native_player_event_payload(5, 0.0),
            Some(json!({ "type": "prev" }))
        );
        assert_eq!(
            native_player_event_payload(6, 3.25),
            Some(json!({ "type": "timeUpdate", "time": 3.25 }))
        );
        assert_eq!(
            native_player_event_payload(7, 0.0),
            Some(json!({ "type": "ended" }))
        );
    }

    #[test]
    fn ignores_unknown_native_player_event_codes() {
        assert_eq!(native_player_event_payload(0, 1.0), None);
        assert_eq!(native_player_event_payload(8, 1.0), None);
        assert_eq!(native_player_event_payload(255, 1.0), None);
    }

    #[tokio::test]
    async fn non_ios_player_commands_are_safe_noops() {
        assert!(ios_player_play().await.is_ok());
        assert!(ios_player_pause().await.is_ok());
        assert!(ios_player_seek(1.5).await.is_ok());
        assert!(ios_player_set_rate(1.25).await.is_ok());
        assert_eq!(ios_player_current_time().await.unwrap(), 0.0);
        assert!(!ios_player_is_playing().await.unwrap());
    }

    #[test]
    fn deserializes_ios_player_load_options_camel_case() {
        let options: IosPlayerLoadOptions = serde_json::from_value(json!({
            "bookId": "b1",
            "trackId": "t1",
            "title": "Chapter 1",
            "artist": "Author",
            "duration": 120.5
        }))
        .unwrap();
        assert_eq!(options.book_id, "b1");
        assert_eq!(options.track_id, "t1");
        assert_eq!(options.title.as_deref(), Some("Chapter 1"));
        assert_eq!(options.artist.as_deref(), Some("Author"));
        assert_eq!(options.duration, Some(120.5));
    }
}

