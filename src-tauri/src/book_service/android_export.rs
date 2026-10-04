use crate::book_service::models::Book;
use crate::utils::errors::{AppError, AppResult};
use jni::objects::{JClass, JObject, JObjectArray, JString, JValue};
use jni::sys::{jboolean, jint};
use jni::{JNIEnv, JavaVM};
use mp4ameta::{Chapter, Tag};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

pub(crate) struct AndroidExportTrack {
    pub path: PathBuf,
    pub title: String,
    pub duration_seconds: Option<f64>,
}

static ANDROID_EXPORT_PROGRESS: AtomicU64 = AtomicU64::new(0);

#[no_mangle]
pub extern "system" fn Java_com_micheleyin_aurorabook_NativeAudioExporter_nativeIsCancelled(
    _env: JNIEnv<'_>,
    _class: JClass<'_>,
) -> jboolean {
    crate::book_service::ios_export::ios_export_cancel_requested() as jboolean
}

#[no_mangle]
pub extern "system" fn Java_com_micheleyin_aurorabook_NativeAudioExporter_nativeProgress(
    _env: JNIEnv<'_>,
    _class: JClass<'_>,
    track_index: jint,
    percent: jint,
) {
    let track = track_index.max(0) as u64;
    let percent = percent.clamp(0, 100) as u64;
    ANDROID_EXPORT_PROGRESS.store((track << 32) | percent, Ordering::Release);
}

fn call_android_encoder(
    tracks: &[AndroidExportTrack],
    output_path: &Path,
    format: &str,
) -> Result<Vec<u64>, String> {
    let context = ndk_context::android_context();
    let vm = unsafe { JavaVM::from_raw(context.vm() as *mut jni::sys::JavaVM) }
        .map_err(|error| format!("Attach to Android JVM: {error}"))?;
    let mut env = vm
        .attach_current_thread()
        .map_err(|error| format!("Attach Android export thread: {error}"))?;
    let class = env
        .find_class("com/micheleyin/aurorabook/NativeAudioExporter")
        .map_err(|error| format!("Find Android audio exporter: {error}"))?;
    let path_array: JObjectArray<'_> = env
        .new_object_array(tracks.len() as jint, "java/lang/String", JObject::null())
        .map_err(|error| format!("Create Android input path array: {error}"))?;
    let title_array: JObjectArray<'_> = env
        .new_object_array(tracks.len() as jint, "java/lang/String", JObject::null())
        .map_err(|error| format!("Create Android chapter title array: {error}"))?;

    for (index, track) in tracks.iter().enumerate() {
        let path = env
            .new_string(track.path.to_string_lossy().as_ref())
            .map_err(|error| format!("Create Android input path: {error}"))?;
        let title = env
            .new_string(&track.title)
            .map_err(|error| format!("Create Android chapter title: {error}"))?;
        env.set_object_array_element(&path_array, index as jint, path)
            .map_err(|error| format!("Set Android input path: {error}"))?;
        env.set_object_array_element(&title_array, index as jint, title)
            .map_err(|error| format!("Set Android chapter title: {error}"))?;
    }
    let output = env
        .new_string(output_path.to_string_lossy().as_ref())
        .map_err(|error| format!("Create Android output path: {error}"))?;
    let format = env
        .new_string(format)
        .map_err(|error| format!("Create Android output format: {error}"))?;
    let result = env
        .call_static_method(
            class,
            "exportAac",
            "([Ljava/lang/String;[Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;",
            &[
                JValue::Object(path_array.as_ref()),
                JValue::Object(title_array.as_ref()),
                JValue::Object(output.as_ref()),
                JValue::Object(format.as_ref()),
            ],
        )
        .map_err(|error| format!("Android MediaCodec export failed: {error}"))?
        .l()
        .map_err(|error| format!("Read Android export result: {error}"))?;
    if result.is_null() {
        return Err("Android MediaCodec returned no chapter offsets".to_string());
    }
    let result = JString::from(result);
    let json: String = env
        .get_string(&result)
        .map_err(|error| format!("Read Android chapter offsets: {error}"))?
        .into();
    serde_json::from_str(&json)
        .map_err(|error| format!("Parse Android chapter offsets: {error}"))
}

