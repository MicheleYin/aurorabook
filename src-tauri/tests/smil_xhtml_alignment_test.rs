/// Test for verifying SMIL and XHTML alignment
/// 
/// This test verifies that:
/// 1. All span IDs in the SMIL file exist in the generated XHTML
/// 2. The counts match between SMIL segments and HTML spans
/// 3. No orphaned segments are created

use std::fs;
use std::path::Path;
use aurorabook_lib::epub::converter::chunking::{extract_text_with_spans, extract_all_sentences};
use aurorabook_lib::epub::converter::smil::{generate_smil_file, parse_smil_file};
use regex::Regex;
use once_cell::sync::Lazy;

mod helpers;
use helpers::*;

static SPAN_ID_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"<span\s+id="(f\d{6})""#).expect("Failed to compile span ID regex")
});

static SMIL_TEXT_SRC_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"<text\s+src="[^"]*#(f\d{6})""#).expect("Failed to compile SMIL text src regex")
});

#[test]
fn test_prologue_smil_xhtml_alignment() {
    // Read the original prologue.xhtml
    // Try multiple possible paths relative to project root
    let possible_paths = vec![
        Path::new("sample_audio/That_Time_I_Got_Reincarnated_as_a_Slime__Vol__1/OEBPS/prologue.xhtml"),
        Path::new("../sample_audio/That_Time_I_Got_Reincarnated_as_a_Slime__Vol__1/OEBPS/prologue.xhtml"),
    ];
    
    let prologue_path = possible_paths.iter()
        .find(|p| p.exists())
        .copied();
    
    let prologue_path = match prologue_path {
        Some(p) => p,
        None => {
            eprintln!("Skipping test: prologue.xhtml not found. Tried: {:?}", possible_paths);
            return;
        }
    };
    
    let original_html = fs::read_to_string(prologue_path)
        .expect("Failed to read prologue.xhtml");
    
    // Extract text with spans (simulating the conversion process)
    // Pass None to let it extract spans internally
    let (extracted_full_text, updated_html_with_spans, extracted_span_mappings) = 
        extract_text_with_spans(&original_html, None)
            .expect("Failed to extract text with spans");
    
    // Extract actual span IDs from the generated HTML
    let mut actual_span_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
    for cap in SPAN_ID_PATTERN.captures_iter(&updated_html_with_spans) {
        if let Some(span_id) = cap.get(1) {
            actual_span_ids.insert(span_id.as_str().to_string());
        }
    }
    
    // Filter span_mappings to only include spans that actually exist in the HTML
    let total_mappings = extracted_span_mappings.len();
    let filtered_span_mappings: Vec<(String, usize, usize)> = extracted_span_mappings
        .into_iter()
        .filter(|(span_id, _, _)| actual_span_ids.contains(span_id))
        .collect();
    
    println!("Total span mappings: {}", total_mappings);
    println!("Spans in HTML: {}", actual_span_ids.len());
    println!("Filtered span mappings: {}", filtered_span_mappings.len());
    
    // Create mock word alignments for testing
    // In a real scenario, these would come from TTS processing
    let text_words: Vec<&str> = extracted_full_text.split_whitespace().filter(|s| !s.is_empty()).collect();
    let word_count = text_words.len();
    
    // Create synthetic word alignments (each word gets 0.5 seconds)
    // We'll create a simple struct that matches WordAlignment
    #[derive(Clone)]
    struct MockWordAlignment {
        word: String,
        start_sec: f32,
        end_sec: f32,
    }
    
    let mut mock_alignments = Vec::new();
    for i in 0..word_count {
        mock_alignments.push(MockWordAlignment {
            word: text_words[i].to_string(),
            start_sec: i as f32 * 0.5,
            end_sec: (i + 1) as f32 * 0.5,
        });
    }
    
    // Convert to the format expected by map_alignments_to_segments
    // Since we can't easily use kokoros types in tests, we'll adapt the function
    let word_alignments: Vec<(f32, f32)> = mock_alignments.iter()
        .map(|wa| (wa.start_sec, wa.end_sec))
        .collect();
    
    // Create mock audio samples (1 second per word)
    let sample_rate = 24000;
    let total_samples = (word_count as f32 * 0.5 * sample_rate as f32) as usize;
    let audio_samples = vec![0.0f32; total_samples];
    
    // Map alignments to segments (simulating the conversion process)
    let audio_segments = map_alignments_to_segments(
        filtered_span_mappings.clone(),
        &word_alignments,
        &audio_samples,
        &extracted_full_text,
    );
    
    println!("Audio segments created: {}", audio_segments.len());
    
    // Generate SMIL file
    let chapter_href = "prologue.xhtml";
    let audio_href = "Audio/prologue.mp3";
    let smil_content = generate_smil_file(chapter_href, audio_href, &audio_segments)
        .expect("Failed to generate SMIL file");
    
    // Parse the SMIL file to extract segment IDs
    let parsed_segments = parse_smil_file(&smil_content, chapter_href)
        .expect("Failed to parse SMIL file");
    
    println!("Parsed SMIL segments: {}", parsed_segments.len());
    
    // Extract span IDs from SMIL using regex as well
    let mut smil_span_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
    for cap in SMIL_TEXT_SRC_PATTERN.captures_iter(&smil_content) {
        if let Some(span_id) = cap.get(1) {
            smil_span_ids.insert(span_id.as_str().to_string());
        }
    }
    
    println!("Unique span IDs in SMIL: {}", smil_span_ids.len());
    
    // Verify all SMIL segment IDs exist in the HTML
    let mut missing_ids = Vec::new();
    for segment in &parsed_segments {
        if !actual_span_ids.contains(&segment.text_element_id) {
            missing_ids.push(segment.text_element_id.clone());
        }
    }
    
    // Also check regex-extracted IDs
    for span_id in &smil_span_ids {
        if !actual_span_ids.contains(span_id) {
            if !missing_ids.contains(span_id) {
                missing_ids.push(span_id.clone());
            }
        }
    }
    
    // Assertions
    assert_eq!(
        audio_segments.len(),
        filtered_span_mappings.len(),
        "Audio segments count should match filtered span mappings count"
    );
    
    assert_eq!(
        parsed_segments.len(),
        audio_segments.len(),
        "Parsed SMIL segments should match generated segments"
    );
    
    assert_eq!(
        smil_span_ids.len(),
        actual_span_ids.len(),
        "Unique span IDs in SMIL should match spans in HTML"
    );
    
    assert!(
        missing_ids.is_empty(),
        "Found {} span IDs in SMIL that don't exist in HTML: {:?}",
        missing_ids.len(),
        missing_ids.iter().take(10).collect::<Vec<_>>()
    );
    
    // Verify all HTML spans have corresponding SMIL segments
    let mut missing_in_smil = Vec::new();
    for span_id in &actual_span_ids {
        if !smil_span_ids.contains(span_id) {
            missing_in_smil.push(span_id.clone());
        }
    }
    
    // Note: It's okay if some HTML spans don't have SMIL segments (they might be empty or skipped)
    // But we should log it for visibility
    if !missing_in_smil.is_empty() {
        println!("Warning: {} HTML spans don't have SMIL segments: {:?}", 
            missing_in_smil.len(),
            missing_in_smil.iter().take(10).collect::<Vec<_>>()
        );
    }
    
    println!("✓ All SMIL segment IDs exist in HTML");
    println!("✓ Counts match: {} segments, {} HTML spans", 
        parsed_segments.len(), 
        actual_span_ids.len()
    );
}

