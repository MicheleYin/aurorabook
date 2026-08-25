// Test helper functions for finding model files and resources

use std::env;
use std::path::{Path, PathBuf};

fn is_supertonic_onnx_dir(p: &Path) -> bool {
    p.is_dir()
        && p.join("tts.json").exists()
        && p.join("duration_predictor.onnx").exists()
}

fn is_supertonic_voice_bundle_dir(p: &Path) -> bool {
    if !p.is_dir() {
        return false;
    }
    let nested = p.join("voice_styles");
    if nested.is_dir() {
        return std::fs::read_dir(&nested).map_or(false, |d| {
            d.flatten()
                .any(|e| e.path().extension().and_then(|x| x.to_str()) == Some("json"))
        });
    }
    std::fs::read_dir(p).map_or(false, |d| {
        d.flatten().any(|e| {
            let path = e.path();
            path.extension().and_then(|x| x.to_str()) == Some("json")
                && path.file_stem().and_then(|s| s.to_str()) != Some("voice_map")
        })
    })
}

/// Find Supertonic 3 ONNX directory (`tts.json` + graphs).
///
/// Checks `SUPERTONIC_ONNX_DIR` / `KOKORO_MODEL_DIR`, then
/// `resources/supertonic/onnx` under common cargo/test working directories.
#[allow(dead_code)] // Used by TTS language / engine tests
pub fn find_supertonic_onnx_dir() -> Option<PathBuf> {
    let mut possible_paths = Vec::new();

    if let Ok(p) = env::var("SUPERTONIC_ONNX_DIR") {
        if !p.is_empty() {
            possible_paths.push(PathBuf::from(p));
        }
    }
    if let Ok(p) = env::var("KOKORO_MODEL_DIR") {
        if !p.is_empty() {
            possible_paths.push(PathBuf::from(p));
        }
    }

    possible_paths.push(PathBuf::from("resources").join("supertonic").join("onnx"));
    possible_paths.push(PathBuf::from("../resources").join("supertonic").join("onnx"));
    possible_paths.push(PathBuf::from("src-tauri/resources").join("supertonic").join("onnx"));

    if let Ok(manifest_dir) = env::var("CARGO_MANIFEST_DIR") {
        let m = PathBuf::from(manifest_dir);
        possible_paths.push(m.join("resources").join("supertonic").join("onnx"));
        // CARGO_MANIFEST_DIR = …/tts-tauri/src-tauri → sibling …/aurorabook/supertonic-3
        if let Some(repo) = m.parent() {
            if let Some(aurorabook) = repo.parent() {
                possible_paths.push(aurorabook.join("supertonic-3").join("onnx"));
            }
        }
    }

    // Sibling checkout of Hugging Face assets (parent of tts-tauri)
    if let Ok(cwd) = env::current_dir() {
        // cwd = …/src-tauri
        if cwd.ends_with("src-tauri") {
            if let Some(repo) = cwd.parent() {
                if let Some(aurorabook) = repo.parent() {
                    possible_paths.push(aurorabook.join("supertonic-3").join("onnx"));
                }
            }
        }
        // cwd = …/tts-tauri
        if let Some(aurorabook) = cwd.parent() {
            possible_paths.push(aurorabook.join("supertonic-3").join("onnx"));
        }
    }

    possible_paths.into_iter().find(|p| is_supertonic_onnx_dir(p))
}

/// Find Supertonic 3 voice bundle (`voice_styles/*.json` or a directory of style JSON).
#[allow(dead_code)] // Used by TTS language / engine tests
pub fn find_supertonic_voices_dir() -> Option<PathBuf> {
    let mut possible_paths = Vec::new();

    if let Ok(p) = env::var("SUPERTONIC_VOICES_DIR") {
        if !p.is_empty() {
            possible_paths.push(PathBuf::from(p));
        }
    }
    if let Ok(p) = env::var("KOKORO_VOICES_PATH") {
        if !p.is_empty() {
            possible_paths.push(PathBuf::from(p));
        }
    }

    possible_paths.push(PathBuf::from("resources").join("supertonic").join("voice_styles"));
    possible_paths.push(PathBuf::from("resources").join("supertonic"));
    possible_paths.push(PathBuf::from("../resources").join("supertonic").join("voice_styles"));
    possible_paths.push(PathBuf::from("src-tauri/resources").join("supertonic").join("voice_styles"));

    if let Ok(manifest_dir) = env::var("CARGO_MANIFEST_DIR") {
        let m = PathBuf::from(manifest_dir);
        possible_paths.push(m.join("resources").join("supertonic").join("voice_styles"));
        possible_paths.push(m.join("resources").join("supertonic"));
        if let Some(repo) = m.parent() {
            if let Some(aurorabook) = repo.parent() {
                possible_paths.push(aurorabook.join("supertonic-3").join("voice_styles"));
                possible_paths.push(aurorabook.join("supertonic-3"));
            }
        }
    }

    if let Ok(cwd) = env::current_dir() {
        if cwd.ends_with("src-tauri") {
            if let Some(repo) = cwd.parent() {
                if let Some(aurorabook) = repo.parent() {
                    possible_paths.push(aurorabook.join("supertonic-3").join("voice_styles"));
                }
            }
        }
        if let Some(aurorabook) = cwd.parent() {
            possible_paths.push(aurorabook.join("supertonic-3").join("voice_styles"));
        }
    }

    possible_paths
        .into_iter()
        .find(|p| is_supertonic_voice_bundle_dir(p))
}

