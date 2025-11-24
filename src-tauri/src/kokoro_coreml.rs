// CoreML implementation for FluidInference Kokoro models
// This module provides direct CoreML model loading and inference
// for better performance on Apple devices compared to ONNX Runtime

#[cfg(any(target_os = "macos", target_os = "ios"))]
use std::path::Path;
use std::sync::{Arc, Mutex};

#[cfg(any(target_os = "macos", target_os = "ios"))]
use objc2::rc::{Retained, autoreleasepool};
#[cfg(any(target_os = "macos", target_os = "ios"))]
use objc2::AnyThread;
#[cfg(any(target_os = "macos", target_os = "ios"))]
use objc2_foundation::{NSArray, NSDictionary, NSNumber, NSString, NSURL};
#[cfg(any(target_os = "macos", target_os = "ios"))]
use objc2::runtime::AnyObject;
#[cfg(any(target_os = "macos", target_os = "ios"))]
use objc2_core_ml::{
    MLDictionaryFeatureProvider, MLFeatureProvider, MLFeatureValue, MLModel, MLModelConfiguration,
    MLMultiArray,
};
use std::collections::HashMap;
use lazy_static::lazy_static;
use espeak_rs::text_to_phonemes;

// Global mutex to serialize espeak-rs calls to prevent phoneme randomization
// espeak-rs uses global state internally and is not thread-safe
lazy_static! {
    static ref ESPEAK_MUTEX: Mutex<()> = Mutex::new(());
}

// Vocabulary from kokoros - exact same as kokoros/src/tts/vocab.rs
fn get_vocab() -> HashMap<char, usize> {
    let pad = "$";
    let punctuation = r#";:,.!?¡¿—…"«»"" "#;
    let letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    let letters_ipa = "ɑɐɒæɓʙβɔɕçɗɖðʤəɘɚɛɜɝɞɟʄɡɠɢʛɦɧħɥʜɨɪʝɭɬɫɮʟɱɯɰŋɳɲɴøɵɸθœɶʘɹɺɾɻʀʁɽʂʃʈʧʉʊʋⱱʌɣɤʍχʎʏʑʐʒʔʡʕʢǀǁǂǃˈˌːˑʼʴʰʱʲʷˠˤ˞↓↑→↗↘'̩'ᵻ";

    let symbols: String = [pad, punctuation, letters, letters_ipa].concat();

    symbols
        .chars()
        .enumerate()
        .collect::<HashMap<_, _>>()
        .into_iter()
        .map(|(idx, c)| (c, idx))
        .collect()
}

lazy_static! {
    static ref VOCAB: HashMap<char, usize> = get_vocab();
}

// Tokenize function from kokoros - exact same as kokoros/src/tts/tokenize.rs
/// Tokenizes the given phonemes string into a vector of token indices.
/// This matches kokoros' tokenization exactly.
fn tokenize_phonemes(phonemes: &str) -> Vec<i64> {
    phonemes
        .chars()
        .filter_map(|c| VOCAB.get(&c))
        .map(|&idx| idx as i64)
        .collect()
}

/// CoreML-based Kokoro TTS engine
/// Uses FluidInference CoreML models for optimal ANE/GPU performance
/// 
/// Note: MLModel is not Send/Sync, so we use unsafe impl to mark it as such.
/// This is safe because we ensure thread safety via Mutex locking.
#[cfg(any(target_os = "macos", target_os = "ios"))]
pub struct KokoroCoreML {
    /// Duration prediction model
    duration_model: Option<Retained<MLModel>>,
    /// Synthesizer models (bucketed by duration: 3s, 5s, 10s, 30s)
    synthesizer_models: std::collections::HashMap<String, Retained<MLModel>>,
    /// Model directory path
    model_dir: String,
    /// Voices data path
    voices_path: String,
    /// Vocabulary index for tokenization (deprecated - using static VOCAB from kokoros)
    #[allow(dead_code)]
    vocab: HashMap<String, u32>,
}

