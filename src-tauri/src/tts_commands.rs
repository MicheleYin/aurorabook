use crate::tts::engine::TtsEngineType;
use crate::utils::audio::f32_to_pcm_le_bytes;
use crate::utils::constants::{DEFAULT_LAME_QUALITY, DEFAULT_MP3_BITRATE};
use crate::utils::errors::{AppError, AppResult};
use crate::utils::path_resolver::ResourcePathResolver;
use mp3lame_encoder::{Builder, FlushNoGap, MonoPcm};

/// Initialize the bundled TTS engine (Tauri command).
///
/// Validates paths when non-empty. Models use Supertonic ONNX assets (directory layout).
///
/// # Arguments
/// * `model_path` - Supertonic ONNX directory (contains `tts.json` and `*.onnx`), or empty to use bundle resolution
/// * `voices_path` - Voice bundle directory (`voice_styles/*.json`), or empty for bundle resolution
/// * `_num_instances` - Number of engine instances (currently unused)
/// * `_app` - Tauri application handle
///
/// # Returns
/// A success message string if initialization is successful.
///
/// # Errors
/// Returns an error if the model path is invalid or the file doesn't exist.
#[tauri::command]
pub async fn init_kokoros_engine(
    model_path: String,
    voices_path: String,
    _num_instances: Option<usize>,
    _app: tauri::AppHandle,
) -> AppResult<String> {
    if !model_path.is_empty() {
        let model_path_obj = std::path::Path::new(&model_path);

        if !model_path_obj.exists() {
            return Err(AppError::ResourceNotFound(format!(
                "Supertonic ONNX directory does not exist: {}",
                model_path
            )));
        }

        if !model_path_obj.is_dir() {
            return Err(AppError::InvalidPath(format!(
                "Model path must be a directory (Supertonic ONNX bundle with tts.json). Got: {}",
                model_path
            )));
        }
    }

    log::info!(
        "TTS engine initialization (models will be loaded from bundle resources when needed)"
    );
    if !model_path.is_empty() {
        log::info!("Model path: {}, Voices path: {}", model_path, voices_path);
    } else {
        log::info!("Using bundle resources for models");
    }

    Ok("Initialized TTS engine (using bundle resources)".to_string())
}

/// Generate text-to-speech audio for a single text string (Tauri command).
///
/// This function generates TTS audio using the Kokoros engine. It creates
/// a new engine instance for each call, which is less efficient than using
/// the engine pool for batch operations.
///
/// # Arguments
/// * `text` - The text to convert to speech
/// * `voice_id` - Voice identifier (e.g., "af_heart", "af_bella")
/// * `language` - Optional language code (defaults to "en" if None)
/// * `speed` - Optional speech speed multiplier (defaults to 1.0 if None)
/// * `worker_id` - Optional worker ID for instance selection (defaults to 0)
/// * `engine_type` - Optional engine type ("onnx" or "candle", defaults to "onnx")
/// * `app` - Tauri application handle for resource path resolution
///
/// # Returns
/// PCM audio data as a byte vector (16-bit, little-endian, mono; sample rate matches `SAMPLE_RATE`, typically 44.1 kHz for Supertonic v2).
///
/// # Errors
/// Returns an error if:
/// - Model files cannot be found
/// - TTS generation fails
/// - Path conversion fails
///
/// # Performance Note
/// For batch operations, consider using `generate_tts_batch` which uses
/// an engine pool for better performance.
///
/// # Example
/// ```rust
/// let audio = generate_tts_cached(
///     "Hello, world!".to_string(),
///     "af_heart".to_string(),
///     Some("en".to_string()),
///     Some(1.0),
///     None,
///     app
/// ).await?;
/// ```
#[tauri::command]
pub async fn generate_tts_cached(
    text: String,
    voice_id: String,
    language: Option<String>,
    speed: Option<f32>,
    worker_id: Option<usize>,
    engine_type: Option<String>,
    app: tauri::AppHandle,
) -> AppResult<Vec<u8>> {
    let (onnx_path, voices_path) = ResourcePathResolver::find_model_and_voices(Some(&app))?;

    let onnx_path_str = onnx_path
        .to_str()
        .ok_or_else(|| AppError::Encoding("ONNX path contains invalid UTF-8".to_string()))?;
    let voices_path_str = voices_path
        .to_str()
        .ok_or_else(|| AppError::Encoding("Voices path contains invalid UTF-8".to_string()))?;

    let engine_type = engine_type
        .as_deref()
        .map(|s| s.parse())
        .transpose()?
        .unwrap_or(TtsEngineType::Onnx);

    let audio_samples = match engine_type {
        TtsEngineType::Onnx => {
            let engine = crate::tts::supertonic::koko::TTSKokoParallel::new_with_instances(
                onnx_path_str,
                voices_path_str,
                1,
            )
            .await;
            let model_instance = engine.get_model_instance(worker_id.unwrap_or(0));
            engine
                .tts_raw_audio_with_instance(
                    &text,
                    language.as_deref().unwrap_or("en"),
                    &voice_id,
                    speed.unwrap_or(1.0),
                    None,
                    None,
                    None,
                    None,
                    model_instance,
                )
                .map_err(|e| AppError::TtsGeneration(format!("TTS generation failed: {}", e)))?
        }
        TtsEngineType::Candle => {
            // Candle engine support is not yet implemented in kokoros crate
            return Err(AppError::TtsGeneration(
                "Candle engine is not yet implemented. Please use TtsEngineType::Onnx instead."
                    .to_string(),
            ));
        }
    };

    Ok(f32_to_pcm_le_bytes(&audio_samples))
}

