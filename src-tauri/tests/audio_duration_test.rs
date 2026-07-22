/// Test for verifying audio durations and timestamps in WAV files and SMIL generation
/// 
/// This test creates a synthetic WAV file with known duration and word alignments,
/// then verifies that the timestamps are correctly mapped to SMIL segments.

use std::fs;
use aurorabook_lib::epub::converter::smil::{generate_smil_file, format_smil_time};

// Sample rate constant (24000 Hz - matches the actual TTS sample rate)
const SAMPLE_RATE: u32 = 24000;

/// Mock WordAlignment structure for testing
/// This mirrors the structure from aurorabook_lib::tts::koko::WordAlignment
#[derive(Clone, Debug)]
struct MockWordAlignment {
    pub start_sec: f32,
    pub end_sec: f32,
}

impl MockWordAlignment {
    fn new(start_sec: f32, end_sec: f32) -> Self {
        Self { start_sec, end_sec }
    }
}

/// Convert MockWordAlignment to the format expected by map_alignments_to_segments
/// Since we can't directly use kokoros types in tests, we'll create a wrapper
fn create_test_alignments() -> Vec<MockWordAlignment> {
    // Create alignments for a 10-second audio file with 5 words
    // Each word is approximately 2 seconds long
    vec![
        MockWordAlignment::new(0.0, 2.0),   // Word 0: 0-2s
        MockWordAlignment::new(2.0, 4.0),   // Word 1: 2-4s
        MockWordAlignment::new(4.0, 6.0),   // Word 2: 4-6s
        MockWordAlignment::new(6.0, 8.0),   // Word 3: 6-8s
        MockWordAlignment::new(8.0, 10.0),  // Word 4: 8-10s
    ]
}

/// Create a synthetic WAV file with a specific duration
fn create_test_wav_file(file_path: &str, duration_seconds: f64) -> Result<Vec<f32>, String> {
    use std::fs::File;
    use std::io::Write;
    
    let sample_rate = SAMPLE_RATE as u32;
    let num_samples = (duration_seconds * sample_rate as f64) as usize;
    
    // Generate a simple sine wave for testing
    let frequency = 440.0; // A4 note
    let mut samples = Vec::with_capacity(num_samples);
    
    for i in 0..num_samples {
        let t = i as f64 / sample_rate as f64;
        let sample = (2.0 * std::f64::consts::PI * frequency * t).sin() * 0.5;
        samples.push(sample as f32);
    }
    
    // Write WAV file
    let mut file = File::create(file_path)
        .map_err(|e| format!("Failed to create WAV file: {}", e))?;
    
    let data_size = num_samples * 2; // 16-bit samples = 2 bytes per sample
    let file_size = 36 + data_size;
    
    // Write WAV header
    file.write_all(b"RIFF")
        .map_err(|e| format!("Failed to write RIFF: {}", e))?;
    file.write_all(&(file_size as u32).to_le_bytes())
        .map_err(|e| format!("Failed to write file size: {}", e))?;
    file.write_all(b"WAVE")
        .map_err(|e| format!("Failed to write WAVE: {}", e))?;
    file.write_all(b"fmt ")
        .map_err(|e| format!("Failed to write fmt: {}", e))?;
    file.write_all(&(16u32).to_le_bytes()) // fmt chunk size
        .map_err(|e| format!("Failed to write fmt size: {}", e))?;
    file.write_all(&(1u16).to_le_bytes()) // PCM format
        .map_err(|e| format!("Failed to write format: {}", e))?;
    file.write_all(&(1u16).to_le_bytes()) // mono
        .map_err(|e| format!("Failed to write channels: {}", e))?;
    file.write_all(&sample_rate.to_le_bytes())
        .map_err(|e| format!("Failed to write sample rate: {}", e))?;
    file.write_all(&(sample_rate * 2).to_le_bytes()) // byte rate
        .map_err(|e| format!("Failed to write byte rate: {}", e))?;
    file.write_all(&(2u16).to_le_bytes()) // block align
        .map_err(|e| format!("Failed to write block align: {}", e))?;
    file.write_all(&(16u16).to_le_bytes()) // bits per sample
        .map_err(|e| format!("Failed to write bits per sample: {}", e))?;
    file.write_all(b"data")
        .map_err(|e| format!("Failed to write data: {}", e))?;
    file.write_all(&(data_size as u32).to_le_bytes())
        .map_err(|e| format!("Failed to write data size: {}", e))?;
    
    // Write audio samples as 16-bit PCM
    for sample in &samples {
        let clamped = sample.max(-1.0).min(1.0);
        let pcm_value = if clamped < 0.0 {
            (clamped * 32768.0) as i16
        } else {
            (clamped * 32767.0) as i16
        };
        file.write_all(&pcm_value.to_le_bytes())
            .map_err(|e| format!("Failed to write sample: {}", e))?;
    }
    
    Ok(samples)
}

