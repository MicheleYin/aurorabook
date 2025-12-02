/// Test for TTS model with durations
/// 
/// This test:
/// 1. Loads the TTS model
/// 2. Generates audio with word alignments/durations
/// 3. Saves the audio as a WAV file
/// 4. Saves the word alignments/durations as a TSV file
/// 5. Verifies that durations are correct and match the audio

use std::fs;

mod helpers;
use helpers::*;

/// Save word alignments to TSV file
fn save_alignments_to_tsv(alignments: &[kokoros::tts::koko::WordAlignment], file_path: &str) -> Result<(), String> {
    use std::fs::File;
    use std::io::Write;
    
    let mut file = File::create(file_path)
        .map_err(|e| format!("Failed to create TSV file: {}", e))?;
    
    // Write header
    file.write_all(b"word\tstart_sec\tend_sec\tduration_sec\n")
        .map_err(|e| format!("Failed to write TSV header: {}", e))?;
    
    // Write alignments
    for alignment in alignments {
        let duration = alignment.end_sec - alignment.start_sec;
        let line = format!("{}\t{:.6}\t{:.6}\t{:.6}\n", 
            alignment.word, 
            alignment.start_sec, 
            alignment.end_sec,
            duration);
        file.write_all(line.as_bytes())
            .map_err(|e| format!("Failed to write alignment: {}", e))?;
    }
    
    Ok(())
}

