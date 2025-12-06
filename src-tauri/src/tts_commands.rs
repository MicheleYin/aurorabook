use crate::utils::path_resolver::ResourcePathResolver;
use crate::utils::audio::f32_to_pcm_le_bytes;
use crate::utils::constants::{DEFAULT_MP3_BITRATE, DEFAULT_LAME_QUALITY};
use crate::utils::errors::{AppError, AppResult};
use crate::tts::engine::TtsEngineType;
use std::sync::Arc;

/// Initialize the Kokoros TTS engine (Tauri command).
///
/// This command validates model file paths and logs initialization information.
/// The actual engine creation is deferred until TTS generation is requested.
///
/// # Arguments
/// * `model_path` - Path to the ONNX model file (e.g., "kokoro-v1.0.onnx")
/// * `voices_path` - Path to the voices data file (e.g., "voices-v1.0.bin")
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
                "Model file does not exist: {}. Expected kokoro-v1.0.onnx",
                model_path
            )));
        }

        if !model_path_obj.is_file() {
            return Err(AppError::InvalidPath(format!(
                "Model path must be a file (ONNX model). Got: {}",
                model_path
            )));
        }

        if !model_path.ends_with(".onnx") {
            return Err(AppError::Config(format!(
                "Model file must be an ONNX model (.onnx extension). Got: {}",
                model_path
            )));
        }
    }

    log::info!("TTS engine initialization (models will be loaded from bundle resources when needed)");
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
/// PCM audio data as a byte vector (16-bit, little-endian, mono, 24kHz).
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

    // Note: RuleBasedG2p (voirs-g2p) doesn't require resource directories
    // as it uses rule-based phonemization without model files
    
    let audio_samples = match engine_type {
        TtsEngineType::Onnx => {
            let engine = kokoros::tts::koko::TTSKokoParallel::new_with_instances(
                onnx_path_str,
                voices_path_str,
                1,
            )
            .await;
            let model_instance = engine.get_model_instance(worker_id.unwrap_or(0));
            engine.tts_raw_audio_with_instance(
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
                "Candle engine is not yet implemented. Please use TtsEngineType::Onnx instead.".to_string()
            ));
        }
    };

    Ok(f32_to_pcm_le_bytes(&audio_samples))
}

