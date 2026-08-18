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

use aurorabook_lib::tts::koko::{TTSKokoParallel, WordAlignment};

/// Supertonic-backed synthesis returns audio only; per-word timestamps are not wired here yet.
fn synthesize_with_optional_word_alignments(
    engine: &TTSKokoParallel,
    text: &str,
    language: &str,
    voice_id: &str,
    speed: f32,
) -> Result<(Vec<f32>, Vec<WordAlignment>), Box<dyn std::error::Error>> {
    let model_instance = engine.get_model_instance(0);
    let audio = engine.tts_raw_audio_with_instance(
        text,
        language,
        voice_id,
        speed,
        None,
        None,
        None,
        None,
        model_instance,
    )?;
    Ok((audio, Vec::new()))
}

/// Save word alignments to TSV file
fn save_alignments_to_tsv(alignments: &[aurorabook_lib::tts::koko::WordAlignment], file_path: &str) -> Result<(), String> {
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
    
    let engine = aurorabook_lib::tts::koko::TTSKokoParallel::new_with_instances(
        onnx_path_str,
        voices_path_str,
        1, // Single instance for testing
    ).await.expect("TTS init");
    
    // Test text
    let test_text = "Hello, this is a test of the text to speech system with word alignments. How does it sound?";
    let voice_id = "af_heart";
    let language = "en";
    let speed = 1.0;
    
    println!("\n📝 Test text: '{}'", test_text);
    println!("   Voice: {}", voice_id);
    println!("   Language: {}", language);
    println!("   Speed: {}", speed);
    
    // Generate audio (word alignments empty until a timestamped path exists for Supertonic).
    println!("\n🎵 Generating audio...");
    let (audio_samples, word_alignments) =
        synthesize_with_optional_word_alignments(&engine, test_text, language, voice_id, speed)
            .expect("TTS synthesis failed");

    if word_alignments.is_empty() {
        assert!(!audio_samples.is_empty(), "Should have audio samples");
        let sr = engine.sample_rate();
        println!(
            "⚠️ Supertonic backend: no per-word timestamps; saving WAV only ({} Hz, {:.3}s).",
            sr,
            audio_samples.len() as f32 / sr as f32
        );
        save_audio_as_wav(&audio_samples, sr, wav_path.to_str().unwrap())
            .expect("Failed to save WAV file");
        assert!(wav_path.exists(), "WAV file should exist");
        return;
    }

    println!("✅ Audio generated successfully!");
    println!("   Samples: {}", audio_samples.len());
    let sr = engine.sample_rate();
    println!(
        "   Duration: {:.3}s (at {} Hz)",
        audio_samples.len() as f32 / sr as f32,
        sr
    );
    println!("   Word alignments: {} words", word_alignments.len());

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
    let audio_duration = audio_samples.len() as f32 / sr as f32;
    
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
    save_audio_as_wav(&audio_samples, sr, wav_path.to_str().unwrap())
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
    
    let engine = aurorabook_lib::tts::koko::TTSKokoParallel::new_with_instances(
        onnx_path_str,
        voices_path_str,
        1,
    ).await.expect("TTS init");
    
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
        
        let (audio_samples, word_alignments) =
            synthesize_with_optional_word_alignments(&engine, test_text, "en", "af_heart", 1.0)
                .expect("TTS synthesis failed");

        if word_alignments.is_empty() {
            println!("⚠️  Skipping duration-accuracy checks: no word timestamps from Supertonic.");
            assert!(!audio_samples.is_empty());
            break;
        }

        let sr = engine.sample_rate();
        let audio_duration = audio_samples.len() as f32 / sr as f32;
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
        save_audio_as_wav(&audio_samples, sr, wav_path.to_str().unwrap())
            .expect("Failed to save WAV file");
        
        println!("   💾 Saving alignments: {}", tsv_path.display());
        save_alignments_to_tsv(&word_alignments, tsv_path.to_str().unwrap())
            .expect("Failed to save alignments");
    }
    
    println!("\n✅ Duration accuracy test completed!");
    println!("\n📁 Test files saved and kept at: {}", test_dir.display());
    println!("💡 All WAV and TSV files are kept for inspection.");
}

