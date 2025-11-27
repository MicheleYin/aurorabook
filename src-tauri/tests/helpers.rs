// Test helper functions for finding model files and resources

use std::env;
use std::path::PathBuf;

/// Helper function to find the ONNX model file
pub fn find_onnx_model() -> Option<PathBuf> {
    // Try multiple possible locations
    let mut possible_paths = Vec::new();
    
    // From test execution (cargo test) - relative to src-tauri
    possible_paths.push(PathBuf::from("resources").join("kokoro-v1.0.onnx"));
    possible_paths.push(PathBuf::from("../resources").join("kokoro-v1.0.onnx"));
    possible_paths.push(PathBuf::from("src-tauri/resources").join("kokoro-v1.0.onnx"));
    
    // From project root
    if let Ok(manifest_dir) = env::var("CARGO_MANIFEST_DIR") {
        possible_paths.push(PathBuf::from(manifest_dir).join("resources").join("kokoro-v1.0.onnx"));
    }
    
    // Check KOKORO_MODEL_DIR env var
    if let Ok(env_path) = env::var("KOKORO_MODEL_DIR") {
        if !env_path.is_empty() {
            let env_buf = PathBuf::from(&env_path);
            if env_buf.is_file() && env_buf.extension().and_then(|s| s.to_str()) == Some("onnx") {
                possible_paths.push(env_buf);
            } else if env_buf.is_dir() {
                possible_paths.push(env_buf.join("kokoro-v1.0.onnx"));
            }
        }
    }

    for path in possible_paths {
        if path.exists() && path.is_file() {
            return Some(path);
        }
    }
    None
}

/// Helper function to find quantized models from Kokoro-82M-v1.0-ONNX
#[allow(dead_code)] // Used in tests
pub fn find_quantized_model(model_name: &str) -> Option<PathBuf> {
    let mut possible_paths = Vec::new();
    
    // Try relative to project root
    possible_paths.push(PathBuf::from("Kokoro-82M-v1.0-ONNX").join("onnx").join(model_name));
    possible_paths.push(PathBuf::from("../Kokoro-82M-v1.0-ONNX").join("onnx").join(model_name));
    
    // From project root if we have manifest dir
    if let Ok(manifest_dir) = env::var("CARGO_MANIFEST_DIR") {
        let manifest_path = PathBuf::from(&manifest_dir);
        // Go up to project root (assuming we're in src-tauri)
        if let Some(parent) = manifest_path.parent() {
            possible_paths.push(parent.join("Kokoro-82M-v1.0-ONNX").join("onnx").join(model_name));
        }
    }
    
    // Check current directory
    if let Ok(current_dir) = std::env::current_dir() {
        possible_paths.push(current_dir.join("Kokoro-82M-v1.0-ONNX").join("onnx").join(model_name));
        // Also check if we're in src-tauri
        if let Some(parent) = current_dir.parent() {
            possible_paths.push(parent.join("Kokoro-82M-v1.0-ONNX").join("onnx").join(model_name));
        }
    }

    for path in possible_paths {
        if path.exists() && path.is_file() {
            return Some(path);
        }
    }
    None
}

/// Helper function to find the resources directory
pub fn find_resources_dir() -> Option<PathBuf> {
    // Try multiple possible locations
    let possible_paths = vec![
        // From test execution (cargo test) - relative to src-tauri
        PathBuf::from("resources"),
        PathBuf::from("../resources"),
        PathBuf::from("src-tauri/resources"),
        // From project root
        PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap_or_default()).join("resources"),
        // Absolute path fallback
        PathBuf::from(env::var("KOKORO_MODEL_DIR").unwrap_or_default()),
    ];

    for path in possible_paths {
        if path.exists() {
            // Check if it has model files (look for .onnx files)
            let has_models = path.read_dir()
                .ok()
                .map(|entries| {
                    entries.filter_map(|e| e.ok())
                        .any(|e| {
                            let file_name = e.file_name();
                            let name = file_name.to_string_lossy();
                            name.ends_with(".onnx")
                        })
                })
                .unwrap_or(false);
            
            if has_models {
                return Some(path);
            }
        }
    }
    None
}

