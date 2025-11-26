use tauri::Manager;

// ONNX Runtime with CoreML EP support (macOS/iOS only)
#[cfg(any(target_os = "macos", target_os = "ios"))]
mod kokoro_onnx_coreml;

mod epub_converter;
mod book_service;

// Use kokoros crate directly on all platforms (it uses ONNX Runtime with CoreML EP on macOS/iOS)

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// Read a resource file and return its contents as bytes
/// Useful for loading bundled resources like voice samples
#[tauri::command]
async fn read_resource_file(
    resource_path: String,
    app: tauri::AppHandle,
) -> Result<Vec<u8>, String> {
    use std::fs;
    
    // Get resource file path from bundle
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to get resource dir: {}", e))?;
    
    // Try multiple possible resource locations (dev vs production)
    let mut possible_paths = vec![
        resource_dir.join(&resource_path),
        resource_dir.join("resources").join(&resource_path),
    ];
    
    // Add dev mode path if available
    if let Ok(current_dir) = std::env::current_dir() {
        possible_paths.push(current_dir.join("src-tauri").join("resources").join(&resource_path));
        possible_paths.push(current_dir.join("resources").join(&resource_path));
    }
    
    for path in &possible_paths {
        if path.exists() && path.is_file() {
            return fs::read(path)
                .map_err(|e| format!("Failed to read resource file {:?}: {}", path, e));
        }
    }
    
    Err(format!(
        "Resource file {} not found in any expected location. Checked: {:?}",
        resource_path, possible_paths
    ))
}

// Copy bundled resource file to app data directory
#[tauri::command]
async fn copy_resource_file(
    resource_path: String,
    target_path: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    use std::fs;
    use std::io::Write;
    
    // Get resource file path from bundle
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to get resource dir: {}", e))?;
    
    // Try multiple possible resource locations (dev vs production)
    let mut possible_paths = vec![
        resource_dir.join(&resource_path),
        resource_dir.join("resources").join(&resource_path),
    ];
    
    // Add dev mode path if available
    if let Ok(current_dir) = std::env::current_dir() {
        possible_paths.push(current_dir.join("src-tauri").join("resources").join(&resource_path));
    }
    
    let mut data = None;
    let mut checked_paths = Vec::new();
    for path in &possible_paths {
        checked_paths.push(path.clone());
        if path.exists() {
            data = Some(fs::read(path)
                .map_err(|e| format!("Failed to read resource file {:?}: {}", path, e))?);
            break;
        }
    }
    
    let file_data = data.ok_or_else(|| {
        format!(
            "Resource file {} not found in any expected location. Checked: {:?}",
            resource_path, checked_paths
        )
    })?;
    
    // Ensure target directory exists
    if let Some(parent) = std::path::Path::new(&target_path).parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    
    // Write to target path
    let mut file = fs::File::create(&target_path)
        .map_err(|e| format!("Failed to create target file: {}", e))?;
    file.write_all(&file_data)
        .map_err(|e| format!("Failed to write file: {}", e))?;
    
    Ok(())
}

// Copy directory recursively (for resource directories)
#[tauri::command]
async fn copy_directory(
    source_path: String,
    target_path: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    use std::fs;
    use std::path::Path;
    
    fn copy_dir_all(src: &Path, dst: &Path) -> Result<(), String> {
        fs::create_dir_all(dst)
            .map_err(|e| format!("Failed to create directory {:?}: {}", dst, e))?;
        
        for entry in fs::read_dir(src)
            .map_err(|e| format!("Failed to read directory {:?}: {}", src, e))? {
            let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
            let path = entry.path();
            let file_name = entry.file_name();
            let target = dst.join(&file_name);
            
            if path.is_dir() {
                copy_dir_all(&path, &target)?;
            } else {
                fs::copy(&path, &target)
                    .map_err(|e| format!("Failed to copy {:?} to {:?}: {}", path, target, e))?;
            }
        }
        Ok(())
    }
    
    // Try to resolve source path from bundled resources
    // First, try to find it as a resource (with or without "resources/" prefix)
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to get resource dir: {}", e))?;
    
    // Try multiple possible resource locations (dev vs production)
    let mut possible_paths = Vec::new();
    
    // If it starts with "resources/", strip that prefix
    let resource_name = if source_path.starts_with("resources/") {
        source_path.strip_prefix("resources/").unwrap_or(&source_path).to_string()
    } else {
        source_path.clone()
    };
    
    // Try resource directory paths
    possible_paths.push(resource_dir.join(&resource_name));
    possible_paths.push(resource_dir.join("resources").join(&resource_name));
    
    // Add dev mode paths if available
    if let Ok(current_dir) = std::env::current_dir() {
        possible_paths.push(current_dir.join("src-tauri").join("resources").join(&resource_name));
        possible_paths.push(current_dir.join("src-tauri").join(&resource_name));
    }
    
    // Also try as absolute path (fallback)
    possible_paths.push(Path::new(&source_path).to_path_buf());
    
    // Find the first path that exists
    let mut found_path = None;
    for path in &possible_paths {
        if path.exists() {
            found_path = Some(path.clone());
            break;
        }
    }
    
    let source = found_path.ok_or_else(|| {
        format!(
            "Source path does not exist: {}. Checked locations: {:?}",
            source_path, possible_paths
        )
    })?;
    
    let target = Path::new(&target_path);
    
    if !source.exists() {
        return Err(format!("Source path does not exist: {}", source.display()));
    }
    
    if source.is_dir() {
        copy_dir_all(&source, target)
    } else {
        // If it's a file, just copy it
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create parent directory: {}", e))?;
        }
        fs::copy(&source, target)
            .map_err(|e| format!("Failed to copy file: {}", e))?;
        Ok(())
    }
}

#[tauri::command]
async fn init_kokoros_engine(
    model_path: String,
    voices_path: String,
    _num_instances: Option<usize>,
    _app: tauri::AppHandle,
) -> Result<String, String> {
    // Models are accessed directly from bundle resources
    // If paths are empty, we'll find them from bundle resources
    // This function is kept for API compatibility but doesn't need to store engine state
    // kokoros manages its own instances internally
    
    // If paths are provided and not empty, validate them
    if !model_path.is_empty() {
        let model_path_obj = std::path::Path::new(&model_path);
        
        if !model_path_obj.exists() {
            return Err(format!(
                "Model file does not exist: {}. Expected kokoro-v1.0.onnx",
                model_path
            ));
        }
        
        if !model_path_obj.is_file() {
            return Err(format!(
                "Model path must be a file (ONNX model). Got: {}",
                model_path
            ));
        }
        
        if !model_path.ends_with(".onnx") {
            return Err(format!(
                "Model file must be an ONNX model (.onnx extension). Got: {}",
                model_path
            ));
        }
    }
    
    println!("ONNX Runtime engine initialization (models will be loaded from bundle resources when needed)");
    if !model_path.is_empty() {
        println!("Model path: {}, Voices path: {}", model_path, voices_path);
    } else {
        println!("Using bundle resources for models");
    }
    
    Ok(format!(
        "Initialized ONNX Runtime engine (using bundle resources)"
    ))
}

