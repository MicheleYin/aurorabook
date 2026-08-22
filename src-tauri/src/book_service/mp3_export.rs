//! Export audiobook tracks to a single file (MP3, M4A, or M4B) by decoding with **FFmpeg** and
//! encoding/muxing with **FFmpeg** on `PATH`. Metadata and M4B chapter markers are applied with
//! **FFmpeg** (`ffmetadata`) after mux. iOS builds do not ship FFmpeg for export; those commands
//! return a clear error.

use super::repositories::{AudioRepository, BookRepository};
use super::get_db_connection;
use crate::utils::constants::DEFAULT_MP3_BITRATE;
use crate::utils::errors::{AppError, AppResult};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Instant;
use tauri::Emitter;

#[cfg(not(target_os = "ios"))]
use std::collections::HashSet;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AudioExportProgress {
    book_id: String,
    format: String,
    current_step: String,
    message: String,
    processed_tracks: usize,
    total_tracks: usize,
    percent: u8,
    eta_ms: Option<u64>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioExportStatus {
    in_progress: bool,
    book_id: Option<String>,
    format: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Mp3ExportStatus {
    in_progress: bool,
    book_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AudioExportFormat {
    Mp3,
    M4a,
    M4b,
}

impl AudioExportFormat {
    fn as_str(self) -> &'static str {
        match self {
            AudioExportFormat::Mp3 => "mp3",
            AudioExportFormat::M4a => "m4a",
            AudioExportFormat::M4b => "m4b",
        }
    }
}

#[derive(Debug, Clone)]
struct ActiveAudioExport {
    book_id: String,
    format: AudioExportFormat,
}

static AUDIO_EXPORT_IN_PROGRESS: AtomicBool = AtomicBool::new(false);
static ACTIVE_AUDIO_EXPORT: OnceLock<Mutex<Option<ActiveAudioExport>>> = OnceLock::new();

#[cfg(not(target_os = "ios"))]
static ACTIVE_FFMPEG_AUDIO_EXPORT_PIDS: OnceLock<Mutex<HashSet<u32>>> = OnceLock::new();

#[cfg(not(target_os = "ios"))]
fn active_ffmpeg_audio_export_pids() -> &'static Mutex<HashSet<u32>> {
    ACTIVE_FFMPEG_AUDIO_EXPORT_PIDS.get_or_init(|| Mutex::new(HashSet::new()))
}

#[cfg(not(target_os = "ios"))]
fn register_ffmpeg_audio_export_pid(pid: u32) {
    if pid == 0 {
        return;
    }
    if let Ok(mut guard) = active_ffmpeg_audio_export_pids().lock() {
        guard.insert(pid);
    }
}

#[cfg(not(target_os = "ios"))]
fn unregister_ffmpeg_audio_export_pid(pid: u32) {
    if let Ok(mut guard) = active_ffmpeg_audio_export_pids().lock() {
        guard.remove(&pid);
    }
}

#[cfg(not(target_os = "ios"))]
fn signal_ffmpeg_export_process(pid: u32) -> std::io::Result<std::process::ExitStatus> {
    #[cfg(unix)]
    {
        Command::new("kill").arg("-TERM").arg(pid.to_string()).status()
    }
    #[cfg(windows)]
    {
        let mut cmd = Command::new("taskkill");
        cmd.args(["/PID", &pid.to_string(), "/T", "/F"]);
        crate::utils::ffmpeg_audio::configure_hidden_subprocess(&mut cmd);
        cmd.status()
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = pid;
        Err(std::io::Error::new(
            std::io::ErrorKind::Unsupported,
            "cannot signal subprocess on this platform",
        ))
    }
}

/// Send SIGTERM to FFmpeg children used for m4a/m4b export (app shutdown, etc.).
#[cfg(not(target_os = "ios"))]
pub fn terminate_active_ffmpeg_audio_exports() {
    let pids: Vec<u32> = active_ffmpeg_audio_export_pids()
        .lock()
        .map(|g| g.iter().copied().collect())
        .unwrap_or_default();

    for pid in pids {
        match signal_ffmpeg_export_process(pid) {
            Ok(status) if status.success() => {
                log::info!("Signalled active audio-export FFmpeg process pid={}", pid);
            }
            Ok(status) => {
                log::warn!(
                    "Failed to terminate audio-export FFmpeg process pid={} (status={:?})",
                    pid,
                    status.code()
                );
            }
            Err(e) => {
                log::warn!(
                    "Failed to signal audio-export FFmpeg process pid={}: {}",
                    pid,
                    e
                );
            }
        }
    }
}

#[cfg(target_os = "ios")]
pub fn terminate_active_ffmpeg_audio_exports() {}

fn active_audio_export_mutex() -> &'static Mutex<Option<ActiveAudioExport>> {
    ACTIVE_AUDIO_EXPORT.get_or_init(|| Mutex::new(None))
}

fn set_audio_export_active(active: Option<ActiveAudioExport>) {
    if let Ok(mut m) = active_audio_export_mutex().lock() {
        *m = active;
    }
}

fn active_audio_export() -> Option<ActiveAudioExport> {
    active_audio_export_mutex().lock().ok().and_then(|m| m.clone())
}

#[tauri::command]
pub async fn get_audio_export_status() -> AppResult<AudioExportStatus> {
    let in_progress = AUDIO_EXPORT_IN_PROGRESS.load(Ordering::Acquire);
    let active = active_audio_export();
    Ok(AudioExportStatus {
        in_progress,
        book_id: active.as_ref().map(|a| a.book_id.clone()),
        format: active.as_ref().map(|a| a.format.as_str().to_string()),
    })
}

#[tauri::command]
pub async fn get_mp3_export_status() -> AppResult<Mp3ExportStatus> {
    let in_progress = AUDIO_EXPORT_IN_PROGRESS.load(Ordering::Acquire);
    let active = active_audio_export();
    Ok(Mp3ExportStatus {
        in_progress,
        book_id: active.map(|a| a.book_id),
    })
}

/// Cancel an in-progress audio export that uses FFmpeg by sending SIGTERM to the child process.
#[tauri::command]
pub async fn cancel_audio_export(app: tauri::AppHandle) -> AppResult<bool> {
    #[cfg(target_os = "ios")]
    {
        let _ = app;
        return Ok(false);
    }

    #[cfg(not(target_os = "ios"))]
    {
        if !AUDIO_EXPORT_IN_PROGRESS.load(Ordering::Acquire) {
            return Ok(false);
        }

        let active = active_audio_export();
        let pids: Vec<u32> = active_ffmpeg_audio_export_pids()
            .lock()
            .map(|g| g.iter().copied().collect())
            .unwrap_or_default();

        let mut killed_any = false;
        for pid in pids {
            match signal_ffmpeg_export_process(pid) {
                Ok(status) if status.success() => {
                    killed_any = true;
                    log::info!("Signalled cancel for audio-export FFmpeg process pid={}", pid);
                }
                Ok(status) => {
                    log::warn!(
                        "Failed to cancel audio-export FFmpeg process pid={} (status={:?})",
                        pid,
                        status.code()
                    );
                }
                Err(e) => {
                    log::warn!(
                        "Failed to signal cancelling audio-export FFmpeg process pid={}: {}",
                        pid,
                        e
                    );
                }
            }
        }

        if killed_any {
            if let Some(ref a) = active {
                emit_progress(
                    &app,
                    a.format,
                    &a.book_id,
                    "cancelled",
                    "Audio export cancelled".to_string(),
                    0,
                    0,
                    0,
                    Some(0),
                );
            }
        }

        Ok(killed_any)
    }
}

