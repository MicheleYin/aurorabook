//! Export audiobook tracks to a single MP3 using Symphonia decode + bundled LAME (mp3lame-encoder).
//! M4A/M4B: on desktop, AAC+MP4 mux uses **FFmpeg** when available (`AURORABOOK_FFMPEG`, bundled
//! `ffmpeg` next to app resources, or `ffmpeg` on `PATH`). iOS and environments without FFmpeg
//! fall back to the pure-Rust AAC encoder + `mp4` muxer.

use super::repositories::{AudioRepository, BookRepository};
use super::get_db_connection;
use crate::tts_commands::encode_pcm_to_mp3_bytes;
use crate::utils::constants::DEFAULT_MP3_BITRATE;
use crate::utils::errors::{AppError, AppResult};
use mp4::{
    AacConfig, AudioObjectType, ChannelConfig, Mp4Config, Mp4Sample, Mp4Writer, SampleFreqIndex,
    TrackConfig,
};
use oxideav_aac::adts::parse_adts_header;
use oxideav_core::{AudioFrame, CodecId, CodecParameters, Frame, SampleFormat, TimeBase};
use std::io::{Cursor, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::Instant;
use tauri::{Emitter, Manager};

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
        Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .status()
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

/// Cancel an in-progress m4a/m4b export that uses FFmpeg by sending SIGTERM to the child process.
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

fn hint_from_href(href: &str, format_hint: AudioExportFormat) -> symphonia::core::probe::Hint {
    let mut hint = symphonia::core::probe::Hint::new();
    let lower = href.to_lowercase();
    if lower.ends_with(".mp3") {
        hint.with_extension("mp3");
    } else if lower.ends_with(".m4a")
        || lower.ends_with(".m4b")
        || lower.ends_with(".mp4")
        || lower.ends_with(".aac")
    {
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
        hint.with_extension(format_hint.as_str());
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
    // Use decoded frame count (not buffer capacity) to avoid out-of-bounds reads.
    let frames = decoded.frames();

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
fn decode_audio_blob_to_pcm(
    audio_bytes: &[u8],
    href: &str,
    format_hint: AudioExportFormat,
) -> AppResult<(Vec<u8>, u32, u32)> {
    use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
    use symphonia::core::errors::Error as SymphErr;
    use symphonia::core::formats::FormatOptions;
    use symphonia::core::io::MediaSourceStream;
    use symphonia::core::meta::MetadataOptions;

    let hint = hint_from_href(href, format_hint);
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

fn split_adts_to_raw_frames(adts_bytes: &[u8]) -> AppResult<Vec<Vec<u8>>> {
    let mut frames = Vec::new();
    let mut offset = 0usize;
    while offset < adts_bytes.len() {
        let header = parse_adts_header(&adts_bytes[offset..]).map_err(|e| {
            AppError::Encoding(format!("Failed to parse AAC ADTS header at {}: {}", offset, e))
        })?;
        if header.frame_length == 0 || offset + header.frame_length > adts_bytes.len() {
            return Err(AppError::Encoding(
                "Invalid ADTS frame length while encoding AAC".to_string(),
            ));
        }
        let header_len = header.header_length();
        let frame_end = offset + header.frame_length;
        let payload_start = offset + header_len;
        if payload_start > frame_end {
            return Err(AppError::Encoding(
                "Invalid ADTS payload offsets while encoding AAC".to_string(),
            ));
        }
        frames.push(adts_bytes[payload_start..frame_end].to_vec());
        offset = frame_end;
    }
    Ok(frames)
}

fn encode_pcm_to_aac_frames(
    pcm: Vec<u8>,
    sample_rate: u32,
    channels: u32,
    bitrate: u64,
) -> AppResult<Vec<Vec<u8>>> {
    let channel_count = u16::try_from(channels)
        .map_err(|_| AppError::Encoding("Channel count out of range for AAC".to_string()))?;
    let bytes_per_frame = 2usize * channels as usize;
    if pcm.len() % bytes_per_frame != 0 {
        return Err(AppError::Encoding(
            "PCM byte length is not aligned to 16-bit interleaved frames".to_string(),
        ));
    }
    let total_samples = pcm.len() / bytes_per_frame;
    let pcm = pcm;

    let mut params = CodecParameters::audio(CodecId::new("aac"));
    params.sample_rate = Some(sample_rate);
    params.channels = Some(channel_count);
    params.bit_rate = Some(bitrate);

    let mut encoder = oxideav_aac::encoder::make_encoder(&params)
        .map_err(|e| AppError::Encoding(format!("Failed to initialize AAC encoder: {}", e)))?;

    // Feed PCM in bounded chunks so `AudioFrame.samples` always fits `u32` and the encoder
    // stays within reasonable RAM while still preserving cross-chunk AAC state on one encoder.
    // Keep AAC input chunked close to codec frame cadence. Very large chunks can produce
    // unstable output quality in long-form content with the current pure-Rust encoder stack.
    const CHUNK_SAMPLES: usize = 4096;

    let mut encoded_frames = Vec::new();
    let mut offset_samples = 0usize;

    while offset_samples < total_samples {
        let chunk_samples = CHUNK_SAMPLES.min(total_samples - offset_samples);
        let byte_start = offset_samples * bytes_per_frame;
        let byte_end = (offset_samples + chunk_samples) * bytes_per_frame;
        let chunk = pcm[byte_start..byte_end].to_vec();

        let frame = Frame::Audio(AudioFrame {
            format: SampleFormat::S16,
            channels: channel_count,
            sample_rate,
            samples: u32::try_from(chunk_samples).map_err(|_| {
                AppError::Encoding("AAC PCM chunk sample count overflow".to_string())
            })?,
            pts: Some(offset_samples as i64),
            time_base: TimeBase::new(1, sample_rate as i64),
            data: vec![chunk],
        });
        encoder
            .send_frame(&frame)
            .map_err(|e| AppError::Encoding(format!("Failed to encode AAC frame: {}", e)))?;

        while let Ok(packet) = encoder.receive_packet() {
            let mut raw_frames = split_adts_to_raw_frames(&packet.data)?;
            encoded_frames.append(&mut raw_frames);
        }

        offset_samples += chunk_samples;
    }

    encoder
        .flush()
        .map_err(|e| AppError::Encoding(format!("Failed to flush AAC encoder: {}", e)))?;

    while let Ok(packet) = encoder.receive_packet() {
        let mut raw_frames = split_adts_to_raw_frames(&packet.data)?;
        encoded_frames.append(&mut raw_frames);
    }

    if encoded_frames.is_empty() {
        return Err(AppError::Encoding(
            "AAC encoder produced no output frames".to_string(),
        ));
    }

    Ok(encoded_frames)
}

#[cfg(target_os = "ios")]
fn resolve_ffmpeg_executable(_app: Option<&tauri::AppHandle>) -> Option<PathBuf> {
    None
}

#[cfg(not(target_os = "ios"))]
fn resolve_ffmpeg_executable(app: Option<&tauri::AppHandle>) -> Option<PathBuf> {
    fn ensure_executable(path: PathBuf) -> PathBuf {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Ok(meta) = std::fs::metadata(&path) {
                let mut perms = meta.permissions();
                let mode = perms.mode();
                if mode & 0o111 == 0 {
                    perms.set_mode(mode | 0o755);
                    let _ = std::fs::set_permissions(&path, perms);
                }
            }
        }
        path
    }

    if let Ok(p) = std::env::var("AURORABOOK_FFMPEG") {
        let pb = PathBuf::from(p.trim());
        if pb.is_file() {
            return Some(ensure_executable(pb));
        }
    }
    if let Some(app) = app {
        if let Ok(rd) = app.path().resource_dir() {
            for rel in [
                Path::new("ffmpeg"),
                Path::new("ffmpeg.exe"),
                Path::new("bin/ffmpeg"),
                Path::new("bin/ffmpeg.exe"),
                Path::new("resources/ffmpeg"),
                Path::new("resources/ffmpeg.exe"),
            ] {
                let candidate = rd.join(rel);
                if candidate.is_file() {
                    return Some(ensure_executable(candidate));
                }
            }
        }
    }
    let status = Command::new("ffmpeg")
        .arg("-version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .ok()?;
    if status.success() {
        return Some(PathBuf::from("ffmpeg"));
    }
    None
}

fn chapter_starts_for_pcm_tracks(
    book: &crate::book_service::models::Book,
    pcm_tracks: &[(Vec<u8>, u32, u32, String)],
    sample_rate: u32,
) -> Vec<(std::time::Duration, String)> {
    let mut chapter_starts: Vec<(std::time::Duration, String)> = Vec::new();
    let mut elapsed_samples = 0u64;
    for (index, (pcm, _sr, ch, _href)) in pcm_tracks.iter().enumerate() {
        let track_title = book
            .audio_tracks
            .get(index)
            .map(|t| t.title.clone())
            .unwrap_or_else(|| format!("Track {}", index + 1));
        chapter_starts.push((
            std::time::Duration::from_secs_f64(elapsed_samples as f64 / sample_rate as f64),
            track_title,
        ));
        let frame_samples = (pcm.len() / (2 * *ch as usize)) as u64;
        elapsed_samples += frame_samples;
    }
    chapter_starts
}

#[cfg(not(target_os = "ios"))]
fn create_mp4_export_file_ffmpeg(
    output_path: &str,
    book: &crate::book_service::models::Book,
    pcm_tracks: &[(Vec<u8>, u32, u32, String)],
    format: AudioExportFormat,
    ffmpeg_bin: &Path,
    mut on_track_encoded: impl FnMut(usize, usize) + Send,
) -> AppResult<()> {
    if pcm_tracks.is_empty() {
        return Err(AppError::Store(
            "No exportable audio tracks found for MP4 export".to_string(),
        ));
    }
    let first_sr = pcm_tracks[0].1;
    let first_ch = pcm_tracks[0].2;
    for (_, sr, ch, href) in pcm_tracks.iter().skip(1) {
        if *sr != first_sr || *ch != first_ch {
            return Err(AppError::Encoding(format!(
                "Mixed sample rate/channel tracks are not supported for m4a/m4b export (track '{}': {}Hz/{}ch, expected {}Hz/{}ch)",
                href, sr, ch, first_sr, first_ch
            )));
        }
    }
    let chapter_starts = chapter_starts_for_pcm_tracks(book, pcm_tracks, first_sr);

    let mut child = Command::new(ffmpeg_bin)
        .arg("-nostdin")
        .arg("-y")
        .arg("-f")
        .arg("s16le")
        .arg("-ar")
        .arg(first_sr.to_string())
        .arg("-ac")
        .arg(first_ch.to_string())
        .arg("-i")
        .arg("pipe:0")
        .arg("-c:a")
        .arg("aac")
        .arg("-b:a")
        .arg("128k")
        .arg("-profile:a")
        .arg("aac_low")
        .arg("-movflags")
        .arg("+faststart")
        .arg(output_path)
        .stdin(Stdio::piped())
        .stderr(Stdio::piped())
        .stdout(Stdio::null())
        .spawn()
        .map_err(|e| {
            AppError::Encoding(format!(
                "Failed to spawn FFmpeg for AAC export ({}): {}",
                ffmpeg_bin.display(),
                e
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

    let stdin = child.stdin.take().ok_or_else(|| {
        AppError::Encoding("FFmpeg subprocess has no stdin pipe".to_string())
    })?;

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

    let total = pcm_tracks.len();
    let output: Output = thread::scope(|s| -> AppResult<Output> {
        let writer = s.spawn(|| -> std::io::Result<()> {
            let mut stdin = stdin;
            for (index, (pcm, _sr, _ch, _href)) in pcm_tracks.iter().enumerate() {
                stdin.write_all(pcm)?;
                on_track_encoded(index + 1, total);
            }
            Ok(())
        });

        let out = child.wait_with_output().map_err(|e| {
            AppError::Encoding(format!("FFmpeg AAC export process failed: {}", e))
        })?;

        if !out.status.success() && export_cancelled_by_signal(&out.status) {
            let _ = writer.join();
            return Ok(out);
        }

        let writer_res = writer.join().map_err(|_| {
            AppError::Encoding("FFmpeg stdin writer thread panicked".to_string())
        })?;
        writer_res.map_err(|e| {
            AppError::Encoding(format!("Failed to pipe PCM to FFmpeg: {}", e))
        })?;

        Ok(out)
    })?;

    if !output.status.success() {
        let _ = std::fs::remove_file(output_path);
        if export_cancelled_by_signal(&output.status) {
            return Err(AppError::Store("Audio export cancelled".to_string()));
        }
        let tail = String::from_utf8_lossy(&output.stderr);
        let tail = if tail.len() > 4000 {
            format!("{}…", &tail[..4000])
        } else {
            tail.into_owned()
        };
        return Err(AppError::Encoding(format!(
            "FFmpeg AAC export failed (status {:?}): {}",
            output.status.code(),
            tail
        )));
    }

    if let Err(e) = apply_mp4_metadata_and_chapters(output_path, book, format, &chapter_starts) {
        log::warn!(
            "Could not embed MP4 metadata/chapters for {} export: {}",
            format.as_str(),
            e
        );
    }

    Ok(())
}

fn apply_mp4_metadata_and_chapters(
    output_path: &str,
    book: &crate::book_service::models::Book,
    format: AudioExportFormat,
    chapter_starts: &[(std::time::Duration, String)],
) -> AppResult<()> {
    let mut tag = mp4ameta::Tag::read_from_path(output_path)
        .map_err(|e| AppError::Encoding(format!("Failed to read MP4 metadata: {}", e)))?;

    tag.set_title(book.title.clone());
    tag.set_album(book.title.clone());
    tag.set_artist(book.author.clone());
    tag.set_album_artist(book.author.clone());
    if let Some(year) = &book.published_year {
        tag.set_year(year.clone());
    }
    if let Some(subjects) = &book.subjects {
        let custom_genres: Vec<String> = subjects
            .iter()
            .filter(|s| !s.trim().is_empty())
            .cloned()
            .collect();
        if !custom_genres.is_empty() {
            tag.set_custom_genres(custom_genres);
        }
    }

    if format == AudioExportFormat::M4b {
        tag.chapter_list_mut().clear();
        tag.chapter_track_mut().clear();
        tag.chapter_list_mut().extend(
            chapter_starts
                .iter()
                .map(|(start, title)| mp4ameta::Chapter::new(*start, title.clone())),
        );
    }

    tag.write_to_path(output_path)
        .map_err(|e| AppError::Encoding(format!("Failed to write MP4 metadata: {}", e)))
}

fn create_mp4_export_file_pure_rust(
    output_path: &str,
    book: &crate::book_service::models::Book,
    pcm_tracks: &[(Vec<u8>, u32, u32, String)],
    format: AudioExportFormat,
    mut on_track_encoded: impl FnMut(usize, usize),
) -> AppResult<()> {
    fn to_sample_freq_index(sample_rate: u32) -> AppResult<SampleFreqIndex> {
        match sample_rate {
            96_000 => Ok(SampleFreqIndex::Freq96000),
            88_200 => Ok(SampleFreqIndex::Freq88200),
            64_000 => Ok(SampleFreqIndex::Freq64000),
            48_000 => Ok(SampleFreqIndex::Freq48000),
            44_100 => Ok(SampleFreqIndex::Freq44100),
            32_000 => Ok(SampleFreqIndex::Freq32000),
            24_000 => Ok(SampleFreqIndex::Freq24000),
            22_050 => Ok(SampleFreqIndex::Freq22050),
            16_000 => Ok(SampleFreqIndex::Freq16000),
            12_000 => Ok(SampleFreqIndex::Freq12000),
            11_025 => Ok(SampleFreqIndex::Freq11025),
            8_000 => Ok(SampleFreqIndex::Freq8000),
            7_350 => Ok(SampleFreqIndex::Freq7350),
            _ => Err(AppError::Encoding(format!(
                "Unsupported AAC sample rate for MP4 writer: {}",
                sample_rate
            ))),
        }
    }

    fn to_channel_config(channels: u32) -> AppResult<ChannelConfig> {
        match channels {
            1 => Ok(ChannelConfig::Mono),
            2 => Ok(ChannelConfig::Stereo),
            3 => Ok(ChannelConfig::Three),
            4 => Ok(ChannelConfig::Four),
            5 => Ok(ChannelConfig::Five),
            6 => Ok(ChannelConfig::FiveOne),
            8 => Ok(ChannelConfig::SevenOne),
            _ => Err(AppError::Encoding(format!(
                "Unsupported AAC channel count for MP4 writer: {}",
                channels
            ))),
        }
    }

    if pcm_tracks.is_empty() {
        return Err(AppError::Store(
            "No exportable audio tracks found for MP4 export".to_string(),
        ));
    }

    let first_sr = pcm_tracks[0].1;
    let first_ch = pcm_tracks[0].2;
    for (_, sr, ch, href) in pcm_tracks.iter().skip(1) {
        if *sr != first_sr || *ch != first_ch {
            return Err(AppError::Encoding(format!(
                "Mixed sample rate/channel tracks are not supported for m4a/m4b export (track '{}': {}Hz/{}ch, expected {}Hz/{}ch)",
                href, sr, ch, first_sr, first_ch
            )));
        }
    }

    let mut out_file = std::fs::File::create(output_path)
        .map_err(|e| AppError::Store(format!("Failed to create output file: {}", e)))?;
    let mp4_cfg = Mp4Config {
        major_brand: "M4A ".parse().map_err(|e| {
            AppError::Encoding(format!("Failed to set MP4 major brand: {}", e))
        })?,
        minor_version: 0,
        compatible_brands: vec![
            "M4A ".parse().map_err(|e| {
                AppError::Encoding(format!("Failed to set MP4 compatible brand: {}", e))
            })?,
            "isom".parse().map_err(|e| {
                AppError::Encoding(format!("Failed to set MP4 compatible brand: {}", e))
            })?,
            "mp42".parse().map_err(|e| {
                AppError::Encoding(format!("Failed to set MP4 compatible brand: {}", e))
            })?,
        ],
        timescale: first_sr,
    };
    let mut muxer = Mp4Writer::write_start(&mut out_file, &mp4_cfg)
        .map_err(|e| AppError::Encoding(format!("Failed to start MP4 writer: {}", e)))?;
    // `TrackConfig::from(AacConfig)` defaults mdhd timescale to 1000 in mp4-0.14; our sample
    // durations are in PCM sample ticks (1024 per AAC-LC frame), so the media timescale must
    // match the audio sample rate or players report the wrong duration / play silence.
    let mut track_cfg = TrackConfig::from(AacConfig {
        bitrate: 128_000,
        profile: AudioObjectType::AacLowComplexity,
        freq_index: to_sample_freq_index(first_sr)?,
        chan_conf: to_channel_config(first_ch)?,
    });
    track_cfg.timescale = first_sr;
    muxer
        .add_track(&track_cfg)
        .map_err(|e| AppError::Encoding(format!("Failed to add AAC track: {}", e)))?;
    let track_id = 1u32;

    let mut chapter_starts: Vec<(std::time::Duration, String)> = Vec::new();
    let mut elapsed_samples = 0u64;
    let mut sample_start = 0u64;
    let mut total_samples_written = 0u64;

    for (index, (pcm, sr, ch, _href)) in pcm_tracks.iter().enumerate() {
        let track_title = book
            .audio_tracks
            .get(index)
            .map(|t| t.title.clone())
            .unwrap_or_else(|| format!("Track {}", index + 1));
        chapter_starts.push((
            std::time::Duration::from_secs_f64(elapsed_samples as f64 / first_sr as f64),
            track_title,
        ));

        let frame_samples = (pcm.len() / (2 * *ch as usize)) as u64;
        let encoded_frames = encode_pcm_to_aac_frames(pcm.clone(), *sr, *ch, 128_000)?;
        for frame in encoded_frames {
            muxer
                .write_sample(
                    track_id,
                    &Mp4Sample {
                        start_time: sample_start,
                        duration: 1024,
                        rendering_offset: 0,
                        is_sync: true,
                        bytes: frame.into(),
                    },
                )
                .map_err(|e| AppError::Encoding(format!("Failed to mux AAC frame: {}", e)))?;
            sample_start += 1024;
            total_samples_written += 1024;
        }
        on_track_encoded(index + 1, pcm_tracks.len());
        elapsed_samples += frame_samples;
    }

    if total_samples_written == 0 {
        return Err(AppError::Encoding(
            "No AAC frames were generated for MP4 export".to_string(),
        ));
    }

    muxer
        .write_end()
        .map_err(|e| AppError::Encoding(format!("Failed to finalize MP4 file: {}", e)))?;

    if let Err(e) = apply_mp4_metadata_and_chapters(output_path, book, format, &chapter_starts) {
        log::warn!(
            "Could not embed MP4 metadata/chapters for {} export: {}",
            format.as_str(),
            e
        );
    }

    Ok(())
}

fn create_mp4_export_file(
    output_path: &str,
    book: &crate::book_service::models::Book,
    pcm_tracks: &[(Vec<u8>, u32, u32, String)],
    format: AudioExportFormat,
    app: Option<&tauri::AppHandle>,
    on_track_encoded: impl FnMut(usize, usize) + Send,
) -> AppResult<()> {
    #[cfg(not(target_os = "ios"))]
    {
        if let Some(ffmpeg_bin) = resolve_ffmpeg_executable(app) {
            log::info!(
                "Using FFmpeg for {} export: {}",
                format.as_str(),
                ffmpeg_bin.display()
            );
            return create_mp4_export_file_ffmpeg(
                output_path,
                book,
                pcm_tracks,
                format,
                &ffmpeg_bin,
                on_track_encoded,
            );
        }
        log::warn!(
            "FFmpeg not found for {} export; falling back to pure-Rust AAC",
            format.as_str()
        );
    }
    #[cfg(target_os = "ios")]
    {
        let _ = app;
    }
    create_mp4_export_file_pure_rust(output_path, book, pcm_tracks, format, on_track_encoded)
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

    let mut pcm_tracks: Vec<(Vec<u8>, u32, u32, String)> = Vec::new();

    for (index, track) in sorted_tracks.iter().enumerate() {
        match AudioRepository::resolve_track_audio_bytes(db.as_ref(), &book_id, &track.id).await {
            Ok(Some((audio_bytes, href))) => {
                emit_progress(
                    &app,
                    format,
                    &book_id,
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

                let decoded = decode_audio_blob_to_pcm(&audio_bytes, &href, format)?;
                pcm_tracks.push((decoded.0, decoded.1, decoded.2, href));
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
            format!("Decoded track {}/{}", index + 1, total_tracks),
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

    let final_output = PathBuf::from(&output_path);
    let ext = final_output
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("m4a");
    let temp_output = final_output.with_extension(format!("{}.part", ext));
    let temp_output_str = temp_output
        .to_str()
        .ok_or_else(|| AppError::Store("Temporary output path is not valid UTF-8".to_string()))?;

    if temp_output.exists() {
        let _ = std::fs::remove_file(&temp_output);
    }

    if let Err(e) = create_mp4_export_file(
        temp_output_str,
        &book,
        &pcm_tracks,
        format,
        Some(&app),
        |encoded_tracks, total_tracks| {
            emit_progress(
                &app,
                format,
                &book_id,
                "encoding-aac",
                format!("Processed {} / {} tracks", encoded_tracks, total_tracks),
                encoded_tracks,
                total_tracks,
                if total_tracks > 0 {
                    (40 + (encoded_tracks * 59) / total_tracks).min(99) as u8
                } else {
                    0
                },
                estimate_eta_ms(&started, encoded_tracks, total_tracks),
            );
        },
    ) {
        let _ = std::fs::remove_file(&temp_output);
        return Err(e);
    }

    std::fs::rename(&temp_output, &final_output).map_err(|e| {
        let _ = std::fs::remove_file(&temp_output);
        AppError::Store(format!(
            "Failed to finalize export file '{}': {}",
            final_output.display(),
            e
        ))
    })?;

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

/// Export all audiobook tracks as one concatenated MP3 file (basic: one MP3 frame stream per track appended).
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

    let db = get_db_connection(&app).await.map_err(|e| AppError::Store(e))?;

    let book = BookRepository::find_by_id(db.as_ref(), &book_id)
        .await
        .map_err(|e| AppError::Store(e))?
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

    let mut out_file = std::fs::File::create(&output_path)
        .map_err(|e| AppError::Store(format!("Failed to create output file: {}", e)))?;

    let mut wrote_any = false;
    let mut missing = 0usize;

    for (index, track) in sorted_tracks.iter().enumerate() {
        match AudioRepository::resolve_track_audio_bytes(db.as_ref(), &book_id, &track.id).await {
            Ok(Some((audio_bytes, href))) => {
                emit_progress(
                    &app,
                    AudioExportFormat::Mp3,
                    &book_id,
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

                let (pcm, sample_rate, channels) =
                    match decode_audio_blob_to_pcm(&audio_bytes, &href, AudioExportFormat::Mp3) {
                    Ok(v) => v,
                    Err(e) => {
                        log::warn!("Skipping track {} ({}): {}", track.id, href, e);
                        missing += 1;
                        continue;
                    }
                };

                emit_progress(
                    &app,
                    AudioExportFormat::Mp3,
                    &book_id,
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
        let eta_ms = estimate_eta_ms(&started, processed, total_tracks);
        emit_progress(
            &app,
            AudioExportFormat::Mp3,
            &book_id,
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
mod m4b_export_tests {
    use super::*;
    use crate::book_service::models::{
        AudioSyncMap, AudioTrack, Book, BookAudioState, BookProgress, Chapter, ConversionStatus,
    };
    use std::fs::File;
    use std::io::Read;
    use std::path::{Path, PathBuf};
    use zip::ZipArchive;

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
            last_opened_time: None,
        }
    }

    /// Regression: m4b mux output must be readable by mp4ameta so metadata/chapters can be embedded.
    #[test]
    fn m4b_two_track_export_roundtrips_metadata_and_chapters() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let out_path = tmp.path().join("sample.m4b");
        let out_str = out_path.to_str().expect("utf8 path");

        let book = sample_book_two_tracks();
        let pcm1 = sine_pcm_16le_mono(44_100, 440.0, 0.25);
        let pcm2 = sine_pcm_16le_mono(44_100, 554.0, 0.25);
        let pcm_tracks = vec![
            (pcm1, 44_100u32, 1u32, "track1.raw".to_string()),
            (pcm2, 44_100u32, 1u32, "track2.raw".to_string()),
        ];

        create_mp4_export_file(out_str, &book, &pcm_tracks, AudioExportFormat::M4b, None, |_, _| {})
            .expect("create m4b");

        let meta = std::fs::metadata(&out_path).expect("stat output");
        assert!(meta.len() > 8_000, "m4b output unexpectedly small: {} bytes", meta.len());

        // Metadata read must succeed (this is what failed when mux output was incompatible).
        let tag = mp4ameta::Tag::read_from_path(out_str).expect("read mp4ameta tag");
        assert_eq!(tag.title(), Some("M4B Test Book"));
        assert_eq!(tag.artist(), Some("Test Author"));

        let chapters = tag.chapter_list();
        assert!(
            chapters.len() >= 2,
            "expected at least 2 chapter markers, got {}",
            chapters.len()
        );
        assert_eq!(chapters[0].title, "Track One");
        assert_eq!(chapters[1].title, "Track Two");

        let f = File::open(out_str).expect("open m4b");
        let mp4 = mp4::read_mp4(f).expect("parse mp4");
        let secs = mp4.duration().as_secs_f64();
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

        let mut pcm_tracks: Vec<(Vec<u8>, u32, u32, String)> = Vec::new();
        let mut audio_tracks: Vec<AudioTrack> = Vec::new();

        for i in 0..zip.len() {
            let mut entry = zip.by_index(i).expect("zip entry");
            let name = entry.name().to_string();
            if !is_likely_audio_name(&name) {
                continue;
            }
            let mut bytes = Vec::new();
            entry.read_to_end(&mut bytes).expect("read audio entry");
            let (pcm, sample_rate, channels) =
                decode_audio_blob_to_pcm(&bytes, &name, AudioExportFormat::M4a)
                    .expect("decode audio track from sample epub");

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
            pcm_tracks.push((pcm, sample_rate, channels, name));
        }

        assert!(
            !pcm_tracks.is_empty(),
            "Sample EPUB has no decodable embedded audio tracks: {}",
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
            last_opened_time: None,
        };

        let tmp = tempfile::tempdir().expect("tempdir");
        let m4a = tmp.path().join("sample.m4a");
        let m4b = tmp.path().join("sample.m4b");
        let m4a_str = m4a.to_str().expect("utf8 m4a path");
        let m4b_str = m4b.to_str().expect("utf8 m4b path");

        create_mp4_export_file(m4a_str, &book, &pcm_tracks, AudioExportFormat::M4a, None, |_, _| {})
            .expect("export sample m4a");
        create_mp4_export_file(m4b_str, &book, &pcm_tracks, AudioExportFormat::M4b, None, |_, _| {})
            .expect("export sample m4b");

        let m4a_meta = std::fs::metadata(&m4a).expect("stat m4a");
        let m4b_meta = std::fs::metadata(&m4b).expect("stat m4b");
        assert!(m4a_meta.len() > 16_000, "m4a output too small: {}", m4a_meta.len());
        assert!(m4b_meta.len() > 16_000, "m4b output too small: {}", m4b_meta.len());

        let m4a_reader = mp4::read_mp4(File::open(&m4a).expect("open m4a")).expect("parse m4a");
        let m4b_reader = mp4::read_mp4(File::open(&m4b).expect("open m4b")).expect("parse m4b");
        assert!(
            m4a_reader.duration().as_secs_f64() > 1.0,
            "m4a duration unexpectedly short: {}s",
            m4a_reader.duration().as_secs_f64()
        );
        assert!(
            m4b_reader.duration().as_secs_f64() > 1.0,
            "m4b duration unexpectedly short: {}s",
            m4b_reader.duration().as_secs_f64()
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