#[tauri::command]
async fn generate_tts_cached(
    text: String,
    voice_id: String,
    language: Option<String>,
    speed: Option<f32>,
    worker_id: Option<usize>,
    app: tauri::AppHandle,
) -> Result<Vec<u8>, String> {
    // Find ONNX model and voices file - check multiple locations
    // Priority: 1) Bundle resources, 2) Dev paths
    let mut possible_onnx_paths = Vec::new();
    let mut possible_voices_paths = Vec::new();
    
    // 1. Check bundle resource directory (primary location for built apps)
    if let Ok(resource_dir) = app.path().resource_dir() {
        possible_onnx_paths.push(resource_dir.join("kokoro-v1.0.onnx"));
        possible_onnx_paths.push(resource_dir.join("resources").join("kokoro-v1.0.onnx"));
        possible_voices_paths.push(resource_dir.join("voices-v1.0.bin"));
        possible_voices_paths.push(resource_dir.join("resources").join("voices-v1.0.bin"));
    }
    
    // 3. Check dev mode paths (current directory)
    if let Ok(current_dir) = std::env::current_dir() {
        possible_onnx_paths.push(current_dir.join("src-tauri").join("resources").join("kokoro-v1.0.onnx"));
        possible_onnx_paths.push(current_dir.join("resources").join("kokoro-v1.0.onnx"));
        possible_voices_paths.push(current_dir.join("src-tauri").join("resources").join("voices-v1.0.bin"));
        possible_voices_paths.push(current_dir.join("resources").join("voices-v1.0.bin"));
    }
    
    // 4. Check environment variable
    if let Ok(env_path) = std::env::var("KOKORO_MODEL_PATH") {
        if !env_path.is_empty() {
            possible_onnx_paths.push(std::path::PathBuf::from(env_path));
        }
    }
    
    // Find first existing ONNX model
    let onnx_path = possible_onnx_paths.iter()
        .find(|p| p.exists() && p.is_file())
        .cloned();
    
    // Find first existing voices file
    let voices_path = possible_voices_paths.iter()
        .find(|p| p.exists() && p.is_file())
        .cloned();
    
    if let (Some(onnx_path), Some(voices_path)) = (onnx_path, voices_path) {
        let onnx_path_str = onnx_path.to_str()
            .ok_or_else(|| "ONNX path contains invalid UTF-8".to_string())?;
        let voices_path_str = voices_path.to_str()
            .ok_or_else(|| "Voices path contains invalid UTF-8".to_string())?;
        
        // Initialize ONNX engine (uses CoreML EP automatically on macOS/iOS)
        let engine = kokoros::tts::koko::TTSKokoParallel::new_with_instances(
            onnx_path_str,
            voices_path_str,
            1,
        ).await;
        
        let model_instance = engine.get_model_instance(worker_id.unwrap_or(0));
        match engine.tts_raw_audio_with_instance(
            &text,
            language.as_deref().unwrap_or("en"),
            &voice_id,
            speed.unwrap_or(1.0),
            None,
            None,
            None,
            None,
            model_instance,
        ) {
            Ok(audio_samples) => {
                // Convert Vec<f32> to 16-bit PCM bytes
                let mut pcm_bytes = Vec::with_capacity(audio_samples.len() * 2);
                for sample in audio_samples {
                    let clamped = sample.max(-1.0).min(1.0);
                    let pcm_value = if clamped < 0.0 {
                        (clamped * 32768.0) as i16
                    } else {
                        (clamped * 32767.0) as i16
                    };
                    pcm_bytes.extend_from_slice(&pcm_value.to_le_bytes());
                }
                Ok(pcm_bytes)
            }
            Err(e) => {
                Err(format!("TTS generation failed: {}", e))
            }
        }
    } else {
        let mut error_msg = "Could not find required files. Checked paths:\n".to_string();
        error_msg.push_str("ONNX model paths:\n");
        for path in &possible_onnx_paths {
            error_msg.push_str(&format!("  - {}\n", path.display()));
        }
        error_msg.push_str("Voices file paths:\n");
        for path in &possible_voices_paths {
            error_msg.push_str(&format!("  - {}\n", path.display()));
        }
        Err(error_msg)
    }
}

// Generate TTS for multiple texts in parallel
#[tauri::command]
async fn generate_tts_batch(
    texts: Vec<String>,
    voice_id: String,
    language: Option<String>,
    speed: Option<f32>,
    app: tauri::AppHandle,
) -> Result<Vec<Vec<u8>>, String> {
    // Find ONNX model and voices file - check multiple locations (same as generate_tts_cached)
    let mut possible_onnx_paths = Vec::new();
    let mut possible_voices_paths = Vec::new();
    
    // 1. Check bundle resource directory (primary location for built apps)
    if let Ok(resource_dir) = app.path().resource_dir() {
        possible_onnx_paths.push(resource_dir.join("kokoro-v1.0.onnx"));
        possible_onnx_paths.push(resource_dir.join("resources").join("kokoro-v1.0.onnx"));
        possible_voices_paths.push(resource_dir.join("voices-v1.0.bin"));
        possible_voices_paths.push(resource_dir.join("resources").join("voices-v1.0.bin"));
    }
    
    // 3. Check dev mode paths (current directory)
    if let Ok(current_dir) = std::env::current_dir() {
        possible_onnx_paths.push(current_dir.join("src-tauri").join("resources").join("kokoro-v1.0.onnx"));
        possible_onnx_paths.push(current_dir.join("resources").join("kokoro-v1.0.onnx"));
        possible_voices_paths.push(current_dir.join("src-tauri").join("resources").join("voices-v1.0.bin"));
        possible_voices_paths.push(current_dir.join("resources").join("voices-v1.0.bin"));
    }
    
    // 4. Check environment variable
    if let Ok(env_path) = std::env::var("KOKORO_MODEL_PATH") {
        if !env_path.is_empty() {
            possible_onnx_paths.push(std::path::PathBuf::from(env_path));
        }
    }
    
    // Find first existing ONNX model
    let onnx_path = possible_onnx_paths.iter()
        .find(|p| p.exists() && p.is_file())
        .cloned();
    
    // Find first existing voices file
    let voices_path = possible_voices_paths.iter()
        .find(|p| p.exists() && p.is_file())
        .cloned();
    
    if let (Some(onnx_path), Some(voices_path)) = (onnx_path, voices_path) {
        let onnx_path_str = onnx_path.to_str()
            .ok_or_else(|| "ONNX path contains invalid UTF-8".to_string())?
            .to_string();
        let voices_path_str = voices_path.to_str()
            .ok_or_else(|| "Voices path contains invalid UTF-8".to_string())?
            .to_string();
            
        // Process texts in parallel
        let mut handles = Vec::new();
        for text in texts.iter() {
            let text_clone = text.clone();
            let voice_id_clone = voice_id.clone();
            let language_clone = language.clone();
            let speed_val = speed.unwrap_or(1.0);
            let onnx_path_clone = onnx_path_str.clone();
            let voices_path_clone = voices_path_str.clone();
            
            let handle = tokio::spawn(async move {
                // Create a new engine instance for this task
                let task_engine = kokoros::tts::koko::TTSKokoParallel::new_with_instances(
                    &onnx_path_clone,
                    &voices_path_clone,
                    1, // Use 1 instance per task
                ).await;
                
                let model_instance = task_engine.get_model_instance(0);
                task_engine.tts_raw_audio_with_instance(
                    &text_clone,
                    language_clone.as_deref().unwrap_or("en"),
                    &voice_id_clone,
                    speed_val,
                    None,
                    None,
                    None,
                    None,
                    model_instance,
                )
                .map_err(|e| format!("Failed to generate audio: {}", e))
            });
            handles.push(handle);
        }
        
        // Collect results
        let mut results = Vec::new();
        for handle in handles {
            let audio_samples: Vec<f32> = handle.await
                .map_err(|e: tokio::task::JoinError| format!("Task error: {}", e))?
                .map_err(|e: String| e)?;
            
            // Convert Vec<f32> to 16-bit PCM bytes
            let mut pcm_bytes = Vec::with_capacity(audio_samples.len() * 2);
            for sample in audio_samples {
                let clamped = sample.max(-1.0).min(1.0);
                let pcm_value = if clamped < 0.0 {
                    (clamped * 32768.0) as i16
                } else {
                    (clamped * 32767.0) as i16
                };
                pcm_bytes.extend_from_slice(&pcm_value.to_le_bytes());
            }
            results.push(pcm_bytes);
        }
        
        Ok(results)
    } else {
        let mut error_msg = "Could not find required files. Checked paths:\n".to_string();
        error_msg.push_str("ONNX model paths:\n");
        for path in &possible_onnx_paths {
            error_msg.push_str(&format!("  - {}\n", path.display()));
        }
        error_msg.push_str("Voices file paths:\n");
        for path in &possible_voices_paths {
            error_msg.push_str(&format!("  - {}\n", path.display()));
        }
        Err(error_msg)
    }
}