fn emit_progress(
    app: &tauri::AppHandle,
    format: AudioExportFormat,
    book_id: &str,
    step: &str,
    message: String,
    processed: usize,
    total: usize,
    percent: u8,
    eta_ms: Option<u64>,
) {
    let payload = AudioExportProgress {
        book_id: book_id.to_string(),
        format: format.as_str().to_string(),
        current_step: step.to_string(),
        message,
        processed_tracks: processed,
        total_tracks: total,
        percent,
        eta_ms,
    };

    let _ = app.emit("audio-export-progress", payload.clone());
    if format == AudioExportFormat::Mp3 {
        let _ = app.emit("mp3-export-progress", payload);
    }
}

fn estimate_eta_ms(started: &Instant, processed: usize, total: usize) -> Option<u64> {
    if total == 0 || processed == 0 {
        return None;
    }
    let elapsed_ms = started.elapsed().as_millis() as f64;
    let fraction = processed as f64 / total as f64;
    if fraction <= 0.0 {
        return None;
    }
    let est_total_ms = elapsed_ms / fraction;
    Some((est_total_ms - elapsed_ms).max(0.0).round() as u64)
}

/// ETA from FFmpeg media clock: prefer reported `speed`, else wall-clock fraction of total duration.
fn estimate_eta_ms_from_media(
    started: &Instant,
    out_time_seconds: f64,
    total_duration_seconds: f64,
    speed: Option<f64>,
) -> Option<u64> {
    if total_duration_seconds <= 0.0 || !total_duration_seconds.is_finite() {
        return None;
    }
    let remaining = (total_duration_seconds - out_time_seconds).max(0.0);
    if remaining <= 0.0 {
        return Some(0);
    }
    if let Some(speed) = speed {
        if speed.is_finite() && speed > 0.05 {
            return Some(((remaining / speed) * 1000.0).round() as u64);
        }
    }
    if out_time_seconds <= 0.0 {
        return None;
    }
    let elapsed_ms = started.elapsed().as_millis() as f64;
    let fraction = (out_time_seconds / total_duration_seconds).clamp(0.0, 1.0);
    if fraction <= 0.0 {
        return None;
    }
    let est_total_ms = elapsed_ms / fraction;
    Some((est_total_ms - elapsed_ms).max(0.0).round() as u64)
}

/// Parse FFmpeg `out_time=HH:MM:SS.microseconds` (or `MM:SS.ms`).
fn parse_ffmpeg_clock(value: &str) -> Option<f64> {
    let value = value.trim();
    if value.is_empty() || value == "N/A" {
        return None;
    }
    let parts: Vec<&str> = value.split(':').collect();
    let (hours, minutes, seconds) = match parts.as_slice() {
        [h, m, s] => (h.parse::<f64>().ok()?, m.parse::<f64>().ok()?, s.parse::<f64>().ok()?),
        [m, s] => (0.0, m.parse::<f64>().ok()?, s.parse::<f64>().ok()?),
        [s] => (0.0, 0.0, s.parse::<f64>().ok()?),
        _ => return None,
    };
    Some(hours * 3600.0 + minutes * 60.0 + seconds)
}

fn parse_ffmpeg_speed(value: &str) -> Option<f64> {
    let trimmed = value.trim().trim_end_matches('x');
    if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("N/A") {
        return None;
    }
    let speed = trimmed.parse::<f64>().ok()?;
    if speed.is_finite() && speed > 0.0 {
        Some(speed)
    } else {
        None
    }
}

/// Cumulative track end times (seconds) used to map FFmpeg `out_time` onto track indices.
fn track_end_times_seconds(tracks: &[PreparedTrackInput]) -> Vec<f64> {
    let mut ends = Vec::with_capacity(tracks.len());
    let mut elapsed = 0.0f64;
    for track in tracks {
        let dur = track
            .duration_seconds
            .filter(|d| d.is_finite() && *d > 0.0)
            .or_else(|| {
                crate::utils::ffmpeg_audio::probe_media_duration_seconds(track.path.as_path())
                    .ok()
                    .filter(|d| d.is_finite() && *d > 0.0)
            })
            .unwrap_or(0.0);
        elapsed += dur;
        ends.push(elapsed);
    }
    ends
}

fn tracks_completed_for_out_time(track_ends: &[f64], out_time_seconds: f64) -> usize {
    if track_ends.is_empty() {
        return 0;
    }
    let mut completed = 0usize;
    for end in track_ends {
        if out_time_seconds + 0.05 >= *end {
            completed += 1;
        } else {
            break;
        }
    }
    completed.min(track_ends.len())
}

struct FfmpegEncodeProgress {
    processed_tracks: usize,
    total_tracks: usize,
    /// Overall export percent (encode phase maps into 40..=99).
    percent: u8,
    eta_ms: Option<u64>,
    message: String,
}

#[derive(Debug, Clone)]
struct PreparedTrackInput {
    path: PathBuf,
    title: String,
    duration_seconds: Option<f64>,
}

#[cfg(not(target_os = "ios"))]
fn write_track_blob_to_temp(
    temp_dir: &std::path::Path,
    index: usize,
    href: &str,
    bytes: &[u8],
    format_hint: AudioExportFormat,
) -> AppResult<PathBuf> {
    let ext = crate::utils::ffmpeg_audio::extension_hint_from_href(href, format_hint.as_str());
    let path = temp_dir.join(format!("track_{:05}.{}", index + 1, ext));
    std::fs::write(&path, bytes).map_err(|e| {
        AppError::Store(format!(
            "Failed to write temporary audio for export ({}): {}",
            path.display(),
            e
        ))
    })?;
    Ok(path)
}

#[cfg(not(target_os = "ios"))]
fn write_concat_filelist(
    temp_dir: &std::path::Path,
    tracks: &[PreparedTrackInput],
) -> AppResult<PathBuf> {
    let filelist_path = temp_dir.join("concat_filelist.txt");
    let mut f = std::fs::File::create(&filelist_path)
        .map_err(|e| AppError::Store(format!("Failed to create concat file list: {}", e)))?;

    for track in tracks {
        let escaped = track.path.display().to_string().replace('\'', "'\\''");
        writeln!(f, "file '{}'", escaped)
            .map_err(|e| AppError::Store(format!("Failed to write concat file list: {}", e)))?;
    }

    Ok(filelist_path)
}

