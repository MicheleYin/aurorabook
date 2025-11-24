use std::sync::{Arc, Mutex};
use tauri::Manager;
use kokoros::tts::koko::TTSKokoParallel;

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

// Initialize kokoros engine (cache the instance)
// Use parallel version for better performance
type KokorosEngine = Arc<Mutex<Option<TTSKokoParallel>>>;

#[tauri::command]
async fn init_kokoros_engine(
    model_path: String,
    voices_path: String,
    num_instances: Option<usize>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    // Use parallel version with multiple instances for better throughput
    // Default to 4 instances (best total processing time as per kokoros benchmarks)
    // With GPU, can handle even more instances efficiently
    let instances = num_instances.unwrap_or(4);
    
    // On macOS, try to enable CoreML execution provider for GPU/ANE acceleration
    // Note: kokoros might not expose this configuration, so we rely on ONNX Runtime defaults
    // If GPU/ANE aren't being used, kokoros may need to be updated to support CoreML EP configuration
    #[cfg(target_os = "macos")]
    {
        // Set environment variable to hint ONNX Runtime to use CoreML if available
        // This is a workaround - ideally kokoros would expose CoreML EP configuration
        std::env::set_var("ORT_ENABLE_COREML", "1");
    }
    
    let kokoros = TTSKokoParallel::new_with_instances(&model_path, &voices_path, instances).await;
    
    // Store in app state
    app.manage(Arc::new(Mutex::new(Some(kokoros))));
    
    // Return diagnostic info about execution providers
    #[cfg(target_os = "macos")]
    {
        Ok(format!("Initialized kokoros with {} instances. Note: CoreML EP configuration may not be exposed by kokoros. GPU/ANE usage depends on ONNX Runtime build and kokoros implementation.", instances))
    }
    #[cfg(not(target_os = "macos"))]
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
    let kokoros_guard = engine.lock().map_err(|e| format!("Lock error: {}", e))?;
    
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
    // Kokoros outputs f32 samples in range [-1.0, 1.0]
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
    let engine: tauri::State<'_, KokorosEngine> = app.state();
    
    // Clone kokoros before releasing the lock so we can move it into async tasks
    let kokoros = {
        let kokoros_guard = engine.lock().map_err(|e| format!("Lock error: {}", e))?;
        kokoros_guard.as_ref()
            .ok_or_else(|| "Kokoros engine not initialized".to_string())?
            .clone()
    };
    
    // Process texts in parallel using different instances
    let mut handles = Vec::new();
    for (idx, text) in texts.iter().enumerate() {
        let kokoros_clone = kokoros.clone();
        let text_clone = text.clone();
        let voice_id_clone = voice_id.clone();
        let language_clone = language.clone();
        let speed_val = speed.unwrap_or(1.0);
        
        let handle = tokio::spawn(async move {
            // Round-robin across available instances
            // Use modulo 4 to distribute evenly (we initialize with 4 instances)
            // This ensures even distribution across all parallel instances
            let worker = idx % 4; // Distribute across 4 instances
            let model_instance = kokoros_clone.get_model_instance(worker);
            
            kokoros_clone
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
        let audio_samples = handle.await
            .map_err(|e| format!("Task error: {}", e))?
            .map_err(|e| e.to_string())?;
        
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
            copy_resource_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