// Helper function to map alignments to segments (adapted for testing)
fn map_alignments_to_segments(
    span_mappings: Vec<(String, usize, usize)>,
    word_alignments: &[(f32, f32)],  // (start_sec, end_sec) tuples
    audio_samples: &[f32],
    full_text: &str,
) -> Vec<(String, f64, f64)> {
    const SAMPLE_RATE: usize = 24000;
    
    let text_words: Vec<&str> = full_text.split_whitespace().filter(|s| !s.is_empty()).collect();
    let mut audio_segments = Vec::new();
    
    for (span_id, start_word_idx, end_word_idx) in span_mappings {
        let mut span_start_time: Option<f64> = None;
        let mut span_end_time: Option<f64> = None;
        
        let alignment_count = word_alignments.len();
        let text_word_count = text_words.len();
        
        if alignment_count > 0 && text_word_count > 0 {
            let alignments_per_word = alignment_count as f64 / text_word_count as f64;
            let start_alignment_idx = (start_word_idx as f64 * alignments_per_word).floor() as usize;
            let end_alignment_idx = ((end_word_idx as f64 * alignments_per_word).ceil() as usize).min(alignment_count);
            
            if start_alignment_idx < alignment_count {
                span_start_time = Some(word_alignments[start_alignment_idx].0 as f64);
            }
            if end_alignment_idx > 0 && end_alignment_idx <= alignment_count {
                span_end_time = Some(word_alignments[end_alignment_idx - 1].1 as f64);
            }
        }
        
        let (start_time, end_time) = match (span_start_time, span_end_time) {
            (Some(start), Some(end)) => (start, end),
            (Some(start), None) => {
                let end = if !word_alignments.is_empty() {
                    word_alignments.last().unwrap().1 as f64
                } else {
                    audio_samples.len() as f64 / SAMPLE_RATE as f64
                };
                (start, end)
            }
            (None, Some(end)) => (0.0, end),
            (None, None) => {
                let total_duration = if !word_alignments.is_empty() {
                    word_alignments.last().unwrap().1 as f64
                } else {
                    audio_samples.len() as f64 / SAMPLE_RATE as f64
                };
                let total_words = text_words.len().max(1);
                let duration_per_word = total_duration / total_words as f64;
                let estimated_start = (start_word_idx as f64) * duration_per_word;
                let estimated_end = (end_word_idx as f64) * duration_per_word;
                (estimated_start, estimated_end)
            }
        };
        
        audio_segments.push((span_id, start_time, end_time));
    }
    
    audio_segments
}

