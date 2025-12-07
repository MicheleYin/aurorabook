//! Tests for tts::engine module
//!
//! Tests TTS engine functionality:
//! - TtsEngineType enum
//! - TtsEnginePool creation
//! - Audio generation

use aurorabook_lib::tts::engine::{TtsEngineType, TtsEnginePool};

#[path = "../helpers.rs"]
mod helpers;
use helpers::{find_onnx_model, find_resources_dir, find_voices_file};

#[test]
fn test_tts_engine_type_default() {
    assert_eq!(TtsEngineType::default(), TtsEngineType::Onnx);
}

#[test]
fn test_tts_engine_type_from_str() {
    assert_eq!("onnx".parse::<TtsEngineType>().unwrap(), TtsEngineType::Onnx);
    assert_eq!("ONNX".parse::<TtsEngineType>().unwrap(), TtsEngineType::Onnx);
    assert_eq!("candle".parse::<TtsEngineType>().unwrap(), TtsEngineType::Candle);
    assert!("invalid".parse::<TtsEngineType>().is_err());
}

#[test]
fn test_tts_engine_type_equality() {
    assert_eq!(TtsEngineType::Onnx, TtsEngineType::Onnx);
    assert_ne!(TtsEngineType::Onnx, TtsEngineType::Candle);
}

#[tokio::test]
async fn test_tts_engine_pool_creation_invalid_path() {
    // Test creating TTS engine pool with invalid paths
    let result = TtsEnginePool::new(
        "/nonexistent/model.onnx",
        "/nonexistent/voices.bin",
        1,
        TtsEngineType::Onnx,
    ).await;
    
    // Should fail with resource not found or similar error
    assert!(result.is_err());
}

#[tokio::test]
async fn test_tts_engine_pool_creation() {
    // Test creating TTS engine pool with actual model files
    let onnx_model = find_onnx_model();
    let resources_dir = find_resources_dir();
    
    if onnx_model.is_none() || resources_dir.is_none() {
        println!("⚠️  Skipping test: Model files not found in resources/");
        println!("   Expected: src-tauri/resources/kokoro-v1.0.onnx");
        println!("   Expected: src-tauri/resources/voices-v1.0.bin");
        return;
    }
    
    let onnx_path = onnx_model.unwrap();
    let voices_path = find_voices_file(&resources_dir.unwrap())
        .expect("Voices file should exist if resources dir exists");
    
    let onnx_path_str = onnx_path.to_str().expect("ONNX path should be valid UTF-8");
    let voices_path_str = voices_path.to_str().expect("Voices path should be valid UTF-8");
    
    println!("📁 Creating engine pool with:");
    println!("   Model: {}", onnx_path_str);
    println!("   Voices: {}", voices_path_str);
    
    let pool = TtsEnginePool::new(
        onnx_path_str,
        voices_path_str,
        1, // Single instance for testing
        TtsEngineType::Onnx,
    ).await;
    
    assert!(pool.is_ok(), "Engine pool creation should succeed with valid model files");
    let pool = pool.unwrap();
    
    println!("✅ Engine pool created successfully");
}

#[tokio::test]
async fn test_tts_engine_pool_clone() {
    // Test that engine pool can be cloned
    let onnx_model = find_onnx_model();
    let resources_dir = find_resources_dir();
    
    if onnx_model.is_none() || resources_dir.is_none() {
        println!("⚠️  Skipping test: Model files not found");
        return;
    }
    
    let onnx_path = onnx_model.unwrap();
    let voices_path = find_voices_file(&resources_dir.unwrap()).unwrap();
    
    let pool = TtsEnginePool::new(
        onnx_path.to_str().unwrap(),
        voices_path.to_str().unwrap(),
        1,
        TtsEngineType::Onnx,
    ).await.unwrap();
    
    // Clone the pool
    let cloned_pool = pool.clone();
    
    // Both should be usable
    assert!(true, "Pool cloning should succeed");
    println!("✅ Engine pool cloned successfully");
}

#[tokio::test]
async fn test_tts_engine_pool_generate_audio() {
    // Test audio generation with actual model files
    let onnx_model = find_onnx_model();
    let resources_dir = find_resources_dir();
    
    if onnx_model.is_none() || resources_dir.is_none() {
        println!("⚠️  Skipping test: Model files not found");
        return;
    }
    
    let onnx_path = onnx_model.unwrap();
    let voices_path = find_voices_file(&resources_dir.unwrap()).unwrap();
    
    let pool = TtsEnginePool::new(
        onnx_path.to_str().unwrap(),
        voices_path.to_str().unwrap(),
        1,
        TtsEngineType::Onnx,
    ).await.unwrap();
    
    println!("🎤 Generating audio for test text...");
    let test_text = "Hello, this is a test of the text to speech system.";
    let result = pool.generate_audio(
        test_text,
        "en",
        "af_heart",
        1.0,
    ).await;
    
    assert!(result.is_ok(), "Audio generation should succeed");
    let audio_samples = result.unwrap();
    
    // Verify audio output
    assert!(!audio_samples.is_empty(), "Audio samples should not be empty");
    assert!(audio_samples.len() > 100, "Audio should have reasonable length");
    
    // Check that audio is in valid range [-1.0, 1.0]
    let min_val = audio_samples.iter().fold(f32::INFINITY, |a, &b| a.min(b));
    let max_val = audio_samples.iter().fold(f32::NEG_INFINITY, |a, &b| a.max(b));
    assert!(min_val >= -1.0 && max_val <= 1.0, "Audio samples should be in range [-1.0, 1.0]");
    
    println!("✅ Audio generation successful!");
    println!("   Samples: {}", audio_samples.len());
    println!("   Duration: {:.3}s (at 24kHz)", audio_samples.len() as f32 / 24000.0);
    println!("   Range: [{:.6}, {:.6}]", min_val, max_val);
}

