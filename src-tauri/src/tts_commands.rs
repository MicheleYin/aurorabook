use crate::book_service::database::get_db_connection;
use crate::book_service::repositories::SettingsRepository;
use crate::tts::engine::TtsEngineType;
use crate::tts::supertonic::koko::InitConfig;
use crate::utils::audio::f32_to_pcm_le_bytes;
use crate::utils::errors::{AppError, AppResult};
use crate::utils::path_resolver::ResourcePathResolver;

async fn tts_init_config_from_app_settings(app: &tauri::AppHandle) -> AppResult<InitConfig> {
    let db = get_db_connection(app)
        .await
        .map_err(|e| AppError::Store(e))?;
    let settings = SettingsRepository::get(db.as_ref())
        .await
        .map_err(|e| AppError::Store(e))?;
    Ok(InitConfig::from_tts_synthesis_quality(&settings.tts_synthesis_quality))
}

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

    let init_cfg = tts_init_config_from_app_settings(&app).await?;

    let audio_samples = match engine_type {
        TtsEngineType::Onnx => {
            let engine = crate::tts::supertonic::koko::TTSKokoParallel::from_config_with_instances(
                onnx_path_str,
                voices_path_str,
                init_cfg,
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

    let init_cfg = tts_init_config_from_app_settings(&app).await?;

    // Create engine pool once (reused for all batch items)
    let parallelism = get_parallelism();
    let engine_pool =
        TtsEnginePool::new(&onnx_path_str, &voices_path_str, parallelism, engine_type, init_cfg)
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
/// Encodes 16-bit PCM via **FFmpeg** (`libmp3lame`). Requires `ffmpeg` on `PATH`.
///
/// # Arguments
/// * `pcm_data` - 16-bit PCM audio data (little-endian) as bytes
/// * `sample_rate` - Sample rate in Hz (e.g., 24000, 44100)
/// * `channels` - Number of audio channels (1 for mono, 2 for stereo)
/// * `bitrate` - Optional MP3 bitrate in kbps (defaults to the app-wide default, typically 128, if None)
///
/// # Returns
/// MP3-encoded audio data as a byte vector.
///
/// # Example
/// ```rust
/// let pcm_data = vec![0u8; 48000]; // 1 second of audio at 24kHz
/// let mp3_data = convert_pcm_to_mp3(pcm_data, 24000, 1, Some(128))?;
/// std::fs::write("output.mp3", mp3_data)?;
/// ```
/// Shared MP3 encoder used by Tauri `convert_pcm_to_mp3` and callers that need in-process MP3 bytes.
pub(crate) fn encode_pcm_to_mp3_bytes(
    pcm_data: Vec<u8>,
    sample_rate: u32,
    channels: u32,
    bitrate: Option<u32>,
) -> AppResult<Vec<u8>> {
    crate::utils::ffmpeg_audio::encode_pcm_to_mp3_bytes(pcm_data, sample_rate, channels, bitrate)
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
