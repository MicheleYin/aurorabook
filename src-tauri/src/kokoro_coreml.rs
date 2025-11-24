// CoreML-based Kokoro TTS implementation for Apple platforms
// Uses CoreML models directly for optimal ANE/GPU utilization
// Based on kokoro-coreml conversion pipeline
//
// STATUS: Implementation in progress - model loading and inference need objc2-core-ml API completion
// See COREML_SETUP.md for conversion instructions

use std::path::Path;
use std::sync::{Arc, Mutex};
use std::fs::File;
use std::io::{Read, Cursor};

#[cfg(any(target_os = "macos", target_os = "ios"))]
use objc2_core_ml::{MLModelConfiguration, MLComputeUnits};

#[cfg(any(target_os = "macos", target_os = "ios"))]
use zip::ZipArchive;

// Voice data structure - 256-dimensional embeddings
pub struct VoiceData {
    pub embeddings: Vec<Vec<f32>>, // List of embeddings, indexed by sequence length
}

impl VoiceData {
    /// Load voice data from voices-v1.0.bin file (ZIP archive with .npy files)
    /// Format: ZIP archive containing {voice_id}.npy files
    /// Each .npy file contains a NumPy array with shape (510, 1, 256) - 510 embeddings of 256 dimensions
    pub fn load_from_file(path: &str, voice_id: &str) -> Result<Self, String> {
        let mut file = File::open(path)
            .map_err(|e| format!("Failed to open voices file: {}", e))?;
        
        let mut buffer = Vec::new();
        file.read_to_end(&mut buffer)
            .map_err(|e| format!("Failed to read voices file: {}", e))?;
        
        // Parse as ZIP archive
        let cursor = Cursor::new(buffer);
        let mut archive = ZipArchive::new(cursor)
            .map_err(|e| format!("Failed to open ZIP archive: {}", e))?;
        
        // Look for the specific voice file: {voice_id}.npy
        let voice_filename = format!("{}.npy", voice_id);
        let mut voice_file = archive.by_name(&voice_filename)
            .map_err(|e| format!("Voice '{}' not found in archive: {}", voice_id, e))?;
        
        // Read the .npy file content
        let mut npy_data = Vec::new();
        voice_file.read_to_end(&mut npy_data)
            .map_err(|e| format!("Failed to read voice file: {}", e))?;
        
        // Parse NPY format
        // NPY format: magic (6 bytes) + version (2 bytes) + header_len (2 bytes) + header + data
        if npy_data.len() < 10 {
            return Err("Invalid NPY file: too short".to_string());
        }
        
        // Check magic number: \x93NUMPY
        if &npy_data[0..6] != b"\x93NUMPY" {
            return Err("Invalid NPY file: wrong magic number".to_string());
        }
        
        // Read version (major, minor)
        let version_major = npy_data[6];
        let _version_minor = npy_data[7];
        
        // Read header length
        let (header_len, header_start) = if version_major == 1 {
            let len = u16::from_le_bytes([npy_data[8], npy_data[9]]) as usize;
            (len, 10)
        } else {
            // Version 2 uses u32 for header length
            if npy_data.len() < 12 {
                return Err("Invalid NPY file: too short for version 2 header".to_string());
            }
            let len = u32::from_le_bytes([
                npy_data[8], npy_data[9], npy_data[10], npy_data[11]
            ]) as usize;
            (len, 12)
        };
        let header_end = header_start + header_len;
        
        if header_end > npy_data.len() {
            return Err("Invalid NPY file: header extends beyond file".to_string());
        }
        
        // Parse header to get shape (we expect shape like (510, 1, 256))
        // Header is a Python dict string like: {'descr': '<f4', 'fortran_order': False, 'shape': (510, 1, 256), }
        let header_str = String::from_utf8_lossy(&npy_data[header_start..header_end]);
        
        // Extract shape from header - look for 'shape': (510, 1, 256)
        let shape_start = header_str.find("'shape':")
            .ok_or_else(|| "NPY header missing shape".to_string())?;
        let shape_str = &header_str[shape_start..];
        let shape_start_paren = shape_str.find('(')
            .ok_or_else(|| "NPY header shape missing opening paren".to_string())?;
        let shape_end_paren = shape_str[shape_start_paren..].find(')')
            .ok_or_else(|| "NPY header shape missing closing paren".to_string())?;
        let shape_values = &shape_str[shape_start_paren + 1..shape_start_paren + shape_end_paren];
        
        // Parse shape values (e.g., "510, 1, 256")
        let shape: Vec<usize> = shape_values
            .split(',')
            .map(|s| s.trim().parse::<usize>())
            .collect::<Result<_, _>>()
            .map_err(|e| format!("Failed to parse shape: {}", e))?;
        
        if shape.len() != 3 {
            return Err(format!("Expected 3D shape, got {}D: {:?}", shape.len(), shape));
        }
        
        let num_embeddings = shape[0]; // 510
        let _dim1 = shape[1]; // 1 (usually)
        let embedding_dim = shape[2]; // 256
        
        if embedding_dim != 256 {
            return Err(format!("Expected embedding dimension 256, got {}", embedding_dim));
        }
        
        // Read the data (f32 little-endian)
        let data_start = header_end;
        let expected_data_size = num_embeddings * embedding_dim * 4; // f32 = 4 bytes
        if data_start + expected_data_size > npy_data.len() {
            return Err(format!(
                "NPY data size mismatch: expected {} bytes, got {} bytes",
                expected_data_size,
                npy_data.len() - data_start
            ));
        }
        
        // Parse embeddings
        let mut embeddings = Vec::with_capacity(num_embeddings);
        for i in 0..num_embeddings {
            let offset = data_start + i * embedding_dim * 4;
            let mut embedding = Vec::with_capacity(embedding_dim);
            for j in 0..embedding_dim {
                let byte_offset = offset + j * 4;
                let bytes = [
                    npy_data[byte_offset],
                    npy_data[byte_offset + 1],
                    npy_data[byte_offset + 2],
                    npy_data[byte_offset + 3],
                ];
                embedding.push(f32::from_le_bytes(bytes));
            }
            embeddings.push(embedding);
        }
        
        Ok(Self { embeddings })
    }
    