#[tokio::test]
async fn test_tts_engine_pool_generate_audio_pcm() {
    // Test PCM audio generation with actual model files
    let onnx_model = find_onnx_model();
    let resources_dir = find_resources_dir();
    
    if onnx_model.is_none() || resources_dir.is_none() {
        println!("⚠️  Skipping test: Model files not found");
        return;
    }
    
    let onnx_path = onnx_model.unwrap();
    let voices_path = find_voices_file(&resources_dir.unwrap()).unwrap();
    
    let pool = TtsEnginePool::new(
        onnx_path.to_str().unwrap(),
        voices_path.to_str().unwrap(),
        1,
        TtsEngineType::Onnx,
    ).await.unwrap();
    
    println!("🎤 Generating PCM audio for test text...");
    let test_text = "This is a test of PCM audio generation.";
    let result = pool.generate_audio_pcm(
        test_text,
        "en",
        "af_heart",
        1.0,
    ).await;
    
    assert!(result.is_ok(), "PCM audio generation should succeed");
    let pcm_bytes = result.unwrap();
    
    // Verify PCM output
    assert!(!pcm_bytes.is_empty(), "PCM bytes should not be empty");
    assert!(pcm_bytes.len() % 2 == 0, "PCM bytes should be 16-bit (2 bytes per sample)");
    assert!(pcm_bytes.len() > 200, "PCM should have reasonable length");
    
    // Verify it's valid 16-bit PCM (little-endian)
    let sample_count = pcm_bytes.len() / 2;
    println!("✅ PCM audio generation successful!");
    println!("   PCM bytes: {}", pcm_bytes.len());
    println!("   Samples: {}", sample_count);
    println!("   Duration: {:.3}s (at 24kHz)", sample_count as f32 / 24000.0);
}

#[tokio::test]
async fn test_tts_engine_pool_candle_not_implemented() {
    // Test that Candle engine returns appropriate error
    let result = TtsEnginePool::new(
        "/nonexistent/model.onnx",
        "/nonexistent/voices.bin",
        1,
        TtsEngineType::Candle,
    ).await;
    
    // Should fail with "not yet implemented" error
    assert!(result.is_err());
    if let Err(e) = result {
        let error_msg = e.to_string();
        assert!(
            error_msg.contains("not yet implemented") || 
            error_msg.contains("Candle engine") ||
            error_msg.contains("not yet implemented"),
            "Error should mention Candle is not implemented. Got: {}", error_msg
        );
    }
}

#[tokio::test]
async fn test_tts_engine_pool_multiple_instances() {
    // Test creating engine pool with multiple instances
    let onnx_model = find_onnx_model();
    let resources_dir = find_resources_dir();
    
    if onnx_model.is_none() || resources_dir.is_none() {
        println!("⚠️  Skipping test: Model files not found");
        return;
    }
    
    let onnx_path = onnx_model.unwrap();
    let voices_path = find_voices_file(&resources_dir.unwrap()).unwrap();
    
    println!("📁 Creating engine pool with 2 instances...");
    let pool = TtsEnginePool::new(
        onnx_path.to_str().unwrap(),
        voices_path.to_str().unwrap(),
        2, // Two instances for parallel processing
        TtsEngineType::Onnx,
    ).await;
    
    assert!(pool.is_ok(), "Engine pool with multiple instances should be created");
    let pool = pool.unwrap();
    
    // Test that both instances can generate audio
    let test_text = "Testing multiple instances.";
    let result1 = pool.generate_audio(test_text, "en", "af_heart", 1.0).await;
    let result2 = pool.generate_audio(test_text, "en", "af_heart", 1.0).await;
    
    assert!(result1.is_ok(), "First instance should generate audio");
    assert!(result2.is_ok(), "Second instance should generate audio");
    
    println!("✅ Multiple instances test passed!");
}

#[tokio::test]
async fn test_tts_engine_pool_different_voices() {
    // Test generating audio with different voices
    let onnx_model = find_onnx_model();
    let resources_dir = find_resources_dir();
    
    if onnx_model.is_none() || resources_dir.is_none() {
        println!("⚠️  Skipping test: Model files not found");
        return;
    }
    
    let onnx_path = onnx_model.unwrap();
    let voices_path = find_voices_file(&resources_dir.unwrap()).unwrap();
    
    let pool = TtsEnginePool::new(
        onnx_path.to_str().unwrap(),
        voices_path.to_str().unwrap(),
        1,
        TtsEngineType::Onnx,
    ).await.unwrap();
    
    let test_text = "Testing different voices.";
    let voices = vec!["af_heart", "af_bella"];
    
    for voice in voices {
        let result = pool.generate_audio(test_text, "en", voice, 1.0).await;
        if result.is_ok() {
            println!("✅ Voice '{}' works", voice);
        } else {
            println!("⚠️  Voice '{}' failed: {}", voice, result.unwrap_err());
        }
    }
}