/// Generate text-to-speech audio for multiple texts using ONNX batching (Tauri command).
///
/// Builds one [`TtsEnginePool`] and runs Supertonic with tensor batching across utterances
/// (aligned text chunks), which is typically faster than calling [`generate_tts_cached`] once
/// per line.
///
/// # Arguments
/// * `texts` - Vector of text strings to convert to speech
/// * `voice_id` - Voice identifier (e.g., "af_heart", "af_bella")
/// * `language` - Optional language code (defaults to "en" if None)
/// * `speed` - Optional speech speed multiplier (defaults to 1.0 if None)
/// * `engine_type` - Optional engine type ("onnx" or "candle", defaults to "onnx")
/// * `app` - Tauri application handle for resource path resolution
///
/// # Returns
/// Vector of PCM audio data byte vectors, one for each input text.
/// Each audio is 16-bit PCM, little-endian, mono; sample rate matches the engine (typically 44.1 kHz for Supertonic v2).
///
/// # Errors
/// Returns an error if:
/// - Model files cannot be found
/// - Engine pool creation fails
/// - Any TTS generation fails
///
/// # Performance
/// Uses the pool’s ONNX runtime path with batched inference instead of one forward per string.
///
/// # Example
/// ```rust
/// let texts = vec![
///     "First sentence.".to_string(),
///     "Second sentence.".to_string(),
/// ];
/// let audio_results = generate_tts_batch(
///     texts,
///     "af_heart".to_string(),
///     Some("en".to_string()),
///     Some(1.0),
///     app
/// ).await?;
/// // audio_results[0] contains audio for "First sentence."
/// // audio_results[1] contains audio for "Second sentence."
/// ```
#[tauri::command]
pub async fn generate_tts_batch(
    texts: Vec<String>,
    voice_id: String,
    language: Option<String>,
    speed: Option<f32>,
    engine_type: Option<String>,
    app: tauri::AppHandle,
) -> AppResult<Vec<Vec<u8>>> {
    use crate::epub::converter::get_parallelism;
    use crate::tts::engine::TtsEnginePool;

    let (onnx_path, voices_path) = ResourcePathResolver::find_model_and_voices(Some(&app))?;

    let onnx_path_str = onnx_path
        .to_str()
        .ok_or_else(|| AppError::Encoding("ONNX path contains invalid UTF-8".to_string()))?
        .to_string();
    let voices_path_str = voices_path
        .to_str()
        .ok_or_else(|| AppError::Encoding("Voices path contains invalid UTF-8".to_string()))?
        .to_string();

    let engine_type = engine_type
        .as_deref()
        .map(|s| s.parse())
        .transpose()?
        .unwrap_or(TtsEngineType::Onnx);

    // Create engine pool once (reused for all batch items)
    let parallelism = get_parallelism();
    let engine_pool =
        TtsEnginePool::new(&onnx_path_str, &voices_path_str, parallelism, engine_type)
            .await
            .map_err(|e| {
                AppError::TtsGeneration(format!("Failed to create TTS engine pool: {}", e))
            })?;

    log::info!(
        "Created TTS engine pool with {} instances for batch processing",
        parallelism
    );

    let language_str = language.as_deref().unwrap_or("en");
    let speed_val = speed.unwrap_or(1.0);

    let pcm_results = engine_pool
        .generate_audio_pcm_batch(&texts, language_str, &voice_id, speed_val)
        .await?;

    Ok(pcm_results)
}

