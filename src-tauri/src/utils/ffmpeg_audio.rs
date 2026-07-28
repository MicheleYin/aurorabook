//! Decode, tag, and transcode audio via **FFmpeg** on `PATH`.
//! iOS builds do not invoke these helpers in production export paths; stubs return errors / `None`.

use crate::utils::constants::DEFAULT_MP3_BITRATE;
use crate::utils::errors::{AppError, AppResult};
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use symphonia::default::{get_codecs, get_probe};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;

const EXPORT_DECODE_SAMPLE_RATE: u32 = 44_100;
const EXPORT_DECODE_CHANNELS: u32 = 2;
static FFMPEG_BIN_PATH: OnceLock<PathBuf> = OnceLock::new();

fn candidate_if_file(path: PathBuf) -> Option<PathBuf> {
    // Ignore empty placeholders created for Tauri bundle path validation in CI/tests.
    if path.is_file()
        && std::fs::metadata(&path)
            .map(|m| m.len() > 0)
            .unwrap_or(false)
    {
        Some(path)
    } else {
        None
    }
}

fn detect_ffmpeg_path() -> PathBuf {
    if let Ok(p) = std::env::var("AURORABOOK_FFMPEG") {
        let pb = PathBuf::from(p.trim());
        if let Some(found) = candidate_if_file(pb) {
            return found;
        }
    }

    if let Ok(p) = std::env::var("TAURI_RESOURCE_DIR") {
        let root = PathBuf::from(p);
        if let Some(found) = candidate_if_file(root.join("ffmpeg")) {
            return found;
        }
        if let Some(found) = candidate_if_file(root.join("resources").join("ffmpeg")) {
            return found;
        }
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(contents_dir) = exe.parent().and_then(|p| p.parent()) {
            if let Some(found) = candidate_if_file(contents_dir.join("Resources").join("ffmpeg")) {
                return found;
            }
            if let Some(found) =
                candidate_if_file(contents_dir.join("Resources").join("resources").join("ffmpeg"))
            {
                return found;
            }
        }
    }

    if let Ok(current_dir) = std::env::current_dir() {
        if let Some(found) = candidate_if_file(current_dir.join("src-tauri").join("resources").join("ffmpeg")) {
            return found;
        }
        if let Some(found) = candidate_if_file(current_dir.join("resources").join("ffmpeg")) {
            return found;
        }
    }

    if let Some(found) = candidate_if_file(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("ffmpeg"),
    ) {
        return found;
    }

    PathBuf::from("ffmpeg")
}

pub fn ffmpeg_command() -> Command {
    let bin = FFMPEG_BIN_PATH.get_or_init(detect_ffmpeg_path);
    Command::new(bin)
}

fn stderr_snippet(stderr: &[u8], max: usize) -> String {
    let s = String::from_utf8_lossy(stderr);
    if s.len() > max {
        format!("{}…", &s[..max])
    } else {
        s.into_owned()
    }
}

/// File extension (no dot) used for a temp input so FFmpeg can probe the container.
pub fn extension_hint_from_href(href: &str, format_fallback: &str) -> String {
    let lower = href.to_lowercase();
    let ext = if lower.ends_with(".mp3") {
        "mp3"
    } else if lower.ends_with(".m4a")
        || lower.ends_with(".m4b")
        || lower.ends_with(".mp4")
        || lower.ends_with(".aac")
    {
        "m4a"
    } else if lower.ends_with(".ogg") {
        "ogg"
    } else if lower.ends_with(".opus") {
        "opus"
    } else if lower.ends_with(".wav") {
        "wav"
    } else if lower.ends_with(".flac") {
        "flac"
    } else {
        format_fallback
    };
    ext.to_string()
}