    /// Get voice embedding for a specific sequence length
    /// Returns the embedding at index min(len(embeddings)-1, seq_len)
    pub fn get_embedding(&self, seq_len: usize) -> Option<&[f32]> {
        if self.embeddings.is_empty() {
            return None;
        }
        let idx = (seq_len - 1).min(self.embeddings.len() - 1);
        Some(&self.embeddings[idx])
    }
}

pub struct KokoroCoreML {
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    duration_model_path: Option<String>,
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    synthesizer_model_paths: Vec<(String, String)>, // (bucket_name, path)
    voices_path: String,
    model_dir: String,
    voice_data: Arc<Mutex<Option<VoiceData>>>,
    // Note: Model instances will be loaded on-demand when CoreML inference is implemented
}

impl KokoroCoreML {
    /// Initialize CoreML-based Kokoro TTS engine
    pub async fn new(model_dir: &str, voices_path: &str) -> Result<Self, String> {
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        {
            // Configure CoreML to use all compute units (CPU, GPU, ANE)
            let _config = unsafe {
                let config = MLModelConfiguration::new();
                config.setComputeUnits(MLComputeUnits::All);
                config
            };

            // Check for duration model - try both naming conventions
            let duration_paths = vec![
                Path::new(model_dir).join("kokoro_duration.mlpackage"),
                Path::new(model_dir).join("duration.mlpackage"),
            ];
            let duration_model_path: Option<String> = duration_paths.iter()
                .find(|p| p.exists())
                .map(|p| p.to_string_lossy().to_string());
            
            if duration_model_path.is_none() {
                return Err(format!(
                    "Duration model not found in {}. Expected: kokoro_duration.mlpackage or duration.mlpackage. Please copy CoreML models to this directory. See COREML_SETUP.md",
                    model_dir
                ));
            }

            // Check for synthesizer models (bucketed) - prefer decoder-only, then full synthesizer
            let buckets = vec!["3s", "5s", "10s", "30s"];
            let mut synthesizer_model_paths = Vec::new();

            for bucket in buckets {
                // Try multiple naming conventions:
                // 1. kokoro_decoder_only_{bucket}.mlpackage (preferred - decoder only)
                // 2. kokoro_synthesizer_{bucket}.mlpackage (full synthesizer)
                // 3. synthesizer_decoder_only_{bucket}.mlpackage (legacy)
                // 4. synthesizer_{bucket}.mlpackage (legacy)
                let model_paths = vec![
                    Path::new(model_dir).join(format!("kokoro_decoder_only_{}.mlpackage", bucket)),
                    Path::new(model_dir).join(format!("kokoro_synthesizer_{}.mlpackage", bucket)),
                    Path::new(model_dir).join(format!("synthesizer_decoder_only_{}.mlpackage", bucket)),
                    Path::new(model_dir).join(format!("synthesizer_{}.mlpackage", bucket)),
                ];
                
                for model_path in model_paths {
                    if model_path.exists() {
                        synthesizer_model_paths.push((
                            bucket.to_string(),
                            model_path.to_string_lossy().to_string()
                        ));
                        break; // Found a model for this bucket
                    }
                }
            }

            if synthesizer_model_paths.is_empty() {
                return Err(format!(
                    "No synthesizer models found in {}. Please convert models using kokoro-coreml export scripts. See COREML_SETUP.md",
                    model_dir
                ));
            }

            Ok(Self {
                duration_model_path,
                synthesizer_model_paths,
                voices_path: voices_path.to_string(),
                model_dir: model_dir.to_string(),
                voice_data: Arc::new(Mutex::new(None)),
            })
        }
        
        #[cfg(not(any(target_os = "macos", target_os = "ios")))]
        {
            Err("CoreML is only available on macOS/iOS".to_string())
        }
    }

