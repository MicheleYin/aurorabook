//! Tests for tts_commands module
//!
//! Tests TTS command functions:
//! - init_kokoros_engine
//! - generate_tts_cached
//! - generate_tts_batch
//! - convert_pcm_to_mp3

use aurorabook_lib::tts_commands;

#[path = "helpers.rs"]
mod helpers;
use helpers::{find_onnx_model, find_resources_dir, find_voices_file};

#[tokio::test]
#[ignore] // Requires Tauri app context - can be tested in integration tests
async fn test_init_kokoros_engine_valid_path() {
    // Test engine initialization with valid path
    // Note: This requires Tauri AppHandle which is difficult to mock
    // The underlying functionality is tested in tts::engine tests
    println!("⚠️  This test requires Tauri AppHandle - see tts::engine tests for functionality");
}

#[tokio::test]
#[ignore] // Requires Tauri app context
async fn test_init_kokoros_engine_empty_path() {
    // Test engine initialization with empty path (uses bundle resources)
    // Note: This requires Tauri AppHandle
    println!("⚠️  This test requires Tauri AppHandle");
}

#[tokio::test]
#[ignore] // Requires Tauri app context
async fn test_init_kokoros_engine_invalid_extension() {
    // Test engine initialization with invalid file extension
    // Note: This requires Tauri AppHandle
    // The validation logic is tested indirectly through the function signature
    println!("⚠️  This test requires Tauri AppHandle");
}

#[test]
fn test_convert_pcm_to_mp3_basic() {
    // Test PCM to MP3 conversion
    // Create minimal PCM data (silence)
    let pcm_data: Vec<u8> = vec![0u8; 4800]; // 0.1 seconds at 24kHz, 16-bit mono
    
    let result = tts_commands::convert_pcm_to_mp3(pcm_data, 24000, 1, Some(128));
    
    // Should succeed and produce MP3 data
    assert!(result.is_ok());
    let mp3_data = result.unwrap();
    assert!(!mp3_data.is_empty());
}

#[test]
fn test_convert_pcm_to_mp3_empty_data() {
    // Test with empty PCM data
    let result = tts_commands::convert_pcm_to_mp3(vec![], 24000, 1, None);
    assert!(result.is_err());
}

#[test]
fn test_convert_pcm_to_mp3_invalid_sample_rate() {
    // Test with zero sample rate
    let pcm_data = vec![0u8; 100];
    let result = tts_commands::convert_pcm_to_mp3(pcm_data, 0, 1, None);
    assert!(result.is_err());
}

#[test]
fn test_convert_pcm_to_mp3_invalid_channels() {
    // Test with invalid channel count
    let pcm_data = vec![0u8; 100];
    let result = tts_commands::convert_pcm_to_mp3(pcm_data, 24000, 3, None);
    assert!(result.is_err());
}

#[test]
fn test_convert_pcm_to_mp3_stereo() {
    // Test stereo conversion
    let pcm_data: Vec<u8> = vec![0u8; 9600]; // 0.1 seconds at 24kHz, 16-bit stereo
    
    let result = tts_commands::convert_pcm_to_mp3(pcm_data, 24000, 2, Some(128));
    assert!(result.is_ok());
    let mp3_data = result.unwrap();
    assert!(!mp3_data.is_empty());
}

#[test]
fn test_convert_pcm_to_mp3_invalid_data_length() {
    // Test with data length not divisible by (channels * 2)
    let pcm_data = vec![0u8; 99]; // Odd number of bytes
    let result = tts_commands::convert_pcm_to_mp3(pcm_data, 24000, 1, None);
    assert!(result.is_err());
}