#[tokio::test]
async fn test_prologue_with_real_tts() {
    use std::path::PathBuf;
    
    // Initialize logger
    let _ = env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).try_init();
    
    println!("\n🧪 Testing prologue with real TTS engine");
    println!("{}", "=".repeat(60));
    
    // Find the prologue.xhtml file
    let possible_paths = vec![
        PathBuf::from("sample_audio/That_Time_I_Got_Reincarnated_as_a_Slime__Vol__1/OEBPS/prologue.xhtml"),
        PathBuf::from("../sample_audio/That_Time_I_Got_Reincarnated_as_a_Slime__Vol__1/OEBPS/prologue.xhtml"),
    ];
    
    let prologue_path = possible_paths.iter()
        .find(|p| p.exists())
        .map(|p| p.clone());
    
    let prologue_path = match prologue_path {
        Some(p) => {
            println!("✅ Found prologue.xhtml: {}", p.display());
            p
        }
        None => {
            println!("⚠️ Skipping test: prologue.xhtml not found");
            return;
        }
    };
    
    // Find TTS resources
    let onnx_model = match find_onnx_model() {
        Some(path) => {
            println!("✅ Found ONNX model: {}", path.display());
            path
        }
        None => {
            println!("⚠️ Skipping test: ONNX model not found");
            return;
        }
    };
    
    let resources_dir = match find_resources_dir() {
        Some(dir) => dir,
        None => {
            println!("⚠️ Skipping test: resources directory not found");
            return;
        }
    };
    
    let voices_path = match find_voices_file(&resources_dir) {
        Some(path) => {
            println!("✅ Found voices file: {}", path.display());
            path
        }
        None => {
            println!("⚠️ Skipping test: voices file not found");
            return;
        }
    };
    
    // Read the original HTML
    let original_html = fs::read_to_string(&prologue_path)
        .expect("Failed to read prologue.xhtml");
    
    println!("\n📖 Processing HTML with spans...");
    let (extracted_full_text, updated_html_with_spans, extracted_span_mappings) = 
        extract_text_with_spans(&original_html, None)
            .expect("Failed to extract text with spans");
    
    // Extract actual span IDs from HTML
    let mut actual_span_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
    for cap in SPAN_ID_PATTERN.captures_iter(&updated_html_with_spans) {
        if let Some(span_id) = cap.get(1) {
            actual_span_ids.insert(span_id.as_str().to_string());
        }
    }
    
    // Filter span mappings
    let total_mappings = extracted_span_mappings.len();
    let filtered_span_mappings: Vec<(String, usize, usize)> = extracted_span_mappings
        .into_iter()
        .filter(|(span_id, _, _)| actual_span_ids.contains(span_id))
        .collect();
    
    println!("   Total span mappings: {}", total_mappings);
    println!("   Spans in HTML: {}", actual_span_ids.len());
    println!("   Filtered span mappings: {}", filtered_span_mappings.len());
    
    // Initialize TTS engine
    println!("\n🎤 Initializing TTS engine...");
    let model_path_str = onnx_model.to_str().expect("Model path should be valid UTF-8");
    let voices_path_str = voices_path.to_str().expect("Voices path should be valid UTF-8");
    
    let engine = kokoros::tts::koko::TTSKokoParallel::new_with_instances(
        model_path_str,
        voices_path_str,
        1, // Single instance for testing
    ).await;
    
    println!("✅ TTS engine initialized");
    
    // Extract sentences for round-robin processing
    println!("\n📝 Extracting sentences...");
    let sentences_with_spans = extract_all_sentences(&original_html)
        .expect("Failed to extract sentences");
    let sentences: Vec<String> = sentences_with_spans.iter().map(|s| s.text.clone()).collect();
    
    println!("   Found {} sentences", sentences.len());
    
    // Process sentences with TTS in round-robin fashion
    println!("\n🎵 Generating audio with TTS (sentence-based, round-robin)...");
    let model_instance = engine.get_model_instance(0);
    let voice_id = "af_heart";
    let language = "en";
    let speed = 1.0;
    const SAMPLE_RATE: f32 = 24000.0;
    
    let mut all_word_alignments: Vec<kokoros::tts::koko::WordAlignment> = Vec::new();
    let mut merged_audio: Vec<f32> = Vec::new();
    let mut cumulative_duration = 0.0f32;
    let mut sentence_results: Vec<(usize, Vec<f32>, Vec<kokoros::tts::koko::WordAlignment>, String)> = Vec::new();
    
    // Process sentences sequentially (for testing, can be parallelized)
    for (idx, sentence) in sentences.iter().enumerate() {
        let text = sentence.trim();
        if text.is_empty() {
            continue;
        }
        
        if idx % 10 == 0 {
            println!("   Processing sentence {}/{}: {} chars", idx + 1, sentences.len(), text.len());
        }
        
        // Generate TTS audio (new model doesn't provide timestamps, so we calculate them)
        match engine.tts_raw_audio_with_instance(
            text,
            language,
            voice_id,
            speed,
            None,
            None,
            None,
            None,
            model_instance.clone(),
        ) {
            Ok(audio_samples) => {
                if audio_samples.is_empty() {
                    continue;
                }
                
                // Calculate word alignments from audio duration
                let words: Vec<&str> = text.split_whitespace().filter(|s| !s.is_empty()).collect();
                let audio_duration_sec = audio_samples.len() as f32 / SAMPLE_RATE;
                
                let mut word_alignments = Vec::new();
                if !words.is_empty() {
                    let duration_per_word = audio_duration_sec / words.len() as f32;
                    for (word_idx, word) in words.iter().enumerate() {
                        let start_sec = word_idx as f32 * duration_per_word;
                        let end_sec = (word_idx + 1) as f32 * duration_per_word;
                        word_alignments.push(kokoros::tts::koko::WordAlignment {
                            word: word.to_string(),
                            start_sec: start_sec + cumulative_duration,
                            end_sec: end_sec + cumulative_duration,
                        });
                    }
                }
                
                // Offset word alignments by cumulative duration
                let mut offset_alignments: Vec<kokoros::tts::koko::WordAlignment> = word_alignments
                    .iter()
                    .map(|wa| kokoros::tts::koko::WordAlignment {
                        word: wa.word.clone(),
                        start_sec: wa.start_sec,
                        end_sec: wa.end_sec,
                    })
                    .collect();
                
                all_word_alignments.append(&mut offset_alignments);
                merged_audio.extend_from_slice(&audio_samples);
                
                // Update cumulative duration for next sentence
                if !word_alignments.is_empty() {
                    cumulative_duration = word_alignments.last().unwrap().end_sec;
                } else {
                    cumulative_duration += audio_duration_sec;
                }
                
                sentence_results.push((idx, audio_samples, word_alignments, text.to_string()));
            }
            Err(e) => {
                println!("   ❌ TTS error for sentence {}: {}", idx + 1, e);
            }
        }
    }
    
    let total_duration_sec = merged_audio.len() as f32 / SAMPLE_RATE;
    let total_duration_min = total_duration_sec / 60.0;
    
    println!("\n✅ Generated {} word alignments, {} audio samples", 
        all_word_alignments.len(),
        merged_audio.len()
    );
    println!("   Total duration: {:.2}s ({:.2} minutes)", total_duration_sec, total_duration_min);
    
    // Verify audio duration is around 10 minutes (allow 8-12 minute range)
    assert!(
        total_duration_min >= 8.0 && total_duration_min <= 12.0,
        "Audio duration should be around 10 minutes, but got {:.2} minutes",
        total_duration_min
    );
    println!("   ✓ Audio duration check passed: {:.2} minutes (expected ~10 minutes)", total_duration_min);
    
    // Map alignments to segments
    println!("\n🔗 Mapping alignments to segments...");
    let audio_segments = map_alignments_to_segments_real_tts(
        filtered_span_mappings.clone(),
        &all_word_alignments,
        &merged_audio,
        &extracted_full_text,
    );
    
    println!("   Created {} audio segments", audio_segments.len());
    
    // Generate SMIL file
    println!("\n📄 Generating SMIL file...");
    let chapter_href = "prologue.xhtml";
    let audio_href = "Audio/prologue.mp3";
    let smil_content = generate_smil_file(chapter_href, audio_href, &audio_segments)
        .expect("Failed to generate SMIL file");
    
    // Parse SMIL to extract segment IDs
    let parsed_segments = parse_smil_file(&smil_content, chapter_href)
        .expect("Failed to parse SMIL file");
    
    // Extract span IDs from SMIL
    let mut smil_span_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
    for cap in SMIL_TEXT_SRC_PATTERN.captures_iter(&smil_content) {
        if let Some(span_id) = cap.get(1) {
            smil_span_ids.insert(span_id.as_str().to_string());
        }
    }
    
    println!("\n📊 Verification Results:");
    println!("   SMIL segments: {}", parsed_segments.len());
    println!("   Unique span IDs in SMIL: {}", smil_span_ids.len());
    println!("   HTML spans: {}", actual_span_ids.len());
    
    // Verify all SMIL segment IDs exist in HTML
    let mut missing_ids = Vec::new();
    for segment in &parsed_segments {
        if !actual_span_ids.contains(&segment.text_element_id) {
            missing_ids.push(segment.text_element_id.clone());
        }
    }
    
    // Assertions
    assert_eq!(
        audio_segments.len(),
        filtered_span_mappings.len(),
        "Audio segments count should match filtered span mappings"
    );
    
    assert_eq!(
        parsed_segments.len(),
        audio_segments.len(),
        "Parsed SMIL segments should match generated segments"
    );
    
    assert!(
        missing_ids.is_empty(),
        "Found {} span IDs in SMIL that don't exist in HTML: {:?}",
        missing_ids.len(),
        missing_ids.iter().take(10).collect::<Vec<_>>()
    );
    
    assert_eq!(
        smil_span_ids.len(),
        actual_span_ids.len(),
        "Unique span IDs in SMIL should match spans in HTML"
    );
    
    // Save generated files for inspection
    let test_output_dir = std::env::temp_dir().join("tts_test_output");
    std::fs::create_dir_all(&test_output_dir).ok();
    
    let output_xhtml_path = test_output_dir.join("prologue_generated.xhtml");
    let output_smil_path = test_output_dir.join("prologue_generated.smil");
    
    std::fs::write(&output_xhtml_path, &updated_html_with_spans)
        .expect("Failed to write generated XHTML");
    std::fs::write(&output_smil_path, &smil_content)
        .expect("Failed to write generated SMIL");
    
    println!("\n💾 Generated files saved:");
    println!("   XHTML: {}", output_xhtml_path.display());
    println!("   SMIL: {}", output_smil_path.display());
    
    println!("\n✅ All verifications passed!");
    println!("   ✓ All SMIL segment IDs exist in HTML");
    println!("   ✓ Counts match: {} segments, {} HTML spans",
        parsed_segments.len(),
        actual_span_ids.len()
    );
}