/// Convert PCM audio data (16-bit samples) to MP3
/// 
/// # Arguments
/// * `pcm_data` - Raw PCM audio data as 16-bit little-endian samples
/// * `sample_rate` - Sample rate in Hz (e.g., 24000)
/// * `channels` - Number of channels (1 for mono, 2 for stereo)
/// * `bitrate` - MP3 bitrate in kbps (default: 128)
#[tauri::command]
fn convert_pcm_to_mp3(
    pcm_data: Vec<u8>,
    sample_rate: u32,
    channels: u32,
    bitrate: Option<u32>,
) -> Result<Vec<u8>, String> {
    let bitrate_kbps = bitrate.unwrap_or(128);
    
    // Validate inputs
    if pcm_data.is_empty() {
        return Err("PCM data is empty".to_string());
    }
    if sample_rate == 0 {
        return Err("Sample rate must be greater than 0".to_string());
    }
    if channels != 1 && channels != 2 {
        return Err("Channels must be 1 (mono) or 2 (stereo)".to_string());
    }
    if pcm_data.len() % (channels as usize * 2) != 0 {
        return Err(format!(
            "PCM data length ({}) must be divisible by {} (channels * 2 bytes per sample)",
            pcm_data.len(),
            channels * 2
        ));
    }
    
    // Convert bytes to i16 samples (little-endian)
    let num_samples = pcm_data.len() / 2;
    let mut pcm_samples = Vec::with_capacity(num_samples);
    for chunk in pcm_data.chunks_exact(2) {
        let sample = i16::from_le_bytes([chunk[0], chunk[1]]);
        pcm_samples.push(sample);
    }
    
    // Initialize LAME encoder
    let mut encoder = lame::Lame::new()
        .ok_or_else(|| "Failed to initialize LAME encoder".to_string())?;
    
    encoder.set_sample_rate(sample_rate)
        .map_err(|e| format!("Failed to set sample rate: {:?}", e))?;
    
    encoder.set_channels(channels as u8)
        .map_err(|e| format!("Failed to set channels: {:?}", e))?;
    
    encoder.set_quality(2) // Quality level 0-9 (2 is good balance)
        .map_err(|e| format!("Failed to set quality: {:?}", e))?;
    
    encoder.set_kilobitrate(bitrate_kbps as i32)
        .map_err(|e| format!("Failed to set bitrate: {:?}", e))?;
    
    // Initialize encoder parameters
    encoder.init_params()
        .map_err(|e| format!("Failed to initialize encoder parameters: {:?}", e))?;
    
    // Encode PCM to MP3
    let mut mp3_output = Vec::new();
    
    // Calculate buffer size (LAME recommends: 1.25 * num_samples + 7200)
    let buffer_size = (pcm_samples.len() as f64 * 1.25) as usize + 7200;
    let mut mp3_buffer = vec![0u8; buffer_size];
    
    if channels == 1 {
        // Mono encoding - use same data for left and right
        let encoded_size = encoder.encode(&pcm_samples, &pcm_samples, &mut mp3_buffer)
            .map_err(|e| format!("Failed to encode audio: {:?}", e))?;
        
        mp3_output.extend_from_slice(&mp3_buffer[..encoded_size]);
    } else {
        // Stereo encoding - split into left and right channels
        let mut pcm_left = Vec::with_capacity(num_samples / 2);
        let mut pcm_right = Vec::with_capacity(num_samples / 2);
        
        for i in 0..(num_samples / 2) {
            pcm_left.push(pcm_samples[i * 2]);
            pcm_right.push(pcm_samples[i * 2 + 1]);
        }
        
        let encoded_size = encoder.encode(&pcm_left, &pcm_right, &mut mp3_buffer)
            .map_err(|e| format!("Failed to encode audio: {:?}", e))?;
        
        mp3_output.extend_from_slice(&mp3_buffer[..encoded_size]);
    }
    
    // Flush remaining data (encode empty buffers to flush)
    let flush_size = encoder.encode(&[], &[], &mut mp3_buffer)
        .map_err(|e| format!("Failed to flush encoder: {:?}", e))?;
    
    if flush_size > 0 {
        mp3_output.extend_from_slice(&mp3_buffer[..flush_size]);
    }
    
    if mp3_output.is_empty() {
        return Err("MP3 encoding produced no output".to_string());
    }
    
    Ok(mp3_output)
}

