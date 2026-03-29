use crate::utils::errors::{AppError, AppResult};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

/// TTS Engine type selection
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TtsEngineType {
    /// ONNX Runtime engine (default, uses CoreML/CUDA/CPU)
    Onnx,
    /// Candle engine (uses Metal/CUDA/Accelerate/CPU)
    Candle,
}

impl Default for TtsEngineType {
    fn default() -> Self {
        TtsEngineType::Onnx
    }
}

impl std::str::FromStr for TtsEngineType {
    type Err = AppError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "onnx" => Ok(TtsEngineType::Onnx),
            "candle" => Ok(TtsEngineType::Candle),
            _ => Err(AppError::Config(format!(
                "Invalid engine type: {}. Must be 'onnx' or 'candle'",
                s
            ))),
        }
    }
}

/// TTS Engine Pool for reusing engines across multiple tasks.
///
/// This struct manages a pool of TTS model instances that can be shared
/// across multiple concurrent TTS generation tasks. Creating a TTS engine
/// is expensive (loading ONNX models), so reusing engines significantly
/// improves performance for batch operations.
///
/// The pool uses round-robin distribution to balance load across instances,
/// enabling true parallel processing without the overhead of creating
/// engines per task.
///
/// # Performance
/// Creating a new TTS engine involves:
/// - Loading ONNX model files (can be 100+ MB)
/// - Initializing ONNX Runtime or Candle
/// - Loading voice style data
///
/// By reusing engines, we avoid this overhead for each TTS generation.
pub struct TtsEnginePool {
    engine_type: TtsEngineType,
    onnx_engine: Option<Arc<kokoros::tts::koko::TTSKokoParallel>>,
    // Candle engine support is not yet implemented in kokoros crate
    // candle_engine: Option<Arc<kokoros::tts::koko_candle::TTSKokoParallelCandle>>,
    instance_counter: Arc<AtomicUsize>,
    num_instances: usize,
}

impl TtsEnginePool {
    /// Create a new TTS engine pool with the specified number of instances.
    ///
    /// The engine pool is created once and can be cloned and shared across
    /// multiple tasks. Each instance in the pool can process TTS requests
    /// independently, enabling parallel processing.
    ///
    /// # Arguments
    /// * `onnx_path` - Path to the ONNX model file (e.g., "kokoro-v1.0.onnx")
    /// * `voices_path` - Path to the voices data file (e.g., "voices-v1.0.bin")
    /// * `num_instances` - Number of model instances to create (typically CPU core count)
    /// * `engine_type` - Engine type to use (Onnx or Candle)
    ///
    /// # Returns
    /// A new `TtsEnginePool` instance ready to generate audio.
    ///
    /// # Errors
    /// Returns an error if the model files cannot be loaded or
    /// the engine cannot be initialized.
    ///
    /// # Example
    /// ```rust
    /// let pool = TtsEnginePool::new(
    ///     "kokoro-v1.0.onnx",
    ///     "voices-v1.0.bin",
    ///     4,  // 4 instances for 4-core CPU
    ///     TtsEngineType::Onnx  // or TtsEngineType::Candle
    /// ).await?;
    /// ```
    pub async fn new(
        onnx_path: &str,
        voices_path: &str,
        num_instances: usize,
        engine_type: TtsEngineType,
    ) -> AppResult<Self> {
        log::info!(
            "Creating TTS engine pool with {} instances using {:?} engine",
            num_instances,
            engine_type
        );

        // Misaki G2P (misaki-rs) uses espeak-rs; phoneme tables come from bundled
        // `espeak-ng-data` with `PIPER_ESPEAKNG_DATA_DIRECTORY` set in `lib.rs` setup.

        match engine_type {
            TtsEngineType::Onnx => {
                // Check if files exist before attempting to create engine
                // This prevents panics from the kokoros library when files don't exist
                use std::path::Path;
                if !Path::new(onnx_path).exists() {
                    return Err(AppError::ResourceNotFound(format!(
                        "ONNX model file not found: {}",
                        onnx_path
                    )));
                }
                if !Path::new(voices_path).exists() {
                    return Err(AppError::ResourceNotFound(format!(
                        "Voices file not found: {}",
                        voices_path
                    )));
                }

                // Call kokoros - wrap in spawned task to catch panics
                // ONNX model loading or phonemizer initialization can panic if:
                // - Model files are corrupted
                // - ONNX Runtime fails to initialize
                // - Phonemizer model files are missing
                // - Memory allocation fails
                let onnx_path_clone = onnx_path.to_string();
                let voices_path_clone = voices_path.to_string();
                let engine_task = tokio::spawn(async move {
                    kokoros::tts::koko::TTSKokoParallel::new_with_instances(
                        &onnx_path_clone,
                        &voices_path_clone,
                        num_instances,
                    )
                    .await
                });

                let engine = match engine_task.await {
                    Ok(engine) => engine,
                    Err(e) => {
                        // Task panicked or was cancelled
                        log::error!("TTS engine initialization task failed: {:?}", e);
                        return Err(AppError::TtsGeneration(format!(
                            "TTS engine initialization failed. This may indicate:\n\
                                - Corrupted ONNX model files\n\
                                - Missing or corrupted phonemizer model files\n\
                                - ONNX Runtime initialization failure\n\
                                - Insufficient memory\n\
                                - Task was cancelled\n\
                                \n\
                                Error: {:?}\n\
                                Please check the model files at:\n\
                                ONNX: {}\n\
                                Voices: {}",
                            e, onnx_path, voices_path
                        )));
                    }
                };

                Ok(Self {
                    engine_type,
                    onnx_engine: Some(Arc::new(engine)),
                    instance_counter: Arc::new(AtomicUsize::new(0)),
                    num_instances,
                })
            }
            TtsEngineType::Candle => {
                // NOTE: Candle engine support is not yet implemented in kokoros crate.
                // This variant exists for future compatibility but currently always returns an error.
                // Use TtsEngineType::Onnx for production code.
                Err(AppError::TtsGeneration(
                    "Candle engine is not yet implemented. Please use TtsEngineType::Onnx instead."
                        .to_string(),
                ))
            }
        }
    }

