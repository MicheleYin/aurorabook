//! Decode, probe, tag, and transcode audio via **FFmpeg** / **ffprobe** on `PATH`.
//! iOS builds do not invoke these helpers in production export paths; stubs return errors / `None`.

use crate::utils::constants::DEFAULT_MP3_BITRATE;
use crate::utils::errors::{AppError, AppResult};
use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

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

fn extension_from_mime(mime_type: &str) -> &'static str {
    if mime_type.contains("mpeg") || mime_type.contains("mp3") {
        "mp3"
    } else if mime_type.contains("wav") {
        "wav"
    } else if mime_type.contains("mp4") || mime_type.contains("m4a") {
        "m4a"
    } else if mime_type.contains("ogg") {
        "ogg"
    } else if mime_type.contains("opus") {
        "opus"
    } else {
        "mp3"
    }
}

#[cfg(not(target_os = "ios"))]
fn ffprobe_on_path() -> bool {
    Command::new("ffprobe")
        .arg("-version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Duration in seconds from audio bytes, or `None` if probing fails / unsupported platform.
#[cfg(not(target_os = "ios"))]
pub fn ffprobe_audio_duration_seconds(audio_bytes: &[u8], mime_type: &str) -> Option<f64> {
    if !ffprobe_on_path() || audio_bytes.is_empty() {
        return None;
    }
    let ext = extension_from_mime(mime_type);
    let mut tmp = tempfile::Builder::new()
        .suffix(&format!(".{}", ext))
        .tempfile()
        .ok()?;
    tmp.write_all(audio_bytes).ok()?;
    tmp.flush().ok()?;
    let path = tmp.into_temp_path();
    let out = Command::new("ffprobe")
        .arg("-v")
        .arg("error")
        .arg("-show_entries")
        .arg("format=duration")
        .arg("-of")
        .arg("default=noprint_wrappers=1:nokey=1")
        .arg(path.as_os_str())
        .output()
        .ok()?;
    let _ = std::fs::remove_file(&path);
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    text.trim().parse::<f64>().ok()
}

#[cfg(target_os = "ios")]
pub fn ffprobe_audio_duration_seconds(_audio_bytes: &[u8], _mime_type: &str) -> Option<f64> {
    None
}

#[cfg(not(target_os = "ios"))]
fn ffprobe_sample_rate_channels(path: &Path) -> AppResult<(u32, u32)> {
    let out = Command::new("ffprobe")
        .arg("-v")
        .arg("error")
        .arg("-select_streams")
        .arg("a:0")
        .arg("-show_entries")
        .arg("stream=sample_rate,channels")
        .arg("-of")
        .arg("csv=p=0")
        .arg(path.as_os_str())
        .output()
        .map_err(|e| AppError::Encoding(format!("Failed to run ffprobe: {}", e)))?;
    if !out.status.success() {
        return Err(AppError::Encoding(format!(
            "ffprobe failed: {}",
            stderr_snippet(&out.stderr, 2000)
        )));
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let line = text.trim();
    let mut parts = line.split(',');
    let sr: u32 = parts
        .next()
        .ok_or_else(|| AppError::Encoding("ffprobe: missing sample_rate".into()))?
        .trim()
        .parse()
        .map_err(|_| AppError::Encoding(format!("ffprobe: bad sample_rate {:?}", line)))?;
    let ch: u32 = parts
        .next()
        .ok_or_else(|| AppError::Encoding("ffprobe: missing channels".into()))?
        .trim()
        .parse()
        .map_err(|_| AppError::Encoding(format!("ffprobe: bad channels {:?}", line)))?;
    Ok((sr, ch.max(1)))
}

/// Decode `audio_bytes` to interleaved s16le PCM using FFmpeg (native stream sample rate).
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

    let (sample_rate, channels) = ffprobe_sample_rate_channels(&path)?;

    let out = Command::new("ffmpeg")
        .arg("-nostdin")
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("error")
        .arg("-i")
        .arg(path.as_os_str())
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
    if pcm.len() % (2 * channels as usize) != 0 {
        return Err(AppError::Encoding(
            "Decoded PCM size is not aligned to frame size".into(),
        ));
    }
    Ok((pcm, sample_rate, channels))
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
    let mut child = Command::new("ffmpeg")
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
fn ffprobe_format_duration_seconds(path: &Path) -> AppResult<f64> {
    let out = Command::new("ffprobe")
        .arg("-v")
        .arg("error")
        .arg("-show_entries")
        .arg("format=duration")
        .arg("-of")
        .arg("default=noprint_wrappers=1:nokey=1")
        .arg(path.as_os_str())
        .output()
        .map_err(|e| AppError::Encoding(format!("ffprobe duration: {}", e)))?;
    if !out.status.success() {
        return Err(AppError::Encoding(format!(
            "ffprobe duration failed: {}",
            stderr_snippet(&out.stderr, 2000)
        )));
    }
    let t = String::from_utf8_lossy(&out.stdout);
    t.trim()
        .parse::<f64>()
        .map_err(|_| AppError::Encoding(format!("ffprobe: bad duration {:?}", t)))
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
        let duration_s = ffprobe_format_duration_seconds(in_path)?;
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
        .suffix(".tagged.mp4.part")
        .tempfile_in(parent.unwrap_or_else(|| Path::new(".")))
        .map_err(|e| AppError::Encoding(format!("Tagged output temp: {}", e)))?;
    let out_tmp_path = out_tmp.path().to_path_buf();

    let mut cmd = Command::new("ffmpeg");
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
    // Temp names use `.mp4.part`; FFmpeg 8+ needs an explicit muxer.
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
