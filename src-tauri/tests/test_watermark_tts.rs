//! Test TTS generation for watermark text
//!
//! This test generates TTS audio for the watermark text and converts it to MP3

use aurorabook_lib::tts::engine::{TtsEnginePool, TtsEngineType};
use aurorabook_lib::tts_commands;

#[path = "helpers.rs"]
mod helpers;
use helpers::{find_onnx_model, find_resources_dir, find_voices_file};

#[tokio::test]
async fn test_watermark_tts_to_mp3() {
    let onnx_model = find_onnx_model();
    let resources_dir = find_resources_dir();

    if onnx_model.is_none() || resources_dir.is_none() {
        println!("⚠️  Skipping test: Model files not found in resources/");
        println!(
            "   Please ensure kokoro-v1.0.onnx and voices-v1.0.bin are in the resources directory"
        );
        return;
    }

    let onnx_path = onnx_model.unwrap();
    let voices_path = find_voices_file(&resources_dir.unwrap()).unwrap();

    println!("🎤 Testing TTS generation for watermark text...");
    println!("   Model: {}", onnx_path.display());
    println!("   Voices: {}", voices_path.display());

    // Initialize engine pool
    let pool = TtsEnginePool::new(
        onnx_path.to_str().unwrap(),
        voices_path.to_str().unwrap(),
        1,
        TtsEngineType::Onnx,
    )
    .await
    .unwrap();

    // Watermark text
    let watermark_text = "This audiobook was generated using aurora book reader";
    let voice_id = "af_heart"; // Using a default voice
    let language = "en";

    println!("\n📝 Text: \"{}\"", watermark_text);
    println!("🎙️  Voice: {}", voice_id);
    println!("🌍 Language: {}", language);

    // Generate TTS audio (PCM)
    println!("\n🔄 Generating TTS audio...");
    let pcm_result = pool
        .generate_audio_pcm(watermark_text, language, voice_id, 1.0)
        .await;

    match pcm_result {
        Ok(pcm_audio) => {
            let pcm_len = pcm_audio.len();
            println!("✅ TTS generation successful!");
            println!("   PCM bytes: {}", pcm_len);
            println!("   Samples: {}", pcm_len / 2);
            println!(
                "   Duration: {:.3}s (at 24kHz)",
                (pcm_len / 2) as f32 / 24000.0
            );

            // Convert PCM to MP3
            println!("\n🔄 Converting PCM to MP3...");
            let mp3_result = tts_commands::convert_pcm_to_mp3(
                pcm_audio,
                24000,    // Sample rate
                1,        // Mono channel
                Some(64), // Bitrate in kbps
            );

            match mp3_result {
                Ok(mp3_data) => {
                    println!("✅ MP3 conversion successful!");
                    println!("   MP3 bytes: {}", mp3_data.len());
                    println!(
                        "   Compression ratio: {:.2}x",
                        (pcm_len as f64) / (mp3_data.len() as f64)
                    );

                    // Save to file
                    let output_path = std::path::Path::new("watermark_test.mp3");
                    match std::fs::write(output_path, &mp3_data) {
                        Ok(_) => {
                            println!("\n✅ MP3 file saved successfully!");
                            println!("   Output: {}", output_path.display());
                            println!("\n🎉 Test completed successfully!");
                        }
                        Err(e) => {
                            println!("❌ Failed to save MP3 file: {}", e);
                        }
                    }
                }
                Err(e) => {
                    println!("❌ MP3 conversion failed: {}", e);
                }
            }
        }
        Err(e) => {
            println!("❌ TTS generation failed: {}", e);
        }
    }
}