fn ffmpeg_export_forbidden_message() -> String {
    "Audio export requires FFmpeg (`ffmpeg` on PATH). Install FFmpeg or use a build target where it is available.".to_string()
}

#[cfg(target_os = "ios")]
fn require_ffmpeg_for_export() -> AppResult<()> {
    Err(AppError::Encoding(ffmpeg_export_forbidden_message()))
}

#[cfg(not(target_os = "ios"))]
fn require_ffmpeg_for_export() -> AppResult<()> {
    let status = crate::utils::ffmpeg_audio::ffmpeg_command()
        .arg("-version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|e| {
            AppError::Encoding(format!(
                "{} Could not run `ffmpeg`: {}",
                ffmpeg_export_forbidden_message(),
                e
            ))
        })?;
    if status.success() {
        Ok(())
    } else {
        Err(AppError::Encoding(ffmpeg_export_forbidden_message()))
    }
}

fn export_cancelled_by_signal(status: &std::process::ExitStatus) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt;
        if let Some(sig) = status.signal() {
            return sig == 15 || sig == 2;
        }
    }
    let _ = status;
    false
}

#[cfg(not(target_os = "ios"))]
fn ffmpeg_stderr_snippet(stderr: &[u8]) -> String {
    let s = String::from_utf8_lossy(stderr);
    if s.len() > 4000 {
        format!("{}…", &s[..4000])
    } else {
        s.into_owned()
    }
}

/// Concatenate track files via FFmpeg concat demuxer and encode/mux to target format.
/// Streams `-progress` updates so the UI can show live percent / ETA while FFmpeg runs.
#[cfg(not(target_os = "ios"))]
fn ffmpeg_concat_filelist_export(
    output_path: &str,
    filelist_path: &std::path::Path,
    tracks: &[PreparedTrackInput],
    encoder_args: &[&str],
    process_label: &str,
    encode_started: Instant,
    mut on_progress: impl FnMut(FfmpegEncodeProgress) + Send,
) -> AppResult<()> {
    let total_tracks = tracks.len();
    if total_tracks == 0 {
        return Err(AppError::Store(
            "No exportable audio tracks found for export".to_string(),
        ));
    }

    let track_ends = track_end_times_seconds(tracks);
    let total_duration_seconds = track_ends.last().copied().unwrap_or(0.0);

    let mut cmd = crate::utils::ffmpeg_audio::ffmpeg_command();
    cmd.arg("-nostdin")
        .arg("-y")
        .arg("-progress")
        .arg("pipe:1")
        .arg("-nostats")
        .arg("-f")
        .arg("concat")
        .arg("-safe")
        .arg("0")
        .arg("-i")
        .arg(filelist_path.as_os_str());
    for a in encoder_args {
        cmd.arg(a);
    }
    cmd.arg(output_path)
        .stderr(Stdio::piped())
        .stdout(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| {
        AppError::Encoding(format!(
            "Failed to spawn FFmpeg for {}: {}",
            process_label, e
        ))
    })?;

    let ffmpeg_pid = child.id();
    register_ffmpeg_audio_export_pid(ffmpeg_pid);

    struct FfmpegAudioExportPidGuard(u32);
    impl Drop for FfmpegAudioExportPidGuard {
        fn drop(&mut self) {
            unregister_ffmpeg_audio_export_pid(self.0);
        }
    }
    let _ffmpeg_pid_guard = FfmpegAudioExportPidGuard(ffmpeg_pid);

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Encoding("ffmpeg has no stdout for progress".into()))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| AppError::Encoding("ffmpeg has no stderr".into()))?;

    let (progress_tx, progress_rx) = std::sync::mpsc::sync_channel::<FfmpegEncodeProgress>(4);
    let track_ends_for_thread = track_ends.clone();
    let progress_thread = std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        let mut out_time_seconds = 0.0f64;
        let mut speed: Option<f64> = None;
        let mut last_emitted = Instant::now()
            .checked_sub(std::time::Duration::from_secs(1))
            .unwrap_or_else(Instant::now);

        for line in reader.lines().map_while(Result::ok) {
            let line = line.trim();
            if let Some(value) = line.strip_prefix("out_time=") {
                if let Some(t) = parse_ffmpeg_clock(value) {
                    out_time_seconds = t;
                }
            } else if let Some(value) = line.strip_prefix("out_time_ms=") {
                // Historical FFmpeg quirk: out_time_ms is microseconds.
                if let Ok(us) = value.trim().parse::<u64>() {
                    out_time_seconds = us as f64 / 1_000_000.0;
                }
            } else if let Some(value) = line.strip_prefix("out_time_us=") {
                if let Ok(us) = value.trim().parse::<u64>() {
                    out_time_seconds = us as f64 / 1_000_000.0;
                }
            } else if let Some(value) = line.strip_prefix("speed=") {
                speed = parse_ffmpeg_speed(value);
            } else if line == "progress=continue" || line == "progress=end" {
                if last_emitted.elapsed() < std::time::Duration::from_millis(400)
                    && line != "progress=end"
                {
                    continue;
                }
                last_emitted = Instant::now();

                let completed = tracks_completed_for_out_time(&track_ends_for_thread, out_time_seconds);
                // Show the track currently being encoded (1-based), not only completed ones.
                let current_track = if total_tracks == 0 {
                    0
                } else {
                    (completed + 1).min(total_tracks)
                };
                let fraction = if total_duration_seconds > 0.0 {
                    (out_time_seconds / total_duration_seconds).clamp(0.0, 1.0)
                } else if total_tracks > 0 {
                    completed as f64 / total_tracks as f64
                } else {
                    0.0
                };
                let percent = (40.0 + fraction * 59.0).round().clamp(40.0, 99.0) as u8;
                let eta_ms = estimate_eta_ms_from_media(
                    &encode_started,
                    out_time_seconds,
                    total_duration_seconds,
                    speed,
                )
                .or_else(|| estimate_eta_ms(&encode_started, completed.max(1).min(total_tracks), total_tracks));

                let message = if total_duration_seconds > 0.0 {
                    format!(
                        "Encoding track {}/{} ({:.0}%)",
                        current_track,
                        total_tracks,
                        fraction * 100.0
                    )
                } else {
                    format!("Encoding track {}/{}", current_track, total_tracks)
                };

                let _ = progress_tx.send(FfmpegEncodeProgress {
                    processed_tracks: completed,
                    total_tracks,
                    percent,
                    eta_ms,
                    message,
                });
            }
        }
    });

    let stderr_thread = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let mut reader = BufReader::new(stderr);
        let _ = std::io::copy(&mut reader, &mut buf);
        buf
    });

    // Forward progress while FFmpeg is running.
    let exit_status = loop {
        match progress_rx.recv_timeout(std::time::Duration::from_millis(250)) {
            Ok(update) => on_progress(update),
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => match child.try_wait() {
                Ok(Some(status)) => break status,
                Ok(None) => continue,
                Err(e) => {
                    return Err(AppError::Encoding(format!(
                        "FFmpeg {} process failed: {}",
                        process_label, e
                    )));
                }
            },
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                break child.wait().map_err(|e| {
                    AppError::Encoding(format!("FFmpeg {} process failed: {}", process_label, e))
                })?;
            }
        }
    };

    while let Ok(update) = progress_rx.try_recv() {
        on_progress(update);
    }

    let status = exit_status;
    let _ = progress_thread.join();
    let stderr_bytes = stderr_thread.join().unwrap_or_default();

    if !status.success() {
        let _ = std::fs::remove_file(output_path);
        if export_cancelled_by_signal(&status) {
            return Err(AppError::Store("Audio export cancelled".to_string()));
        }
        let tail = ffmpeg_stderr_snippet(&stderr_bytes);
        return Err(AppError::Encoding(format!(
            "FFmpeg {} failed (status {:?}): {}",
            process_label,
            status.code(),
            tail
        )));
    }

    on_progress(FfmpegEncodeProgress {
        processed_tracks: total_tracks,
        total_tracks,
        percent: 99,
        eta_ms: Some(0),
        message: format!("Processed {} / {} tracks", total_tracks, total_tracks),
    });

    Ok(())
}

