// Tests for model and resource file discovery

mod helpers;
use helpers::*;

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

    let _engine = aurorabook_lib::tts::koko::TTSKokoParallel::new_with_instances(
        model_path_str,
        voices_path_str,
        1, // Use 1 instance for testing
    ).await;

    println!("✅ Model loaded successfully with kokoros!");
}