// Safety: MLModel contains non-Send pointers, but we ensure thread safety
// by only accessing models through Mutex locks. This is safe because:
// 1. All access is guarded by Mutex
// 2. CoreML models are designed to be used from multiple threads with proper synchronization
#[cfg(any(target_os = "macos", target_os = "ios"))]
unsafe impl Send for KokoroCoreML {}
#[cfg(any(target_os = "macos", target_os = "ios"))]
unsafe impl Sync for KokoroCoreML {}

#[cfg(any(target_os = "macos", target_os = "ios"))]
impl KokoroCoreML {
    /// Create a new CoreML engine instance
    pub fn new(model_dir: &str, voices_path: &str) -> Result<Self, String> {
        let model_path = Path::new(model_dir);
        
        if !model_path.exists() {
            return Err(format!("Model directory does not exist: {}", model_dir));
        }
        
        if !model_path.is_dir() {
            return Err(format!("Model path must be a directory: {}", model_dir));
        }
        
        // Initialize synthesizer models map
        let mut synthesizer_models = std::collections::HashMap::new();
        
        // Try to load synthesizer models (kokoro_24_10s, kokoro_24_15s, etc.)
        // These are the FluidInference CoreML models
        let synthesizer_names = vec![
            "kokoro_24_10s",
            "kokoro_24_15s", 
            "kokoro_21_10s",
            "kokoro_21_15s",
            "kokoro_21_5s",
        ];
        
        for name in &synthesizer_names {
            // Only use .mlmodelc files (compiled format)
            // .mlpackage files require compilation and cannot be loaded directly
            let mlmodelc_path = model_path.join(format!("{}.mlmodelc", name));
            if mlmodelc_path.exists() {
                match Self::load_model(&mlmodelc_path) {
                    Ok(model) => {
                        synthesizer_models.insert(name.to_string(), model);
                        println!("Loaded CoreML model: {}.mlmodelc", name);
                    }
                    Err(e) => {
                        eprintln!("Failed to load {}.mlmodelc: {}", name, e);
                        // Try .mlpackage as fallback (for development/testing)
                        let mlpackage_path = model_path.join(format!("{}.mlpackage", name));
                        if mlpackage_path.exists() {
                            eprintln!("Note: {}.mlpackage found but requires compilation. Use .mlmodelc for runtime.", name);
                        }
                    }
                }
            } else {
                // Only try .mlpackage in development if .mlmodelc doesn't exist
                // This allows tests to work with source models
                let mlpackage_path = model_path.join(format!("{}.mlpackage", name));
                if mlpackage_path.exists() {
                    eprintln!("Warning: {}.mlpackage found but .mlmodelc is required for runtime. Skipping.", name);
                }
            }
        }
        
        if synthesizer_models.is_empty() {
            return Err(format!(
                "No CoreML synthesizer models found in model directory: {}. \
                Expected .mlmodelc files for: {:?}",
                model_dir, synthesizer_names
            ));
        }
        
        println!(
            "Successfully loaded {} CoreML model(s): {:?}",
            synthesizer_models.len(),
            synthesizer_models.keys().collect::<Vec<_>>()
        );
        
        Ok(Self {
            duration_model: None, // TODO: Load duration model if available
            synthesizer_models,
            model_dir: model_dir.to_string(),
            voices_path: voices_path.to_string(),
            vocab: HashMap::new(), // Not used anymore - we use static VOCAB from kokoros
        })
    }
    
