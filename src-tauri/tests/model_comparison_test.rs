/// Test to compare TTS output from all ONNX models
/// 
/// This test:
/// 1. Discovers all ONNX models in Kokoro-82M-v1.0-ONNX-timestamped/onnx
/// 2. Tests each model with both short and long text samples
/// 3. Saves audio outputs for comparison
/// 4. Compares metrics (duration, sample count, file size)

use std::fs;
use std::path::PathBuf;
use std::time::Instant;

mod helpers;
use helpers::*;

/// Find all ONNX models in the Kokoro-82M-v1.0-ONNX-timestamped/onnx and Kokoro-82M-v1.0-ONNX/onnx directories
fn find_all_onnx_models() -> Vec<(String, PathBuf)> {
    let mut models = Vec::new();
    let mut possible_dirs = Vec::new();
    
    // Try multiple possible locations for both folder names
    let folder_names = vec!["Kokoro-82M-v1.0-ONNX-timestamped", "Kokoro-82M-v1.0-ONNX"];
    
    for folder_name in &folder_names {
    if let Ok(current_dir) = std::env::current_dir() {
            possible_dirs.push(current_dir.join(folder_name).join("onnx"));
        if let Some(parent) = current_dir.parent() {
                possible_dirs.push(parent.join(folder_name).join("onnx"));
        }
    }
    
    if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
        let manifest_path = PathBuf::from(&manifest_dir);
        if let Some(parent) = manifest_path.parent() {
                possible_dirs.push(parent.join(folder_name).join("onnx"));
            }
        }
        
        // Also try relative to project root
        possible_dirs.push(PathBuf::from(folder_name).join("onnx"));
        possible_dirs.push(PathBuf::from("..").join(folder_name).join("onnx"));
    }
    
    for dir in possible_dirs {
        if dir.exists() && dir.is_dir() {
            if let Ok(entries) = fs::read_dir(&dir) {
                for entry in entries {
                    if let Ok(entry) = entry {
                        let path = entry.path();
                        if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("onnx") {
                            let model_name = path.file_name()
                                .and_then(|n| n.to_str())
                                .unwrap_or("unknown")
                                .to_string();
                            models.push((model_name.clone(), path));
                        }
                    }
                }
            }
        }
    }
    
    // Sort by name for consistent ordering
    models.sort_by(|a, b| a.0.cmp(&b.0));
    models
}

/// Find voices file for Kokoro-82M models
/// 
/// The kokoros library expects a single NPZ file (voices-v1.0.bin) that contains
/// all voices, not individual voice files. This function searches for the correct
/// voices file format.
fn find_kokoro_voices_file() -> Option<PathBuf> {
    let mut possible_paths = Vec::new();
    
    // First, try the standard voices-v1.0.bin file (NPZ format with all voices)
    // This is what kokoros expects - a single file containing all voice styles
    
    // Try resources directory (standard location)
    if let Some(resources_dir) = find_resources_dir() {
        if let Some(voices) = find_voices_file(&resources_dir) {
            possible_paths.push(voices);
        }
    }
    
    // Try Kokoro-82M directories (might have voices-v1.0.bin at root)
    let folder_names = vec!["Kokoro-82M-v1.0-ONNX-timestamped", "Kokoro-82M-v1.0-ONNX"];
    
    for folder_name in &folder_names {
    if let Ok(current_dir) = std::env::current_dir() {
            possible_paths.push(current_dir.join(folder_name).join("voices-v1.0.bin"));
        if let Some(parent) = current_dir.parent() {
                possible_paths.push(parent.join(folder_name).join("voices-v1.0.bin"));
        }
    }
    
    if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
        let manifest_path = PathBuf::from(&manifest_dir);
        if let Some(parent) = manifest_path.parent() {
                possible_paths.push(parent.join(folder_name).join("voices-v1.0.bin"));
            }
        }
        
        // Also try relative paths
        possible_paths.push(PathBuf::from(folder_name).join("voices-v1.0.bin"));
        possible_paths.push(PathBuf::from("..").join(folder_name).join("voices-v1.0.bin"));
    }
    
    // Try src-tauri/resources
    if let Ok(current_dir) = std::env::current_dir() {
        possible_paths.push(current_dir.join("src-tauri").join("resources").join("voices-v1.0.bin"));
        possible_paths.push(current_dir.join("resources").join("voices-v1.0.bin"));
    }
    
    // Check environment variables
    if let Ok(env_voices) = std::env::var("KOKORO_VOICES_PATH") {
        if !env_voices.is_empty() {
            possible_paths.push(PathBuf::from(env_voices));
        }
    }
    
    for path in possible_paths {
        if path.exists() && path.is_file() {
            return Some(path);
        }
    }
    
    None
}