/// Decode `audio_bytes` to interleaved s16le PCM using FFmpeg.
///
/// Export decode is normalized to a fixed format to avoid a separate probing step:
/// 44.1 kHz, stereo, 16-bit PCM.
#[cfg(not(target_os = "ios"))]
pub fn decode_audio_blob_to_pcm(
    audio_bytes: &[u8],
    href: &str,
    format_fallback: &str,
) -> AppResult<(Vec<u8>, u32, u32)> {
    if audio_bytes.is_empty() {
        return Err(AppError::Encoding("Empty audio input".into()));
    }
    let ext = extension_hint_from_href(href, format_fallback);
    let mut tmp = tempfile::Builder::new()
        .suffix(&format!(".{}", ext))
        .tempfile()
        .map_err(|e| AppError::Encoding(format!("Temp file for decode: {}", e)))?;
    tmp.write_all(audio_bytes)
        .map_err(|e| AppError::Encoding(format!("Write temp audio: {}", e)))?;
    tmp.flush()
        .map_err(|e| AppError::Encoding(format!("Sync temp audio: {}", e)))?;
    let path = tmp.into_temp_path();

    let out = ffmpeg_command()
        .arg("-nostdin")
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("error")
        .arg("-i")
        .arg(path.as_os_str())
        .arg("-ar")
        .arg(EXPORT_DECODE_SAMPLE_RATE.to_string())
        .arg("-ac")
        .arg(EXPORT_DECODE_CHANNELS.to_string())
        .arg("-f")
        .arg("s16le")
        .arg("-acodec")
        .arg("pcm_s16le")
        .arg("-")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| {
            let _ = std::fs::remove_file(&path);
            AppError::Encoding(format!("Failed to run ffmpeg decode: {}", e))
        })?;
    let _ = std::fs::remove_file(&path);

    if !out.status.success() {
        return Err(AppError::Encoding(format!(
            "FFmpeg decode failed: {}",
            stderr_snippet(&out.stderr, 4000)
        )));
    }
    let pcm = out.stdout;
    if pcm.is_empty() {
        return Err(AppError::Encoding(
            "FFmpeg decode produced no PCM output".into(),
        ));
    }
    let channels = EXPORT_DECODE_CHANNELS;
    if pcm.len() % (2 * channels as usize) != 0 {
        return Err(AppError::Encoding(
            "Decoded PCM size is not aligned to frame size".into(),
        ));
    }
    Ok((pcm, EXPORT_DECODE_SAMPLE_RATE, EXPORT_DECODE_CHANNELS))
}

#[cfg(target_os = "ios")]
pub fn decode_audio_blob_to_pcm(
    _audio_bytes: &[u8],
    _href: &str,
    _format_fallback: &str,
) -> AppResult<(Vec<u8>, u32, u32)> {
    Err(AppError::Encoding(
        "Audio decode for export requires FFmpeg (not available on this iOS build).".into(),
    ))
}

/// Encode s16le PCM to MP3 using FFmpeg `libmp3lame`.
#[cfg(not(target_os = "ios"))]
pub fn encode_pcm_to_mp3_bytes(
    pcm_data: Vec<u8>,
    sample_rate: u32,
    channels: u32,
    bitrate_kbps: Option<u32>,
) -> AppResult<Vec<u8>> {
    let bitrate_kbps = bitrate_kbps.unwrap_or(DEFAULT_MP3_BITRATE);
    if pcm_data.is_empty() {
        return Err(AppError::Encoding("PCM data is empty".to_string()));
    }
    if sample_rate == 0 {
        return Err(AppError::Config(
            "Sample rate must be greater than 0".to_string(),
        ));
    }
    if channels != 1 && channels != 2 {
        return Err(AppError::Config(
            "Channels must be 1 (mono) or 2 (stereo)".to_string(),
        ));
    }
    if pcm_data.len() % (channels as usize * 2) != 0 {
        return Err(AppError::Encoding(format!(
            "PCM data length ({}) must be divisible by {} (channels * 2 bytes per sample)",
            pcm_data.len(),
            channels * 2
        )));
    }

    let br = format!("{}k", bitrate_kbps);
    let mut child = ffmpeg_command()
        .arg("-nostdin")
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("error")
        .arg("-f")
        .arg("s16le")
        .arg("-ar")
        .arg(sample_rate.to_string())
        .arg("-ac")
        .arg(channels.to_string())
        .arg("-i")
        .arg("pipe:0")
        .arg("-c:a")
        .arg("libmp3lame")
        .arg("-b:a")
        .arg(&br)
        .arg("-f")
        .arg("mp3")
        .arg("-")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| AppError::Encoding(format!("Failed to spawn ffmpeg MP3 encode: {}", e)))?;

    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| AppError::Encoding("ffmpeg has no stdin".into()))?;
    stdin
        .write_all(&pcm_data)
        .map_err(|e| AppError::Encoding(format!("Write PCM to ffmpeg: {}", e)))?;
    drop(stdin);

    let out = child
        .wait_with_output()
        .map_err(|e| AppError::Encoding(format!("ffmpeg MP3 encode wait: {}", e)))?;
    if !out.status.success() {
        return Err(AppError::Encoding(format!(
            "FFmpeg MP3 encode failed: {}",
            stderr_snippet(&out.stderr, 4000)
        )));
    }
    if out.stdout.is_empty() {
        return Err(AppError::Encoding(
            "MP3 encoding produced no output".to_string(),
        ));
    }
    Ok(out.stdout)
}