pub(crate) fn export_m4a_or_m4b(
    output_path: &Path,
    book: &Book,
    format: &str,
    tracks: &[AndroidExportTrack],
    mut on_progress: impl FnMut(usize, u8),
) -> AppResult<()> {
    if tracks.is_empty() {
        return Err(AppError::Store(
            "No exportable audio tracks found for MP4 export".to_string(),
        ));
    }
    let parent = output_path.parent().filter(|path| !path.as_os_str().is_empty());
    if let Some(parent) = parent {
        std::fs::create_dir_all(parent).map_err(|error| {
            AppError::Store(format!(
                "Failed to create export directory {}: {}",
                parent.display(),
                error
            ))
        })?;
    }
    let temp_file = tempfile::Builder::new()
        .suffix(".mp4")
        .tempfile_in(parent.unwrap_or_else(|| Path::new(".")))
        .map_err(|error| AppError::Store(format!("Failed to create MP4 temp file: {error}")))?;
    let temp_path = temp_file.into_temp_path();
    std::fs::remove_file(&temp_path)
        .map_err(|error| AppError::Store(format!("Failed to prepare MP4 temp file: {error}")))?;

    crate::book_service::ios_export::reset_ios_export_cancel();
    ANDROID_EXPORT_PROGRESS.store(0, Ordering::Release);
    let worker_tracks = tracks
        .iter()
        .map(|track| AndroidExportTrack {
            path: track.path.clone(),
            title: track.title.clone(),
            duration_seconds: track.duration_seconds,
        })
        .collect::<Vec<_>>();
    let worker_path = temp_path.to_path_buf();
    let worker_format = format.to_string();
    let worker = std::thread::Builder::new()
        .name("android-audio-export".into())
        .spawn(move || call_android_encoder(&worker_tracks, &worker_path, &worker_format))
        .map_err(|error| AppError::Encoding(format!("Start Android export thread: {error}")))?;

    while !worker.is_finished() {
        let progress = ANDROID_EXPORT_PROGRESS.load(Ordering::Acquire);
        on_progress((progress >> 32) as usize, progress as u8);
        std::thread::sleep(Duration::from_millis(100));
    }
    let chapter_starts_ms = worker
        .join()
        .map_err(|_| AppError::Encoding("Android export thread panicked".into()))?
        .map_err(|message| {
            if crate::book_service::ios_export::ios_export_cancel_requested() {
                AppError::Encoding("Audio export cancelled".into())
            } else {
                AppError::Encoding(message)
            }
        })?;
    on_progress(tracks.len(), 100);

    let mut tag = Tag::default();
    tag.set_title(book.title.clone());
    tag.set_album(book.title.clone());
    tag.set_artist(book.author.clone());
    tag.set_album_artist(book.author.clone());
    if let Some(year) = book.published_year.as_deref().filter(|year| !year.is_empty()) {
        tag.set_year(year.to_string());
    }
    if let Some(genre) = book.subjects.as_ref().map(|subjects| {
        subjects
            .iter()
            .filter(|subject| !subject.trim().is_empty())
            .cloned()
            .collect::<Vec<_>>()
            .join(", ")
    }).filter(|genre| !genre.is_empty()) {
        tag.set_genre(genre);
    }
    if format == "m4b" {
        for (track, start_ms) in tracks.iter().zip(chapter_starts_ms) {
            tag.chapter_list_mut().push(Chapter::new(
                Duration::from_millis(start_ms),
                track.title.clone(),
            ));
        }
    }
    tag.write_to_path(&temp_path)
        .map_err(|error| AppError::Encoding(format!("Failed to write MP4 tags: {error}")))?;
    std::fs::copy(&temp_path, output_path).map_err(|error| {
        AppError::Store(format!(
            "Failed to write {} export to {}: {}",
            format.to_uppercase(),
            output_path.display(),
            error
        ))
    })?;
    Ok(())
}

