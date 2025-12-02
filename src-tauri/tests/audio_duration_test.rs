/// Test for verifying audio durations and timestamps in WAV files and SMIL generation
/// 
/// This test creates a synthetic WAV file with known duration and word alignments,
/// then verifies that the timestamps are correctly mapped to SMIL segments.

use std::fs;
use aurorabook_lib::epub::converter::smil::{generate_smil_file, format_smil_time};

// Sample rate constant (24000 Hz - matches the actual TTS sample rate)
const SAMPLE_RATE: u32 = 24000;

/// Mock WordAlignment structure for testing
/// This mirrors the structure from kokoros::tts::koko::WordAlignment
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