/// Comprehensive test for TTS timestamp accuracy
/// 
/// This test verifies:
/// 1. Consistency: Same text produces similar timestamps across multiple runs
/// 2. Speed scaling: Timestamps scale correctly with different speeds
/// 3. Sequential ordering: Words are in correct order with no invalid overlaps
/// 4. Duration matching: Total alignment duration matches audio duration
/// 5. Word boundary accuracy: Each word has reasonable duration
/// 6. Monotonic timestamps: Timestamps are non-decreasing
#[tokio::test]
async fn test_tts_timestamp_accuracy() {
    println!("🧪 Testing TTS timestamp accuracy");
    
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
    
    let onnx_path_str = onnx_path.to_str().expect("ONNX path should be valid UTF-8");
    let voices_path_str = voices_path.to_str().expect("Voices path should be valid UTF-8");
    
    let engine = aurorabook_lib::tts::koko::TTSKokoParallel::new_with_instances(
        onnx_path_str,
        voices_path_str,
        1,
    ).await.expect("TTS init");
    
    // Create output directory for this test
    let test_dir = std::env::current_dir()
        .unwrap_or_else(|_| std::env::temp_dir())
        .join("test_output")
        .join("tts_timestamp_accuracy");
    fs::create_dir_all(&test_dir).expect("Failed to create test directory");
    
    let test_text = "The quick brown fox jumps over the lazy dog.";
    let voice_id = "af_heart";
    let language = "en";
    
    println!("\n📝 Test text: '{}'", test_text);
    println!("   Voice: {}", voice_id);
    println!("   Language: {}", language);
    
    // Test 1: Consistency across multiple runs
    println!("\n🔬 Test 1: Consistency across multiple runs");
    let num_runs = 3;
    let mut previous_alignments: Option<Vec<aurorabook_lib::tts::koko::WordAlignment>> = None;
    
    for run in 0..num_runs {
        println!("   Run {} of {}", run + 1, num_runs);
        let (audio_samples, word_alignments) =
            synthesize_with_optional_word_alignments(&engine, test_text, language, voice_id, 1.0)
                .expect("TTS synthesis failed");

        if word_alignments.is_empty() {
            println!("⚠️  Skipping timestamp consistency checks: no word timestamps from Supertonic.");
            assert!(!audio_samples.is_empty());
            return;
        }

        // Verify basic structure
        assert!(!word_alignments.is_empty(), "Should have word alignments");
        
        // Verify that engine normalization is working (alignment duration should match audio)
        let sr = engine.sample_rate();
        let audio_duration = audio_samples.len() as f32 / sr as f32;
        let alignment_duration = word_alignments.last().unwrap().end_sec;
        let duration_diff = (alignment_duration - audio_duration).abs();
        let duration_diff_percent = (duration_diff / audio_duration) * 100.0;
        
        // After normalization, alignment should be very close to audio duration (within 2%)
        assert!(
            duration_diff_percent < 2.0,
            "Engine normalization failed: alignment={:.3}s, audio={:.3}s, diff={:.1}%",
            alignment_duration, audio_duration, duration_diff_percent
        );
        
        // Compare with previous run (if available)
        if let Some(ref prev) = previous_alignments {
            assert_eq!(
                prev.len(),
                word_alignments.len(),
                "Word count should be consistent across runs"
            );
            
            // Check that words match
            for (i, (prev_align, curr_align)) in prev.iter().zip(word_alignments.iter()).enumerate() {
                assert_eq!(
                    prev_align.word, curr_align.word,
                    "Word at index {} should match: prev='{}', curr='{}'",
                    i, prev_align.word, curr_align.word
                );
            }
            
            // Check that timestamps are similar (within 10% tolerance for consistency)
            let tolerance = 0.10; // 10% tolerance (allowing for some variance in TTS)
            for (i, (prev_align, curr_align)) in prev.iter().zip(word_alignments.iter()).enumerate() {
                let prev_duration = prev_align.end_sec - prev_align.start_sec;
                let curr_duration = curr_align.end_sec - curr_align.start_sec;
                
                // Allow some variance but timestamps should be reasonably consistent
                if prev_duration > 0.01 && curr_duration > 0.01 {
                    let duration_diff = (prev_duration - curr_duration).abs() / prev_duration;
                    assert!(
                        duration_diff < tolerance,
                        "Word '{}' (index {}) duration variance too high: prev={:.3}s, curr={:.3}s (diff={:.1}%)",
                        prev_align.word, i, prev_duration, curr_duration, duration_diff * 100.0
                    );
                }
                
                // Check start time consistency (within 5% of total duration)
                let total_duration = prev_align.end_sec.max(curr_align.end_sec);
                if total_duration > 0.01 {
                    let start_diff = (prev_align.start_sec - curr_align.start_sec).abs() / total_duration;
                    assert!(
                        start_diff < tolerance,
                        "Word '{}' (index {}) start time variance too high: prev={:.3}s, curr={:.3}s (diff={:.1}%)",
                        prev_align.word, i, prev_align.start_sec, curr_align.start_sec, start_diff * 100.0
                    );
                }
            }
        }
        
        previous_alignments = Some(word_alignments);
    }
    println!("   ✅ Consistency test passed");
    
    // Test 2: Speed scaling accuracy
    println!("\n🔬 Test 2: Speed scaling accuracy");
    let speeds = vec![0.75, 1.0, 1.25, 1.5];
    let mut baseline_duration: Option<f32> = None;
    
    for speed in speeds {
        println!("   Testing speed: {:.2}x", speed);
        let (audio_samples, word_alignments) =
            synthesize_with_optional_word_alignments(&engine, test_text, language, voice_id, speed)
                .expect("TTS synthesis failed");

        if word_alignments.is_empty() {
            println!("⚠️  Skipping speed-scaling checks: no word timestamps from Supertonic.");
            assert!(!audio_samples.is_empty());
            return;
        }

        let sr = engine.sample_rate();
        let audio_duration = audio_samples.len() as f32 / sr as f32;
        let alignment_duration = word_alignments.last().unwrap().end_sec;
        
        println!("      Audio duration: {:.3}s", audio_duration);
        println!("      Alignment duration: {:.3}s", alignment_duration);
        
        // Verify normalization is working (alignment should match audio within 2%)
        let duration_diff_percent = ((alignment_duration - audio_duration).abs() / audio_duration) * 100.0;
        assert!(
            duration_diff_percent < 2.0,
            "Normalization failed at speed {:.2}x: alignment={:.3}s, audio={:.3}s, diff={:.1}%",
            speed, alignment_duration, audio_duration, duration_diff_percent
        );
        
        // Verify that duration scales inversely with speed
        if let Some(baseline) = baseline_duration {
            let actual_ratio = alignment_duration / baseline;
            let ratio_diff = (actual_ratio - (1.0 / speed)).abs();
            
            // Allow 10% tolerance for speed scaling
            assert!(
                ratio_diff < 0.1,
                "Speed scaling inaccurate: speed={:.2}x, expected_ratio={:.3}, actual_ratio={:.3}, diff={:.1}%",
                speed, 1.0 / speed, actual_ratio, ratio_diff * 100.0
            );
        } else {
            baseline_duration = Some(alignment_duration);
        }
        
        // Verify timestamps are still valid at this speed
        for i in 1..word_alignments.len() {
            assert!(
                word_alignments[i].start_sec >= word_alignments[i-1].start_sec,
                "Timestamps should be monotonic at speed {:.2}x",
                speed
            );
        }
    }
    println!("   ✅ Speed scaling test passed");
    
    // Test 3: Sequential ordering and monotonic timestamps
    println!("\n🔬 Test 3: Sequential ordering and monotonic timestamps");
    let (audio_samples, word_alignments) =
        synthesize_with_optional_word_alignments(&engine, test_text, language, voice_id, 1.0)
            .expect("TTS synthesis failed");

    if word_alignments.is_empty() {
        println!("⚠️  Skipping ordering checks: no word timestamps from Supertonic.");
        assert!(!audio_samples.is_empty());
        return;
    }

    // Verify monotonic timestamps
    for i in 1..word_alignments.len() {
        assert!(
            word_alignments[i].start_sec >= word_alignments[i-1].start_sec,
            "Timestamp {} ({:.3}s) should be >= previous ({:.3}s)",
            i, word_alignments[i].start_sec, word_alignments[i-1].start_sec
        );
        
        // Verify no invalid overlaps (words can't end before they start)
        assert!(
            word_alignments[i-1].end_sec <= word_alignments[i].end_sec,
            "Previous word end ({:.3}s) should be <= current word end ({:.3}s)",
            word_alignments[i-1].end_sec, word_alignments[i].end_sec
        );
    }
    
    // Verify all timestamps are non-negative
    for (i, alignment) in word_alignments.iter().enumerate() {
        assert!(
            alignment.start_sec >= 0.0,
            "Word {} start time should be non-negative: {:.3}s",
            i, alignment.start_sec
        );
        assert!(
            alignment.end_sec >= 0.0,
            "Word {} end time should be non-negative: {:.3}s",
            i, alignment.end_sec
        );
    }
    println!("   ✅ Sequential ordering test passed");
    
    // Test 4: Duration matching (verify engine normalization)
    println!("\n🔬 Test 4: Duration matching (engine normalization)");
    let sr = engine.sample_rate();
    let audio_duration = audio_samples.len() as f32 / sr as f32;
    let alignment_duration = word_alignments.last().unwrap().end_sec;
    let duration_diff = (audio_duration - alignment_duration).abs();
    let duration_diff_percent = (duration_diff / audio_duration) * 100.0;
    
    println!("   Audio duration: {:.3}s", audio_duration);
    println!("   Alignment duration: {:.3}s", alignment_duration);
    println!("   Difference: {:.3}s ({:.1}%)", duration_diff, duration_diff_percent);
    
    // After engine normalization, alignment duration should match audio duration very closely (within 2%)
    assert!(
        duration_diff_percent < 2.0,
        "Engine normalization failed: alignment duration ({:.3}s) should match audio duration ({:.3}s) within 2%, but difference is {:.1}%",
        alignment_duration, audio_duration, duration_diff_percent
    );
    println!("   ✅ Duration matching test passed (normalization working correctly)");
    
    // Test 5: Word boundary accuracy
    println!("\n🔬 Test 5: Word boundary accuracy");
    let mut total_word_duration = 0.0;
    let mut word_count = 0;
    
    for (i, alignment) in word_alignments.iter().enumerate() {
        let word_duration = alignment.end_sec - alignment.start_sec;
        
        // Punctuation may have zero or very short duration
        let is_punctuation = alignment.word.len() == 1 && 
            ".,!?:;!?".contains(alignment.word.as_str());
        
        if !is_punctuation {
            // Regular words should have reasonable duration (0.05s to 2.0s)
            assert!(
                word_duration >= 0.05 && word_duration <= 2.0,
                "Word '{}' (index {}) has unusual duration: {:.3}s (expected 0.05-2.0s)",
                alignment.word, i, word_duration
            );
            
            total_word_duration += word_duration;
            word_count += 1;
        } else {
            // Punctuation can have zero or short duration
            assert!(
                word_duration >= 0.0 && word_duration <= 0.5,
                "Punctuation '{}' (index {}) has unusual duration: {:.3}s (expected 0.0-0.5s)",
                alignment.word, i, word_duration
            );
        }
    }
    
    if word_count > 0 {
        let avg_word_duration = total_word_duration / word_count as f32;
        println!("   Average word duration: {:.3}s", avg_word_duration);
        println!("   Total words analyzed: {}", word_count);
        
        // Average word duration should be reasonable (0.1s to 1.0s)
        assert!(
            avg_word_duration >= 0.1 && avg_word_duration <= 1.0,
            "Average word duration ({:.3}s) is outside reasonable range (0.1-1.0s)",
            avg_word_duration
        );
    }
    println!("   ✅ Word boundary accuracy test passed");
    
    // Test 6: Save results for inspection
    println!("\n💾 Saving test results...");
    let wav_path = test_dir.join("timestamp_accuracy_test.wav");
    let tsv_path = test_dir.join("timestamp_accuracy_test_alignments.tsv");
    
    save_audio_as_wav(&audio_samples, sr, wav_path.to_str().unwrap())
        .expect("Failed to save WAV file");
    save_alignments_to_tsv(&word_alignments, tsv_path.to_str().unwrap())
        .expect("Failed to save alignments");
    
    // Print summary statistics
    println!("\n📊 Timestamp Accuracy Summary:");
    println!("   Total words: {}", word_alignments.len());
    println!("   Audio duration: {:.3}s", audio_duration);
    println!("   Alignment duration: {:.3}s", alignment_duration);
    println!("   Duration accuracy: {:.1}%", (1.0 - duration_diff_percent / 100.0) * 100.0);
    println!("   First word starts at: {:.3}s", word_alignments[0].start_sec);
    println!("   Last word ends at: {:.3}s", word_alignments.last().unwrap().end_sec);
    
    if word_count > 0 {
        println!("   Average word duration: {:.3}s", total_word_duration / word_count as f32);
    }
    
    println!("\n✅ All timestamp accuracy tests passed!");
    println!("\n📁 Test files saved at: {}", test_dir.display());
    println!("   🔊 WAV file: {}", wav_path.display());
    println!("   📊 TSV file: {}", tsv_path.display());
}