    /// Generate audio samples using a model instance from the pool.
    ///
    /// This method uses round-robin distribution to select which model
    /// instance to use, ensuring balanced load across all instances.
    /// The returned audio samples are normalized f32 values in the range [-1.0, 1.0].
    ///
    /// # Arguments
    /// * `text` - The text to convert to speech
    /// * `language` - Language code (e.g., "en" for English)
    /// * `voice_id` - Voice identifier (e.g., "af_heart", "af_bella")
    /// * `speed` - Speech speed multiplier (1.0 = normal, >1.0 = faster, <1.0 = slower)
    ///
    /// # Returns
    /// A vector of f32 audio samples at 24kHz sample rate.
    ///
    /// # Errors
    /// Returns an error if TTS generation fails (e.g., invalid voice ID,
    /// model inference error).
    ///
    /// # Example
    /// ```rust
    /// let samples = pool.generate_audio(
    ///     "Hello, world!",
    ///     "en",
    ///     "af_heart",
    ///     1.0
    /// ).await?;
    /// ```
    pub async fn generate_audio(
        &self,
        text: &str,
        language: &str,
        voice_id: &str,
        speed: f32,
    ) -> AppResult<Vec<f32>> {
        // Get next instance index using round-robin with modulo to ensure valid instance ID
        let instance_id =
            self.instance_counter.fetch_add(1, Ordering::Relaxed) % self.num_instances;

        match self.engine_type {
            TtsEngineType::Onnx => {
                let engine = self.onnx_engine.as_ref().ok_or_else(|| {
                    AppError::TtsGeneration("ONNX engine not initialized".to_string())
                })?;
                let model_instance = engine.get_model_instance(instance_id);
                engine
                    .tts_raw_audio_with_instance(
                        text,
                        language,
                        voice_id,
                        speed,
                        None,
                        None,
                        None,
                        None,
                        model_instance,
                    )
                    .map_err(|e| AppError::TtsGeneration(format!("TTS generation failed: {}", e)))
            }
            TtsEngineType::Candle => {
                // NOTE: Candle engine support is not yet implemented in kokoros crate.
                // This variant exists for future compatibility but currently always returns an error.
                // Use TtsEngineType::Onnx for production code.
                Err(AppError::TtsGeneration(
                    "Candle engine is not yet implemented. Please use TtsEngineType::Onnx instead."
                        .to_string(),
                ))
            }
        }
    }

    /// Get the ONNX engine from the pool (for direct access when needed)
    ///
    /// Returns a reference to the underlying TTSKokoParallel engine if available.
    /// This is useful when you need to pass the engine directly to functions
    /// that require it (e.g., process_chapter).
    pub fn get_onnx_engine(&self) -> Option<&Arc<kokoros::tts::koko::TTSKokoParallel>> {
        self.onnx_engine.as_ref()
    }

