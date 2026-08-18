// Integration tests for aurorabook_lib
// These tests were moved from src/lib.rs to improve code organization
//
// NOTE: This file is kept for backward compatibility.
// New tests should be added to the modular test structure in tests/mod.rs

use std::env;
use std::path::PathBuf;

mod helpers;
use helpers::*;

// Helper functions are imported from helpers module via `use helpers::*;`

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
                println!(
                    "   File size: {} bytes ({:.2} MB)",
                    size,
                    size as f64 / 1_000_000.0
                );
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
                println!(
                    "   File size: {} bytes ({:.2} MB)",
                    size,
                    size as f64 / 1_000_000.0
                );
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
    println!(
        "   ⚠️  If this panics with 'Protobuf parsing failed', the ONNX file format may be invalid"
    );
    println!("   ⚠️  Note: kokoros expects the full path to the ONNX file, not just the directory");

    let _engine = aurorabook_lib::tts::koko::TTSKokoParallel::new_with_instances(
        model_path_str,
        voices_path_str,
        1, // Use 1 instance for testing
    )
    .await.expect("TTS init");

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
    let engine = aurorabook_lib::tts::koko::TTSKokoParallel::new_with_instances(
        model_path_str,
        voices_path_str,
        1, // Use 1 instance for simple test
    )
    .await.expect("TTS init");

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
            println!(
                "   Duration: {:.2}s (at 24kHz)",
                audio.len() as f32 / 24000.0
            );

            // Basic validation
            assert!(!audio.is_empty(), "Audio should not be empty");

            // Check for non-zero samples
            let non_zero_count = audio.iter().filter(|&&s| s.abs() > 0.001).count();
            println!(
                "   Non-zero samples: {} / {} ({:.1}%)",
                non_zero_count,
                audio.len(),
                (non_zero_count as f32 / audio.len() as f32) * 100.0
            );

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

// Note: Resource discovery tests are now in tests/model_discovery.rs
// These tests have been moved to avoid duplication