fn chapter_starts_for_track_inputs(
    tracks: &[PreparedTrackInput],
) -> Vec<(std::time::Duration, String)> {
    let mut chapter_starts: Vec<(std::time::Duration, String)> = Vec::new();
    let mut elapsed_seconds = 0.0f64;
    for track in tracks {
        chapter_starts.push((
            std::time::Duration::from_secs_f64(elapsed_seconds.max(0.0)),
            track.title.clone(),
        ));

        let dur = track.duration_seconds.or_else(|| {
            crate::utils::ffmpeg_audio::probe_media_duration_seconds(track.path.as_path()).ok()
        });
        if let Some(d) = dur {
            if d > 0.0 && d.is_finite() {
                elapsed_seconds += d;
            }
        }
    }
    chapter_starts
}

#[cfg(not(target_os = "ios"))]
fn apply_mp4_metadata_and_chapters(
    output_path: &str,
    book: &crate::book_service::models::Book,
    format: AudioExportFormat,
    chapter_starts: &[(std::time::Duration, String)],
) -> AppResult<()> {
    let genre = book.subjects.as_ref().map(|subjects| {
        subjects
            .iter()
            .filter(|s| !s.trim().is_empty())
            .cloned()
            .collect::<Vec<_>>()
            .join(", ")
    });
    let genre_ref = genre.as_deref().filter(|s| !s.is_empty());
    crate::utils::ffmpeg_audio::apply_mp4_metadata_and_chapters_ffmpeg(
        output_path,
        &book.title,
        &book.author,
        book.published_year.as_deref(),
        genre_ref,
        chapter_starts,
        format == AudioExportFormat::M4b,
    )
}

fn create_mp3_export_file(
    output_path: &str,
    tracks: &[PreparedTrackInput],
    filelist_path: &std::path::Path,
    encode_started: Instant,
    on_progress: impl FnMut(FfmpegEncodeProgress) + Send,
) -> AppResult<()> {
    require_ffmpeg_for_export()?;
    #[cfg(not(target_os = "ios"))]
    {
        let bitrate_arg = format!("{}k", DEFAULT_MP3_BITRATE);
        // `-f mp3` is required when the output path uses a non-standard suffix (e.g. `.mp3.part`
        // from atomic rename) so FFmpeg can still pick the MP3 muxer.
        let enc_args: [&str; 6] = [
            "-c:a",
            "libmp3lame",
            "-b:a",
            bitrate_arg.as_str(),
            "-f",
            "mp3",
        ];
        ffmpeg_concat_filelist_export(
            output_path,
            filelist_path,
            tracks,
            &enc_args,
            "MP3 export",
            encode_started,
            on_progress,
        )?;
        Ok(())
    }
    #[cfg(target_os = "ios")]
    {
        let _ = (output_path, tracks, filelist_path, encode_started, on_progress);
        Ok(())
    }
}

fn create_mp4_export_file(
    output_path: &str,
    book: &crate::book_service::models::Book,
    tracks: &[PreparedTrackInput],
    filelist_path: &std::path::Path,
    format: AudioExportFormat,
    encode_started: Instant,
    on_progress: impl FnMut(FfmpegEncodeProgress) + Send,
) -> AppResult<()> {
    require_ffmpeg_for_export()?;
    #[cfg(not(target_os = "ios"))]
    {
        if tracks.is_empty() {
            return Err(AppError::Store(
                "No exportable audio tracks found for MP4 export".to_string(),
            ));
        }
        let chapter_starts = chapter_starts_for_track_inputs(tracks);

        ffmpeg_concat_filelist_export(
            output_path,
            filelist_path,
            tracks,
            &[
                "-c:a",
                "aac",
                "-b:a",
                "128k",
                "-profile:a",
                "aac_low",
                "-movflags",
                "+faststart",
                // Output may use a non-standard extension during processing; FFmpeg 8+ is more
                // reliable when we set the MP4 muxer explicitly.
                "-f",
                "mp4",
            ],
            "M4A/M4B export",
            encode_started,
            on_progress,
        )?;

        if let Err(e) = apply_mp4_metadata_and_chapters(output_path, book, format, &chapter_starts)
        {
            log::warn!(
                "Could not embed MP4 metadata/chapters for {} export: {}",
                format.as_str(),
                e
            );
        }
        Ok(())
    }
    #[cfg(target_os = "ios")]
    {
        let _ = (
            output_path,
            book,
            tracks,
            filelist_path,
            format,
            encode_started,
            on_progress,
        );
        Ok(())
    }
}