    /// Load voice embedding from JSON file
    fn load_voice_embedding(&self, voice_id: &str) -> Result<Vec<f32>, String> {
        let voice_path = Path::new(&self.model_dir)
            .join("voices")
            .join(format!("{}.json", voice_id));
        
        if !voice_path.exists() {
            return Err(format!("Voice file not found: {}", voice_path.display()));
        }
        
        let content = std::fs::read_to_string(&voice_path)
            .map_err(|e| format!("Failed to read voice file: {}", e))?;
        
        let json: serde_json::Value = serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse voice JSON: {}", e))?;
        
        let embedding = json.get("embedding")
            .ok_or_else(|| "embedding key not found".to_string())?
            .as_array()
            .ok_or_else(|| "embedding is not an array".to_string())?;
        
        let mut vec = Vec::new();
        for value in embedding {
            if let Some(f) = value.as_f64() {
                vec.push(f as f32);
            } else {
                return Err("Invalid embedding value".to_string());
            }
        }
        
        Ok(vec)
    }
    
    /// Preprocess text using kokoros' exact preprocessing pipeline (phonemization + tokenization)
    /// This ensures CoreML uses the exact same preprocessing as ONNX
    /// Uses espeak-rs for phonemization and kokoros' tokenize function
    fn preprocess_with_kokoros(&self, text: &str, language: &str) -> Result<Vec<u32>, String> {
        // Use kokoros' exact preprocessing pipeline:
        // 1. Phonemize using espeak-rs (same as kokoros uses)
        // 2. Tokenize using kokoros' tokenize function (copied from source)
        
        // Phonemize text using espeak-rs (same as kokoros/src/tts/koko.rs line 328)
        let phonemes = {
            let _guard = ESPEAK_MUTEX.lock().unwrap();
            text_to_phonemes(text, language, None, true, false)
                .map_err(|e| format!("Failed to phonemize text: {}", e))?
                .join("")
        };
        
        // Tokenize phonemes using kokoros' tokenize function (same as kokoros/src/tts/koko.rs line 343)
        let tokens = tokenize_phonemes(&phonemes);
        
        // Convert i64 to u32 (kokoros uses i64, CoreML uses u32)
        Ok(tokens.into_iter().map(|t| t as u32).collect())
    }
    
    
    /// Load a CoreML model from a path
    fn load_model(model_path: &Path) -> Result<Retained<MLModel>, String> {
        autoreleasepool(|pool| {
            // Convert path to absolute path string
            let absolute_path = model_path.canonicalize()
                .or_else(|_| model_path.to_path_buf().canonicalize())
                .or_else(|_| Ok::<std::path::PathBuf, std::io::Error>(model_path.to_path_buf()))
                .map_err(|e| format!("Failed to resolve model path: {}", e))?;
            
            let path_string = absolute_path.to_string_lossy().to_string();
            
            // Create NSString from the path (keep it alive)
            let ns_string = NSString::from_str(&path_string);
            
            // Create NSURL from the file path
            // Note: For directories (.mlpackage), isDirectory should be true
            // For files (.mlmodelc), isDirectory should be false
            let is_directory = model_path.is_dir() || model_path.extension()
                .and_then(|ext| ext.to_str())
                .map(|ext| ext == "mlpackage")
                .unwrap_or(false);
            
            let url = NSURL::fileURLWithPath_isDirectory(&ns_string, is_directory);
            
            // Create MLModelConfiguration - use default compute units
            // CoreML will automatically use the best available hardware (ANE/GPU/CPU)
            let config = unsafe {
                MLModelConfiguration::new()
            };
            
            // Load the model
            // modelWithContentsOfURL_configuration_error returns Result<Retained<MLModel>, Retained<NSError>>
            unsafe {
                let result = MLModel::modelWithContentsOfURL_configuration_error(
                    &url,
                    &config,
                );
                
                match result {
                    Ok(model) => Ok(model),
                    Err(error) => {
                        let description = error.localizedDescription();
                        let description_str = description.to_str(pool);
                        Err(format!("Failed to load CoreML model: {}", description_str))
                    }
                }
            }
        })
    }
    