/// Helper function to find the ONNX model file
pub fn find_onnx_model() -> Option<PathBuf> {
    // Prefer Supertonic 3 ONNX directory (current engine)
    if let Some(dir) = find_supertonic_onnx_dir() {
        return Some(dir);
    }
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
        if !path.exists() {
            continue;
        }
        // Supertonic 3 layout: resources/supertonic/onnx
        if is_supertonic_onnx_dir(&path.join("supertonic").join("onnx")) {
            return Some(path);
        }
        // Legacy: top-level .onnx files
        let has_models = path
            .read_dir()
            .ok()
            .map(|entries| {
                entries.filter_map(|e| e.ok()).any(|e| {
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
    None
}

/// Helper function to find voices (Supertonic voice_styles dir, or legacy voices-v1.0.bin).
pub fn find_voices_file(resources_dir: &PathBuf) -> Option<PathBuf> {
    // Prefer Supertonic voice bundle
    if let Some(dir) = find_supertonic_voices_dir() {
        return Some(dir);
    }

    let nested = resources_dir.join("supertonic").join("voice_styles");
    if is_supertonic_voice_bundle_dir(&nested) {
        return Some(nested);
    }
    let bundle = resources_dir.join("supertonic");
    if is_supertonic_voice_bundle_dir(&bundle) {
        return Some(bundle);
    }

    let mut possible_paths = vec![resources_dir.join("voices-v1.0.bin")];

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

/// Find a test EPUB file from the test_data directory (or sample_audio fallback).
/// Skips Git LFS pointer files so callers don't treat text stubs as ZIP/EPUB.
pub fn find_test_epub(filename: &str) -> Option<PathBuf> {
    use std::env;
    
    let mut possible_paths = Vec::new();
    
    // From test execution (cargo test) - relative to src-tauri/tests
    possible_paths.push(PathBuf::from("test_data").join(filename));
    possible_paths.push(PathBuf::from("tests/test_data").join(filename));
    
    // From project root
    if let Ok(manifest_dir) = env::var("CARGO_MANIFEST_DIR") {
        let manifest_path = PathBuf::from(manifest_dir);
        possible_paths.push(manifest_path.join("tests").join("test_data").join(filename));
        possible_paths.push(manifest_path.join("test_data").join(filename));
        if let Some(parent) = manifest_path.parent() {
            // tts-tauri/sample_audio/ often has real EPUB fixtures when test_data is LFS
            possible_paths.push(parent.join("sample_audio").join(filename));
            possible_paths.push(parent.join("src-tauri").join("tests").join("test_data").join(filename));
        }
    }
    
    // Check current directory
    if let Ok(current_dir) = std::env::current_dir() {
        possible_paths.push(current_dir.join("src-tauri").join("tests").join("test_data").join(filename));
        possible_paths.push(current_dir.join("tests").join("test_data").join(filename));
        possible_paths.push(current_dir.join("test_data").join(filename));
        possible_paths.push(current_dir.join("sample_audio").join(filename));
        if let Some(parent) = current_dir.parent() {
            possible_paths.push(parent.join("sample_audio").join(filename));
        }
    }

    for path in possible_paths {
        if path.exists() && path.is_file() && !is_git_lfs_pointer(&path) {
            return Some(path);
        }
    }
    None
}

fn is_git_lfs_pointer(path: &PathBuf) -> bool {
    use std::io::Read;
    let mut file = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return false,
    };
    let mut buf = [0u8; 64];
    let n = file.read(&mut buf).unwrap_or(0);
    let head = String::from_utf8_lossy(&buf[..n]);
    head.starts_with("version https://git-lfs.github.com/spec/")
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