/// Helper function to find the voices file
pub fn find_voices_file(resources_dir: &PathBuf) -> Option<PathBuf> {
    let mut possible_paths = vec![
        resources_dir.join("voices-v1.0.bin"),
    ];
    
    // Check parent directories
    if let Some(parent) = resources_dir.parent() {
        possible_paths.push(parent.join("voices-v1.0.bin"));
        if let Some(grandparent) = parent.parent() {
            possible_paths.push(grandparent.join("voices-v1.0.bin"));
        }
    }
    
    // Check env var
    if let Ok(env_path) = env::var("KOKORO_VOICES_PATH") {
        if !env_path.is_empty() {
            possible_paths.push(PathBuf::from(env_path));
        }
    }
    
    // Check common locations relative to CARGO_MANIFEST_DIR
    if let Ok(manifest_dir) = env::var("CARGO_MANIFEST_DIR") {
        let manifest_path = PathBuf::from(manifest_dir);
        possible_paths.push(manifest_path.join("resources").join("voices-v1.0.bin"));
        possible_paths.push(manifest_path.join("voices-v1.0.bin"));
    }

    for path in possible_paths {
        if path.exists() && path.is_file() {
            return Some(path);
        }
    }
    None
}

/// Convert f32 samples to PCM bytes (for use in save_audio_as_wav)
pub fn f32_to_pcm_le_bytes_for_wav(samples: &[f32]) -> Vec<u8> {
    let mut pcm_bytes = Vec::with_capacity(samples.len() * 2);
    for sample in samples {
        let clamped = sample.max(-1.0).min(1.0);
        let pcm_value = if clamped < 0.0 {
            (clamped * 32768.0) as i16
        } else {
            (clamped * 32767.0) as i16
        };
        pcm_bytes.extend_from_slice(&pcm_value.to_le_bytes());
    }
    pcm_bytes
}

/// Helper function to save audio samples as WAV file
pub fn save_audio_as_wav(audio_samples: &[f32], sample_rate: u32, file_path: &str) -> Result<(), String> {
    use std::fs::File;
    use std::io::Write;
    
    let mut file = File::create(file_path)
        .map_err(|e| format!("Failed to create WAV file: {}", e))?;
    
    // WAV header (44 bytes)
    let num_samples = audio_samples.len();
    let data_size = num_samples * 2; // 16-bit samples = 2 bytes per sample
    let file_size = 36 + data_size;
    
    // Write WAV header
    file.write_all(b"RIFF")
        .map_err(|e| format!("Failed to write RIFF: {}", e))?;
    file.write_all(&(file_size as u32).to_le_bytes())
        .map_err(|e| format!("Failed to write file size: {}", e))?;
    file.write_all(b"WAVE")
        .map_err(|e| format!("Failed to write WAVE: {}", e))?;
    file.write_all(b"fmt ")
        .map_err(|e| format!("Failed to write fmt: {}", e))?;
    file.write_all(&(16u32).to_le_bytes()) // fmt chunk size
        .map_err(|e| format!("Failed to write fmt size: {}", e))?;
    file.write_all(&(1u16).to_le_bytes()) // PCM format
        .map_err(|e| format!("Failed to write format: {}", e))?;
    file.write_all(&(1u16).to_le_bytes()) // mono
        .map_err(|e| format!("Failed to write channels: {}", e))?;
    file.write_all(&sample_rate.to_le_bytes())
        .map_err(|e| format!("Failed to write sample rate: {}", e))?;
    file.write_all(&(sample_rate * 2).to_le_bytes()) // byte rate
        .map_err(|e| format!("Failed to write byte rate: {}", e))?;
    file.write_all(&(2u16).to_le_bytes()) // block align
        .map_err(|e| format!("Failed to write block align: {}", e))?;
    file.write_all(&(16u16).to_le_bytes()) // bits per sample
        .map_err(|e| format!("Failed to write bits per sample: {}", e))?;
    file.write_all(b"data")
        .map_err(|e| format!("Failed to write data: {}", e))?;
    file.write_all(&(data_size as u32).to_le_bytes())
        .map_err(|e| format!("Failed to write data size: {}", e))?;
    
    // Write audio samples as 16-bit PCM
    let pcm_bytes = f32_to_pcm_le_bytes_for_wav(audio_samples);
    file.write_all(&pcm_bytes)
        .map_err(|e| format!("Failed to write samples: {}", e))?;
    
    Ok(())
}