pub(crate) fn export_mp3(
    output_path: &Path,
    book: &Book,
    tracks: &[AndroidExportTrack],
    mut on_progress: impl FnMut(usize, u8),
) -> AppResult<()> {
    use id3::TagLike;
    use shine_rs::{Mp3Encoder, Mp3EncoderConfig, StereoMode};
    use symphonia::core::codecs::DecoderOptions;
    use symphonia::core::errors::Error as SymphoniaError;
    use symphonia::core::formats::FormatOptions;
    use symphonia::core::io::MediaSourceStream;
    use symphonia::core::meta::MetadataOptions;
    use symphonia::core::probe::Hint;
    use symphonia::core::audio::SampleBuffer;
    use symphonia::default::{get_codecs, get_probe};
    use std::fs::File;
    use std::io::Write;

    if tracks.is_empty() {
        return Err(AppError::Store("No exportable audio tracks found for MP3 export".into()));
    }
    let parent = output_path.parent().filter(|path| !path.as_os_str().is_empty());
    if let Some(parent) = parent {
        std::fs::create_dir_all(parent).map_err(|error| {
            AppError::Store(format!("Failed to create export directory {}: {error}", parent.display()))
        })?;
    }
    let temp_file = tempfile::Builder::new()
        .suffix(".mp3")
        .tempfile_in(parent.unwrap_or_else(|| Path::new(".")))
        .map_err(|error| AppError::Store(format!("Failed to create MP3 temp file: {error}")))?;
    let temp_path = temp_file.into_temp_path();
    let config = Mp3EncoderConfig::new()
        .sample_rate(44_100)
        .bitrate(crate::tts_commands::map_mp3_bitrate(
            crate::utils::constants::DEFAULT_MP3_BITRATE,
            44_100,
        ))
        .channels(2)
        .stereo_mode(StereoMode::JointStereo);
    let mut encoder = Mp3Encoder::new(config)
        .map_err(|error| AppError::Encoding(format!("Failed to initialize MP3 encoder: {error}")))?;
    let mut output = File::create(&temp_path)
        .map_err(|error| AppError::Store(format!("Failed to create MP3 output: {error}")))?;

    crate::book_service::ios_export::reset_ios_export_cancel();
    for (track_index, track) in tracks.iter().enumerate() {
        if crate::book_service::ios_export::ios_export_cancel_requested() {
            return Err(AppError::Encoding("Audio export cancelled".into()));
        }
        let file = File::open(&track.path).map_err(|error| {
            AppError::Encoding(format!("Open audio track {}: {error}", track.path.display()))
        })?;
        let mut hint = Hint::new();
        if let Some(extension) = track.path.extension().and_then(|value| value.to_str()) {
            hint.with_extension(extension);
        }
        let source = MediaSourceStream::new(Box::new(file), Default::default());
        let probed = get_probe()
            .format(&hint, source, &FormatOptions::default(), &MetadataOptions::default())
            .map_err(|error| AppError::Encoding(format!("Probe audio track: {error}")))?;
        let mut format = probed.format;
        let source_track = format
            .default_track()
            .ok_or_else(|| AppError::Encoding("Audio track has no default stream".into()))?;
        let source_track_id = source_track.id;
        let mut decoder = get_codecs()
            .make(&source_track.codec_params, &DecoderOptions::default())
            .map_err(|error| AppError::Encoding(format!("Create audio decoder: {error}")))?;
        let mut decoded_frames = 0u64;

        loop {
            if crate::book_service::ios_export::ios_export_cancel_requested() {
                return Err(AppError::Encoding("Audio export cancelled".into()));
            }
            let packet = match format.next_packet() {
                Ok(packet) if packet.track_id() == source_track_id => packet,
                Ok(_) => continue,
                Err(SymphoniaError::IoError(error))
                    if error.kind() == std::io::ErrorKind::UnexpectedEof => break,
                Err(error) => {
                    return Err(AppError::Encoding(format!("Read audio packet: {error}")));
                }
            };
            let decoded = match decoder.decode(&packet) {
                Ok(decoded) => decoded,
                Err(SymphoniaError::DecodeError(_)) => continue,
                Err(error) => return Err(AppError::Encoding(format!("Decode audio packet: {error}"))),
            };
            let spec = *decoded.spec();
            let rate = spec.rate;
            let channels = spec.channels.count();
            let mut sample_buffer = SampleBuffer::<i16>::new(decoded.capacity() as u64, spec);
            sample_buffer.copy_interleaved_ref(decoded);
            let normalized = stereo_44100(sample_buffer.samples(), channels, rate);
            if !normalized.is_empty() {
                let frames = encoder
                    .encode_interleaved(&normalized)
                    .map_err(|error| AppError::Encoding(format!("MP3 encode failed: {error}")))?;
                for frame in frames {
                    output.write_all(&frame).map_err(|error| {
                        AppError::Store(format!("Write MP3 output failed: {error}"))
                    })?;
                }
            }
            decoded_frames = decoded_frames.saturating_add(packet.dur);
            let percent = track
                .duration_seconds
                .filter(|duration| *duration > 0.0)
                .map(|duration| {
                    ((decoded_frames as f64 / rate as f64 / duration) * 100.0)
                        .clamp(0.0, 99.0) as u8
                })
                .unwrap_or(0);
            on_progress(track_index, percent);
        }
        on_progress(track_index + 1, 100);
    }

    let encoded = encoder
        .finish()
        .map_err(|error| AppError::Encoding(format!("MP3 encoder flush failed: {error}")))?;
    output
        .write_all(&encoded)
        .map_err(|error| AppError::Store(format!("Write MP3 output failed: {error}")))?;
    output
        .flush()
        .map_err(|error| AppError::Store(format!("Flush MP3 output failed: {error}")))?;
    drop(output);

    let mut tag = id3::Tag::new();
    tag.set_title(book.title.clone());
    tag.set_album(book.title.clone());
    tag.set_artist(book.author.clone());
    if let Some(year) = book
        .published_year
        .as_deref()
        .and_then(|value| value.get(..4))
        .and_then(|value| value.parse::<i32>().ok())
    {
        tag.set_year(year);
    }
    tag.write_to_path(&temp_path, id3::Version::Id3v24)
        .map_err(|error| AppError::Encoding(format!("Write MP3 tags: {error}")))?;
    std::fs::copy(&temp_path, output_path).map_err(|error| {
        AppError::Store(format!("Failed to write MP3 export to {}: {error}", output_path.display()))
    })?;
    Ok(())
}

fn stereo_44100(samples: &[i16], channels: usize, sample_rate: u32) -> Vec<i16> {
    if channels == 0 || sample_rate == 0 {
        return Vec::new();
    }
    let frames = samples.len() / channels;
    if frames == 0 {
        return Vec::new();
    }
    let output_frames = (frames as f64 * 44_100.0 / sample_rate as f64).round() as usize;
    let mut output = Vec::with_capacity(output_frames.saturating_mul(2));
    for frame in 0..output_frames {
        let position = frame as f64 * sample_rate as f64 / 44_100.0;
        let first = (position as usize).min(frames - 1);
        let second = (first + 1).min(frames - 1);
        let fraction = (position - first as f64) as f32;
        let left = samples[first * channels] as f32 * (1.0 - fraction)
            + samples[second * channels] as f32 * fraction;
        let right_channel = usize::from(channels > 1);
        let right = samples[first * channels + right_channel] as f32 * (1.0 - fraction)
            + samples[second * channels + right_channel] as f32 * fraction;
        output.push(left.round().clamp(i16::MIN as f32, i16::MAX as f32) as i16);
        output.push(right.round().clamp(i16::MIN as f32, i16::MAX as f32) as i16);
    }
    output
}