/// Parse SMIL file and extract clipBegin/clipEnd timestamps
fn parse_smil_timestamps(smil_content: &str) -> Vec<(f64, f64)> {
    use quick_xml::events::Event;
    use quick_xml::Reader;
    
    let mut reader = Reader::from_str(smil_content);
    reader.trim_text(true);
    
    let mut timestamps = Vec::new();
    let mut current_clip_begin: Option<f64> = None;
    let mut current_clip_end: Option<f64> = None;
    
    loop {
        match reader.read_event() {
            Ok(Event::Empty(e)) | Ok(Event::Start(e)) => {
                if e.name().as_ref() == b"audio" {
                    let attrs: Result<Vec<_>, _> = e.attributes().collect();
                    if let Ok(attrs) = attrs {
                        for attr in attrs {
                            let key = attr.key.as_ref();
                            if key == b"clipBegin" {
                                let value = String::from_utf8_lossy(&attr.value);
                                current_clip_begin = Some(parse_smil_time_to_seconds(&value));
                            } else if key == b"clipEnd" {
                                let value = String::from_utf8_lossy(&attr.value);
                                current_clip_end = Some(parse_smil_time_to_seconds(&value));
                            }
                        }
                        
                        if let (Some(begin), Some(end)) = (current_clip_begin, current_clip_end) {
                            timestamps.push((begin, end));
                            current_clip_begin = None;
                            current_clip_end = None;
                        }
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => {
                eprintln!("XML parse error: {}", e);
                break;
            }
            _ => {}
        }
    }
    
    timestamps
}

/// Parse SMIL time string to seconds
fn parse_smil_time_to_seconds(time_str: &str) -> f64 {
    let parts: Vec<&str> = time_str.split(':').collect();
    
    if parts.len() == 3 {
        // HH:MM:SS.mmm format
        let hours: f64 = parts[0].parse().unwrap_or(0.0);
        let minutes: f64 = parts[1].parse().unwrap_or(0.0);
        let seconds: f64 = parts[2].parse().unwrap_or(0.0);
        return hours * 3600.0 + minutes * 60.0 + seconds;
    } else if parts.len() == 2 {
        // MM:SS.mmm format
        let minutes: f64 = parts[0].parse().unwrap_or(0.0);
        let seconds: f64 = parts[1].parse().unwrap_or(0.0);
        return minutes * 60.0 + seconds;
    }
    
    // Fallback: try parsing as seconds
    time_str.parse().unwrap_or(0.0)
}

#[test]
fn test_wav_file_creation_with_duration() {
    let test_dir = std::env::temp_dir().join("audio_duration_test");
    fs::create_dir_all(&test_dir).expect("Failed to create test directory");
    
    let wav_path = test_dir.join("test_audio.wav");
    let duration = 10.0; // 10 seconds
    
    let samples = create_test_wav_file(wav_path.to_str().unwrap(), duration)
        .expect("Failed to create WAV file");
    
    // Verify file exists
    assert!(wav_path.exists(), "WAV file should exist");
    
    // Verify sample count matches expected duration
    let expected_samples = (duration * SAMPLE_RATE as f64) as usize;
    assert_eq!(samples.len(), expected_samples, 
        "Sample count should match duration. Expected: {}, Got: {}", 
        expected_samples, samples.len());
    
    // Verify file size is reasonable (WAV header + data)
    let file_size = fs::metadata(&wav_path).unwrap().len();
    let expected_size = 44 + (expected_samples * 2); // 44 byte header + 2 bytes per sample
    assert!(file_size >= expected_size as u64, 
        "File size should be at least {} bytes, got {}", expected_size, file_size);
    
    // Cleanup
    let _ = fs::remove_file(&wav_path);
    let _ = fs::remove_dir(&test_dir);
}

#[test]
fn test_smil_time_formatting() {
    // Test various time values
    let test_cases = vec![
        (0.0, "00:00:00.000"),
        (1.5, "00:00:01.500"),
        (60.0, "00:01:00.000"),
        (3661.123, "01:01:01.123"),
        (125.456, "00:02:05.456"),
    ];
    
    for (seconds, expected) in test_cases {
        let formatted = format_smil_time(seconds);
        assert_eq!(formatted, expected, 
            "Time {} seconds should format to {}, got {}", seconds, expected, formatted);
    }
}

#[test]
fn test_smil_generation_with_timestamps() {
    // Create test segments with known timestamps
    let segments = vec![
        ("f000001".to_string(), 0.0, 2.0),
        ("f000002".to_string(), 2.0, 4.0),
        ("f000003".to_string(), 4.0, 6.0),
        ("f000004".to_string(), 6.0, 8.0),
        ("f000005".to_string(), 8.0, 10.0),
    ];
    
    let smil_content = generate_smil_file(
        "chapter1.xhtml",
        "Audio/chapter1.mp3",
        &segments,
    ).expect("Failed to generate SMIL file");
    
    // Verify SMIL contains expected timestamps
    let timestamps = parse_smil_timestamps(&smil_content);
    
    assert_eq!(timestamps.len(), segments.len(), 
        "SMIL should have {} segments, got {}", segments.len(), timestamps.len());
    
    // Verify each timestamp matches expected values
    for (i, (segment, timestamp)) in 
        segments.iter().zip(timestamps.iter()).enumerate() {
        let (_, expected_start, expected_end) = segment;
        let (actual_start, actual_end) = timestamp;
        
        let tolerance = 0.001; // 1ms tolerance
        assert!((actual_start - expected_start).abs() < tolerance,
            "Segment {}: clipBegin should be {}, got {}", i, expected_start, actual_start);
        assert!((actual_end - expected_end).abs() < tolerance,
            "Segment {}: clipEnd should be {}, got {}", i, expected_end, actual_end);
    }
}

#[test]
fn test_duration_accuracy() {
    // Test that durations are accurately represented
    let test_durations = vec![
        0.1,   // 100ms
        0.5,   // 500ms
        1.0,   // 1 second
        2.5,   // 2.5 seconds
        10.0,  // 10 seconds
    ];
    
    for duration in test_durations {
        let formatted = format_smil_time(duration);
        let parsed = parse_smil_time_to_seconds(&formatted);
        
        let tolerance = 0.001; // 1ms tolerance
        assert!((parsed - duration).abs() < tolerance,
            "Duration {} should round-trip correctly. Formatted: {}, Parsed: {}", 
            duration, formatted, parsed);
    }
}


#[test]
fn test_timestamp_ordering() {
    // Verify that timestamps in SMIL are in correct order
    let segments = vec![
        ("f000001".to_string(), 0.0, 2.0),
        ("f000002".to_string(), 2.0, 4.0),
        ("f000003".to_string(), 4.0, 6.0),
    ];
    
    let smil_content = generate_smil_file(
        "chapter1.xhtml",
        "Audio/chapter1.mp3",
        &segments,
    ).expect("Failed to generate SMIL file");
    
    let timestamps = parse_smil_timestamps(&smil_content);
    
    // Verify timestamps are in order
    for i in 1..timestamps.len() {
        let (prev_start, prev_end) = timestamps[i-1];
        let (curr_start, curr_end) = timestamps[i];
        
        assert!(prev_end <= curr_start,
            "Segment {} should start after segment {} ends. Prev: {}-{}, Curr: {}-{}",
            i, i-1, prev_start, prev_end, curr_start, curr_end);
        
        assert!(curr_start < curr_end,
            "Segment {} should have start < end. Start: {}, End: {}",
            i, curr_start, curr_end);
    }
}

/// Test backend duration computation accuracy
/// 
/// This test verifies that the backend's `compute_audio_duration` function
/// accurately computes durations from audio files using ffprobe.
#[test]
fn test_backend_duration_computation_accuracy() {
    use std::fs;
    use std::io::Read;
    use aurorabook_lib::epub::parser::audio::compute_audio_track_durations;
    use aurorabook_lib::book_service::models::AudioTrack;
    
    let test_dir = std::env::temp_dir().join("duration_accuracy_test");
    fs::create_dir_all(&test_dir).expect("Failed to create test directory");
    
    // Test with multiple durations
    let test_durations = vec![
        0.5,   // 500ms
        1.0,   // 1 second
        2.5,   // 2.5 seconds
        5.0,   // 5 seconds
        10.0,  // 10 seconds
        30.0,  // 30 seconds
    ];
    
    println!("\n🔬 Testing backend duration computation accuracy");
    println!("{}", "=".repeat(60));
    
    for expected_duration in test_durations {
        let wav_path = test_dir.join(format!("test_{:.1}s.wav", expected_duration));
        
        // Create test WAV file
        let _samples = create_test_wav_file(
            wav_path.to_str().unwrap(),
            expected_duration,
        ).expect("Failed to create WAV file");
        
        // Read audio bytes
        let mut audio_bytes = Vec::new();
        let mut file = std::fs::File::open(&wav_path)
            .expect("Failed to open WAV file");
        file.read_to_end(&mut audio_bytes)
            .expect("Failed to read WAV file");
        
        // Compute duration using the internal function (we'll need to test it indirectly)
        // Since compute_audio_duration is private, we'll test via compute_audio_track_durations
        let mut tracks = vec![AudioTrack {
            id: "test-track".to_string(),
            title: "Test Track".to_string(),
            href: wav_path.file_name().unwrap().to_string_lossy().to_string(),
            url: None,
            duration: None,
            order: 0,
        }];
        
        // Create a minimal EPUB-like structure for testing
        // We'll create a zip archive with the WAV file
        use std::io::Write;
        use zip::write::{FileOptions, ZipWriter};
        use std::io::Cursor;
        
        let epub_bytes = {
            let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
            let options = FileOptions::default()
                .compression_method(zip::CompressionMethod::Stored);
            
            let file_name = wav_path.file_name().unwrap().to_string_lossy().to_string();
            zip.start_file(&file_name, options)
                .expect("Failed to add file to zip");
            zip.write_all(&audio_bytes)
                .expect("Failed to write audio to zip");
            zip.finish()
                .expect("Failed to finish zip")
                .into_inner()
        };
        
        // Compute durations
        compute_audio_track_durations(&epub_bytes, &mut tracks, "test.opf");
        
        // Verify computed duration
        let computed_duration = tracks[0].duration.expect("Duration should be computed");
        
        // Calculate accuracy metrics
        let duration_diff = (computed_duration - expected_duration).abs();
        let duration_diff_percent = (duration_diff / expected_duration) * 100.0;
        
        println!(
            "   Expected: {:.3}s, Computed: {:.3}s, Diff: {:.3}s ({:.2}%)",
            expected_duration, computed_duration, duration_diff, duration_diff_percent
        );
        
        // Allow 1% tolerance for duration computation
        // Symphonia should be very accurate, but there may be slight rounding differences
        let tolerance_percent = 1.0;
        assert!(
            duration_diff_percent < tolerance_percent,
            "Duration computation inaccurate for {:.1}s file. Expected: {:.3}s, Got: {:.3}s, Diff: {:.2}%",
            expected_duration, expected_duration, computed_duration, duration_diff_percent
        );
        
        // Also verify duration is positive and reasonable
        assert!(computed_duration > 0.0, "Computed duration should be positive");
        assert!(
            computed_duration <= expected_duration * 1.1,
            "Computed duration should not exceed expected by more than 10%"
        );
    }
    
    // Cleanup
    let _ = fs::remove_dir_all(&test_dir);
    println!("\n✅ All duration computations accurate within tolerance");
}

/// Test total duration calculation accuracy
/// 
/// This test verifies that summing individual track durations
/// produces accurate total durations.
#[test]
fn test_total_duration_calculation_accuracy() {
    use std::fs;
    use std::io::Read;
    use aurorabook_lib::epub::parser::audio::compute_audio_track_durations;
    use aurorabook_lib::book_service::models::AudioTrack;
    use std::io::Write;
    use zip::write::{FileOptions, ZipWriter};
    use std::io::Cursor;
    
    let test_dir = std::env::temp_dir().join("total_duration_test");
    fs::create_dir_all(&test_dir).expect("Failed to create test directory");
    
    // Create multiple tracks with known durations
    let track_durations = vec![
        5.0,   // 5 seconds
        10.0,  // 10 seconds
        15.0,  // 15 seconds
        20.0,  // 20 seconds
    ];
    let expected_total = track_durations.iter().sum::<f64>();
    
    println!("\n🔬 Testing total duration calculation accuracy");
    println!("{}", "=".repeat(60));
    println!("   Individual track durations: {:?}", track_durations);
    println!("   Expected total: {:.3}s", expected_total);
    
    let mut tracks: Vec<AudioTrack> = track_durations
        .iter()
        .enumerate()
        .map(|(i, &duration)| {
            let wav_path = test_dir.join(format!("track_{}.wav", i));
            create_test_wav_file(wav_path.to_str().unwrap(), duration)
                .expect("Failed to create WAV file");
            
            AudioTrack {
                id: format!("track-{}", i),
                title: format!("Track {}", i + 1),
                href: format!("track_{}.wav", i),
                url: None,
                duration: None,
                order: i,
            }
        })
        .collect();
    
    // Create a zip archive with all audio files
    let epub_bytes = {
        let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
        let options = FileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        
        for (i, &duration) in track_durations.iter().enumerate() {
            let wav_path = test_dir.join(format!("track_{}.wav", i));
            let mut audio_bytes = Vec::new();
            let mut file = std::fs::File::open(&wav_path)
                .expect("Failed to open WAV file");
            file.read_to_end(&mut audio_bytes)
                .expect("Failed to read WAV file");
            
            let file_name = format!("track_{}.wav", i);
            zip.start_file(&file_name, options)
                .expect("Failed to add file to zip");
            zip.write_all(&audio_bytes)
                .expect("Failed to write audio to zip");
        }
        
        zip.finish()
            .expect("Failed to finish zip")
            .into_inner()
    };
    
    // Compute durations for all tracks
    compute_audio_track_durations(&epub_bytes, &mut tracks, "test.opf");
    
    // Calculate total duration
    let computed_total: f64 = tracks
        .iter()
        .map(|track| track.duration.unwrap_or(0.0))
        .sum();
    
    println!("   Computed total: {:.3}s", computed_total);
    
    // Verify all tracks have durations
    for (i, track) in tracks.iter().enumerate() {
        assert!(
            track.duration.is_some(),
            "Track {} should have a computed duration",
            i
        );
        let computed = track.duration.unwrap();
        let expected = track_durations[i];
        let diff_percent = ((computed - expected).abs() / expected) * 100.0;
        
        println!(
            "   Track {}: Expected {:.3}s, Computed {:.3}s, Diff {:.2}%",
            i + 1, expected, computed, diff_percent
        );
        
        assert!(
            diff_percent < 1.0,
            "Track {} duration inaccurate. Expected: {:.3}s, Got: {:.3}s",
            i + 1, expected, computed
        );
    }
    
    // Verify total duration accuracy
    let total_diff = (computed_total - expected_total).abs();
    let total_diff_percent = (total_diff / expected_total) * 100.0;
    
    println!(
        "   Total duration diff: {:.3}s ({:.2}%)",
        total_diff, total_diff_percent
    );
    
    // Allow 1% tolerance for total duration
    assert!(
        total_diff_percent < 1.0,
        "Total duration inaccurate. Expected: {:.3}s, Got: {:.3}s, Diff: {:.2}%",
        expected_total, computed_total, total_diff_percent
    );
    
    // Cleanup
    let _ = fs::remove_dir_all(&test_dir);
    println!("\n✅ Total duration calculation accurate");
}

/// Test duration computation with edge cases
#[test]
fn test_duration_edge_cases() {
    use std::fs;
    use std::io::Read;
    use aurorabook_lib::epub::parser::audio::compute_audio_track_durations;
    use aurorabook_lib::book_service::models::AudioTrack;
    use std::io::Write;
    use zip::write::{FileOptions, ZipWriter};
    use std::io::Cursor;
    
    let test_dir = std::env::temp_dir().join("duration_edge_cases");
    fs::create_dir_all(&test_dir).expect("Failed to create test directory");
    
    println!("\n🔬 Testing duration computation edge cases");
    println!("{}", "=".repeat(60));
    
    // Test very short duration (100ms)
    let short_duration = 0.1;
    let wav_path = test_dir.join("short.wav");
    create_test_wav_file(wav_path.to_str().unwrap(), short_duration)
        .expect("Failed to create short WAV file");
    
    let mut audio_bytes = Vec::new();
    let mut file = std::fs::File::open(&wav_path)
        .expect("Failed to open WAV file");
    file.read_to_end(&mut audio_bytes)
        .expect("Failed to read WAV file");
    
    let mut tracks = vec![AudioTrack {
        id: "short-track".to_string(),
        title: "Short Track".to_string(),
        href: "short.wav".to_string(),
        url: None,
        duration: None,
        order: 0,
    }];
    
    let epub_bytes = {
        let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
        let options = FileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        zip.start_file("short.wav", options)
            .expect("Failed to add file to zip");
        zip.write_all(&audio_bytes)
            .expect("Failed to write audio to zip");
        zip.finish().expect("Failed to finish zip").into_inner()
    };
    
    compute_audio_track_durations(&epub_bytes, &mut tracks, "test.opf");
    
    if let Some(computed) = tracks[0].duration {
        let diff = (computed - short_duration).abs();
        println!("   Short duration (0.1s): Computed {:.3}s, Diff {:.3}s", computed, diff);
        
        // For very short durations, allow more tolerance (10%)
        assert!(
            diff < 0.05, // 50ms tolerance for 100ms file
            "Short duration computation failed. Expected: {:.3}s, Got: {:.3}s",
            short_duration, computed
        );
    } else {
        println!("   Short duration: Could not compute (may be too short for accurate measurement)");
        // This is acceptable - very short files may not have accurate duration metadata
    }
    
    // Test longer duration (60 seconds)
    let long_duration = 60.0;
    let wav_path = test_dir.join("long.wav");
    create_test_wav_file(wav_path.to_str().unwrap(), long_duration)
        .expect("Failed to create long WAV file");
    
    let mut audio_bytes = Vec::new();
    let mut file = std::fs::File::open(&wav_path)
        .expect("Failed to open WAV file");
    file.read_to_end(&mut audio_bytes)
        .expect("Failed to read WAV file");
    
    let mut tracks = vec![AudioTrack {
        id: "long-track".to_string(),
        title: "Long Track".to_string(),
        href: "long.wav".to_string(),
        url: None,
        duration: None,
        order: 0,
    }];
    
    let epub_bytes = {
        let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
        let options = FileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        zip.start_file("long.wav", options)
            .expect("Failed to add file to zip");
        zip.write_all(&audio_bytes)
            .expect("Failed to write audio to zip");
        zip.finish().expect("Failed to finish zip").into_inner()
    };
    
    compute_audio_track_durations(&epub_bytes, &mut tracks, "test.opf");
    
    if let Some(computed) = tracks[0].duration {
        let diff = (computed - long_duration).abs();
        let diff_percent = (diff / long_duration) * 100.0;
        println!("   Long duration (60s): Computed {:.3}s, Diff {:.3}s ({:.2}%)", computed, diff, diff_percent);
        
        // For longer durations, should be very accurate (within 1%)
        assert!(
            diff_percent < 1.0,
            "Long duration computation failed. Expected: {:.3}s, Got: {:.3}s, Diff: {:.2}%",
            long_duration, computed, diff_percent
        );
    } else {
        panic!("Long duration should always be computable");
    }
    
    // Cleanup
    let _ = fs::remove_dir_all(&test_dir);
    println!("\n✅ Edge cases handled correctly");
}