    /// Generate TTS audio using CoreML models
    pub fn generate_tts(
        &self,
        text: &str,
        voice_id: &str,
        language: &str,
        speed: f32,
    ) -> Result<Vec<f32>, String> {
        // Load voice embedding
        let voice_embedding = self.load_voice_embedding(voice_id)?;
        if voice_embedding.len() != 256 {
            return Err(format!(
                "Voice embedding must be 256 dimensions, got {}",
                voice_embedding.len()
            ));
        }

        // Use kokoros' exact preprocessing pipeline (phonemization + tokenization)
        // This ensures CoreML uses the exact same preprocessing as ONNX
        // Uses espeak-rs for phonemization (same as kokoros) and kokoros' tokenize function
        let tokens = self.preprocess_with_kokoros(text, language)?;
        if tokens.is_empty() {
            return Err("Tokenization produced no tokens".to_string());
        }

        // Select appropriate model based on text length and get its max token count
        let (model_name, max_tokens) = if tokens.len() <= 124 {
            ("kokoro_21_5s", 124)
        } else if tokens.len() <= 168 {
            ("kokoro_21_10s", 168)
        } else if tokens.len() <= 242 {
            ("kokoro_24_15s", 242)
        } else {
            return Err(format!(
                "Text too long: {} tokens, max supported: 242",
                tokens.len()
            ));
        };

        let model = self
            .synthesizer_models
            .get(model_name)
            .ok_or_else(|| format!("Model {} not found", model_name))?;

        // Pad tokens to model's max length
        let mut input_ids = tokens;
        let seq_len = input_ids.len();
        while input_ids.len() < max_tokens {
            input_ids.push(0); // Pad with 0
        }
        input_ids.truncate(max_tokens);

        // Create attention mask (1 for real tokens, 0 for padding)
        let mut attention_mask = vec![1i32; seq_len];
        while attention_mask.len() < max_tokens {
            attention_mask.push(0i32);
        }
        attention_mask.truncate(max_tokens);

        // Generate random phases (9 values)
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};
        let mut hasher = DefaultHasher::new();
        text.hash(&mut hasher);
        voice_id.hash(&mut hasher);
        let seed = hasher.finish();
        let mut rng = fastrand::Rng::with_seed(seed);
        let random_phases: Vec<f32> = (0..9).map(|_| rng.f32() * 2.0 - 1.0).collect();