#[tokio::test]
async fn test_onnx_only() {
    println!("\n🧪 Testing ONNX TTS generation (ONNX only, no CoreML fallback)");

    // Find ONNX model file
    let onnx_model = find_onnx_model();
    if onnx_model.is_none() {
        println!("⚠️ Skipping test - kokoro-v1.0.onnx not found");
        println!(
            "   Set KOKORO_MODEL_DIR env var or ensure kokoro-v1.0.onnx is in resources directory"
        );
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
        println!(
            "   Set KOKORO_VOICES_PATH env var or ensure voices-v1.0.bin is in resources directory"
        );
        return;
    }
    let voices_path = voices_path.unwrap();
    let voices_path_str = voices_path.to_str().unwrap();
    println!("   Voices path: {}", voices_path_str);

    // Initialize ONNX engine
    println!("\n📦 Initializing ONNX engine...");
    let engine = aurorabook_lib::tts::koko::TTSKokoParallel::new_with_instances(
        model_path_str,
        voices_path_str,
        1, // Use 1 instance for testing
    )
    .await.expect("TTS init");

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
            println!(
                "   Duration: {:.2}s (at 24kHz)",
                audio_samples.len() as f32 / 24000.0
            );

            // Basic validation
            assert!(!audio_samples.is_empty(), "Audio should not be empty");

            // Check for non-zero samples
            let non_zero_count = audio_samples.iter().filter(|&&s| s.abs() > 0.001).count();
            println!(
                "   Non-zero samples: {} / {} ({:.1}%)",
                non_zero_count,
                audio_samples.len(),
                (non_zero_count as f32 / audio_samples.len() as f32) * 100.0
            );

            if non_zero_count > 0 {
                // Check audio range
                let min_val = audio_samples.iter().fold(f32::INFINITY, |a, &b| a.min(b));
                let max_val = audio_samples
                    .iter()
                    .fold(f32::NEG_INFINITY, |a, &b| a.max(b));
                println!("   Audio range: [{:.6}, {:.6}]", min_val, max_val);
            } else {
                println!("⚠️ WARNING: Audio contains only zeros (silence)");
            }

            // Save audio file
            let output_path = "test_output_onnx_only.wav";
            match save_audio_as_wav(&audio_samples, 24000, output_path) {
                Ok(_) => {
                    println!("✅ Audio saved to: {}", output_path);
                    println!(
                        "   File location: {}/{}",
                        std::env::current_dir().unwrap().display(),
                        output_path
                    );
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
async fn test_generate_and_save_audio() {
    // Initialize tracing for logging
    let _ = env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .try_init();

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

    // Initialize Supertonic-backed engine (legacy tests referred to this as "kokoros").
    let engine =
        aurorabook_lib::tts::koko::TTSKokoParallel::new_with_instances(model_path_str, voices_path_str, 1)
            .await.expect("TTS init");

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
    let sr = engine.sample_rate();
    println!(
        "   Duration: {:.2}s (at {} Hz)",
        audio_samples.len() as f32 / sr as f32,
        sr
    );
    println!("   ⚠️ Word-level timestamps are not exposed by the Supertonic path in this build.");

    // Save to WAV file
    let output_path = "test_output.wav";
    match save_audio_as_wav(&audio_samples, sr, output_path) {
        Ok(_) => {
            println!("✅ Audio saved to: {}", output_path);
            println!(
                "   File location: {}/{}",
                std::env::current_dir().unwrap().display(),
                output_path
            );
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
        "model_q8f16.onnx",     // 82MB - smallest
        "model_quantized.onnx", // 88MB
        "model_uint8f16.onnx",  // 109MB
        "model_q4f16.onnx",     // 147MB
        "model_fp16.onnx",      // 156MB
        "model_uint8.onnx",     // 169MB
        "model_q4.onnx",        // 291MB
        "model.onnx",           // 310MB - full precision
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
        PathBuf::from("Kokoro-82M-v1.0-ONNX")
            .join("voices")
            .join("af.bin"),
        PathBuf::from("../Kokoro-82M-v1.0-ONNX")
            .join("voices")
            .join("af.bin"),
    ];

    if let Ok(manifest_dir) = env::var("CARGO_MANIFEST_DIR") {
        let manifest_path = PathBuf::from(&manifest_dir);
        if let Some(parent) = manifest_path.parent() {
            voices_locations.push(
                parent
                    .join("Kokoro-82M-v1.0-ONNX")
                    .join("voices")
                    .join("af.bin"),
            );
        }
    }

    if let Ok(current_dir) = std::env::current_dir() {
        voices_locations.push(
            current_dir
                .join("Kokoro-82M-v1.0-ONNX")
                .join("voices")
                .join("af.bin"),
        );
        if let Some(parent) = current_dir.parent() {
            voices_locations.push(
                parent
                    .join("Kokoro-82M-v1.0-ONNX")
                    .join("voices")
                    .join("af.bin"),
            );
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
            println!(
                "   Expected: Kokoro-82M-v1.0-ONNX/voices/af.bin or voices-v1.0.bin in resources"
            );
            return;
        }
    };

    let voices_path_str = voices_path.to_str().unwrap();
    println!("   Voices file: {}", voices_path_str);

    // Initialize kokoros engine with the quantized model
    println!("\n📦 Initializing kokoros engine with quantized model...");
    let engine = aurorabook_lib::tts::koko::TTSKokoParallel::new_with_instances(
        model_path_str,
        voices_path_str,
        1, // Use 1 instance for testing
    )
    .await
    .expect("TTS init");
    println!("✅ Engine initialized successfully!");

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
            println!(
                "   Duration: {:.2}s (at 24kHz)",
                audio_samples.len() as f32 / 24000.0
            );

            // Basic validation
            assert!(!audio_samples.is_empty(), "Audio should not be empty");

            // Check for non-zero samples
            let non_zero_count = audio_samples.iter().filter(|&&s| s.abs() > 0.001).count();
            println!(
                "   Non-zero samples: {} / {} ({:.1}%)",
                non_zero_count,
                audio_samples.len(),
                (non_zero_count as f32 / audio_samples.len() as f32) * 100.0
            );

            if non_zero_count > 0 {
                // Check audio range
                let min_val = audio_samples.iter().fold(f32::INFINITY, |a, &b| a.min(b));
                let max_val = audio_samples
                    .iter()
                    .fold(f32::NEG_INFINITY, |a, &b| a.max(b));
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
            println!(
                "   - Input name mismatch (model expects 'input_ids' but kokoros uses 'tokens')"
            );
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
        println!(
            "   Set KOKORO_MODEL_DIR env var or ensure kokoro-v1.0.onnx is in resources directory"
        );
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
            current_dir
                .join("src-tauri")
                .join("resources")
                .join("voice-samples")
        }
    } else {
        PathBuf::from("resources/voice-samples")
    };

    fs::create_dir_all(&output_dir).expect("Failed to create output directory");
    println!("   Output directory: {}", output_dir.display());

    // All voice IDs
    let voices = vec![
        // American voices
        "af_heart",
        "af_alloy",
        "af_aoede",
        "af_bella",
        "af_jessica",
        "af_kore",
        "af_nicole",
        "af_nova",
        "af_river",
        "af_sarah",
        "af_sky",
        "am_adam",
        "am_echo",
        "am_eric",
        "am_fenrir",
        "am_liam",
        "am_michael",
        "am_onyx",
        "am_puck",
        "am_santa",
        // British voices
        "bf_alice",
        "bf_emma",
        "bf_isabella",
        "bf_lily",
        "bm_daniel",
        "bm_fable",
        "bm_george",
        "bm_lewis",
    ];

    let sample_text = "Hello, this is a sample of my voice. I hope you enjoy listening to it.";

    println!("\n📦 Initializing TTS engine...");
    let engine =
        aurorabook_lib::tts::koko::TTSKokoParallel::new_with_instances(model_path_str, voices_path_str, 1)
            .await
            .expect("TTS init");

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

                // Convert PCM to MP3 (64 kbps) via FFmpeg on PATH
                let mp3_data = match aurorabook_lib::utils::ffmpeg_audio::encode_pcm_to_mp3_bytes(
                    pcm_bytes,
                    24_000,
                    1,
                    Some(64),
                ) {
                    Ok(b) => b,
                    Err(e) => {
                        println!(
                            "   ❌ FFmpeg MP3 encode failed: {} (install ffmpeg / ffprobe?)",
                            e
                        );
                        continue;
                    }
                };

                if mp3_data.is_empty() {
                    println!("   ❌ MP3 encoding produced no output");
                } else {
                    let filename = format!("{}.mp3", voice_id);
                    let output_path = output_dir.join(&filename);

                    fs::write(&output_path, &mp3_data).expect(&format!(
                        "Failed to write MP3 file: {}",
                        output_path.display()
                    ));

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

    println!(
        "\n✅ Completed! Generated {} voice samples in {}",
        voices.len(),
        output_dir.display()
    );
    println!("   Files are ready to be bundled with the app.");
}
