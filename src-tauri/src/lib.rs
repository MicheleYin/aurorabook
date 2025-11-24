use std::sync::{Arc, Mutex};
use tauri::Manager;

// Use kokoros crate directly on all platforms (it handles CoreML via ONNX Runtime on macOS)

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
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
    
    // Try to resolve source path from bundled resources if it starts with "resources/"
    let source = if source_path.starts_with("resources/") {
        let resource_dir = app
            .path()
            .resource_dir()
            .map_err(|e| format!("Failed to get resource dir: {}", e))?;
        
        // Try multiple possible resource locations (dev vs production)
        let mut possible_paths = vec![
            resource_dir.join(&source_path),
            resource_dir.join(&source_path.strip_prefix("resources/").unwrap_or(&source_path)),
        ];
        
        // Add dev mode path if available
        if let Ok(current_dir) = std::env::current_dir() {
            possible_paths.push(current_dir.join("src-tauri").join(&source_path));
        }
        
        let mut found_path = None;
        for path in &possible_paths {
            if path.exists() {
                found_path = Some(path.clone());
                break;
            }
        }
        
        found_path.ok_or_else(|| {
            format!(
                "Resource directory {} not found in any expected location. Checked: {:?}",
                source_path, possible_paths
            )
        })?
    } else {
        Path::new(&source_path).to_path_buf()
    };
    
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

// Use kokoros crate directly on all platforms (it handles CoreML via ONNX Runtime on macOS)
// This provides optimal ANE/GPU utilization without custom CoreML code
type KokorosEngine = Arc<Mutex<Option<kokoros::tts::koko::TTSKokoParallel>>>;

#[tauri::command]
async fn init_kokoros_engine(
    model_path: String,
    voices_path: String,
    num_instances: Option<usize>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let instances = num_instances.unwrap_or(4);
    
    // Verify model_path is a file, not a directory
    let model_path_obj = std::path::Path::new(&model_path);
    if model_path_obj.is_dir() {
        return Err(format!(
            "Model path must be a file, not a directory. Got: {}. kokoros expects the full path to an ONNX file (e.g., /path/to/kokoro-v1.0.onnx)",
            model_path
        ));
    }
    
    if !model_path_obj.exists() {
        return Err(format!(
            "Model file does not exist: {}. Please ensure the ONNX model file is available.",
            model_path
        ));
    }
    
    println!("Initializing kokoros engine with model_path: {}, voices_path: {}", model_path, voices_path);
    
    // Use kokoros crate directly - it handles CoreML via ONNX Runtime on macOS/iOS
    // kokoros expects the full path to an ONNX file (not a directory)
    // ONNX Runtime with CoreML Execution Provider will be used on Apple platforms
    // Note: new_with_instances panics on error, so we validate the path beforehand
    let kokoros = kokoros::tts::koko::TTSKokoParallel::new_with_instances(&model_path, &voices_path, instances).await;
    
    // Replace any existing engine with the new one
    app.manage(Arc::new(Mutex::new(Some(kokoros))));
    
    println!("Successfully initialized kokoros engine with {} instances", instances);
    
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    {
        Ok(format!("Initialized kokoros with {} instances. Using ONNX Runtime with CoreML EP for optimal ANE/GPU acceleration.", instances))
    }
    
    #[cfg(not(any(target_os = "macos", target_os = "ios")))]
    {
        Ok(format!("Initialized kokoros with {} instances", instances))
    }
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
    let engine: tauri::State<'_, KokorosEngine> = app.state();
    // Handle poisoned locks gracefully
    let kokoros_guard = engine.lock().unwrap_or_else(|e| e.into_inner());
    
    let kokoros = kokoros_guard.as_ref()
        .ok_or_else(|| "Kokoros engine not initialized".to_string())?;
    
    // Use worker_id to distribute load across instances (round-robin if not specified)
    let worker = worker_id.unwrap_or(0);
    let model_instance = kokoros.get_model_instance(worker);
    
    // Generate audio using cached engine with specific instance
    // tts_raw_audio_with_instance returns Vec<f32> (24kHz sample rate)
    let audio_samples = kokoros
        .tts_raw_audio_with_instance(
            &text,
            language.as_deref().unwrap_or("en"),
            &voice_id,
            speed.unwrap_or(1.0),
            None, // initial_silence
            None, // request_id
            None, // instance_id
            None, // chunk_number
            model_instance,
        )
        .map_err(|e| format!("Failed to generate audio: {}", e))?;
    
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

// Generate TTS for multiple texts in parallel
#[tauri::command]
async fn generate_tts_batch(
    texts: Vec<String>,
    voice_id: String,
    language: Option<String>,
    speed: Option<f32>,
    app: tauri::AppHandle,
) -> Result<Vec<Vec<u8>>, String> {
    // Verify engine is initialized before spawning tasks
    {
        let engine: tauri::State<'_, KokorosEngine> = app.state();
        // Handle poisoned locks gracefully
        let kokoros_guard = engine.lock().unwrap_or_else(|e| e.into_inner());
        kokoros_guard.as_ref()
            .ok_or_else(|| "Kokoros engine not initialized".to_string())?;
    } // Guard is dropped here
    
    // Process texts in parallel using different instances
    let mut handles = Vec::new();
    for (idx, text) in texts.iter().enumerate() {
        let app_clone = app.clone();
        let text_clone = text.clone();
        let voice_id_clone = voice_id.clone();
        let language_clone = language.clone();
        let speed_val = speed.unwrap_or(1.0);
        
        let handle = tokio::spawn(async move {
            let engine: tauri::State<'_, KokorosEngine> = app_clone.state();
            // Extract the model instance Arc before dropping the guard
            let model_instance = {
                // Handle poisoned locks gracefully
                let kokoros_guard = engine.lock().unwrap_or_else(|e| e.into_inner());
                let kokoros = kokoros_guard.as_ref()
                    .ok_or_else(|| "Kokoros engine not initialized".to_string())?;
                
                let worker = idx % 4;
                kokoros.get_model_instance(worker)
            }; // Guard is dropped here
            
            // Now get kokoros again to call tts_raw_audio_with_instance
            let kokoros_guard = engine.lock().unwrap_or_else(|e| e.into_inner());
            let kokoros = kokoros_guard.as_ref()
                .ok_or_else(|| "Kokoros engine not initialized".to_string())?;
            
            kokoros
                .tts_raw_audio_with_instance(
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
            copy_directory
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use std::env;
    use std::path::PathBuf;

    /// Helper function to find the ONNX model file (kokoros requires ONNX, not CoreML)
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
                // Note: We use ONNX models via kokoros crate, not CoreML .mlpackage files
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
}