        autoreleasepool(|pool| {
            // Helper function to create NSArray from Vec<NSNumber>
            fn create_shape_array(dims: &[i32]) -> Retained<NSArray<NSNumber>> {
                let numbers: Vec<Retained<NSNumber>> = dims.iter().map(|&d| NSNumber::new_i32(d)).collect();
                let refs: Vec<&NSNumber> = numbers.iter().map(|n| n.as_ref()).collect();
                NSArray::from_slice(&refs)
            }

            // Create MLMultiArray for input_ids (Int32, shape [1, 242])
            let input_ids_shape = create_shape_array(&[1, max_tokens as i32]);
            let input_ids_array = unsafe {
                MLMultiArray::initWithShape_dataType_error(
                    MLMultiArray::alloc(),
                    &input_ids_shape,
                    objc2_core_ml::MLMultiArrayDataType::Int32,
                )
            }
            .map_err(|e| format!("Failed to create input_ids MLMultiArray: {:?}", e))?;

            // Copy data into input_ids array - use objectAtIndexedSubscript for 2D access
            // For shape [1, N], we access as [0, i]
            unsafe {
                for i in 0..input_ids.len() {
                    let idx = (0 * max_tokens + i) as isize;
                    input_ids_array.setObject_atIndexedSubscript(&NSNumber::new_i32(input_ids[i] as i32), idx);
                }
            }

            // Create MLMultiArray for ref_s (Float32, shape [1, 256])
            let ref_s_shape = create_shape_array(&[1, 256]);
            let ref_s_array = unsafe {
                MLMultiArray::initWithShape_dataType_error(
                    MLMultiArray::alloc(),
                    &ref_s_shape,
                    objc2_core_ml::MLMultiArrayDataType::Float32,
                )
            }
            .map_err(|e| format!("Failed to create ref_s MLMultiArray: {:?}", e))?;

            // Copy voice embedding data
            unsafe {
                for i in 0..voice_embedding.len() {
                    let idx = (0 * 256 + i) as isize;
                    ref_s_array.setObject_atIndexedSubscript(&NSNumber::new_f32(voice_embedding[i]), idx);
                }
            }

            // Create MLMultiArray for random_phases (Float32, shape [1, 9])
            let random_phases_shape = create_shape_array(&[1, 9]);
            let random_phases_array = unsafe {
                MLMultiArray::initWithShape_dataType_error(
                    MLMultiArray::alloc(),
                    &random_phases_shape,
                    objc2_core_ml::MLMultiArrayDataType::Float32,
                )
            }
            .map_err(|e| format!("Failed to create random_phases MLMultiArray: {:?}", e))?;

            unsafe {
                for i in 0..random_phases.len() {
                    let idx = (0 * 9 + i) as isize;
                    random_phases_array.setObject_atIndexedSubscript(&NSNumber::new_f32(random_phases[i]), idx);
                }
            }

            // Create MLMultiArray for attention_mask (Int32, shape [1, 242])
            let attention_mask_shape = create_shape_array(&[1, max_tokens as i32]);
            let attention_mask_array = unsafe {
                MLMultiArray::initWithShape_dataType_error(
                    MLMultiArray::alloc(),
                    &attention_mask_shape,
                    objc2_core_ml::MLMultiArrayDataType::Int32,
                )
            }
            .map_err(|e| format!("Failed to create attention_mask MLMultiArray: {:?}", e))?;

            unsafe {
                for i in 0..attention_mask.len() {
                    let idx = (0 * max_tokens + i) as isize;
                    attention_mask_array.setObject_atIndexedSubscript(&NSNumber::new_i32(attention_mask[i]), idx);
                }
            }

            // Create MLFeatureValue instances from MLMultiArray
            let input_ids_feature = unsafe {
                MLFeatureValue::featureValueWithMultiArray(&input_ids_array)
            };
            let ref_s_feature = unsafe {
                MLFeatureValue::featureValueWithMultiArray(&ref_s_array)
            };
            let random_phases_feature = unsafe {
                MLFeatureValue::featureValueWithMultiArray(&random_phases_array)
            };
            let attention_mask_feature = unsafe {
                MLFeatureValue::featureValueWithMultiArray(&attention_mask_array)
            };

            // Create dictionary with input features using from_slices
            // MLDictionaryFeatureProvider expects NSDictionary<NSString, AnyObject>
            // Store NSString values to avoid temporary value issues
            let key1 = NSString::from_str("input_ids");
            let key2 = NSString::from_str("ref_s");
            let key3 = NSString::from_str("random_phases");
            let key4 = NSString::from_str("attention_mask");
            
            let keys: [&NSString; 4] = [
                key1.as_ref(),
                key2.as_ref(),
                key3.as_ref(),
                key4.as_ref(),
            ];
            let values: [&AnyObject; 4] = [
                input_ids_feature.as_ref() as &AnyObject,
                ref_s_feature.as_ref() as &AnyObject,
                random_phases_feature.as_ref() as &AnyObject,
                attention_mask_feature.as_ref() as &AnyObject,
            ];
            let input_dict: Retained<NSDictionary<NSString, AnyObject>> = NSDictionary::from_slices(&keys, &values);

            let feature_provider = unsafe {
                MLDictionaryFeatureProvider::initWithDictionary_error(
                    MLDictionaryFeatureProvider::alloc(),
                    &input_dict,
                )
            }
            .map_err(|e| format!("Failed to create feature provider: {:?}", e))?;

            // Run prediction - convert to ProtocolObject
            use objc2::runtime::ProtocolObject;
            let feature_provider_obj = ProtocolObject::from_ref(&*feature_provider);
            let prediction = unsafe {
                model.predictionFromFeatures_error(&feature_provider_obj)
            }
            .map_err(|e| {
                let description = e.localizedDescription();
                let description_str = unsafe { description.to_str(pool) };
                format!("CoreML prediction failed: {}", description_str)
            })?;

            // Extract audio output
            let audio_feature = unsafe {
                prediction.featureValueForName(&NSString::from_str("audio"))
            }
            .ok_or_else(|| "audio output not found in prediction".to_string())?;

            let audio_array = unsafe {
                audio_feature.multiArrayValue()
            }
            .ok_or_else(|| "audio feature is not a MultiArray".to_string())?;

            // Extract audio samples from MLMultiArray
            let count = unsafe { audio_array.count() };
            
            // Extract audio samples
            let mut audio_samples = Vec::with_capacity(count as usize);
            unsafe {
                for i in 0..count {
                    let value = audio_array.objectAtIndexedSubscript(i);
                    if let Some(num) = value.downcast_ref::<NSNumber>() {
                        audio_samples.push(num.floatValue() as f32);
                    } else {
                        return Err("Failed to extract audio sample".to_string());
                    }
                }
            }

            // Apply speed adjustment if needed
            if (speed - 1.0).abs() > 0.01 {
                // Simple resampling for speed adjustment
                let target_len = (audio_samples.len() as f32 / speed) as usize;
                let mut resampled = Vec::with_capacity(target_len);
                for i in 0..target_len {
                    let src_idx = (i as f32 * speed) as usize;
                    if src_idx < audio_samples.len() {
                        resampled.push(audio_samples[src_idx]);
                    }
                }
                audio_samples = resampled;
            }

            Ok(audio_samples)
        })
    }
}