    /// Get voice embedding for a sequence length and voice ID
    fn get_voice_embedding(&self, seq_len: usize, voice_id: &str) -> Result<Vec<f32>, String> {
        // Handle poisoned locks gracefully
        let mut voice_data_guard = self.voice_data.lock().unwrap_or_else(|e| e.into_inner());
        
        // Load voice data if not already loaded (or if voice changed)
        // For now, reload each time - could optimize with caching per voice_id
        let data = VoiceData::load_from_file(&self.voices_path, voice_id)?;
        *voice_data_guard = Some(data);
        
        let voice_data = voice_data_guard.as_ref()
            .ok_or_else(|| "Voice data not loaded".to_string())?;
        
        let embedding = voice_data.get_embedding(seq_len)
            .ok_or_else(|| format!("No voice embedding found for sequence length {}", seq_len))?;
        
        Ok(embedding.to_vec())
    }

    /// Simple text preprocessing - convert to phoneme IDs
    /// TODO: Implement proper G2P conversion (may need Python bridge or espeak-ng)
    fn preprocess_text(&self, text: &str) -> Result<Vec<i32>, String> {
        // Placeholder: Simple character-based tokenization
        // In production, this should use proper G2P conversion
        // For now, return a simple token sequence
        let tokens: Vec<i32> = text.chars()
            .map(|c| c as i32)
            .take(128) // Max 128 tokens
            .collect();
        
        // Pad to 128 tokens
        let mut padded = vec![0i32; 128];
        let len = tokens.len().min(128);
        padded[..len].copy_from_slice(&tokens[..len]);
        
        Ok(padded)
    }