#[tokio::test]
async fn test_generate_tts_cached() {
    // Test single TTS generation with actual model files
    // Note: This test uses the underlying TtsEnginePool directly since
    // generate_tts_cached requires Tauri AppHandle
    use aurorabook_lib::tts::engine::{TtsEnginePool, TtsEngineType};
    
    let onnx_model = find_onnx_model();
    let resources_dir = find_resources_dir();
    
    if onnx_model.is_none() || resources_dir.is_none() {
        println!("⚠️  Skipping test: Model files not found in resources/");
        return;
    }
    
    let onnx_path = onnx_model.unwrap();
    let voices_path = find_voices_file(&resources_dir.unwrap()).unwrap();
    
    println!("🎤 Testing TTS generation (using TtsEnginePool directly)...");
    let pool = TtsEnginePool::new(
        onnx_path.to_str().unwrap(),
        voices_path.to_str().unwrap(),
        1,
        TtsEngineType::Onnx,
    ).await.unwrap();
    
    let result = pool.generate_audio_pcm(
        "Hello, this is a test of the text to speech system.",
        "en",
        "af_heart",
        1.0,
    ).await;
    
    assert!(result.is_ok(), "TTS generation should succeed");
    let pcm_audio = result.unwrap();
    
    // Verify audio output
    assert!(!pcm_audio.is_empty(), "PCM audio should not be empty");
    assert!(pcm_audio.len() > 100, "PCM audio should have reasonable length");
    assert!(pcm_audio.len() % 2 == 0, "PCM should be 16-bit (2 bytes per sample)");
    
    let sample_count = pcm_audio.len() / 2;
    println!("✅ TTS generation successful!");
    println!("   PCM bytes: {}", pcm_audio.len());
    println!("   Samples: {}", sample_count);
    println!("   Duration: {:.3}s (at 24kHz)", sample_count as f32 / 24000.0);
}

#[tokio::test]
async fn test_generate_tts_batch() {
    // Test batch TTS generation with actual model files
    // Note: This test uses the underlying TtsEnginePool directly since
    // generate_tts_batch requires Tauri AppHandle
    use aurorabook_lib::tts::engine::{TtsEnginePool, TtsEngineType};
    
    let onnx_model = find_onnx_model();
    let resources_dir = find_resources_dir();
    
    if onnx_model.is_none() || resources_dir.is_none() {
        println!("⚠️  Skipping test: Model files not found in resources/");
        return;
    }
    
    let onnx_path = onnx_model.unwrap();
    let voices_path = find_voices_file(&resources_dir.unwrap()).unwrap();
    
    println!("🎤 Testing batch TTS generation (using TtsEnginePool directly)...");
    let pool = TtsEnginePool::new(
        onnx_path.to_str().unwrap(),
        voices_path.to_str().unwrap(),
        2, // Use 2 instances for parallel processing
        TtsEngineType::Onnx,
    ).await.unwrap();
    
    let texts = vec![
        "First sentence for batch testing.",
        "Second sentence for batch testing.",
        "Third sentence for batch testing.",
    ];
    
    // Generate audio for all texts in parallel
    let mut handles = Vec::new();
    for text in texts {
        let pool_clone = pool.clone();
        let handle = tokio::spawn(async move {
            pool_clone.generate_audio_pcm(text, "en", "af_heart", 1.0).await
        });
        handles.push(handle);
    }
    
    let mut audio_results = Vec::new();
    for handle in handles {
        let result = handle.await.unwrap();
        assert!(result.is_ok(), "Each TTS generation should succeed");
        audio_results.push(result.unwrap());
    }
    
    // Verify batch output
    assert_eq!(audio_results.len(), 3, "Should have audio for each text");
    
    for (i, audio) in audio_results.iter().enumerate() {
        assert!(!audio.is_empty(), "Audio {} should not be empty", i);
        assert!(audio.len() > 100, "Audio {} should have reasonable length", i);
        let sample_count = audio.len() / 2;
        println!("   Audio {}: {} bytes ({} samples, {:.3}s)", 
                 i, audio.len(), sample_count, sample_count as f32 / 24000.0);
    }
    
    println!("✅ Batch TTS generation successful!");
}