/// Convert PCM audio data to MP3 format (Tauri command).
///
/// This function encodes 16-bit PCM audio data into MP3 format using the LAME encoder.
/// It supports both mono and stereo audio, with configurable bitrate.
///
/// # Arguments
/// * `pcm_data` - 16-bit PCM audio data (little-endian) as bytes
/// * `sample_rate` - Sample rate in Hz (e.g., 24000, 44100)
/// * `channels` - Number of audio channels (1 for mono, 2 for stereo)
/// * `bitrate` - Optional MP3 bitrate in kbps (defaults to 128 kbps if None)
///
/// # Returns
/// MP3-encoded audio data as a byte vector.
///
/// # Errors
/// Returns an error if:
/// - PCM data is empty
/// - Sample rate is 0
/// - Channels is not 1 or 2
/// - PCM data length is not divisible by (channels * 2)
/// - LAME encoder initialization fails
/// - Encoding fails
/// - Output is empty
///
/// # Example
/// ```rust
/// let pcm_data = vec![0u8; 48000]; // 1 second of audio at 24kHz
/// let mp3_data = convert_pcm_to_mp3(pcm_data, 24000, 1, Some(128))?;
/// std::fs::write("output.mp3", mp3_data)?;
/// ```
/// Shared MP3 encoder used by Tauri `convert_pcm_to_mp3` and audiobook MP3 export.
pub(crate) fn encode_pcm_to_mp3_bytes(
    pcm_data: Vec<u8>,
    sample_rate: u32,
    channels: u32,
    bitrate: Option<u32>,
) -> AppResult<Vec<u8>> {
    let bitrate_kbps = bitrate.unwrap_or(DEFAULT_MP3_BITRATE);

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

    // Convert PCM bytes to i16 samples
    let num_samples = pcm_data.len() / 2;
    let mut pcm_samples = Vec::with_capacity(num_samples);
    for chunk in pcm_data.chunks_exact(2) {
        let sample = i16::from_le_bytes([chunk[0], chunk[1]]);
        pcm_samples.push(sample);
    }

    // Build MP3 encoder using mp3lame-encoder (self-contained, no system LAME required)
    let mut encoder_builder = Builder::new()
        .ok_or_else(|| AppError::Encoding("Failed to initialize LAME encoder".to_string()))?;

    encoder_builder
        .set_num_channels(channels as u8)
        .map_err(|e| AppError::Encoding(format!("Failed to set channels: {:?}", e)))?;

    encoder_builder
        .set_sample_rate(sample_rate)
        .map_err(|e| AppError::Encoding(format!("Failed to set sample rate: {:?}", e)))?;

    // Convert quality (0-9) to mp3lame-encoder Quality enum
    // DEFAULT_LAME_QUALITY is 5, which maps to Good
    let quality = match DEFAULT_LAME_QUALITY {
        0..=3 => mp3lame_encoder::Quality::Worst,
        4..=6 => mp3lame_encoder::Quality::Good,
        7..=9 => mp3lame_encoder::Quality::Best,
        _ => mp3lame_encoder::Quality::Good,
    };
    encoder_builder
        .set_quality(quality)
        .map_err(|e| AppError::Encoding(format!("Failed to set quality: {:?}", e)))?;

    // Convert bitrate to mp3lame-encoder Bitrate enum
    // Available bitrates: Kbps32, Kbps40, Kbps48, Kbps56, Kbps64, Kbps80, Kbps96,
    // Kbps112, Kbps128, Kbps160, Kbps192, Kbps224, Kbps256, Kbps320
    let bitrate_enum = match bitrate_kbps {
        32 => mp3lame_encoder::Bitrate::Kbps32,
        40 => mp3lame_encoder::Bitrate::Kbps40,
        48 => mp3lame_encoder::Bitrate::Kbps48,
        64 => mp3lame_encoder::Bitrate::Kbps64,
        80 => mp3lame_encoder::Bitrate::Kbps80,
        96 => mp3lame_encoder::Bitrate::Kbps96,
        112 => mp3lame_encoder::Bitrate::Kbps112,
        128 => mp3lame_encoder::Bitrate::Kbps128,
        160 => mp3lame_encoder::Bitrate::Kbps160,
        192 => mp3lame_encoder::Bitrate::Kbps192,
        224 => mp3lame_encoder::Bitrate::Kbps224,
        256 => mp3lame_encoder::Bitrate::Kbps256,
        320 => mp3lame_encoder::Bitrate::Kbps320,
        _ => {
            // Default to closest available bitrate
            if bitrate_kbps <= 48 {
                mp3lame_encoder::Bitrate::Kbps48
            } else if bitrate_kbps <= 64 {
                mp3lame_encoder::Bitrate::Kbps64
            } else if bitrate_kbps <= 128 {
                mp3lame_encoder::Bitrate::Kbps128
            } else if bitrate_kbps <= 192 {
                mp3lame_encoder::Bitrate::Kbps192
            } else {
                mp3lame_encoder::Bitrate::Kbps320
            }
        }
    };
    encoder_builder
        .set_brate(bitrate_enum)
        .map_err(|e| AppError::Encoding(format!("Failed to set bitrate: {:?}", e)))?;

    let mut encoder = encoder_builder
        .build()
        .map_err(|e| AppError::Encoding(format!("Failed to build encoder: {:?}", e)))?;

    // Prepare output buffer
    let mut mp3_output = Vec::new();
    mp3_output.reserve(mp3lame_encoder::max_required_buffer_size(pcm_samples.len()));

    // Encode based on channel count
    // Note: mp3lame-encoder handles stereo internally when channels=2 is set
    // We encode as mono for simplicity (stereo can be added later if needed)
    if channels == 1 {
        // Mono encoding
        let pcm = MonoPcm(&pcm_samples);
        let encoded_size = encoder
            .encode(pcm, mp3_output.spare_capacity_mut())
            .map_err(|e| AppError::Encoding(format!("Failed to encode audio: {:?}", e)))?;

        unsafe {
            mp3_output.set_len(mp3_output.len().wrapping_add(encoded_size));
        }
    } else {
        // For stereo, we need to interleave the samples
        // mp3lame-encoder with channels=2 expects interleaved stereo PCM
        // For now, convert to mono by taking left channel only
        // TODO: Add proper stereo support when mp3lame-encoder API supports it
        let mut mono_samples = Vec::with_capacity(num_samples / 2);
        for i in 0..(num_samples / 2) {
            mono_samples.push(pcm_samples[i * 2]); // Take left channel
        }
        let pcm = MonoPcm(&mono_samples);
        let encoded_size = encoder
            .encode(pcm, mp3_output.spare_capacity_mut())
            .map_err(|e| AppError::Encoding(format!("Failed to encode audio: {:?}", e)))?;

        unsafe {
            mp3_output.set_len(mp3_output.len().wrapping_add(encoded_size));
        }
    }

    // Flush encoder to get remaining data
    let flush_size = encoder
        .flush::<FlushNoGap>(mp3_output.spare_capacity_mut())
        .map_err(|e| AppError::Encoding(format!("Failed to flush encoder: {:?}", e)))?;

    if flush_size > 0 {
        unsafe {
            mp3_output.set_len(mp3_output.len().wrapping_add(flush_size));
        }
    }

    if mp3_output.is_empty() {
        return Err(AppError::Encoding(
            "MP3 encoding produced no output".to_string(),
        ));
    }

    Ok(mp3_output)
}

#[tauri::command]
pub fn convert_pcm_to_mp3(
    pcm_data: Vec<u8>,
    sample_rate: u32,
    channels: u32,
    bitrate: Option<u32>,
) -> AppResult<Vec<u8>> {
    encode_pcm_to_mp3_bytes(pcm_data, sample_rate, channels, bitrate)
}