    /// Generate TTS audio using CoreML models
    pub async fn generate_audio(
        &self,
        text: &str,
        voice_id: &str,
        _language: Option<&str>,
        speed: Option<f32>,
    ) -> Result<Vec<f32>, String> {
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        {
            // 1. Preprocess text to phoneme IDs
            let input_ids = self.preprocess_text(text)?;
            let seq_len = input_ids.len();
            
            // 2. Load voice embedding
            let ref_s_tensor = self.get_voice_embedding(seq_len, voice_id)?;
            
            // Ensure ref_s is shape [1, 256] for model input
            let ref_s = if ref_s_tensor.len() == 256 {
                ref_s_tensor
            } else {
                return Err(format!("Invalid ref_s length: expected 256, got {}", ref_s_tensor.len()));
            };
            
            // 3. Prepare inputs for duration model
            let speed_val = speed.unwrap_or(1.0);
            let _attention_mask: Vec<i32> = input_ids.iter()
                .map(|&id| if id != 0 { 1 } else { 0 })
                .collect();
            
            // 4. Run duration model inference
            // TODO: Implement actual CoreML model inference using objc2-core-ml API
            // The actual CoreML inference requires:
            // - Loading MLModel from .mlpackage path
            // - Creating MLFeatureProvider with inputs (input_ids, ref_s, speed, attention_mask)
            // - Running prediction
            // - Extracting outputs (pred_dur, t_en, s, ref_s_out)
            // - Building alignment matrix
            // - Running synthesizer model inference
            // - Converting waveform to audio samples
            
            // Placeholder: Generate silence based on estimated duration
            // This allows the pipeline to work while CoreML inference is being implemented
            let estimated_duration_frames = (seq_len as f32 * 40.0 / speed_val) as usize; // ~40 frames per token
            let estimated_samples = (estimated_duration_frames as f32 * 600.0) as usize; // 600 samples per frame
            
            // Generate silence as placeholder (max 3 seconds = 72000 samples at 24kHz)
            let audio_samples = vec![0.0f32; estimated_samples.min(72000)];
            
            // Log that we're using placeholder implementation
            eprintln!(
                "⚠️  CoreML inference not yet implemented. Using placeholder audio. \
                Text: '{}', Voice: '{}', Speed: {}, Input IDs len: {}, Ref_S len: {}, Estimated samples: {}",
                text.chars().take(50).collect::<String>(),
                voice_id,
                speed_val,
                input_ids.len(),
                ref_s.len(),
                audio_samples.len()
            );
            
            Ok(audio_samples)
        }
        
        #[cfg(not(any(target_os = "macos", target_os = "ios")))]
        {
            Err("CoreML is only available on macOS/iOS".to_string())
        }
    }
}

// Trait to match kokoros API interface for compatibility
pub trait TTSInstance {
    fn tts_raw_audio_with_instance(
        &self,
        text: &str,
        language: &str,
        voice_id: &str,
        speed: f32,
        initial_silence: Option<f32>,
        request_id: Option<&str>,
        instance_id: Option<usize>,
        chunk_number: Option<usize>,
        instance: &Self,
    ) -> Result<Vec<f32>, String>;
}

impl TTSInstance for KokoroCoreML {
    fn tts_raw_audio_with_instance(
        &self,
        text: &str,
        language: &str,
        voice_id: &str,
        speed: f32,
        _initial_silence: Option<f32>,
        _request_id: Option<&str>,
        _instance_id: Option<usize>,
        _chunk_number: Option<usize>,
        _instance: &Self,
    ) -> Result<Vec<f32>, String> {
        // Clone data for potential async call
        let text = text.to_string();
        let voice_id = voice_id.to_string();
        let language = language.to_string();
        
        // Check if we're in an async runtime
        if tokio::runtime::Handle::try_current().is_ok() {
            // We're in an async context - use spawn_blocking to run in a blocking thread
            // This avoids the "cannot start runtime from within runtime" error
            std::thread::scope(|s| {
                let result = s.spawn(|| {
                    let rt = tokio::runtime::Runtime::new()
                        .map_err(|e| format!("Failed to create runtime: {}", e))?;
                    rt.block_on(self.generate_audio(&text, &voice_id, Some(&language), Some(speed)))
                });
                result.join().map_err(|_| "Thread join error".to_string())?
            })
        } else {
            // We're not in an async context, create a new runtime
            let rt = tokio::runtime::Runtime::new()
                .map_err(|e| format!("Failed to create runtime: {}", e))?;
            rt.block_on(self.generate_audio(&text, &voice_id, Some(&language), Some(speed)))
        }
    }
}

#[derive(Clone)]
pub struct KokoroCoreMLParallel {
    engines: Vec<Arc<Mutex<KokoroCoreML>>>,
}

impl KokoroCoreMLParallel {
    /// Create multiple CoreML instances for parallel processing
    pub async fn new_with_instances(
        model_dir: &str,
        voices_path: &str,
        num_instances: usize,
    ) -> Result<Self, String> {
        let mut engines = Vec::new();
        for _ in 0..num_instances {
            let engine = KokoroCoreML::new(model_dir, voices_path).await?;
            engines.push(Arc::new(Mutex::new(engine)));
        }
        Ok(Self { engines })
    }

    pub fn get_instance(&self, index: usize) -> Arc<Mutex<KokoroCoreML>> {
        self.engines[index % self.engines.len()].clone()
    }
    
    /// Get model instance compatible with kokoros API
    pub fn get_model_instance(&self, index: usize) -> Arc<Mutex<KokoroCoreML>> {
        self.get_instance(index)
    }
}