// Helper function for real TTS word alignments
fn map_alignments_to_segments_real_tts(
    span_mappings: Vec<(String, usize, usize)>,
    word_alignments: &[kokoros::tts::koko::WordAlignment],
    audio_samples: &[f32],
    full_text: &str,
) -> Vec<(String, f64, f64)> {
    const SAMPLE_RATE: usize = 24000;
    
    let text_words: Vec<&str> = full_text.split_whitespace().filter(|s| !s.is_empty()).collect();
    let mut audio_segments = Vec::new();
    
    for (span_id, start_word_idx, end_word_idx) in span_mappings {
        let mut span_start_time: Option<f64> = None;
        let mut span_end_time: Option<f64> = None;
        
        let alignment_count = word_alignments.len();
        let text_word_count = text_words.len();
        
        if alignment_count > 0 && text_word_count > 0 {
            let alignments_per_word = alignment_count as f64 / text_word_count as f64;
            let start_alignment_idx = (start_word_idx as f64 * alignments_per_word).floor() as usize;
            let end_alignment_idx = ((end_word_idx as f64 * alignments_per_word).ceil() as usize).min(alignment_count);
            
            if start_alignment_idx < alignment_count {
                span_start_time = Some(word_alignments[start_alignment_idx].start_sec as f64);
            }
            if end_alignment_idx > 0 && end_alignment_idx <= alignment_count {
                span_end_time = Some(word_alignments[end_alignment_idx - 1].end_sec as f64);
            }
        }
        
        let (start_time, end_time) = match (span_start_time, span_end_time) {
            (Some(start), Some(end)) => (start, end),
            (Some(start), None) => {
                let end = if !word_alignments.is_empty() {
                    word_alignments.last().unwrap().end_sec as f64
                } else {
                    audio_samples.len() as f64 / SAMPLE_RATE as f64
                };
                (start, end)
            }
            (None, Some(end)) => (0.0, end),
            (None, None) => {
                let total_duration = if !word_alignments.is_empty() {
                    word_alignments.last().unwrap().end_sec as f64
                } else {
                    audio_samples.len() as f64 / SAMPLE_RATE as f64
                };
                let total_words = text_words.len().max(1);
                let duration_per_word = total_duration / total_words as f64;
                let estimated_start = (start_word_idx as f64) * duration_per_word;
                let estimated_end = (end_word_idx as f64) * duration_per_word;
                (estimated_start, estimated_end)
            }
        };
        
        audio_segments.push((span_id, start_time, end_time));
    }
    
    audio_segments
}