/// Generate text-to-speech audio for multiple texts in parallel (Tauri command).
///
/// This function efficiently processes multiple texts by creating a single
/// TTS engine pool and reusing it across all generations. This is significantly
/// faster than calling `generate_tts_cached` multiple times.
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
/// Each audio is 16-bit PCM, little-endian, mono, 24kHz.
///
/// # Errors
/// Returns an error if:
/// - Model files cannot be found
/// - Engine pool creation fails
/// - Any TTS generation fails
///
/// # Performance
/// Uses a TTS engine pool with multiple instances (one per CPU core)
/// to enable true parallel processing. Much faster than sequential generation.
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
    use crate::tts::engine::TtsEnginePool;
    use num_cpus;
    
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
    let parallelism = num_cpus::get().max(1);
    let engine_pool = TtsEnginePool::new(
        &onnx_path_str,
        &voices_path_str,
        parallelism,
        engine_type,
    )
    .await
    .map_err(|e| AppError::TtsGeneration(format!("Failed to create TTS engine pool: {}", e)))?;
    
    log::info!("Created TTS engine pool with {} instances for batch processing", parallelism);
    
    let engine_pool_arc = std::sync::Arc::new(engine_pool);
    // Use Arc<str> for shared strings to avoid unnecessary cloning
    let language_str: std::sync::Arc<str> = Arc::from(language.as_deref().unwrap_or("en"));
    let voice_id_arc: std::sync::Arc<str> = Arc::from(voice_id.as_str());
    let speed_val = speed.unwrap_or(1.0);
    let mut handles = Vec::new();
    for text in texts.iter() {
        // Only clone the text (which is unique per task)
        let text_clone = text.clone();
        let voice_id_clone = voice_id_arc.clone();
        let language_clone = language_str.clone();
        let pool = engine_pool_arc.clone();

        let handle = tokio::spawn(async move {
            pool.generate_audio_pcm(&text_clone, &language_clone, &voice_id_clone, speed_val)
                .await
                .map_err(|e| AppError::TtsGeneration(format!("Failed to generate audio: {}", e)))
        });
        handles.push(handle);
    }

    let mut results = Vec::new();
    for handle in handles {
        match handle.await {
            Ok(Ok(audio_pcm)) => results.push(audio_pcm),
            Ok(Err(e)) => return Err(e),
            Err(e) => return Err(AppError::TtsGeneration(format!("Task failed: {:?}", e))),
        }
    }

    Ok(results)
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
#[tauri::command]
pub fn convert_pcm_to_mp3(
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
        return Err(AppError::Config("Sample rate must be greater than 0".to_string()));
    }
    if channels != 1 && channels != 2 {
        return Err(AppError::Config("Channels must be 1 (mono) or 2 (stereo)".to_string()));
    }
    if pcm_data.len() % (channels as usize * 2) != 0 {
        return Err(AppError::Encoding(format!(
            "PCM data length ({}) must be divisible by {} (channels * 2 bytes per sample)",
            pcm_data.len(),
            channels * 2
        )));
    }

    let num_samples = pcm_data.len() / 2;
    let mut pcm_samples = Vec::with_capacity(num_samples);
    for chunk in pcm_data.chunks_exact(2) {
        let sample = i16::from_le_bytes([chunk[0], chunk[1]]);
        pcm_samples.push(sample);
    }

    let mut encoder = lame::Lame::new()
        .ok_or_else(|| AppError::Encoding("Failed to initialize LAME encoder".to_string()))?;

    encoder
        .set_sample_rate(sample_rate)
        .map_err(|e| AppError::Encoding(format!("Failed to set sample rate: {:?}", e)))?;

    encoder
        .set_channels(channels as u8)
        .map_err(|e| AppError::Encoding(format!("Failed to set channels: {:?}", e)))?;

    encoder
        .set_quality(DEFAULT_LAME_QUALITY)
        .map_err(|e| AppError::Encoding(format!("Failed to set quality: {:?}", e)))?;

    encoder
        .set_kilobitrate(bitrate_kbps as i32)
        .map_err(|e| AppError::Encoding(format!("Failed to set bitrate: {:?}", e)))?;

    encoder
        .init_params()
        .map_err(|e| AppError::Encoding(format!("Failed to initialize encoder parameters: {:?}", e)))?;

    let mut mp3_output = Vec::new();

    let buffer_size = (pcm_samples.len() as f64 * 1.25) as usize + 7200;
    let mut mp3_buffer = vec![0u8; buffer_size];

    if channels == 1 {
        let encoded_size = encoder
            .encode(&pcm_samples, &pcm_samples, &mut mp3_buffer)
            .map_err(|e| AppError::Encoding(format!("Failed to encode audio: {:?}", e)))?;

        mp3_output.extend_from_slice(&mp3_buffer[..encoded_size]);
    } else {
        let mut pcm_left = Vec::with_capacity(num_samples / 2);
        let mut pcm_right = Vec::with_capacity(num_samples / 2);

        for i in 0..(num_samples / 2) {
            pcm_left.push(pcm_samples[i * 2]);
            pcm_right.push(pcm_samples[i * 2 + 1]);
        }

        let encoded_size = encoder
            .encode(&pcm_left, &pcm_right, &mut mp3_buffer)
            .map_err(|e| AppError::Encoding(format!("Failed to encode audio: {:?}", e)))?;

        mp3_output.extend_from_slice(&mp3_buffer[..encoded_size]);
    }

    let flush_size = encoder
        .encode(&[], &[], &mut mp3_buffer)
        .map_err(|e| AppError::Encoding(format!("Failed to flush encoder: {:?}", e)))?;

    if flush_size > 0 {
        mp3_output.extend_from_slice(&mp3_buffer[..flush_size]);
    }

    if mp3_output.is_empty() {
        return Err(AppError::Encoding("MP3 encoding produced no output".to_string()));
    }

    Ok(mp3_output)
}