#[cfg(target_os = "ios")]
pub fn encode_pcm_to_mp3_bytes(
    _pcm_data: Vec<u8>,
    _sample_rate: u32,
    _channels: u32,
    _bitrate_kbps: Option<u32>,
) -> AppResult<Vec<u8>> {
    Err(AppError::Encoding(
        "MP3 encoding requires FFmpeg (not available on this iOS build).".into(),
    ))
}

fn escape_ffmetadata_value(s: &str) -> String {
    let mut o = String::with_capacity(s.len());
    for ch in s.chars() {
        match ch {
            '\\' | '=' | ';' | '#' | '\n' | '\r' => {
                o.push('\\');
                o.push(ch);
            }
            _ => o.push(ch),
        }
    }
    o
}

#[cfg(not(target_os = "ios"))]
fn media_format_duration_seconds(path: &Path) -> AppResult<f64> {
    let file = std::fs::File::open(path)
        .map_err(|e| AppError::Encoding(format!("Open media for duration failed: {}", e)))?;

    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let probed = get_probe()
        .format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default())
        .map_err(|e| AppError::Encoding(format!("Probe media duration failed: {}", e)))?;
    let mut format = probed.format;
    let track = format
        .default_track()
        .ok_or_else(|| AppError::Encoding("No default audio track for duration probe".into()))?;

    if let (Some(frames), Some(sr)) = (track.codec_params.n_frames, track.codec_params.sample_rate) {
        if sr > 0 {
            return Ok(frames as f64 / sr as f64);
        }
    }

    let track_id = track.id;
    let mut decoder = get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| AppError::Encoding(format!("Create decoder for duration failed: {}", e)))?;
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

    let sr = sample_rate.ok_or_else(|| {
        AppError::Encoding("Missing sample rate while decoding media duration".into())
    })?;
    if total_frames == 0 {
        return Err(AppError::Encoding(
            "Decoded zero frames while computing media duration".into(),
        ));
    }
    Ok(total_frames as f64 / sr as f64)
}

#[cfg(not(target_os = "ios"))]
pub fn probe_media_duration_seconds(path: &Path) -> AppResult<f64> {
    media_format_duration_seconds(path)
}

#[cfg(target_os = "ios")]
pub fn probe_media_duration_seconds(_path: &Path) -> AppResult<f64> {
    Err(AppError::Encoding(
        "Media duration probing requires FFmpeg-enabled export support.".into(),
    ))
}

/// Embed MP4/M4A/M4B tags and (for M4B) chapter markers using FFmpeg + ffmetadata.
#[cfg(not(target_os = "ios"))]
pub fn apply_mp4_metadata_and_chapters_ffmpeg(
    output_path: &str,
    title: &str,
    author: &str,
    year: Option<&str>,
    genre_joined: Option<&str>,
    chapter_starts: &[(std::time::Duration, String)],
    embed_chapters: bool,
) -> AppResult<()> {
    let in_path = Path::new(output_path);

    let mut meta_lines: Vec<String> = vec![";FFMETADATA1".to_string()];
    meta_lines.push(format!("title={}", escape_ffmetadata_value(title)));
    meta_lines.push(format!("album={}", escape_ffmetadata_value(title)));
    meta_lines.push(format!("artist={}", escape_ffmetadata_value(author)));
    meta_lines.push(format!(
        "album_artist={}",
        escape_ffmetadata_value(author)
    ));
    if let Some(y) = year {
        if !y.is_empty() {
            meta_lines.push(format!("date={}", escape_ffmetadata_value(y)));
        }
    }
    if let Some(g) = genre_joined {
        if !g.is_empty() {
            meta_lines.push(format!("genre={}", escape_ffmetadata_value(g)));
        }
    }

    if embed_chapters && !chapter_starts.is_empty() {
        let duration_s = media_format_duration_seconds(in_path)?;
        let duration_us = (duration_s * 1_000_000.0).round().max(1.0) as i64;
        let n = chapter_starts.len();
        for (i, (start, chapter_title)) in chapter_starts.iter().enumerate() {
            let start_us = (start.as_secs_f64() * 1_000_000.0).round() as i64;
            let end_us = if i + 1 < n {
                (chapter_starts[i + 1].0.as_secs_f64() * 1_000_000.0).round() as i64
            } else {
                duration_us
            };
            meta_lines.push(String::new());
            meta_lines.push("[CHAPTER]".to_string());
            meta_lines.push("TIMEBASE=1/1000000".to_string());
            meta_lines.push(format!("START={}", start_us.max(0)));
            meta_lines.push(format!("END={}", end_us.max(start_us + 1)));
            meta_lines.push(format!(
                "title={}",
                escape_ffmetadata_value(chapter_title)
            ));
        }
    }

    let meta_body = meta_lines.join("\n");
    let meta_tmp = tempfile::NamedTempFile::new()
        .map_err(|e| AppError::Encoding(format!("ffmetadata temp: {}", e)))?;
    std::fs::write(meta_tmp.path(), meta_body.as_bytes())
        .map_err(|e| AppError::Encoding(format!("Write ffmetadata: {}", e)))?;

    let parent = in_path
        .parent()
        .filter(|p| !p.as_os_str().is_empty());
    let out_tmp = tempfile::Builder::new()
        .suffix(".tagged.mp4.work")
        .tempfile_in(parent.unwrap_or_else(|| Path::new(".")))
        .map_err(|e| AppError::Encoding(format!("Tagged output temp: {}", e)))?;
    let out_tmp_path = out_tmp.path().to_path_buf();

    let mut cmd = ffmpeg_command();
    cmd.arg("-nostdin")
        .arg("-y")
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("error")
        .arg("-i")
        .arg(in_path.as_os_str())
        .arg("-i")
        .arg(meta_tmp.path().as_os_str())
        .arg("-map_metadata")
        .arg("1")
        .arg("-codec")
        .arg("copy");
    if embed_chapters && !chapter_starts.is_empty() {
        cmd.arg("-map_chapters").arg("1");
    }
    // Temp names use a non-standard extension; FFmpeg 8+ needs an explicit muxer.
    cmd.arg("-f").arg("mp4");
    let out = cmd
        .arg(out_tmp_path.as_os_str())
        .output()
        .map_err(|e| AppError::Encoding(format!("ffmpeg metadata mux: {}", e)))?;

    if !out.status.success() {
        let _ = std::fs::remove_file(&out_tmp_path);
        return Err(AppError::Encoding(format!(
            "FFmpeg failed to mux metadata/chapters: {}",
            stderr_snippet(&out.stderr, 4000)
        )));
    }

    std::fs::rename(&out_tmp_path, in_path).map_err(|e| {
        let _ = std::fs::remove_file(&out_tmp_path);
        AppError::Encoding(format!("Replace file with tagged output: {}", e))
    })?;

    Ok(())
}