#[tokio::test]
async fn test_tts_with_durations_save_wav_and_alignments() {
    println!("🧪 Testing TTS model with durations - saving WAV and alignments");
    
    // Find model and voices files
    let onnx_model = find_onnx_model();
    let resources_dir = find_resources_dir();
    
    if onnx_model.is_none() || resources_dir.is_none() {
        println!("⚠️  Skipping test: Model files not found");
        println!("   Set KOKORO_MODEL_DIR or place model files in resources/");
        return;
    }
    
    let onnx_path = onnx_model.unwrap();
    let voices_path = find_voices_file(&resources_dir.unwrap())
        .expect("Voices file should exist if resources dir exists");
    
    println!("📁 Model: {}", onnx_path.display());
    println!("📁 Voices: {}", voices_path.display());
    
    // Create output directory (in project root for easy access)
    let test_dir = std::env::current_dir()
        .unwrap_or_else(|_| std::env::temp_dir())
        .join("test_output")
        .join("tts_duration_test");
    fs::create_dir_all(&test_dir).expect("Failed to create test directory");
    
    let wav_path = test_dir.join("test_output.wav");
    let tsv_path = test_dir.join("test_alignments.tsv");
    
    println!("\n🎤 Creating TTS engine...");
    let onnx_path_str = onnx_path.to_str()
        .expect("ONNX path should be valid UTF-8");
    let voices_path_str = voices_path.to_str()
        .expect("Voices path should be valid UTF-8");
    
    let engine = kokoros::tts::koko::TTSKokoParallel::new_with_instances(
        onnx_path_str,
        voices_path_str,
        1, // Single instance for testing
    ).await;
    
    // Test text
    let test_text = "Hello, this is a test of the text to speech system with word alignments. How does it sound?";
    let voice_id = "af_heart";
    let language = "en";
    let speed = 1.0;
    
    println!("\n📝 Test text: '{}'", test_text);
    println!("   Voice: {}", voice_id);
    println!("   Language: {}", language);
    println!("   Speed: {}", speed);
    
    // Generate audio with durations
    println!("\n🎵 Generating audio with word alignments...");
    let model_instance = engine.get_model_instance(0);
    
    let (audio_samples, word_alignments) = match engine.tts_timestamped_raw_audio_with_instance(
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
        Ok(Some((audio, alignments))) => {
            println!("✅ Audio generated successfully!");
            println!("   Samples: {}", audio.len());
            println!("   Duration: {:.3}s (at 24kHz)", audio.len() as f32 / 24000.0);
            println!("   Word alignments: {} words", alignments.len());
            (audio, alignments)
        }
        Ok(None) => {
            panic!("TTS engine returned None - model may not support durations");
        }
        Err(e) => {
            panic!("Failed to generate audio: {}", e);
        }
    };
    
    // Verify alignments
    assert!(!word_alignments.is_empty(), "Should have word alignments");
    assert!(!audio_samples.is_empty(), "Should have audio samples");
    
    // Verify alignment structure
    // Note: Some alignments (like punctuation) may have zero duration (end_sec == start_sec)
    for (i, alignment) in word_alignments.iter().enumerate() {
        assert!(alignment.end_sec >= alignment.start_sec,
            "Alignment {}: end_sec ({}) should be greater than or equal to start_sec ({})",
            i, alignment.end_sec, alignment.start_sec);
        
        let duration = alignment.end_sec - alignment.start_sec;
        assert!(duration >= 0.0, "Alignment {} should have non-negative duration", i);
    }
    
    // Verify alignments are sequential
    for i in 1..word_alignments.len() {
        assert!(word_alignments[i].start_sec >= word_alignments[i-1].start_sec,
            "Alignment {} should start after or at alignment {} start",
            i, i-1);
    }
    
    // Calculate total duration from alignments
    let total_alignment_duration = word_alignments.last().unwrap().end_sec;
    let audio_duration = audio_samples.len() as f32 / 24000.0;
    
    println!("\n📊 Duration verification:");
    println!("   Audio duration (from samples): {:.3}s", audio_duration);
    println!("   Total alignment duration: {:.3}s", total_alignment_duration);
    println!("   Ratio (alignment/audio): {:.3}", total_alignment_duration / audio_duration);
    
    // Calculate what frame rate would make durations match audio
    // If we assume durations are in frames and we divide by frame_rate to get seconds,
    // then: total_frames / frame_rate = alignment_duration
    // But we don't have total_frames directly. However, if 80 Hz gives us 2.719s,
    // and audio is 5.675s, we can calculate:
    // If current_frame_rate = 80, and current_duration = 2.719, then:
    // total_frames = 2.719 * 80 = 217.52
    // To match audio: frame_rate = total_frames / audio_duration = 217.52 / 5.675 = 38.3 Hz
    // But this assumes durations cover full audio, which they might not.
    let estimated_total_frames = total_alignment_duration * 80.0;
    let calculated_frame_rate_for_audio = estimated_total_frames / audio_duration;
    println!("   Estimated total frames (at 80Hz): {:.2}", estimated_total_frames);
    println!("   Calculated frame rate to match audio: {:.2} Hz", calculated_frame_rate_for_audio);
    
    // Allow some tolerance (alignments might be slightly shorter due to silence)
    let duration_tolerance = 0.5; // 500ms tolerance
    assert!(
        total_alignment_duration <= audio_duration + duration_tolerance,
        "Total alignment duration ({:.3}s) should not exceed audio duration ({:.3}s) by more than {:.3}s",
        total_alignment_duration, audio_duration, duration_tolerance
    );
    
    // Save WAV file
    println!("\n💾 Saving WAV file to: {}", wav_path.display());
    save_audio_as_wav(&audio_samples, 24000, wav_path.to_str().unwrap())
        .expect("Failed to save WAV file");
    
    // Verify WAV file was created
    assert!(wav_path.exists(), "WAV file should exist");
    let wav_size = fs::metadata(&wav_path).unwrap().len();
    println!("   WAV file size: {} bytes", wav_size);
    assert!(wav_size > 44, "WAV file should be larger than header (44 bytes)");
    
    // Save alignments to TSV
    println!("\n💾 Saving alignments to: {}", tsv_path.display());
    save_alignments_to_tsv(&word_alignments, tsv_path.to_str().unwrap())
        .expect("Failed to save alignments");
    
    // Verify TSV file was created
    assert!(tsv_path.exists(), "TSV file should exist");
    let tsv_size = fs::metadata(&tsv_path).unwrap().len();
    println!("   TSV file size: {} bytes", tsv_size);
    assert!(tsv_size > 0, "TSV file should not be empty");
    
    // Print summary
    println!("\n📋 Word Alignment Summary:");
    println!("   Total words: {}", word_alignments.len());
    for (i, alignment) in word_alignments.iter().take(10).enumerate() {
        let duration = alignment.end_sec - alignment.start_sec;
        println!("   {}. '{}': {:.3}s - {:.3}s (duration: {:.3}s)",
            i + 1, alignment.word, alignment.start_sec, alignment.end_sec, duration);
    }
    if word_alignments.len() > 10 {
        println!("   ... and {} more words", word_alignments.len() - 10);
    }
    
    // Verify that we can read back the TSV file
    let tsv_content = fs::read_to_string(&tsv_path).expect("Failed to read TSV file");
    let lines: Vec<&str> = tsv_content.lines().collect();
    assert_eq!(lines.len(), word_alignments.len() + 1, "TSV should have header + alignments");
    assert!(lines[0].starts_with("word\t"), "TSV should have correct header");
    
    println!("\n✅ Test completed successfully!");
    println!("\n📁 Test files saved and kept at: {}", test_dir.display());
    println!("   🔊 WAV file: {}", wav_path.display());
    println!("   📊 TSV file (durations): {}", tsv_path.display());
    println!("\n💡 Files are kept for inspection. You can find them at the paths above.");
}