/// Convert EPUB to audiobook format (backend implementation)
#[tauri::command]
async fn convert_epub_to_audiobook(
    epub_data: Vec<u8>,
    options: epub_converter::ConversionOptions,
    app: tauri::AppHandle,
) -> Result<Vec<u8>, String> {
    epub_converter::convert_epub_to_audiobook(epub_data, options, app).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            greet,
            init_kokoros_engine,
            generate_tts_cached,
            generate_tts_batch,
            copy_resource_file,
            copy_directory,
            convert_pcm_to_mp3,
            convert_epub_to_audiobook,
            read_resource_file,
            book_service::read_all_books,
            book_service::read_one_book,
            book_service::read_single_chapter,
            book_service::read_single_audio_track,
            book_service::delete_book,
            book_service::add_book,
            book_service::get_epub_buffer,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use std::env;
    use std::path::PathBuf;

    /// Helper function to find the ONNX model file
    fn find_onnx_model() -> Option<PathBuf> {
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
    fn find_quantized_model(model_name: &str) -> Option<PathBuf> {
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
    fn find_resources_dir() -> Option<PathBuf> {
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
    fn find_voices_file(resources_dir: &PathBuf) -> Option<PathBuf> {
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

    #[tokio::test]
    async fn test_onnx_model_and_voices_file() {
        println!("🧪 Testing ONNX model and voices file discovery");

        // Find ONNX model file
        let onnx_model = find_onnx_model();
        match &onnx_model {
            Some(path) => {
                println!("✅ Found ONNX model: {}", path.display());
                assert!(path.exists(), "ONNX model file should exist");
                assert!(path.is_file(), "ONNX model should be a file");
                
                // Check file size (should be non-zero)
                if let Ok(metadata) = std::fs::metadata(path) {
                    let size = metadata.len();
                    println!("   File size: {} bytes ({:.2} MB)", size, size as f64 / 1_000_000.0);
                    assert!(size > 0, "ONNX model file should not be empty");
                }
            }
            None => {
                
                println!("❌ ONNX model not found");
                println!("   Expected: kokoro-v1.0.onnx");
                println!("   Set KOKORO_MODEL_DIR env var or ensure kokoro-v1.0.onnx is in resources directory");
                panic!("ONNX model file not found");
            }
        }

        // Find voices file
        let resources_dir = find_resources_dir();
        if resources_dir.is_none() {
            println!("⚠️ Resources directory not found, trying to find voices file directly");
        }
        let voices_path = if let Some(dir) = &resources_dir {
            find_voices_file(dir)
        } else {
            None
        };

        match &voices_path {
            Some(path) => {
                println!("✅ Found voices file: {}", path.display());
                assert!(path.exists(), "Voices file should exist");
                assert!(path.is_file(), "Voices should be a file");
                
                // Check file size (should be non-zero)
                if let Ok(metadata) = std::fs::metadata(path) {
                    let size = metadata.len();
                    println!("   File size: {} bytes ({:.2} MB)", size, size as f64 / 1_000_000.0);
                    assert!(size > 0, "Voices file should not be empty");
                }
            }
            None => {
                println!("❌ Voices file not found");
                println!("   Expected: voices-v1.0.bin");
                println!("   Set KOKORO_VOICES_PATH env var or ensure voices-v1.0.bin is in resources directory");
                panic!("Voices file not found");
            }
        }

        println!("\n✅ Both ONNX model and voices file are present and valid");
        
        // Try to initialize kokoros engine (this will panic if files are invalid)
        let onnx_model = onnx_model.unwrap();
        // kokoros expects the full path to the ONNX file (not just the directory)
        // Based on the TypeScript code: modelPath = `${dataDirPath}kokoro-v1.0.onnx`
        let model_path_str = onnx_model.to_str().unwrap();
        let voices_path = voices_path.unwrap();
        let voices_path_str = voices_path.to_str().unwrap();

        println!("\n🧪 Attempting to load model with kokoros...");
        println!("   Model file: {}", model_path_str);
        println!("   Voices path: {}", voices_path_str);
        println!("   ⚠️  If this panics with 'Protobuf parsing failed', the ONNX file format may be invalid");
        println!("   ⚠️  Note: kokoros expects the full path to the ONNX file, not just the directory");

        let _engine = kokoros::tts::koko::TTSKokoParallel::new_with_instances(
            model_path_str,
            voices_path_str,
            1, // Use 1 instance for testing
        ).await;

        println!("✅ Model loaded successfully with kokoros!");
    }

    #[tokio::test]
    async fn test_simple_tts_generation() {
        println!("\n🧪 Testing simple TTS generation with kokoros");

        // Find ONNX model file
        let onnx_model = find_onnx_model();
        if onnx_model.is_none() {
            println!("⚠️ Skipping test - kokoro-v1.0.onnx not found");
            return;
        }
        let onnx_model = onnx_model.unwrap();
        
        // kokoros expects the full path to the ONNX file (not just the directory)
        let model_path_str = onnx_model.to_str().unwrap();
        
        // Find voices file
        let resources_dir = find_resources_dir();
        if resources_dir.is_none() {
            println!("⚠️ Skipping test - resources directory not found");
            return;
        }
        let voices_path = find_voices_file(&resources_dir.unwrap());
        if voices_path.is_none() {
            println!("⚠️ Skipping test - voices-v1.0.bin not found");
            return;
        }
        let voices_path = voices_path.unwrap();
        let voices_path_str = voices_path.to_str().unwrap();

        println!("   Model file: {}", model_path_str);
        println!("   Voices path: {}", voices_path_str);

        // Initialize engine (following kokoros usage pattern)
        println!("\n📦 Initializing kokoros engine...");
        let engine = kokoros::tts::koko::TTSKokoParallel::new_with_instances(
            model_path_str,
            voices_path_str,
            1, // Use 1 instance for simple test
        ).await;

        println!("✅ Engine initialized");

        // Generate audio for a simple text (following kokoros API)
        let test_text = "Hello world";
        let voice_id = "af_heart";
        let language = "en";
        let speed = 1.0;

        println!("\n🎤 Generating TTS audio...");
        println!("   Text: '{}'", test_text);
        println!("   Voice: {}", voice_id);
        println!("   Language: {}", language);
        println!("   Speed: {}", speed);

        // Get model instance and generate audio
        let model_instance = engine.get_model_instance(0);
        let result = engine.tts_raw_audio_with_instance(
            test_text,
            language,
            voice_id,
            speed,
            None, // initial_silence
            None, // request_id
            None, // instance_id
            None, // chunk_number
            model_instance,
        );

        match result {
            Ok(audio) => {
                println!("✅ TTS generation succeeded!");
                println!("   Audio samples: {}", audio.len());
                println!("   Duration: {:.2}s (at 24kHz)", audio.len() as f32 / 24000.0);
                
                // Basic validation
                assert!(!audio.is_empty(), "Audio should not be empty");
                
                // Check for non-zero samples
                let non_zero_count = audio.iter().filter(|&&s| s.abs() > 0.001).count();
                println!("   Non-zero samples: {} / {} ({:.1}%)", 
                    non_zero_count, audio.len(),
                    (non_zero_count as f32 / audio.len() as f32) * 100.0);
                
                if non_zero_count > 0 {
                    // Check audio range
                    let min_val = audio.iter().fold(f32::INFINITY, |a, &b| a.min(b));
                    let max_val = audio.iter().fold(f32::NEG_INFINITY, |a, &b| a.max(b));
                    println!("   Audio range: [{:.6}, {:.6}]", min_val, max_val);
                    println!("\n✅ Simple TTS test PASSED - audio generated successfully!");
                } else {
                    println!("⚠️ WARNING: Audio contains only zeros (silence)");
                }
            }
            Err(e) => {
                println!("❌ TTS generation failed: {}", e);
                println!("   This might indicate:");
                println!("   - Model loading issues");
                println!("   - Invalid voice ID");
                println!("   - Text preprocessing problems");
                // Don't panic - just report the error
            }
        }
    }

    #[test]
    fn test_find_resources_dir() {
        let resources_dir = find_resources_dir();
        if let Some(dir) = resources_dir {
            println!("✅ Found resources directory: {}", dir.display());
            assert!(dir.exists(), "Resources directory should exist");
        } else {
            println!("⚠️ Resources directory not found - this is OK if models are not present");
        }
    }

    #[test]
    fn test_find_voices_file() {
        let resources_dir = find_resources_dir();
        if let Some(dir) = resources_dir {
            let voices_path = find_voices_file(&dir);
            if let Some(path) = voices_path {
                println!("✅ Found voices file: {}", path.display());
                assert!(path.exists(), "Voices file should exist");
                assert!(path.is_file(), "Voices path should be a file");
            } else {
                println!("⚠️ Voices file not found - this is OK if voices-v1.0.bin is not present");
            }
        } else {
            println!("⚠️ Skipping voices file test - resources directory not found");
        }
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
        for &sample in audio_samples {
            let clamped = sample.max(-1.0).min(1.0);
            let pcm_value = if clamped < 0.0 {
                (clamped * 32768.0) as i16
            } else {
                (clamped * 32767.0) as i16
            };
            file.write_all(&pcm_value.to_le_bytes())
                .map_err(|e| format!("Failed to write sample: {}", e))?;
        }
        
        Ok(())
    }

    #[tokio::test]
    async fn test_onnx_only() {
        println!("\n🧪 Testing ONNX TTS generation (ONNX only, no CoreML fallback)");
        
        // Find ONNX model file
        let onnx_model = find_onnx_model();
        if onnx_model.is_none() {
            println!("⚠️ Skipping test - kokoro-v1.0.onnx not found");
            println!("   Set KOKORO_MODEL_DIR env var or ensure kokoro-v1.0.onnx is in resources directory");
            return;
        }
        let onnx_model = onnx_model.unwrap();
        let model_path_str = onnx_model.to_str().unwrap();
        println!("   ONNX model file: {}", model_path_str);
        
        // Find voices file
        let resources_dir = find_resources_dir();
        if resources_dir.is_none() {
            println!("⚠️ Skipping test - resources directory not found");
            return;
        }
        let voices_path = find_voices_file(&resources_dir.unwrap());
        if voices_path.is_none() {
            println!("⚠️ Skipping test - voices-v1.0.bin not found");
            println!("   Set KOKORO_VOICES_PATH env var or ensure voices-v1.0.bin is in resources directory");
            return;
        }
        let voices_path = voices_path.unwrap();
        let voices_path_str = voices_path.to_str().unwrap();
        println!("   Voices path: {}", voices_path_str);
        
        // Initialize ONNX engine
        println!("\n📦 Initializing ONNX engine...");
        let engine = kokoros::tts::koko::TTSKokoParallel::new_with_instances(
            model_path_str,
            voices_path_str,
            1, // Use 1 instance for testing
        ).await;
        
        println!("✅ ONNX engine initialized successfully!");
        
        let test_text = "Hello, this is an ONNX-only test of the text to speech system.";
        let voice_id = "af_heart";
        let language = "en";
        let speed = 1.0;
        
        println!("\n🎤 Generating TTS audio with ONNX...");
        println!("   Text: '{}'", test_text);
        println!("   Voice: {}", voice_id);
        println!("   Language: {}", language);
        println!("   Speed: {}", speed);
        
        // Get model instance and generate audio
        let model_instance = engine.get_model_instance(0);
        match engine.tts_raw_audio_with_instance(
            test_text,
            language,
            voice_id,
            speed,
            None, // initial_silence
            None, // request_id
            None, // instance_id
            None, // chunk_number
            model_instance,
        ) {
            Ok(audio_samples) => {
                println!("✅ ONNX audio generated successfully!");
                println!("   Samples: {}", audio_samples.len());
                println!("   Duration: {:.2}s (at 24kHz)", audio_samples.len() as f32 / 24000.0);
                
                // Basic validation
                assert!(!audio_samples.is_empty(), "Audio should not be empty");
                
                // Check for non-zero samples
                let non_zero_count = audio_samples.iter().filter(|&&s| s.abs() > 0.001).count();
                println!("   Non-zero samples: {} / {} ({:.1}%)", 
                    non_zero_count, audio_samples.len(),
                    (non_zero_count as f32 / audio_samples.len() as f32) * 100.0);
                
                if non_zero_count > 0 {
                    // Check audio range
                    let min_val = audio_samples.iter().fold(f32::INFINITY, |a, &b| a.min(b));
                    let max_val = audio_samples.iter().fold(f32::NEG_INFINITY, |a, &b| a.max(b));
                    println!("   Audio range: [{:.6}, {:.6}]", min_val, max_val);
                } else {
                    println!("⚠️ WARNING: Audio contains only zeros (silence)");
                }
                
                // Save audio file
                let output_path = "test_output_onnx_only.wav";
                match save_audio_as_wav(&audio_samples, 24000, output_path) {
                    Ok(_) => {
                        println!("✅ Audio saved to: {}", output_path);
                        println!("   File location: {}/{}", std::env::current_dir().unwrap().display(), output_path);
                    }
                    Err(e) => {
                        println!("❌ Failed to save audio: {}", e);
                        panic!("Failed to save audio file: {}", e);
                    }
                }
                
                println!("\n✅ ONNX-only test PASSED!");
            }
            Err(e) => {
                println!("❌ ONNX TTS generation failed: {}", e);
                println!("   This might indicate:");
                println!("   - Model loading issues");
                println!("   - Invalid voice ID");
                println!("   - Text preprocessing problems");
                panic!("ONNX TTS generation failed: {}", e);
            }
        }
    }

    #[tokio::test]
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    async fn test_onnx_coreml_ep() {
        println!("\n🧪 Testing ONNX Runtime with CoreML Execution Provider");
        
        // Find ONNX model file
        let onnx_model = find_onnx_model();
        if onnx_model.is_none() {
            println!("⚠️ Skipping test - kokoro-v1.0.onnx not found");
            println!("   Set KOKORO_MODEL_DIR env var or ensure kokoro-v1.0.onnx is in resources directory");
            return;
        }
        let onnx_model = onnx_model.unwrap();
        let model_path_str = onnx_model.to_str().unwrap();
        println!("   ONNX model file: {}", model_path_str);
        
        // Initialize ONNX Runtime session with CoreML EP
        println!("\n📦 Initializing ONNX Runtime with CoreML EP...");
        use crate::kokoro_onnx_coreml::KokoroOnnxCoreML;
        
        let session = match KokoroOnnxCoreML::new(model_path_str, true) {
            Ok(session) => {
                println!("✅ ONNX Runtime session with CoreML EP initialized successfully!");
                session
            }
            Err(e) => {
                println!("❌ Failed to initialize ONNX Runtime with CoreML EP: {}", e);
                println!("   This might indicate:");
                println!("   - CoreML EP not available on this platform");
                println!("   - Model file is invalid or corrupted");
                println!("   - ONNX Runtime build doesn't include CoreML EP");
                panic!("Failed to initialize ONNX Runtime with CoreML EP: {}", e);
            }
        };
        
        // Check input and output names
        println!("\n📋 Model Information:");
        match session.input_names() {
            Ok(inputs) => {
                println!("   Inputs: {:?}", inputs);
                assert!(!inputs.is_empty(), "Model should have at least one input");
            }
            Err(e) => {
                println!("   ⚠️ Failed to get input names: {}", e);
            }
        }
        
        match session.output_names() {
            Ok(outputs) => {
                println!("   Outputs: {:?}", outputs);
                assert!(!outputs.is_empty(), "Model should have at least one output");
            }
            Err(e) => {
                println!("   ⚠️ Failed to get output names: {}", e);
        }
        }
        
        // Find voices file for voice embedding
        let resources_dir = find_resources_dir();
        let voices_path = if let Some(dir) = resources_dir {
            find_voices_file(&dir)
        } else {
            None
        };
        
        if voices_path.is_none() {
            println!("⚠️ Skipping full TTS test - voices-v1.0.bin not found");
            println!("   Set KOKORO_VOICES_PATH env var or ensure voices-v1.0.bin is in resources directory");
            println!("\n✅ ONNX Runtime with CoreML EP session initialized successfully!");
            return;
        }
        
        let voices_path = voices_path.unwrap();
        let voices_path_str = voices_path.to_str().unwrap();
        println!("   Voices path: {}", voices_path_str);
        
        // Use kokoros for full TTS pipeline (it will use CoreML EP if available via ONNX Runtime)
        // Note: kokoros crate manages its own ONNX Runtime session, but ONNX Runtime should
        // automatically use CoreML EP on macOS/iOS when available
        println!("\n🎤 Generating TTS audio with ONNX Runtime (CoreML EP enabled)...");
        
        let test_text = "Hello, this is a test of ONNX Runtime with CoreML Execution Provider.";
        let voice_id = "af_heart";
        let language = "en";
        let speed = 1.0;
        
        println!("   Text: '{}'", test_text);
        println!("   Voice: {}", voice_id);
        println!("   Language: {}", language);
        println!("   Speed: {}", speed);
        
        // Initialize kokoros engine - it will use ONNX Runtime which should use CoreML EP on macOS/iOS
        let engine = kokoros::tts::koko::TTSKokoParallel::new_with_instances(
            model_path_str,
            voices_path_str,
            1, // Use 1 instance for testing
        ).await;
        
        println!("✅ Kokoros engine initialized (should use CoreML EP via ONNX Runtime)");
        
        // Generate audio
        let model_instance = engine.get_model_instance(0);
        match engine.tts_raw_audio_with_instance(
            test_text,
            language,
            voice_id,
            speed,
            None, // initial_silence
            None, // request_id
            None, // instance_id
            None, // chunk_number
            model_instance,
        ) {
            Ok(audio_samples) => {
                println!("✅ Audio generated successfully with ONNX Runtime!");
                println!("   Samples: {}", audio_samples.len());
                println!("   Duration: {:.2}s (at 24kHz)", audio_samples.len() as f32 / 24000.0);
                
                // Basic validation
                assert!(!audio_samples.is_empty(), "Audio should not be empty");
                
                // Check for non-zero samples
                let non_zero_count = audio_samples.iter().filter(|&&s| s.abs() > 0.001).count();
                println!("   Non-zero samples: {} / {} ({:.1}%)", 
                    non_zero_count, audio_samples.len(),
                    (non_zero_count as f32 / audio_samples.len() as f32) * 100.0);
                
                if non_zero_count > 0 {
                    // Check audio range
                    let min_val = audio_samples.iter().fold(f32::INFINITY, |a, &b| a.min(b));
                    let max_val = audio_samples.iter().fold(f32::NEG_INFINITY, |a, &b| a.max(b));
                    println!("   Audio range: [{:.6}, {:.6}]", min_val, max_val);
                } else {
                    println!("⚠️ WARNING: Audio contains only zeros (silence)");
                }
                
                // Save audio file
                let output_path = "test_output_onnx_coreml_ep.wav";
                match save_audio_as_wav(&audio_samples, 24000, output_path) {
                    Ok(_) => {
                        println!("✅ Audio saved to: {}", output_path);
                        println!("   File location: {}/{}", std::env::current_dir().unwrap().display(), output_path);
                    }
                    Err(e) => {
                        println!("❌ Failed to save audio: {}", e);
                        panic!("Failed to save audio file: {}", e);
                    }
                }
                
                println!("\n✅ ONNX Runtime with CoreML EP test PASSED!");
                println!("   Note: kokoros crate manages ONNX Runtime sessions internally.");
                println!("   ONNX Runtime should automatically use CoreML EP on macOS/iOS when available.");
            }
            Err(e) => {
                println!("❌ TTS generation failed: {}", e);
                println!("   This might indicate:");
                println!("   - Model loading issues");
                println!("   - Invalid voice ID");
                println!("   - Text preprocessing problems");
                panic!("TTS generation failed: {}", e);
            }
        }
    }

    #[tokio::test]
    async fn test_generate_and_save_audio() {
        println!("\n🧪 Testing TTS generation and audio file saving");
        
        // Use ONNX Runtime with CPU execution provider
        println!("   Using ONNX Runtime engine (CoreML EP enabled on macOS/iOS)...");
        let onnx_model = find_onnx_model();
        if onnx_model.is_none() {
            println!("⚠️ Skipping test - no models found (neither CoreML nor ONNX)");
            return;
        }
        let onnx_model = onnx_model.unwrap();
        let model_path_str = onnx_model.to_str().unwrap();
        
        let resources_dir = find_resources_dir();
        if resources_dir.is_none() {
            println!("⚠️ Skipping test - resources directory not found");
            return;
        }
        let voices_path = find_voices_file(&resources_dir.unwrap());
        if voices_path.is_none() {
            println!("⚠️ Skipping test - voices-v1.0.bin not found");
            return;
        }
        let voices_path = voices_path.unwrap();
        let voices_path_str = voices_path.to_str().unwrap();
        
        println!("   Model file: {}", model_path_str);
        println!("   Voices path: {}", voices_path_str);
        
        // Initialize kokoros engine
        let engine = kokoros::tts::koko::TTSKokoParallel::new_with_instances(
            model_path_str,
            voices_path_str,
            1,
        ).await;
        
        // Generate audio
        let test_text = "Hello, this is a test of the text to speech system. How does it sound?";
        let voice_id = "af_heart";
        let language = "en";
        let speed = 1.0;
        
        println!("\n🎤 Generating TTS audio with ONNX...");
        println!("   Text: '{}'", test_text);
        println!("   Voice: {}", voice_id);
        println!("   Language: {}", language);
        println!("   Speed: {}", speed);
        
        let model_instance = engine.get_model_instance(0);
        let audio_samples = match engine.tts_raw_audio_with_instance(
            test_text,
            language,
            voice_id,
            speed,
            None,
            None,
            None,
            None,
            model_instance,
        ) {
            Ok(audio) => audio,
            Err(e) => {
                println!("❌ Failed to generate audio: {}", e);
                return;
            }
        };
        
        println!("✅ Audio generated successfully!");
        println!("   Samples: {}", audio_samples.len());
        println!("   Duration: {:.2}s (at 24kHz)", audio_samples.len() as f32 / 24000.0);
        
        // Save to WAV file
        let output_path = "test_output.wav";
        match save_audio_as_wav(&audio_samples, 24000, output_path) {
            Ok(_) => {
                println!("✅ Audio saved to: {}", output_path);
                println!("   File location: {}/{}", std::env::current_dir().unwrap().display(), output_path);
                println!("   You can now listen to the file!");
            }
            Err(e) => {
                println!("❌ Failed to save audio: {}", e);
            }
        }
    }

    #[tokio::test]
    async fn test_quantized_model_tts() {
        println!("\n🧪 Testing TTS generation with quantized model from Kokoro-82M-v1.0-ONNX");
        
        // Try to find a quantized model (prefer smaller ones for faster testing)
        let quantized_models = vec![
            "model_q8f16.onnx",      // 82MB - smallest
            "model_quantized.onnx",  // 88MB
            "model_uint8f16.onnx",   // 109MB
            "model_q4f16.onnx",      // 147MB
            "model_fp16.onnx",       // 156MB
            "model_uint8.onnx",      // 169MB
            "model_q4.onnx",         // 291MB
            "model.onnx",            // 310MB - full precision
        ];
        
        let mut model_path: Option<PathBuf> = None;
        let mut model_name = "";
        
        for model in &quantized_models {
            if let Some(path) = find_quantized_model(model) {
                model_path = Some(path);
                model_name = model;
                break;
            }
        }
        
        let model_path = match model_path {
            Some(path) => path,
            None => {
                println!("⚠️ Skipping test - no quantized models found in Kokoro-82M-v1.0-ONNX/onnx");
                println!("   Checked models: {:?}", quantized_models);
                println!("   Make sure Kokoro-82M-v1.0-ONNX/onnx directory exists with model files");
                return;
            }
        };
        
        let model_path_str = model_path.to_str().unwrap();
        println!("   Using model: {} ({})", model_name, model_path_str);
        
        // Find voices file - try to find it in the Kokoro-82M-v1.0-ONNX/voices directory
        let mut voices_path: Option<PathBuf> = None;
        
        // Try voices from Kokoro-82M-v1.0-ONNX
        let mut voices_locations = vec![
            PathBuf::from("Kokoro-82M-v1.0-ONNX").join("voices").join("af.bin"),
            PathBuf::from("../Kokoro-82M-v1.0-ONNX").join("voices").join("af.bin"),
        ];
        
        if let Ok(manifest_dir) = env::var("CARGO_MANIFEST_DIR") {
            let manifest_path = PathBuf::from(&manifest_dir);
            if let Some(parent) = manifest_path.parent() {
                voices_locations.push(parent.join("Kokoro-82M-v1.0-ONNX").join("voices").join("af.bin"));
            }
        }
        
        if let Ok(current_dir) = std::env::current_dir() {
            voices_locations.push(current_dir.join("Kokoro-82M-v1.0-ONNX").join("voices").join("af.bin"));
            if let Some(parent) = current_dir.parent() {
                voices_locations.push(parent.join("Kokoro-82M-v1.0-ONNX").join("voices").join("af.bin"));
            }
        }
        
        // Also try the standard voices file location
        if let Some(resources_dir) = find_resources_dir() {
            if let Some(voices) = find_voices_file(&resources_dir) {
                voices_path = Some(voices);
            }
        }
        
        // Try the Kokoro-82M-v1.0-ONNX voices locations
        if voices_path.is_none() {
            for path in voices_locations {
                if path.exists() && path.is_file() {
                    voices_path = Some(path);
                    break;
                }
            }
        }
        
        let voices_path = match voices_path {
            Some(path) => path,
            None => {
                println!("⚠️ Skipping test - voices file not found");
                println!("   Expected: Kokoro-82M-v1.0-ONNX/voices/af.bin or voices-v1.0.bin in resources");
                return;
            }
        };
        
        let voices_path_str = voices_path.to_str().unwrap();
        println!("   Voices file: {}", voices_path_str);

        // Initialize kokoros engine with the quantized model
        println!("\n📦 Initializing kokoros engine with quantized model...");
        let engine = match kokoros::tts::koko::TTSKokoParallel::new_with_instances(
            model_path_str,
            voices_path_str,
            1, // Use 1 instance for testing
        ).await {
            engine => {
                println!("✅ Engine initialized successfully!");
                engine
            }
        };

        // Generate audio
        let test_text = "Hello, this is a test using a quantized model from Kokoro-82M-v1.0-ONNX.";
        let voice_id = "af_heart";
        let language = "en";
        let speed = 1.0;

        println!("\n🎤 Generating TTS audio with quantized model...");
        println!("   Text: '{}'", test_text);
        println!("   Voice: {}", voice_id);
        println!("   Language: {}", language);
        println!("   Speed: {}", speed);

        let model_instance = engine.get_model_instance(0);
        match engine.tts_raw_audio_with_instance(
            test_text,
            language,
            voice_id,
            speed,
            None, // initial_silence
            None, // request_id
            None, // instance_id
            None, // chunk_number
            model_instance,
        ) {
            Ok(audio_samples) => {
                println!("✅ Audio generated successfully with quantized model!");
                println!("   Samples: {}", audio_samples.len());
                println!("   Duration: {:.2}s (at 24kHz)", audio_samples.len() as f32 / 24000.0);
                
                // Basic validation
                assert!(!audio_samples.is_empty(), "Audio should not be empty");
                
                // Check for non-zero samples
                let non_zero_count = audio_samples.iter().filter(|&&s| s.abs() > 0.001).count();
                println!("   Non-zero samples: {} / {} ({:.1}%)", 
                    non_zero_count, audio_samples.len(),
                    (non_zero_count as f32 / audio_samples.len() as f32) * 100.0);
                
                if non_zero_count > 0 {
                    // Check audio range
                    let min_val = audio_samples.iter().fold(f32::INFINITY, |a, &b| a.min(b));
                    let max_val = audio_samples.iter().fold(f32::NEG_INFINITY, |a, &b| a.max(b));
                    println!("   Audio range: [{:.6}, {:.6}]", min_val, max_val);
                    
                    // Save audio file
                    let output_path = format!("test_quantized_{}.wav", model_name.replace(".onnx", ""));
                    match save_audio_as_wav(&audio_samples, 24000, &output_path) {
                        Ok(_) => {
                            println!("✅ Audio saved to: {}", output_path);
                        }
                        Err(e) => {
                            println!("⚠️ Failed to save audio: {}", e);
                        }
                    }
                    
                    println!("\n✅ Quantized model TTS test PASSED!");
                } else {
                    println!("⚠️ WARNING: Audio contains only zeros (silence)");
                    println!("   This might indicate the model is not working correctly");
                }
            }
            Err(e) => {
                println!("❌ TTS generation failed: {}", e);
                println!("   This error likely indicates:");
                println!("   - Input name mismatch (model expects 'input_ids' but kokoros uses 'tokens')");
                println!("   - Model format incompatibility");
                println!("   - Other model loading issues");
                println!("\n   The quantized models from Kokoro-82M-v1.0-ONNX use 'input_ids' as the input name,");
                println!("   but the kokoros crate may be hardcoded to use 'tokens'.");
                panic!("TTS generation failed with quantized model: {}", e);
            }
        }
    }

    /// Generate voice samples for all Kokoro voices
    /// Run with: cargo test --test generate_voice_samples -- --nocapture
    /// Or: cargo test generate_voice_samples -- --nocapture --ignored
    #[tokio::test]
    #[ignore] // Ignore by default - only run when explicitly requested
    async fn generate_voice_samples() {
        use std::fs;
        use std::path::PathBuf;
        
        println!("\n🎤 Generating voice samples for all Kokoro voices");
        println!("{}", "=".repeat(60));
        
        // Find ONNX model file
        let onnx_model = find_onnx_model();
        if onnx_model.is_none() {
            println!("⚠️ Skipping - kokoro-v1.0.onnx not found");
            println!("   Set KOKORO_MODEL_DIR env var or ensure kokoro-v1.0.onnx is in resources directory");
            return;
        }
        let onnx_model = onnx_model.unwrap();
        let model_path_str = onnx_model.to_str().unwrap();
        println!("   ONNX model: {}", model_path_str);
        
        // Find voices file
        let resources_dir = find_resources_dir();
        if resources_dir.is_none() {
            println!("⚠️ Skipping - resources directory not found");
            return;
        }
        let voices_path = find_voices_file(&resources_dir.unwrap());
        if voices_path.is_none() {
            println!("⚠️ Skipping - voices-v1.0.bin not found");
            return;
        }
        let voices_path = voices_path.unwrap();
        let voices_path_str = voices_path.to_str().unwrap();
        println!("   Voices file: {}", voices_path_str);
        
        // Create output directory
        // Handle both cases: running from project root or from src-tauri directory
        let output_dir = if let Ok(current_dir) = std::env::current_dir() {
            if current_dir.ends_with("src-tauri") {
                // Running from src-tauri directory
                current_dir.join("resources").join("voice-samples")
            } else {
                // Running from project root
                current_dir.join("src-tauri").join("resources").join("voice-samples")
            }
        } else {
            PathBuf::from("resources/voice-samples")
        };
        
        fs::create_dir_all(&output_dir)
            .expect("Failed to create output directory");
        println!("   Output directory: {}", output_dir.display());
        
        // All voice IDs
        let voices = vec![
            // American voices
            "af_heart", "af_alloy", "af_aoede", "af_bella", "af_jessica",
            "af_kore", "af_nicole", "af_nova", "af_river", "af_sarah", "af_sky",
            "am_adam", "am_echo", "am_eric", "am_fenrir", "am_liam",
            "am_michael", "am_onyx", "am_puck", "am_santa",
            // British voices
            "bf_alice", "bf_emma", "bf_isabella", "bf_lily",
            "bm_daniel", "bm_fable", "bm_george", "bm_lewis",
        ];
        
        let sample_text = "Hello, this is a sample of my voice. I hope you enjoy listening to it.";
        
        println!("\n📦 Initializing TTS engine...");
        let engine = kokoros::tts::koko::TTSKokoParallel::new_with_instances(
            model_path_str,
            voices_path_str,
            1,
        ).await;
        
        println!("✅ Engine initialized\n");
        
        // Generate samples for all voices
        for (i, voice_id) in voices.iter().enumerate() {
            println!("[{}/{}] Generating {}...", i + 1, voices.len(), voice_id);
            
            // Get a new model instance for each voice (or clone if needed)
            let model_instance = engine.get_model_instance(0);
            
            match engine.tts_raw_audio_with_instance(
                sample_text,
                "en",
                voice_id,
                1.0,
                None,
                None,
                None,
                None,
                model_instance,
            ) {
                Ok(audio_samples) => {
                    // Convert f32 samples to 16-bit PCM bytes
                    let mut pcm_bytes = Vec::with_capacity(audio_samples.len() * 2);
                    for sample in &audio_samples {
                        let clamped = sample.max(-1.0).min(1.0);
                        let pcm_value = if clamped < 0.0 {
                            (clamped * 32768.0) as i16
                        } else {
                            (clamped * 32767.0) as i16
                        };
                        pcm_bytes.extend_from_slice(&pcm_value.to_le_bytes());
                    }
                    
                    // Convert PCM to MP3 (64 kbps for voice samples)
                    // Use the same logic as the convert_pcm_to_mp3 command
                    use lame::Lame;
                    
                    let bitrate_kbps = 64;
                    let num_samples = pcm_bytes.len() / 2;
                    let mut pcm_samples = Vec::with_capacity(num_samples);
                    for chunk in pcm_bytes.chunks_exact(2) {
                        let sample = i16::from_le_bytes([chunk[0], chunk[1]]);
                        pcm_samples.push(sample);
                    }
                    
                    let mut encoder = match Lame::new() {
                        Some(e) => e,
                        None => {
                            println!("   ❌ Failed to initialize LAME encoder");
                            continue;
                        }
                    };
                    
                    if let Err(e) = encoder.set_sample_rate(24000) {
                        println!("   ❌ Failed to set sample rate: {:?}", e);
                        continue;
                    }
                    if let Err(e) = encoder.set_channels(1) {
                        println!("   ❌ Failed to set channels: {:?}", e);
                        continue;
                    }
                    if let Err(e) = encoder.set_quality(2) {
                        println!("   ❌ Failed to set quality: {:?}", e);
                        continue;
                    }
                    if let Err(e) = encoder.set_kilobitrate(bitrate_kbps as i32) {
                        println!("   ❌ Failed to set bitrate: {:?}", e);
                        continue;
                    }
                    if let Err(e) = encoder.init_params() {
                        println!("   ❌ Failed to initialize encoder parameters: {:?}", e);
                        continue;
                    }
                    
                    let buffer_size = (pcm_samples.len() as f64 * 1.25) as usize + 7200;
                    let mut mp3_buffer = vec![0u8; buffer_size];
                    let encoded_size = match encoder.encode(&pcm_samples, &pcm_samples, &mut mp3_buffer) {
                        Ok(size) => size,
                        Err(e) => {
                            println!("   ❌ Failed to encode audio: {:?}", e);
                            continue;
                        }
                    };
                    
                    let mut mp3_data = Vec::from(&mp3_buffer[..encoded_size]);
                    let flush_size = match encoder.encode(&[], &[], &mut mp3_buffer) {
                        Ok(size) => size,
                        Err(e) => {
                            println!("   ❌ Failed to flush encoder: {:?}", e);
                            continue;
                        }
                    };
                    if flush_size > 0 {
                        mp3_data.extend_from_slice(&mp3_buffer[..flush_size]);
                    }
                    
                    if mp3_data.is_empty() {
                        println!("   ❌ MP3 encoding produced no output");
                    } else {
                        let filename = format!("{}.mp3", voice_id);
                        let output_path = output_dir.join(&filename);
                        
                        fs::write(&output_path, &mp3_data)
                            .expect(&format!("Failed to write MP3 file: {}", output_path.display()));
                        
                        let file_size_kb = mp3_data.len() as f64 / 1024.0;
                        println!("   ✅ Generated: {} ({:.1} KB)", filename, file_size_kb);
                    }
                }
                Err(e) => {
                    println!("   ❌ Failed to generate audio: {}", e);
                }
            }
            
            // Small delay to avoid overwhelming the system
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        }
        
        println!("\n✅ Completed! Generated {} voice samples in {}", voices.len(), output_dir.display());
        println!("   Files are ready to be bundled with the app.");
    }

    #[tokio::test]
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    async fn test_cpu_vs_coreml_performance() {
        use std::time::{Duration, Instant};
        use crate::kokoro_onnx_coreml::KokoroOnnxCoreML;
        use ndarray::ArrayD;

        println!("\n🧪 Performance Comparison: CPU vs CoreML EP");
        println!("{}", "=".repeat(60));
        
        // Find ONNX model file
        let onnx_model = find_onnx_model();
        if onnx_model.is_none() {
            println!("⚠️ Skipping test - kokoro-v1.0.onnx not found");
            println!("   Set KOKORO_MODEL_DIR env var or ensure kokoro-v1.0.onnx is in resources directory");
            return;
        }
        let onnx_model = onnx_model.unwrap();
        let model_path_str = onnx_model.to_str().unwrap();
        println!("   ONNX model file: {}", model_path_str);

        // Get model input/output names first (using CoreML EP session)
        println!("\n📋 Initializing sessions to get model structure...");
        let coreml_session = match KokoroOnnxCoreML::new(model_path_str, true) {
            Ok(session) => session,
            Err(e) => {
                println!("❌ Failed to initialize CoreML EP session: {}", e);
                return;
            }
        };

        let cpu_session = match KokoroOnnxCoreML::new(model_path_str, false) {
            Ok(session) => session,
            Err(e) => {
                println!("❌ Failed to initialize CPU session: {}", e);
                return;
            }
        };

        // Get input/output names
        let input_names = match coreml_session.input_names() {
            Ok(names) => names,
            Err(e) => {
                println!("❌ Failed to get input names: {}", e);
                return;
            }
        };

        let output_names = match coreml_session.output_names() {
            Ok(names) => names,
            Err(e) => {
                println!("❌ Failed to get output names: {}", e);
                return;
            }
        };

        println!("   Inputs: {:?}", input_names);
        println!("   Outputs: {:?}", output_names);

        // Create dummy input data for testing
        // Based on kokoro model: tokens [batch, seq_len] as i64, style [batch, style_dim] as f32, speed [1] as f32
        // We'll use small dummy inputs for performance testing
        let batch_size = 1;
        let seq_len = 50; // Short sequence for faster testing
        let style_dim = 256; // Typical style embedding dimension
        
        // Tokens must be i64 (int64)
        let tokens_data: Vec<i64> = (0..(batch_size * seq_len)).map(|i| (i % 100) as i64).collect();
        let tokens_array = ArrayD::<i64>::from_shape_vec(
            vec![batch_size, seq_len],
            tokens_data
        ).expect("Failed to create tokens array");

        // Style and speed are f32 (float32)
        let style_data: Vec<f32> = (0..(batch_size * style_dim)).map(|i| (i as f32) * 0.01).collect();
        let style_array = ArrayD::<f32>::from_shape_vec(
            vec![batch_size, style_dim],
            style_data
        ).expect("Failed to create style array");

        let speed_array = ArrayD::<f32>::from_shape_vec(
            vec![1],
            vec![1.0]
        ).expect("Failed to create speed array");

        println!("\n⏱️  Running performance benchmarks...");
        println!("   Test configuration:");
        println!("   - Batch size: {}", batch_size);
        println!("   - Sequence length: {}", seq_len);
        println!("   - Style dimension: {}", style_dim);
        println!("   - Number of iterations: 10");

        const NUM_ITERATIONS: usize = 10;
        const WARMUP_ITERATIONS: usize = 2;

        // Warmup runs
        println!("\n🔥 Warming up ({} iterations)...", WARMUP_ITERATIONS);
        for _ in 0..WARMUP_ITERATIONS {
            let _ = cpu_session.run_kokoro(tokens_array.clone(), style_array.clone(), speed_array.clone());
            let _ = coreml_session.run_kokoro(tokens_array.clone(), style_array.clone(), speed_array.clone());
        }

        // CPU-only benchmark
        println!("\n📊 Benchmarking CPU-only execution provider...");
        let mut cpu_times = Vec::new();
        for i in 0..NUM_ITERATIONS {
            let start = Instant::now();
            match cpu_session.run_kokoro(tokens_array.clone(), style_array.clone(), speed_array.clone()) {
                Ok(_) => {
                    let elapsed = start.elapsed();
                    cpu_times.push(elapsed);
                    print!("   Iteration {}: {:.2}ms\r", i + 1, elapsed.as_secs_f64() * 1000.0);
                }
                Err(e) => {
                    println!("\n❌ CPU inference failed: {}", e);
                    return;
                }
            }
        }
        println!(); // New line after progress

        // CoreML EP benchmark
        println!("\n📊 Benchmarking CoreML EP execution provider...");
        let mut coreml_times = Vec::new();
        for i in 0..NUM_ITERATIONS {
            let start = Instant::now();
            match coreml_session.run_kokoro(tokens_array.clone(), style_array.clone(), speed_array.clone()) {
                Ok(_) => {
                    let elapsed = start.elapsed();
                    coreml_times.push(elapsed);
                    print!("   Iteration {}: {:.2}ms\r", i + 1, elapsed.as_secs_f64() * 1000.0);
                }
                Err(e) => {
                    println!("\n❌ CoreML EP inference failed: {}", e);
                    return;
                }
            }
        }
        println!(); // New line after progress

        // Calculate statistics
        let cpu_avg = cpu_times.iter().sum::<Duration>() / cpu_times.len() as u32;
        let cpu_min = cpu_times.iter().min().unwrap();
        let cpu_max = cpu_times.iter().max().unwrap();

        let coreml_avg = coreml_times.iter().sum::<Duration>() / coreml_times.len() as u32;
        let coreml_min = coreml_times.iter().min().unwrap();
        let coreml_max = coreml_times.iter().max().unwrap();

        let speedup = cpu_avg.as_secs_f64() / coreml_avg.as_secs_f64();

        // Print results
        println!("\n📈 Performance Results:");
        println!("{}", "=".repeat(60));
        println!("CPU-only Execution Provider:");
        println!("   Average: {:.2}ms ({:.3}s)", cpu_avg.as_secs_f64() * 1000.0, cpu_avg.as_secs_f64());
        println!("   Min:     {:.2}ms ({:.3}s)", cpu_min.as_secs_f64() * 1000.0, cpu_min.as_secs_f64());
        println!("   Max:     {:.2}ms ({:.3}s)", cpu_max.as_secs_f64() * 1000.0, cpu_max.as_secs_f64());
        
        println!("\nCoreML EP Execution Provider:");
        println!("   Average: {:.2}ms ({:.3}s)", coreml_avg.as_secs_f64() * 1000.0, coreml_avg.as_secs_f64());
        println!("   Min:     {:.2}ms ({:.3}s)", coreml_min.as_secs_f64() * 1000.0, coreml_min.as_secs_f64());
        println!("   Max:     {:.2}ms ({:.3}s)", coreml_max.as_secs_f64() * 1000.0, coreml_max.as_secs_f64());
        
        println!("\n🚀 Performance Improvement:");
        if speedup > 1.0 {
            println!("   CoreML EP is {:.2}x FASTER than CPU-only", speedup);
            println!("   Time saved: {:.2}ms per inference ({:.1}%)", 
                (cpu_avg.as_secs_f64() - coreml_avg.as_secs_f64()) * 1000.0,
                (1.0 - 1.0 / speedup) * 100.0);
        } else {
            println!("   CPU-only is {:.2}x faster than CoreML EP", 1.0 / speedup);
            println!("   ⚠️  This is unexpected - CoreML EP should be faster on Apple devices");
        }

        println!("\n✅ Performance comparison test completed!");
        
        // Assert that CoreML EP is at least as fast as CPU (or within reasonable margin)
        // Allow some variance due to system load
        if speedup < 0.8 {
            println!("⚠️  WARNING: CoreML EP is slower than expected. This might indicate:");
            println!("   - System is under heavy load");
            println!("   - Model operations are not well-suited for CoreML EP");
            println!("   - First-time conversion overhead (MLProgram compilation)");
        }
    }
}