async fn export_as_mp4(
    book_id: String,
    output_path: String,
    app: tauri::AppHandle,
    format: AudioExportFormat,
) -> AppResult<()> {
    if AUDIO_EXPORT_IN_PROGRESS
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err(AppError::Store(
            "Another audio export is already in progress. Please wait for it to finish."
                .to_string(),
        ));
    }

    set_audio_export_active(Some(ActiveAudioExport {
        book_id: book_id.clone(),
        format,
    }));

    struct AudioExportLockGuard;
    impl Drop for AudioExportLockGuard {
        fn drop(&mut self) {
            set_audio_export_active(None);
            AUDIO_EXPORT_IN_PROGRESS.store(false, Ordering::Release);
        }
    }
    let _guard = AudioExportLockGuard;

    let db = get_db_connection(&app).await.map_err(AppError::Store)?;
    let book = BookRepository::find_by_id(db.as_ref(), &book_id)
        .await
        .map_err(AppError::Store)?
        .ok_or_else(|| AppError::Store(format!("Book not found: {}", book_id)))?;

    let mut sorted_tracks = book.audio_tracks.clone();
    sorted_tracks.sort_by_key(|t| t.order);
    let total_tracks = sorted_tracks.len();
    let started = Instant::now();

    emit_progress(
        &app,
        format,
        &book_id,
        "initializing",
        format!("Starting {} export...", format.as_str().to_uppercase()),
        0,
        total_tracks,
        0,
        None,
    );

    #[cfg(not(target_os = "ios"))]
    let temp_tracks_dir = tempfile::tempdir()
        .map_err(|e| AppError::Store(format!("Failed to create export temp directory: {}", e)))?;
    let mut prepared_tracks: Vec<PreparedTrackInput> = Vec::new();

    for (index, track) in sorted_tracks.iter().enumerate() {
        match AudioRepository::resolve_track_audio_bytes(db.as_ref(), &book_id, &track.id).await {
            Ok(Some((audio_bytes, href))) => {
                emit_progress(
                    &app,
                    format,
                    &book_id,
                    "extracting-audio",
                    format!("Preparing track {}/{}", index + 1, total_tracks),
                    index,
                    total_tracks,
                    if total_tracks > 0 {
                        ((index * 50) / total_tracks).min(49) as u8
                    } else {
                        0
                    },
                    None,
                );

                #[cfg(not(target_os = "ios"))]
                {
                    let temp_path = write_track_blob_to_temp(
                        temp_tracks_dir.path(),
                        prepared_tracks.len(),
                        &href,
                        &audio_bytes,
                        format,
                    )?;
                    prepared_tracks.push(PreparedTrackInput {
                        path: temp_path,
                        title: if track.title.trim().is_empty() {
                            format!("Track {}", track.order + 1)
                        } else {
                            track.title.clone()
                        },
                        duration_seconds: track.duration,
                    });
                }
            }
            Ok(None) => {
                log::warn!("Missing audio track id='{}'", track.id);
            }
            Err(e) => {
                log::warn!("Unreadable track id='{}': {}", track.id, e);
            }
        }

        // For m4a/m4b, a track is only "processed" after encode+mux completes.
        // Keep decode progress visible via percent/message, but processed-tracks stays 0 here.
        emit_progress(
            &app,
            format,
            &book_id,
            "extracting-audio",
            format!("Prepared track {}/{}", index + 1, total_tracks),
            0,
            total_tracks,
            if total_tracks > 0 {
                ((index + 1) * 40 / total_tracks).min(40) as u8
            } else {
                0
            },
            None,
        );
    }

    if prepared_tracks.is_empty() {
        return Err(AppError::Store(
            "No exportable audio tracks found for MP4 export".to_string(),
        ));
    }

    #[cfg(not(target_os = "ios"))]
    let filelist_path = write_concat_filelist(temp_tracks_dir.path(), &prepared_tracks)?;
    #[cfg(target_os = "ios")]
    let filelist_path = PathBuf::new();

    let final_output = PathBuf::from(&output_path);
    if final_output.exists() {
        let _ = std::fs::remove_file(&final_output);
    }

    let final_output_str = final_output
        .to_str()
        .ok_or_else(|| AppError::Store("Output path is not valid UTF-8".to_string()))?;

    emit_progress(
        &app,
        format,
        &book_id,
        "encoding-aac",
        format!(
            "Encoding {} tracks to {}...",
            prepared_tracks.len(),
            format.as_str().to_uppercase()
        ),
        0,
        prepared_tracks.len(),
        40,
        None,
    );

    if let Err(e) = create_mp4_export_file(
        final_output_str,
        &book,
        &prepared_tracks,
        &filelist_path,
        format,
        started,
        |progress| {
            emit_progress(
                &app,
                format,
                &book_id,
                "encoding-aac",
                progress.message,
                progress.processed_tracks,
                progress.total_tracks,
                progress.percent,
                progress.eta_ms,
            );
        },
    ) {
        let _ = std::fs::remove_file(&final_output);
        return Err(e);
    }

    emit_progress(
        &app,
        format,
        &book_id,
        "completed",
        format!("{} export complete", format.as_str().to_uppercase()),
        total_tracks,
        total_tracks,
        100,
        Some(0),
    );
    Ok(())
}