#[cfg(target_os = "ios")]
pub fn apply_mp4_metadata_and_chapters_ffmpeg(
    _output_path: &str,
    _title: &str,
    _author: &str,
    _year: Option<&str>,
    _genre_joined: Option<&str>,
    _chapter_starts: &[(std::time::Duration, String)],
    _embed_chapters: bool,
) -> AppResult<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extension_hint_maps_known_containers() {
        assert_eq!(extension_hint_from_href("a.MP3", "bin"), "mp3");
        assert_eq!(extension_hint_from_href("a.m4b", "bin"), "m4a");
        assert_eq!(extension_hint_from_href("a.aac", "bin"), "m4a");
        assert_eq!(extension_hint_from_href("a.ogg", "bin"), "ogg");
        assert_eq!(extension_hint_from_href("a.opus", "bin"), "opus");
        assert_eq!(extension_hint_from_href("a.wav", "bin"), "wav");
        assert_eq!(extension_hint_from_href("a.flac", "bin"), "flac");
        assert_eq!(extension_hint_from_href("a.bin", "mp3"), "mp3");
    }

    #[test]
    fn escape_ffmetadata_escapes_special_chars() {
        assert_eq!(escape_ffmetadata_value(r"a=b;c#d\e"), r"a\=b\;c\#d\\e");
        assert_eq!(
            escape_ffmetadata_value("line\nbreak\r"),
            "line\\\nbreak\\\r"
        );
        assert_eq!(escape_ffmetadata_value("plain"), "plain");
    }

    #[test]
    fn stderr_snippet_truncates_long_output() {
        assert_eq!(stderr_snippet(b"ok", 10), "ok");
        assert_eq!(stderr_snippet(b"abcdefghijklmnop", 5), "abcde…");
    }

    #[test]
    fn candidate_if_file_rejects_missing_and_empty() {
        let missing = candidate_if_file(std::path::PathBuf::from("/no/such/ffmpeg-bin"));
        assert!(missing.is_none());

        let dir = tempfile::tempdir().expect("tempdir");
        let empty = dir.path().join("ffmpeg");
        std::fs::write(&empty, b"").expect("write empty");
        assert!(candidate_if_file(empty.clone()).is_none());

        std::fs::write(&empty, b"#!/bin/sh\n").expect("write non-empty");
        assert_eq!(candidate_if_file(empty.clone()), Some(empty));
    }

    #[test]
    fn extension_hint_falls_back_for_unknown() {
        assert_eq!(extension_hint_from_href("track.bin", "wav"), "wav");
        assert_eq!(extension_hint_from_href("track.MP4", "bin"), "m4a");
    }
}
