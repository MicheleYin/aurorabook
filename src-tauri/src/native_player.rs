//! Native AVPlayer bridge for iOS.
//!
//! On iOS the WebView's `<audio>` element is backed by an HTTP server that iOS
//! kills when the app is backgrounded. This module drives `AVPlayer` directly
//! through a Swift bridge, giving us:
//!
//!  * Playback that survives backgrounding (AVAudioSession .playback category)
//!  * Working lock-screen / Control-Centre controls (MPRemoteCommandCenter)
//!  * No dependency on the local streaming server staying alive
//!  * Live chapters via a growing on-disk MP3 that AVPlayer can reload as it extends
//!
//! # Bridge design
//!
//! Swift (`swift/NativePlayer.swift`) exports `@_cdecl` C-compatible functions.
//! Rust declares them as `extern "C"` and calls them directly after linking.
//! Swift calls the Rust symbol `on_native_player_event` via `@_silgen_name`.

#![cfg_attr(not(target_os = "ios"), allow(dead_code, unused_variables))]

use std::ffi::CString;
use std::path::PathBuf;
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
        expects_more: bool,
        cover_path: *const std::ffi::c_char,
    );
    fn aurora_player_notify_file_extended(duration: f64);
    fn aurora_player_set_expects_more(expects_more: bool);
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
///   6=timeUpdate(value=secs)  7=ended  8=durationUpdate(value=secs)
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
        8 => Some(json!({ "type": "durationUpdate", "time": value })),
        _ => None,
    }
}

/// Swift calls this via `@_silgen_name("on_native_player_event")`.
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

// ─── Cache helpers ────────────────────────────────────────────────────────────

fn player_cache_dir(app: &AppHandle) -> AppResult<PathBuf> {
    let cache_dir = app
        .path()
        .cache_dir()
        .map_err(|e| AppError::Store(format!("cache_dir unavailable: {e}")))?
        .join("aurora_player");

    Ok(cache_dir)
}

/// Resolve audio bytes and write them to a stable cache path on disk.
/// Returns the path — AVPlayer requires a `file://` URL, not SQLite bytes.
#[cfg(target_os = "ios")]
async fn cache_track_file(
    app: &AppHandle,
    book_id: &str,
    track_id: &str,
) -> AppResult<PathBuf> {
    use crate::book_service::{database::get_db_connection, repositories::AudioRepository};

    let cache_dir = player_cache_dir(app)?;
    tokio::fs::create_dir_all(&cache_dir)
        .await
        .map_err(|e| AppError::Store(format!("Failed to create player cache dir: {e}")))?;

    let db = get_db_connection(app).await.map_err(AppError::Store)?;
    let Some((bytes, href)) =
        AudioRepository::resolve_track_audio_bytes(db.as_ref(), app, book_id, track_id)
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

fn live_file_path(app: &AppHandle, book_id: &str, chapter_index: usize) -> AppResult<PathBuf> {
    let cache_dir = player_cache_dir(app)?;
    Ok(cache_dir.join(format!("live-{book_id}-{chapter_index}.mp3")))
}

/// Decode a `data:*;base64,...` (or raw base64) cover into a cache file for MPNowPlaying artwork.
async fn cache_cover_file(app: &AppHandle, book_id: &str, cover_url: &str) -> Option<PathBuf> {
    let cache_dir = player_cache_dir(app).ok()?;
    tokio::fs::create_dir_all(&cache_dir).await.ok()?;

    let (ext, b64) = if let Some(rest) = cover_url.strip_prefix("data:") {
        let (meta, data) = rest.split_once(',')?;
        let ext = if meta.contains("image/png") {
            "png"
        } else if meta.contains("image/webp") {
            "webp"
        } else if meta.contains("image/gif") {
            "gif"
        } else {
            "jpg"
        };
        if !meta.contains("base64") {
            return None;
        }
        (ext, data)
    } else {
        ("jpg", cover_url)
    };

    use base64::Engine as _;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64.trim())
        .ok()?;
    if bytes.is_empty() {
        return None;
    }

    let path = cache_dir.join(format!("cover-{book_id}.{ext}"));
    if let Ok(meta) = tokio::fs::metadata(&path).await {
        if meta.len() == bytes.len() as u64 {
            return Some(path);
        }
    }
    tokio::fs::write(&path, &bytes).await.ok()?;
    Some(path)
}

