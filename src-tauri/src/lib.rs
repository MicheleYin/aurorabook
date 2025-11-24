use std::sync::{Arc, Mutex};
use tauri::Manager;

#[cfg(not(any(target_os = "macos", target_os = "ios")))]
use kokoros::tts::koko::TTSKokoParallel;

#[cfg(any(target_os = "macos", target_os = "ios"))]
mod kokoro_coreml;
#[cfg(any(target_os = "macos", target_os = "ios"))]
use kokoro_coreml::KokoroCoreMLParallel;

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

// Copy directory recursively (for .mlpackage files which are directories)
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

// Initialize kokoros engine (cache the instance)
// Use parallel version for better performance
#[cfg(not(any(target_os = "macos", target_os = "ios")))]
type KokorosEngine = Arc<Mutex<Option<kokoros::tts::koko::TTSKokoParallel>>>;

#[cfg(any(target_os = "macos", target_os = "ios"))]
type KokorosEngine = Arc<Mutex<Option<KokoroCoreMLParallel>>>;

#[tauri::command]
async fn init_kokoros_engine(
    model_path: String,
    voices_path: String,
    num_instances: Option<usize>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let instances = num_instances.unwrap_or(4);
    
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    {
        // Use CoreML models directly for optimal ANE/GPU utilization
        // model_path should point to directory containing .mlpackage files
        let kokoros = KokoroCoreMLParallel::new_with_instances(&model_path, &voices_path, instances)
            .await
            .map_err(|e| format!("Failed to initialize CoreML engine: {}", e))?;
        
        app.manage(Arc::new(Mutex::new(Some(kokoros))));
        
        Ok(format!("Initialized CoreML engine with {} instances. Using direct CoreML for optimal ANE/GPU acceleration.", instances))
    }
    
    #[cfg(not(any(target_os = "macos", target_os = "ios")))]
    {
        // Use ONNX Runtime with CUDA for non-Apple platforms
        let kokoros = kokoros::tts::koko::TTSKokoParallel::new_with_instances(&model_path, &voices_path, instances).await;
        
        app.manage(Arc::new(Mutex::new(Some(kokoros))));
        
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
    
    #[cfg(not(any(target_os = "macos", target_os = "ios")))]
    {
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
    
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    {
        // Extract the instance Arc before dropping the guard
        let model_instance_arc = {
            let kokoros = kokoros_guard.as_ref()
                .ok_or_else(|| "Kokoros engine not initialized".to_string())?;
            
            // Use worker_id to distribute load across instances
            let worker = worker_id.unwrap_or(0);
            kokoros.get_model_instance(worker)
        };
        // Guard is dropped here
        
        // Generate audio using CoreML - use the sync trait method
        use kokoro_coreml::TTSInstance;
        let audio_samples = {
            let instance_guard = model_instance_arc.lock().unwrap_or_else(|e| e.into_inner());
            instance_guard.tts_raw_audio_with_instance(
                &text,
                language.as_deref().unwrap_or("en"),
                &voice_id,
                speed.unwrap_or(1.0),
                None,
                None,
                None,
                None,
                &*instance_guard,
            )
        }
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
    }
    
    #[cfg(not(any(target_os = "macos", target_os = "ios")))]
    {
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
                // Handle poisoned locks gracefully
                let kokoros_guard = engine.lock().unwrap_or_else(|e| e.into_inner());
                let kokoros = kokoros_guard.as_ref()
                    .ok_or_else(|| "Kokoros engine not initialized".to_string())?;
                
                let worker = idx % 4;
                let model_instance = kokoros.get_model_instance(worker);
                
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
    
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    {
        use kokoro_coreml::TTSInstance;
        
        // Process texts in parallel using different instances
        let mut handles = Vec::new();
        for (idx, text) in texts.iter().enumerate() {
            let app_clone = app.clone();
            let text_clone = text.clone();
            let voice_id_clone = voice_id.clone();
            let language_clone = language.clone();
            let speed_val = speed.unwrap_or(1.0);
            
            let handle = tokio::spawn(async move {
                // Extract the instance Arc before dropping the guard
                let instance_arc = {
                    let engine: tauri::State<'_, KokorosEngine> = app_clone.state();
                    // Handle poisoned locks gracefully
                    let kokoros_guard = engine.lock().unwrap_or_else(|e| e.into_inner());
                    let kokoros = kokoros_guard.as_ref()
                        .ok_or_else(|| "Kokoros engine not initialized".to_string())?;
                    
                    let worker = idx % 4;
                    kokoros.get_instance(worker)
                };
                // Guard is dropped here
                
                // Use the sync trait method to avoid Send issues
                use kokoro_coreml::TTSInstance;
                let audio_samples: Vec<f32> = {
                    let instance_guard = instance_arc.lock().unwrap_or_else(|e| e.into_inner());
                    instance_guard.tts_raw_audio_with_instance(
                        &text_clone,
                        language_clone.as_deref().unwrap_or("en"),
                        &voice_id_clone,
                        speed_val,
                        None,
                        None,
                        None,
                        None,
                        &*instance_guard,
                    )
                }
                .map_err(|e: String| e)?;
                
                Ok::<Vec<f32>, String>(audio_samples)
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