/// Export all audiobook tracks as one MP3 via FFmpeg decode and a single FFmpeg (`libmp3lame`) encode.
#[tauri::command]
pub async fn export_as_mp3(
    book_id: String,
    output_path: String,
    app: tauri::AppHandle,
) -> AppResult<()> {
    if AUDIO_EXPORT_IN_PROGRESS
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err(AppError::Store(
            "Another audio export is already in progress. Please wait for it to finish."
                .to_string(),
        ));
    }

    set_audio_export_active(Some(ActiveAudioExport {
        book_id: book_id.clone(),
        format: AudioExportFormat::Mp3,
    }));

    struct AudioExportLockGuard;
    impl Drop for AudioExportLockGuard {
        fn drop(&mut self) {
            set_audio_export_active(None);
            AUDIO_EXPORT_IN_PROGRESS.store(false, Ordering::Release);
        }
    }
    let _guard = AudioExportLockGuard;

    let db = get_db_connection(&app).await.map_err(AppError::Store)?;

    let book = BookRepository::find_by_id(db.as_ref(), &book_id)
        .await
        .map_err(AppError::Store)?
        .ok_or_else(|| AppError::Store(format!("Book not found: {}", book_id)))?;

    let mut sorted_tracks = book.audio_tracks.clone();
    sorted_tracks.sort_by_key(|t| t.order);
    let total_tracks = sorted_tracks.len();
    let started = Instant::now();

    emit_progress(
        &app,
        AudioExportFormat::Mp3,
        &book_id,
        "initializing",
        "Starting MP3 export...".to_string(),
        0,
        total_tracks,
        0,
        None,
    );

    #[cfg(not(target_os = "ios"))]
    let temp_tracks_dir = tempfile::tempdir()
        .map_err(|e| AppError::Store(format!("Failed to create export temp directory: {}", e)))?;
    let mut prepared_tracks: Vec<PreparedTrackInput> = Vec::new();

    for (index, track) in sorted_tracks.iter().enumerate() {
        match AudioRepository::resolve_track_audio_bytes(db.as_ref(), &book_id, &track.id).await {
            Ok(Some((audio_bytes, href))) => {
                emit_progress(
                    &app,
                    AudioExportFormat::Mp3,
                    &book_id,
                    "extracting-audio",
                    format!("Preparing track {}/{}", index + 1, total_tracks),
                    index,
                    total_tracks,
                    if total_tracks > 0 {
                        ((index * 50) / total_tracks).min(49) as u8
                    } else {
                        0
                    },
                    None,
                );

                #[cfg(not(target_os = "ios"))]
                {
                    let temp_path = write_track_blob_to_temp(
                        temp_tracks_dir.path(),
                        prepared_tracks.len(),
                        &href,
                        &audio_bytes,
                        AudioExportFormat::Mp3,
                    )?;
                    prepared_tracks.push(PreparedTrackInput {
                        path: temp_path,
                        title: if track.title.trim().is_empty() {
                            format!("Track {}", track.order + 1)
                        } else {
                            track.title.clone()
                        },
                        duration_seconds: track.duration,
                    });
                }
            }
            Ok(None) => {
                log::warn!("Missing audio track id='{}'", track.id);
            }
            Err(e) => {
                log::warn!("Unreadable track id='{}': {}", track.id, e);
            }
        }

        emit_progress(
            &app,
            AudioExportFormat::Mp3,
            &book_id,
            "extracting-audio",
            format!("Prepared track {}/{}", index + 1, total_tracks),
            0,
            total_tracks,
            if total_tracks > 0 {
                ((index + 1) * 40 / total_tracks).min(40) as u8
            } else {
                0
            },
            None,
        );
    }

    if prepared_tracks.is_empty() {
        return Err(AppError::Store(
            "No exportable audio tracks found for MP3 export".to_string(),
        ));
    }

    #[cfg(not(target_os = "ios"))]
    let filelist_path = write_concat_filelist(temp_tracks_dir.path(), &prepared_tracks)?;
    #[cfg(target_os = "ios")]
    let filelist_path = PathBuf::new();

    let final_output = PathBuf::from(&output_path);
    if final_output.exists() {
        let _ = std::fs::remove_file(&final_output);
    }

    let final_output_str = final_output
        .to_str()
        .ok_or_else(|| AppError::Store("Output path is not valid UTF-8".to_string()))?;

    emit_progress(
        &app,
        AudioExportFormat::Mp3,
        &book_id,
        "encoding-mp3",
        format!("Encoding {} tracks to MP3...", prepared_tracks.len()),
        0,
        prepared_tracks.len(),
        40,
        None,
    );

    if let Err(e) = create_mp3_export_file(
        final_output_str,
        &prepared_tracks,
        &filelist_path,
        started,
        |progress| {
            emit_progress(
                &app,
                AudioExportFormat::Mp3,
                &book_id,
                "encoding-mp3",
                progress.message,
                progress.processed_tracks,
                progress.total_tracks,
                progress.percent,
                progress.eta_ms,
            );
        },
    ) {
        let _ = std::fs::remove_file(&final_output);
        return Err(e);
    }

    emit_progress(
        &app,
        AudioExportFormat::Mp3,
        &book_id,
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

#[tauri::command]
pub async fn export_as_m4a(
    book_id: String,
    output_path: String,
    app: tauri::AppHandle,
) -> AppResult<()> {
    export_as_mp4(book_id, output_path, app, AudioExportFormat::M4a).await
}

#[tauri::command]
pub async fn export_as_m4b(
    book_id: String,
    output_path: String,
    app: tauri::AppHandle,
) -> AppResult<()> {
    export_as_mp4(book_id, output_path, app, AudioExportFormat::M4b).await
}

#[cfg(test)]
mod helper_tests {
    use super::*;
    use std::time::{Duration, Instant};

    #[test]
    fn estimate_eta_ms_returns_none_without_progress() {
        let started = Instant::now();
        assert_eq!(estimate_eta_ms(&started, 0, 10), None);
        assert_eq!(estimate_eta_ms(&started, 5, 0), None);
    }

    #[test]
    fn estimate_eta_ms_estimates_remaining_time() {
        let started = Instant::now();
        std::thread::sleep(Duration::from_millis(20));
        let eta = estimate_eta_ms(&started, 1, 2).expect("eta");
        assert!(eta > 0);
    }

    #[test]
    fn parse_ffmpeg_clock_parses_hms() {
        assert!((parse_ffmpeg_clock("00:01:30.5").unwrap() - 90.5).abs() < 0.001);
        assert!((parse_ffmpeg_clock("01:00:00").unwrap() - 3600.0).abs() < 0.001);
        assert!((parse_ffmpeg_clock("45.25").unwrap() - 45.25).abs() < 0.001);
        assert!(parse_ffmpeg_clock("N/A").is_none());
    }

    #[test]
    fn parse_ffmpeg_speed_parses_multiplier() {
        assert!((parse_ffmpeg_speed("1.85x").unwrap() - 1.85).abs() < 0.001);
        assert!((parse_ffmpeg_speed("2").unwrap() - 2.0).abs() < 0.001);
        assert!(parse_ffmpeg_speed("N/A").is_none());
    }

    #[test]
    fn tracks_completed_for_out_time_maps_media_clock() {
        let ends = vec![10.0, 25.0, 40.0];
        assert_eq!(tracks_completed_for_out_time(&ends, 0.0), 0);
        assert_eq!(tracks_completed_for_out_time(&ends, 10.0), 1);
        assert_eq!(tracks_completed_for_out_time(&ends, 24.0), 1);
        assert_eq!(tracks_completed_for_out_time(&ends, 25.0), 2);
        assert_eq!(tracks_completed_for_out_time(&ends, 100.0), 3);
    }

    #[test]
    fn estimate_eta_ms_from_media_uses_speed() {
        let started = Instant::now();
        let eta = estimate_eta_ms_from_media(&started, 10.0, 30.0, Some(2.0)).expect("eta");
        // 20s remaining at 2x => ~10s
        assert!((eta as i64 - 10_000).abs() < 50);
    }

    #[test]
    fn ffmpeg_export_forbidden_message_mentions_ffmpeg() {
        let msg = ffmpeg_export_forbidden_message();
        assert!(msg.contains("FFmpeg") || msg.contains("ffmpeg"));
    }

    #[test]
    fn export_cancelled_by_signal_false_for_success() {
        let status = std::process::Command::new("true")
            .status()
            .expect("run true");
        assert!(!export_cancelled_by_signal(&status));
    }

    #[cfg(unix)]
    #[test]
    fn export_cancelled_by_signal_true_for_sigterm_and_sigint() {
        use std::os::unix::process::ExitStatusExt;
        let sigterm = std::process::ExitStatus::from_raw(15);
        let sigint = std::process::ExitStatus::from_raw(2);
        assert!(export_cancelled_by_signal(&sigterm));
        assert!(export_cancelled_by_signal(&sigint));
    }

    #[cfg(not(target_os = "ios"))]
    #[test]
    fn ffmpeg_stderr_snippet_truncates() {
        let short = ffmpeg_stderr_snippet(b"ok");
        assert_eq!(short, "ok");
        let long = "x".repeat(5000);
        let snippet = ffmpeg_stderr_snippet(long.as_bytes());
        assert!(snippet.ends_with('…'));
        assert_eq!(&snippet[..4000], &long[..4000]);
    }
}

#[cfg(test)]
mod m4b_export_tests {
    use super::*;
    use crate::book_service::models::{
        AudioSyncMap, AudioTrack, Book, BookAudioState, BookProgress, Chapter, ConversionStatus,
    };
    use symphonia::core::codecs::DecoderOptions;
    use symphonia::core::errors::Error as SymphoniaError;
    use symphonia::core::formats::FormatOptions;
    use symphonia::core::io::MediaSourceStream;
    use symphonia::core::meta::MetadataOptions;
    use symphonia::core::probe::Hint;
    use symphonia::default::{get_codecs, get_probe};
    use std::fs::File;
    use std::io::Read;
    use std::path::{Path, PathBuf};
    use std::process::{Command, Stdio};
    use zip::ZipArchive;

    fn ffmpeg_probe_output(path: &str) -> String {
        let out = crate::utils::ffmpeg_audio::ffmpeg_command()
            .args([
                "-hide_banner",
                "-v",
                "info",
                "-i",
                path,
                "-f",
                "null",
                "-",
            ])
            .output()
            .expect("ffmpeg probe output");
        assert!(
            out.status.success(),
            "ffmpeg probe output failed: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        String::from_utf8_lossy(&out.stderr).to_string()
    }

    fn media_duration_sec(path: &str) -> f64 {
        let file = File::open(path).expect("open media file for duration");
        let mut hint = Hint::new();
        if let Some(ext) = Path::new(path).extension().and_then(|e| e.to_str()) {
            hint.with_extension(ext);
        }

        let mss = MediaSourceStream::new(Box::new(file), Default::default());
        let probed = get_probe()
            .format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default())
            .expect("probe media format");
        let mut format = probed.format;
        let track = format.default_track().expect("default audio track");

        if let (Some(frames), Some(sr)) = (track.codec_params.n_frames, track.codec_params.sample_rate) {
            return frames as f64 / sr as f64;
        }

        let track_id = track.id;
        let mut decoder = get_codecs()
            .make(&track.codec_params, &DecoderOptions::default())
            .expect("build decoder");
        let mut sample_rate = track.codec_params.sample_rate;
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
                        Err(SymphoniaError::DecodeError(_)) => continue,
                        Err(_) => break,
                    }
                }
                Err(SymphoniaError::IoError(_)) => break,
                Err(_) => break,
            }
        }

        let sr = sample_rate.expect("sample rate for decoded stream") as f64;
        total_frames as f64 / sr
    }

    fn ffmpeg_on_path() -> bool {
        #[cfg(target_os = "ios")]
        {
            return false;
        }
        #[cfg(not(target_os = "ios"))]
        {
            crate::utils::ffmpeg_audio::ffmpeg_command()
                .arg("-version")
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .map(|s| s.success())
                .unwrap_or(false)
        }
    }

    fn sine_pcm_16le_mono(sample_rate: u32, hz: f64, seconds: f64) -> Vec<u8> {
        let samples = (sample_rate as f64 * seconds) as usize;
        let mut out = Vec::with_capacity(samples * 2);
        for i in 0..samples {
            let t = i as f64 / sample_rate as f64;
            let v = (2.0 * std::f64::consts::PI * hz * t).sin() * 0.2;
            let s = (v * 32767.0) as i16;
            out.extend_from_slice(&s.to_le_bytes());
        }
        out
    }

    fn sample_book_two_tracks() -> Book {
        Book {
            id: "book-m4b-test".to_string(),
            title: "M4B Test Book".to_string(),
            author: "Test Author".to_string(),
            chapters: vec![Chapter {
                id: "c1".to_string(),
                title: "Chapter 1".to_string(),
                content_html: None,
                plain_text: None,
                order: 0,
                href: "chapter1.xhtml".to_string(),
                word_count: None,
                estimated_page_count: None,
            }],
            cover_url: None,
            source_path: "/tmp/test.epub".to_string(),
            publisher: None,
            published_year: Some("2026".to_string()),
            subjects: Some(vec!["Audiobook".to_string()]),
            file_size_bytes: None,
            audio_tracks: vec![
                AudioTrack {
                    id: "t1".to_string(),
                    title: "Track One".to_string(),
                    href: "audio1.mp3".to_string(),
                    url: None,
                    duration: Some(0.25),
                    order: 0,
                },
                AudioTrack {
                    id: "t2".to_string(),
                    title: "Track Two".to_string(),
                    href: "audio2.mp3".to_string(),
                    url: None,
                    duration: Some(0.25),
                    order: 1,
                },
            ],
            audio_state: None::<BookAudioState>,
            audio_sync_map: None::<AudioSyncMap>,
            progress: None::<BookProgress>,
            page_count: None,
            conversion_status: ConversionStatus::Done,
            completed_chapters: vec![],
            voice_id: None,
            total_words: None,
            words_processed: None,
            conversion_session_baseline_words: None,
            conversion_session_started_at: None,
            conversion_elapsed_ms: None,
            last_opened_time: None,
        }
    }

    /// Regression: m4b mux output must carry tags and chapters.
    #[test]
    fn m4b_two_track_export_roundtrips_metadata_and_chapters() {
        if !ffmpeg_on_path() {
            eprintln!("Skipping m4b export test: ffmpeg not on PATH");
            return;
        }
        let tmp = tempfile::tempdir().expect("tempdir");
        let out_path = tmp.path().join("sample.m4b");
        let out_str = out_path.to_str().expect("utf8 path");

        let book = sample_book_two_tracks();
        let pcm1 = sine_pcm_16le_mono(44_100, 440.0, 0.25);
        let pcm2 = sine_pcm_16le_mono(44_100, 554.0, 0.25);
        let mp3_1 = crate::utils::ffmpeg_audio::encode_pcm_to_mp3_bytes(
            pcm1,
            44_100,
            1,
            Some(DEFAULT_MP3_BITRATE),
        )
        .expect("encode track1 mp3");
        let mp3_2 = crate::utils::ffmpeg_audio::encode_pcm_to_mp3_bytes(
            pcm2,
            44_100,
            1,
            Some(DEFAULT_MP3_BITRATE),
        )
        .expect("encode track2 mp3");

        let input_dir = tempfile::tempdir().expect("input tempdir");
        let track1 = write_track_blob_to_temp(
            input_dir.path(),
            0,
            "track1.mp3",
            &mp3_1,
            AudioExportFormat::M4b,
        )
        .expect("write track1 temp");
        let track2 = write_track_blob_to_temp(
            input_dir.path(),
            1,
            "track2.mp3",
            &mp3_2,
            AudioExportFormat::M4b,
        )
        .expect("write track2 temp");

        let prepared_tracks = vec![
            PreparedTrackInput {
                path: track1,
                title: "Track One".to_string(),
                duration_seconds: Some(0.25),
            },
            PreparedTrackInput {
                path: track2,
                title: "Track Two".to_string(),
                duration_seconds: Some(0.25),
            },
        ];
        let filelist_path =
            write_concat_filelist(input_dir.path(), &prepared_tracks).expect("filelist");

        create_mp4_export_file(
            out_str,
            &book,
            &prepared_tracks,
            &filelist_path,
            AudioExportFormat::M4b,
            Instant::now(),
            |_| {},
        )
        .expect("create m4b");

        let meta = std::fs::metadata(&out_path).expect("stat output");
        assert!(meta.len() > 8_000, "m4b output unexpectedly small: {} bytes", meta.len());

        let probe = ffmpeg_probe_output(out_str).to_lowercase();
        assert!(probe.contains("title           : m4b test book"));
        assert!(probe.contains("artist          : test author"));
        assert!(probe.contains("track one"));
        assert!(probe.contains("track two"));

        let secs = media_duration_sec(out_str);
        assert!(
            (secs - 0.5).abs() < 0.45,
            "expected ~0.5s of muxed audio (two 0.25s tracks), got {}s",
            secs
        );
    }

    fn sample_epub_path() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../sample_audio/Sample .epub Book.epub")
    }

    fn is_likely_audio_name(name: &str) -> bool {
        let lower = name.to_lowercase();
        lower.ends_with(".mp3")
            || lower.ends_with(".m4a")
            || lower.ends_with(".aac")
            || lower.ends_with(".wav")
            || lower.ends_with(".ogg")
            || lower.ends_with(".opus")
            || lower.ends_with(".flac")
    }

    #[test]
    fn sample_epub_exports_m4a_and_m4b_are_parseable() {
        if !ffmpeg_on_path() {
            eprintln!("Skipping sample EPUB export test: ffmpeg not on PATH");
            return;
        }
        let epub_path = sample_epub_path();
        if !epub_path.exists() {
            eprintln!(
                "Skipping sample EPUB export test (missing file): {}",
                epub_path.display()
            );
            return;
        }

        let mut zip = ZipArchive::new(File::open(&epub_path).expect("open sample epub"))
            .expect("read sample epub as zip");

        let input_dir = tempfile::tempdir().expect("input tempdir");
        let mut prepared_tracks: Vec<PreparedTrackInput> = Vec::new();
        let mut audio_tracks: Vec<AudioTrack> = Vec::new();

        for i in 0..zip.len() {
            let mut entry = zip.by_index(i).expect("zip entry");
            let name = entry.name().to_string();
            if !is_likely_audio_name(&name) {
                continue;
            }
            let mut bytes = Vec::new();
            entry.read_to_end(&mut bytes).expect("read audio entry");

            let order = audio_tracks.len();
            audio_tracks.push(AudioTrack {
                id: format!("sample-track-{}", order + 1),
                title: Path::new(&name)
                    .file_name()
                    .and_then(|s| s.to_str())
                    .unwrap_or("Track")
                    .to_string(),
                href: name.clone(),
                url: None,
                duration: None,
                order,
            });
            let temp_path = write_track_blob_to_temp(
                input_dir.path(),
                order,
                &name,
                &bytes,
                AudioExportFormat::M4a,
            )
            .expect("write sample track temp");
            prepared_tracks.push(PreparedTrackInput {
                path: temp_path,
                title: Path::new(&name)
                    .file_name()
                    .and_then(|s| s.to_str())
                    .unwrap_or("Track")
                    .to_string(),
                duration_seconds: None,
            });
        }

        assert!(
            !prepared_tracks.is_empty(),
            "Sample EPUB has no readable embedded audio tracks: {}",
            epub_path.display()
        );

        let book = Book {
            id: "sample-epub-export-test".to_string(),
            title: "Sample EPUB Export Test".to_string(),
            author: "AuroraBook".to_string(),
            chapters: vec![],
            cover_url: None,
            source_path: epub_path.to_string_lossy().to_string(),
            publisher: None,
            published_year: Some("2026".to_string()),
            subjects: Some(vec!["Audiobook".to_string()]),
            file_size_bytes: None,
            audio_tracks,
            audio_state: None::<BookAudioState>,
            audio_sync_map: None::<AudioSyncMap>,
            progress: None::<BookProgress>,
            page_count: None,
            conversion_status: ConversionStatus::Done,
            completed_chapters: vec![],
            voice_id: None,
            total_words: None,
            words_processed: None,
            conversion_session_baseline_words: None,
            conversion_session_started_at: None,
            conversion_elapsed_ms: None,
            last_opened_time: None,
        };

        let tmp = tempfile::tempdir().expect("tempdir");
        let m4a = tmp.path().join("sample.m4a");
        let m4b = tmp.path().join("sample.m4b");
        let m4a_str = m4a.to_str().expect("utf8 m4a path");
        let m4b_str = m4b.to_str().expect("utf8 m4b path");
        let filelist_path =
            write_concat_filelist(input_dir.path(), &prepared_tracks).expect("write filelist");

        create_mp4_export_file(
            m4a_str,
            &book,
            &prepared_tracks,
            &filelist_path,
            AudioExportFormat::M4a,
            Instant::now(),
            |_| {},
        )
        .expect("export sample m4a");
        create_mp4_export_file(
            m4b_str,
            &book,
            &prepared_tracks,
            &filelist_path,
            AudioExportFormat::M4b,
            Instant::now(),
            |_| {},
        )
        .expect("export sample m4b");

        let m4a_meta = std::fs::metadata(&m4a).expect("stat m4a");
        let m4b_meta = std::fs::metadata(&m4b).expect("stat m4b");
        assert!(m4a_meta.len() > 16_000, "m4a output too small: {}", m4a_meta.len());
        assert!(m4b_meta.len() > 16_000, "m4b output too small: {}", m4b_meta.len());

        let m4a_secs = media_duration_sec(m4a_str);
        let m4b_secs = media_duration_sec(m4b_str);
        assert!(
            m4a_secs > 1.0,
            "m4a duration unexpectedly short: {}s",
            m4a_secs
        );
        assert!(
            m4b_secs > 1.0,
            "m4b duration unexpectedly short: {}s",
            m4b_secs
        );

        // Optional: persist outputs for manual listening/inspection.
        // Usage:
        // AURORABOOK_SAMPLE_EXPORT_OUT_DIR="../sample_audio" cargo test --lib sample_epub_exports_m4a_and_m4b_are_parseable -- --nocapture
        if let Ok(out_dir_raw) = std::env::var("AURORABOOK_SAMPLE_EXPORT_OUT_DIR") {
            let out_dir = Path::new(&out_dir_raw);
            std::fs::create_dir_all(out_dir).expect("create output directory");
            let out_m4a = out_dir.join("Sample .epub Book.m4a");
            let out_m4b = out_dir.join("Sample .epub Book.m4b");
            std::fs::copy(&m4a, &out_m4a).expect("copy m4a output");
            std::fs::copy(&m4b, &out_m4b).expect("copy m4b output");
            eprintln!(
                "Persisted exports:\n  m4a: {}\n  m4b: {}",
                out_m4a.display(),
                out_m4b.display()
            );
        }
    }
}