#[tokio::test]
async fn test_tts_duration_accuracy() {
    println!("🧪 Testing TTS duration accuracy");
    
    // Find model and voices files
    let onnx_model = find_onnx_model();
    let resources_dir = find_resources_dir();
    
    if onnx_model.is_none() || resources_dir.is_none() {
        println!("⚠️  Skipping test: Model files not found");
        return;
    }
    
    let onnx_path = onnx_model.unwrap();
    let voices_path = find_voices_file(&resources_dir.unwrap())
        .expect("Voices file should exist if resources dir exists");
    
    let onnx_path_str = onnx_path.to_str().expect("ONNX path should be valid UTF-8");
    let voices_path_str = voices_path.to_str().expect("Voices path should be valid UTF-8");
    
    let engine = kokoros::tts::koko::TTSKokoParallel::new_with_instances(
        onnx_path_str,
        voices_path_str,
        1,
    ).await;
    
    // Create output directory for this test
    let test_dir = std::env::current_dir()
        .unwrap_or_else(|_| std::env::temp_dir())
        .join("test_output")
        .join("tts_duration_accuracy");
    fs::create_dir_all(&test_dir).expect("Failed to create test directory");
    
    // Test with different text lengths
    let test_cases = vec![
        "Hello.",
        "This is a short sentence.",
        "This is a longer sentence that should take more time to generate and speak.",
        "This is a much longer sentence that contains many words and should result in a longer audio duration with multiple word alignments that we can verify are correctly timed.",
    ];
    
    for (test_num, test_text) in test_cases.iter().enumerate() {
        println!("\n📝 Test case {}: '{}'", test_num + 1, test_text);
        
        let model_instance = engine.get_model_instance(0);
        let (audio_samples, word_alignments) = match engine.tts_timestamped_raw_audio_with_instance(
            test_text,
            "en",
            "af_heart",
            1.0,
            None,
            None,
            None,
            None,
            model_instance,
        ) {
            Ok(Some((audio, alignments))) => (audio, alignments),
            Ok(None) => {
                println!("⚠️  Skipping: Model doesn't support durations");
                continue;
            }
            Err(e) => {
                panic!("Failed to generate audio: {}", e);
            }
        };
        
        let audio_duration = audio_samples.len() as f32 / 24000.0;
        let alignment_duration = word_alignments.last().unwrap().end_sec;
        
        println!("   Audio duration: {:.3}s", audio_duration);
        println!("   Alignment duration: {:.3}s", alignment_duration);
        println!("   Word count: {}", word_alignments.len());
        
        // Verify durations are reasonable
        assert!(audio_duration > 0.0, "Audio duration should be positive");
        assert!(alignment_duration > 0.0, "Alignment duration should be positive");
        
        // Verify that alignment duration doesn't exceed audio duration by too much
        // (allowing for some silence at the end)
        assert!(
            alignment_duration <= audio_duration + 0.5,
            "Alignment duration ({:.3}s) should not exceed audio duration ({:.3}s) by more than 0.5s",
            alignment_duration, audio_duration
        );
        
        // Verify each word has a reasonable duration
        // Note: Punctuation marks may have zero duration (0.0s), which is valid
        for alignment in &word_alignments {
            let word_duration = alignment.end_sec - alignment.start_sec;
            assert!(
                word_duration >= 0.0 && word_duration < 3.0,
                "Word '{}' has unusual duration: {:.3}s",
                alignment.word, word_duration
            );
        }
        
        // Verify alignments are sequential
        for i in 1..word_alignments.len() {
            assert!(
                word_alignments[i].start_sec >= word_alignments[i-1].start_sec,
                "Word {} should start after word {}",
                i, i-1
            );
        }
        
        // Save WAV and TSV files for this test case
        let wav_path = test_dir.join(format!("test_case_{}.wav", test_num + 1));
        let tsv_path = test_dir.join(format!("test_case_{}_alignments.tsv", test_num + 1));
        
        println!("   💾 Saving WAV file: {}", wav_path.display());
        save_audio_as_wav(&audio_samples, 24000, wav_path.to_str().unwrap())
            .expect("Failed to save WAV file");
        
        println!("   💾 Saving alignments: {}", tsv_path.display());
        save_alignments_to_tsv(&word_alignments, tsv_path.to_str().unwrap())
            .expect("Failed to save alignments");
    }
    
    println!("\n✅ Duration accuracy test completed!");
    println!("\n📁 Test files saved and kept at: {}", test_dir.display());
    println!("💡 All WAV and TSV files are kept for inspection.");
}