/// Parallel CoreML engine for batch processing
#[cfg(any(target_os = "macos", target_os = "ios"))]
pub struct KokoroCoreMLParallel {
    instances: Vec<Arc<Mutex<KokoroCoreML>>>,
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
impl KokoroCoreMLParallel {
    /// Create a parallel engine with multiple instances
    pub fn new_with_instances(
        model_dir: &str,
        voices_path: &str,
        num_instances: usize,
    ) -> Result<Self, String> {
        let mut instances = Vec::new();
        
        for _ in 0..num_instances {
            let engine = KokoroCoreML::new(model_dir, voices_path)?;
            instances.push(Arc::new(Mutex::new(engine)));
        }
        
        Ok(Self { instances })
    }
    
    /// Get a model instance by index
    pub fn get_model_instance(&self, index: usize) -> Arc<Mutex<KokoroCoreML>> {
        self.instances[index % self.instances.len()].clone()
    }
}

// Non-Apple platforms: provide stub implementations
#[cfg(not(any(target_os = "macos", target_os = "ios")))]
pub struct KokoroCoreML;

#[cfg(not(any(target_os = "macos", target_os = "ios")))]
impl KokoroCoreML {
    pub fn new(_model_dir: &str, _voices_path: &str) -> Result<Self, String> {
        Err("CoreML is only available on macOS/iOS".to_string())
    }
    
    pub fn generate_tts(
        &self,
        _text: &str,
        _voice_id: &str,
        _language: &str,
        _speed: f32,
    ) -> Result<Vec<f32>, String> {
        Err("CoreML is only available on macOS/iOS".to_string())
    }
}

#[cfg(not(any(target_os = "macos", target_os = "ios")))]
pub struct KokoroCoreMLParallel;

#[cfg(not(any(target_os = "macos", target_os = "ios")))]
impl KokoroCoreMLParallel {
    pub fn new_with_instances(
        _model_dir: &str,
        _voices_path: &str,
        _num_instances: usize,
    ) -> Result<Self, String> {
        Err("CoreML is only available on macOS/iOS".to_string())
    }
    
    pub fn get_model_instance(&self, _index: usize) -> Arc<Mutex<KokoroCoreML>> {
        unreachable!("CoreML is only available on macOS/iOS")
    }
}