/// Write the contiguous live MP3 snapshot to disk. Returns (path, duration_seconds, byte_len).
async fn sync_live_file_to_disk(
    app: &AppHandle,
    book_id: &str,
    chapter_index: usize,
) -> AppResult<(PathBuf, f64, usize)> {
    use crate::book_service::audio_stream::get_live_stream_manager;

    let manager = get_live_stream_manager();
    let bytes = manager.snapshot_mp3(book_id, chapter_index);
    let duration = manager.duration_seconds(book_id, chapter_index);
    let path = live_file_path(app, book_id, chapter_index)?;

    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| AppError::Store(format!("Failed to create live player cache dir: {e}")))?;
    }

    let byte_len = bytes.len();
    // Always rewrite so AVPlayer reloads see a coherent contiguous prefix.
    tokio::fs::write(&path, &bytes)
        .await
        .map_err(|e| AppError::Store(format!("Failed to write live audio cache file: {e}")))?;

    Ok((path, duration, byte_len))
}

#[cfg(target_os = "ios")]
fn call_aurora_player_load(
    path: &str,
    title: &str,
    artist: &str,
    duration: f64,
    expects_more: bool,
    cover_path: &str,
) -> AppResult<()> {
    let c_path = CString::new(path.as_bytes())
        .map_err(|e| AppError::Store(format!("Invalid path string: {e}")))?;
    let c_title = CString::new(title)
        .map_err(|e| AppError::Store(format!("Invalid title string: {e}")))?;
    let c_artist = CString::new(artist)
        .map_err(|e| AppError::Store(format!("Invalid artist string: {e}")))?;
    let c_cover = CString::new(cover_path.as_bytes())
        .map_err(|e| AppError::Store(format!("Invalid cover path string: {e}")))?;

    // SAFETY: CStrings live for the duration of this call; Swift only reads the pointers.
    unsafe {
        aurora_player_load(
            c_path.as_ptr(),
            c_title.as_ptr(),
            c_artist.as_ptr(),
            duration,
            expects_more,
            c_cover.as_ptr(),
        );
    }
    Ok(())
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
    pub cover_url: Option<String>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IosPlayerLoadLiveOptions {
    pub book_id: String,
    pub chapter_index: usize,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub cover_url: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IosLivePlayerStatus {
    pub duration_seconds: f64,
    pub byte_length: usize,
}

/// Cache audio to disk and hand it to AVPlayer (iOS only; no-op on other platforms).
#[tauri::command]
pub async fn ios_player_load(options: IosPlayerLoadOptions, app: AppHandle) -> AppResult<()> {
    #[cfg(target_os = "ios")]
    {
        let file_path = cache_track_file(&app, &options.book_id, &options.track_id).await?;
        let cover_path = if let Some(ref cover) = options.cover_url {
            cache_cover_file(&app, &options.book_id, cover)
                .await
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_default()
        } else {
            String::new()
        };
        let path_str = file_path.to_string_lossy();
        call_aurora_player_load(
            path_str.as_ref(),
            options.title.as_deref().unwrap_or(""),
            options.artist.as_deref().unwrap_or(""),
            options.duration.unwrap_or(0.0),
            false,
            &cover_path,
        )?;
    }

    #[cfg(not(target_os = "ios"))]
    {
        let _ = (options, app);
    }

    Ok(())
}

/// Sync live chapter MP3 to disk and load it into AVPlayer (expects more content).
#[tauri::command]
pub async fn ios_player_load_live(
    options: IosPlayerLoadLiveOptions,
    app: AppHandle,
) -> AppResult<IosLivePlayerStatus> {
    let (file_path, duration, byte_len) =
        sync_live_file_to_disk(&app, &options.book_id, options.chapter_index).await?;

    #[cfg(target_os = "ios")]
    {
        let cover_path = if let Some(ref cover) = options.cover_url {
            cache_cover_file(&app, &options.book_id, cover)
                .await
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_default()
        } else {
            String::new()
        };
        let path_str = file_path.to_string_lossy();
        call_aurora_player_load(
            path_str.as_ref(),
            options.title.as_deref().unwrap_or(""),
            options.artist.as_deref().unwrap_or(""),
            duration,
            true,
            &cover_path,
        )?;
    }

    #[cfg(not(target_os = "ios"))]
    {
        let _ = file_path;
    }

    Ok(IosLivePlayerStatus {
        duration_seconds: duration,
        byte_length: byte_len,
    })
}

/// Rewrite the live file from the latest contiguous snapshot and notify AVPlayer.
#[tauri::command(rename_all = "camelCase")]
pub async fn ios_player_refresh_live(
    book_id: String,
    chapter_index: usize,
    app: AppHandle,
) -> AppResult<IosLivePlayerStatus> {
    let (_path, duration, byte_len) =
        sync_live_file_to_disk(&app, &book_id, chapter_index).await?;

    #[cfg(target_os = "ios")]
    // SAFETY: plain f64 FFI into Swift.
    unsafe {
        aurora_player_notify_file_extended(duration);
    }

    Ok(IosLivePlayerStatus {
        duration_seconds: duration,
        byte_length: byte_len,
    })
}

/// Mark whether the current item is still growing (live) or finished.
#[tauri::command(rename_all = "camelCase")]
pub async fn ios_player_set_expects_more(expects_more: bool) -> AppResult<()> {
    #[cfg(target_os = "ios")]
    // SAFETY: plain bool FFI into Swift.
    unsafe {
        aurora_player_set_expects_more(expects_more);
    }
    #[cfg(not(target_os = "ios"))]
    let _ = expects_more;
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

#[tauri::command(rename_all = "camelCase")]
pub async fn ios_player_seek(seconds: f64) -> AppResult<()> {
    #[cfg(target_os = "ios")]
    // SAFETY: `aurora_player_seek` is a `@_cdecl` Swift function with a plain f64 arg.
    unsafe {
        aurora_player_seek(seconds);
    }
    #[cfg(not(target_os = "ios"))]
    let _ = seconds;
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn ios_player_set_rate(rate: f32) -> AppResult<()> {
    #[cfg(target_os = "ios")]
    // SAFETY: `aurora_player_set_rate` is a `@_cdecl` Swift function with a plain f32 arg.
    unsafe {
        aurora_player_set_rate(rate);
    }
    #[cfg(not(target_os = "ios"))]
    let _ = rate;
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
        assert_eq!(
            native_player_event_payload(8, 42.0),
            Some(json!({ "type": "durationUpdate", "time": 42.0 }))
        );
    }

    #[test]
    fn ignores_unknown_native_player_event_codes() {
        assert_eq!(native_player_event_payload(0, 1.0), None);
        assert_eq!(native_player_event_payload(9, 1.0), None);
        assert_eq!(native_player_event_payload(255, 1.0), None);
    }

    #[tokio::test]
    async fn non_ios_player_commands_are_safe_noops() {
        assert!(ios_player_play().await.is_ok());
        assert!(ios_player_pause().await.is_ok());
        assert!(ios_player_seek(1.5).await.is_ok());
        assert!(ios_player_set_rate(1.25).await.is_ok());
        assert!(ios_player_set_expects_more(true).await.is_ok());
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

    #[test]
    fn deserializes_ios_player_load_live_options_camel_case() {
        let options: IosPlayerLoadLiveOptions = serde_json::from_value(json!({
            "bookId": "b1",
            "chapterIndex": 3,
            "title": "Chapter 4",
            "artist": "Author"
        }))
        .unwrap();
        assert_eq!(options.book_id, "b1");
        assert_eq!(options.chapter_index, 3);
        assert_eq!(options.title.as_deref(), Some("Chapter 4"));
    }
}