    /// Generate PCM audio bytes (16-bit little-endian).
    ///
    /// This is a convenience method that generates audio and converts it
    /// to 16-bit PCM format suitable for WAV files or MP3 encoding.
    ///
    /// # Arguments
    /// * `text` - The text to convert to speech
    /// * `language` - Language code (e.g., "en" for English)
    /// * `voice_id` - Voice identifier (e.g., "af_heart", "af_bella")
    /// * `speed` - Speech speed multiplier (1.0 = normal)
    ///
    /// # Returns
    /// A vector of bytes representing 16-bit PCM audio (little-endian).
    /// The audio is at 24kHz sample rate, mono channel.
    ///
    /// # Errors
    /// Returns an error if TTS generation fails.
    ///
    /// # Example
    /// ```rust
    /// let pcm_bytes = pool.generate_audio_pcm(
    ///     "Hello, world!",
    ///     "en",
    ///     "af_heart",
    ///     1.0
    /// ).await?;
    /// // Can be written to WAV file or encoded to MP3
    /// ```
    pub async fn generate_audio_pcm(
        &self,
        text: &str,
        language: &str,
        voice_id: &str,
        speed: f32,
    ) -> AppResult<Vec<u8>> {
        use crate::utils::audio::f32_to_pcm_le_bytes;
        let audio_samples = self.generate_audio(text, language, voice_id, speed).await?;
        Ok(f32_to_pcm_le_bytes(&audio_samples))
    }
}

impl Clone for TtsEnginePool {
    fn clone(&self) -> Self {
        Self {
            engine_type: self.engine_type,
            onnx_engine: self.onnx_engine.as_ref().map(Arc::clone),
            // candle_engine: self.candle_engine.as_ref().map(Arc::clone),
            instance_counter: Arc::clone(&self.instance_counter),
            num_instances: self.num_instances,
        }
    }
}

// Global TTS engine pool singleton - ensures engines are only loaded once
// Key: (onnx_path, voices_path, num_instances) -> TtsEnginePool
static GLOBAL_ENGINE_POOL: OnceLock<Mutex<Option<Arc<TtsEnginePool>>>> = OnceLock::new();

impl TtsEnginePool {
    /// Get or create the global TTS engine pool singleton
    ///
    /// This ensures that TTS engines and phonemizers are only loaded once,
    /// even if multiple parts of the code request them. All callers share
    /// the same engine pool instance with round-robin distribution.
    ///
    /// # Arguments
    /// * `onnx_path` - Path to the ONNX model file
    /// * `voices_path` - Path to the voices data file  
    /// * `num_instances` - Number of model instances to create
    /// * `engine_type` - Engine type to use (Onnx or Candle)
    ///
    /// # Returns
    /// A shared reference to the global engine pool
    pub async fn get_or_create_global(
        onnx_path: &str,
        voices_path: &str,
        num_instances: usize,
        engine_type: TtsEngineType,
    ) -> AppResult<Arc<Self>> {
        // Check if already initialized (without holding lock across await)
        {
            let guard = GLOBAL_ENGINE_POOL.get_or_init(|| Mutex::new(None));
            let pool_opt = guard.lock().map_err(|e| {
                AppError::TtsGeneration(format!(
                    "Failed to acquire global engine pool lock (mutex poisoned): {:?}",
                    e
                ))
            })?;

            // If already initialized, return existing pool
            if let Some(ref existing_pool) = *pool_opt {
                log::debug!("Reusing existing global TTS engine pool");
                return Ok(Arc::clone(existing_pool));
            }
        } // Guard is dropped here

        // Initialize new engine pool (no guard held, so this is safe)
        log::info!(
            "Initializing global TTS engine pool singleton (first initialization) - {} instances",
            num_instances
        );
        let pool = Self::new(onnx_path, voices_path, num_instances, engine_type).await?;
        let pool_arc = Arc::new(pool);

        // Re-acquire lock to store in global singleton
        {
            let guard = GLOBAL_ENGINE_POOL.get_or_init(|| Mutex::new(None));
            let mut pool_opt = guard.lock().map_err(|e| {
                AppError::TtsGeneration(format!(
                    "Failed to acquire global engine pool lock (mutex poisoned): {:?}",
                    e
                ))
            })?;

            // Double-check pattern: another thread might have initialized it while we were creating
            if let Some(ref existing_pool) = *pool_opt {
                log::debug!("Another thread initialized the pool, reusing it");
                return Ok(Arc::clone(existing_pool));
            }

            // Store in global singleton
            *pool_opt = Some(Arc::clone(&pool_arc));
        } // Guard is dropped here
        log::info!("✓ Global TTS engine pool singleton initialized and cached");

        Ok(pool_arc)
    }
}