#[tokio::test]
async fn test_compare_all_onnx_models() {
    println!("\n🧪 Testing TTS comparison across all ONNX models");
    println!("{}", "=".repeat(80));
    
    // Find all models
    let models = find_all_onnx_models();
    if models.is_empty() {
        println!("⚠️  No ONNX models found in Kokoro-82M-v1.0-ONNX-timestamped/onnx or Kokoro-82M-v1.0-ONNX/onnx");
        println!("   Skipping test");
        return;
    }
    
    println!("\n📦 Found {} ONNX models:", models.len());
    for (name, path) in &models {
        let size = fs::metadata(path).map(|m| m.len()).unwrap_or(0);
        println!("   - {} ({:.2} MB)", name, size as f64 / 1_000_000.0);
    }
    
    // Find voices file
    let voices_path = find_kokoro_voices_file();
    let voices_path = match voices_path {
        Some(path) => {
            println!("\n✅ Found voices file: {}", path.display());
            path
        }
        None => {
            println!("\n❌ Voices file not found");
            println!("   Expected: voices-v1.0.bin (NPZ format with all voices)");
            println!("   Locations checked:");
            println!("     - src-tauri/resources/voices-v1.0.bin");
            println!("     - resources/voices-v1.0.bin");
            println!("     - Kokoro-82M-v1.0-ONNX-timestamped/voices-v1.0.bin");
            println!("     - Kokoro-82M-v1.0-ONNX/voices-v1.0.bin");
            println!("     - KOKORO_VOICES_PATH environment variable");
            println!("   Note: kokoros expects a single NPZ file containing all voices, not individual .bin files");
            println!("   Skipping test");
            return;
        }
    };
    
    let voices_path_str = voices_path.to_str().expect("Voices path should be valid UTF-8");
    
    // Create output directory
    let test_dir = std::env::current_dir()
        .unwrap_or_else(|_| std::env::temp_dir())
        .join("test_output")
        .join("model_comparison");
    fs::create_dir_all(&test_dir).expect("Failed to create test directory");
    
    // Test texts: short and long
    let short_text = "Hello, this is a short test.";
    let long_text = "This is a much longer text sample that will test how well each model handles extended speech generation. It contains multiple sentences and should produce a longer audio output. We can use this to compare the quality and performance of different quantized models. The text should be long enough to reveal any differences in how the models process and generate speech over time.";
    
    println!("\n📝 Test texts:");
    println!("   Short: '{}'", short_text);
    println!("   Long: '{}'", long_text);
    
    let voice_id = "af_heart";
    let language = "en";
    let speed = 1.0;
    
    // Results storage
    #[derive(Debug)]
    struct ModelResult {
        name: String,
        short_samples: usize,
        short_duration: f32,
        short_generation_time: f64,
        long_samples: usize,
        long_duration: f32,
        long_generation_time: f64,
        model_size_mb: f64,
    }
    
    let mut results = Vec::new();
    
    // Test each model
    for (model_name, model_path) in &models {
        println!("\n{}", "=".repeat(80));
        println!("🎯 Testing model: {}", model_name);
        println!("{}", "=".repeat(80));
        
        let model_path_str = model_path.to_str().expect("Model path should be valid UTF-8");
        let model_size = fs::metadata(model_path).map(|m| m.len()).unwrap_or(0) as f64 / 1_000_000.0;
        
        println!("   Model path: {}", model_path_str);
        println!("   Model size: {:.2} MB", model_size);
        
        // Initialize engine
        println!("\n   📦 Initializing engine...");
        let init_start = Instant::now();
        let engine = match aurorabook_lib::tts::koko::TTSKokoParallel::new_with_instances(
            model_path_str,
            voices_path_str,
            1, // Single instance for testing
        ).await {
            engine => {
                let init_time = init_start.elapsed().as_secs_f64();
                println!("   ✅ Engine initialized in {:.2}s", init_time);
                engine
            }
        };
        
        // Test with short text
        println!("\n   🎤 Generating short audio...");
        let short_start = Instant::now();
        let model_instance = engine.get_model_instance(0);
        let short_audio = match engine.tts_raw_audio_with_instance(
            short_text,
            language,
            voice_id,
            speed,
            None,
            None,
            None,
            None,
            model_instance,
        ) {
            Ok(audio) => {
                let gen_time = short_start.elapsed().as_secs_f64();
                println!("   ✅ Generated in {:.3}s", gen_time);
                audio
            }
            Err(e) => {
                println!("   ❌ Failed to generate short audio: {}", e);
                continue;
            }
        };
        
        let short_duration = short_audio.len() as f32 / 24000.0;
        println!("   📊 Short audio: {} samples, {:.3}s duration", short_audio.len(), short_duration);
        
        // Test with long text
        println!("\n   🎤 Generating long audio...");
        let long_start = Instant::now();
        let model_instance = engine.get_model_instance(0);
        let long_audio = match engine.tts_raw_audio_with_instance(
            long_text,
            language,
            voice_id,
            speed,
            None,
            None,
            None,
            None,
            model_instance,
        ) {
            Ok(audio) => {
                let gen_time = long_start.elapsed().as_secs_f64();
                println!("   ✅ Generated in {:.3}s", gen_time);
                audio
            }
            Err(e) => {
                println!("   ❌ Failed to generate long audio: {}", e);
                continue;
            }
        };
        
        let long_duration = long_audio.len() as f32 / 24000.0;
        println!("   📊 Long audio: {} samples, {:.3}s duration", long_audio.len(), long_duration);
        
        // Save audio files
        let safe_name = model_name.replace(".onnx", "").replace(".", "_");
        let short_wav = test_dir.join(format!("{}_short.wav", safe_name));
        let long_wav = test_dir.join(format!("{}_long.wav", safe_name));
        
        println!("\n   💾 Saving audio files...");
        save_audio_as_wav(&short_audio, 24000, short_wav.to_str().unwrap())
            .expect("Failed to save short WAV");
        save_audio_as_wav(&long_audio, 24000, long_wav.to_str().unwrap())
            .expect("Failed to save long WAV");
        
        println!("   ✅ Saved: {} and {}", short_wav.file_name().unwrap().to_string_lossy(), 
                 long_wav.file_name().unwrap().to_string_lossy());
        
        // Store results
        results.push(ModelResult {
            name: model_name.clone(),
            short_samples: short_audio.len(),
            short_duration,
            short_generation_time: short_start.elapsed().as_secs_f64(),
            long_samples: long_audio.len(),
            long_duration,
            long_generation_time: long_start.elapsed().as_secs_f64(),
            model_size_mb: model_size,
        });
    }
    
    // Print comparison summary
    println!("\n{}", "=".repeat(80));
    println!("📊 COMPARISON SUMMARY");
    println!("{}", "=".repeat(80));
    
    println!("\n{:<25} {:>10} {:>12} {:>12} {:>12} {:>12} {:>12}",
              "Model", "Size (MB)", "Short (s)", "Short Gen", "Long (s)", "Long Gen", "Long Samples");
    println!("{}", "-".repeat(100));
    
    for result in &results {
        println!("{:<25} {:>10.2} {:>12.3} {:>12.3} {:>12.3} {:>12.3} {:>12}",
                 result.name,
                 result.model_size_mb,
                 result.short_duration,
                 result.short_generation_time,
                 result.long_duration,
                 result.long_generation_time,
                 result.long_samples);
    }
    
    // Find fastest and smallest models
    if !results.is_empty() {
        let fastest_short = results.iter().min_by(|a, b| {
            a.short_generation_time.partial_cmp(&b.short_generation_time).unwrap()
        }).unwrap();
        let fastest_long = results.iter().min_by(|a, b| {
            a.long_generation_time.partial_cmp(&b.long_generation_time).unwrap()
        }).unwrap();
        let smallest = results.iter().min_by(|a, b| {
            a.model_size_mb.partial_cmp(&b.model_size_mb).unwrap()
        }).unwrap();
        
        println!("\n🏆 Best Models:");
        println!("   Fastest (short): {} ({:.3}s)", fastest_short.name, fastest_short.short_generation_time);
        println!("   Fastest (long): {} ({:.3}s)", fastest_long.name, fastest_long.long_generation_time);
        println!("   Smallest: {} ({:.2} MB)", smallest.name, smallest.model_size_mb);
        
        // Check for consistency in output duration
        if results.len() > 1 {
            let avg_short_duration = results.iter().map(|r| r.short_duration).sum::<f32>() / results.len() as f32;
            let avg_long_duration = results.iter().map(|r| r.long_duration).sum::<f32>() / results.len() as f32;
            
            println!("\n📈 Duration Consistency:");
            println!("   Average short duration: {:.3}s", avg_short_duration);
            println!("   Average long duration: {:.3}s", avg_long_duration);
            
            let short_variance = results.iter()
                .map(|r| (r.short_duration - avg_short_duration).powi(2))
                .sum::<f32>() / results.len() as f32;
            let long_variance = results.iter()
                .map(|r| (r.long_duration - avg_long_duration).powi(2))
                .sum::<f32>() / results.len() as f32;
            
            println!("   Short duration std dev: {:.3}s", short_variance.sqrt());
            println!("   Long duration std dev: {:.3}s", long_variance.sqrt());
        }
    }
    
    println!("\n{}", "=".repeat(80));
    println!("✅ Test completed successfully!");
    println!("\n📁 Audio files saved to: {}", test_dir.display());
    println!("💡 You can listen to the files to compare audio quality between models.");
    println!("{}", "=".repeat(80));
    
    // Verify we tested at least one model
    assert!(!results.is_empty(), "Should have tested at least one model");
}

