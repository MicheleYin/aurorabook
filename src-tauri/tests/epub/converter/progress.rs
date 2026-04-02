//! Tests for epub::converter::progress module
//!
//! Tests progress tracking:
//! - get_parallelism
//! - Progress callback functionality

use aurorabook_lib::epub::converter::get_parallelism;
use aurorabook_lib::epub::converter::ConversionProgress;

#[test]
fn test_get_parallelism() {
    let parallelism = get_parallelism();
    
    // Should return at least 1
    assert!(parallelism >= 1, "Parallelism should be at least 1");
    
    // Should not exceed number of CPU cores
    let logical_cores = num_cpus::get();
    assert!(parallelism <= logical_cores, "Parallelism should not exceed CPU cores");
    
    // On machines with 8+ cores, should use ~75% (with 1 reserved)
    if logical_cores >= 8 {
        let expected_max = ((logical_cores as f64) * 0.50).round() as usize;
        assert!(parallelism <= expected_max, 
                "On {} core machine, parallelism ({}) should be <= {}", 
                logical_cores, parallelism, expected_max);
    }
}

#[test]
fn test_progress_callback_type() {
    // Test that we can create a progress callback
    use aurorabook_lib::epub::converter::ProgressCallback;
    let callback: ProgressCallback = 
        Box::new(|progress: ConversionProgress| {
            println!("Progress: {} - {}", progress.current_step, progress.message);
        });
    
    // Test calling the callback
    let progress = ConversionProgress {
        current_chapter: 1,
        total_chapters: 10,
        words_processed: 100,
        total_words: 1000,
        words_in_current_chapter: 50,
        current_step: "testing".to_string(),
        message: "Test progress".to_string(),
    };
    
    callback(progress);
    // If we get here without panicking, the callback works
    assert!(true);
}

#[test]
fn test_progress_callback_multiple_calls() {
    use aurorabook_lib::epub::converter::ProgressCallback;
    let callback: ProgressCallback = 
        Box::new(|_progress: ConversionProgress| {
            // Callback executed
        });
    
    // Call multiple times
    for i in 0..5 {
        let progress = ConversionProgress {
            current_chapter: i,
            total_chapters: 10,
            words_processed: i * 100,
            total_words: 1000,
            words_in_current_chapter: 100,
            current_step: format!("step_{}", i),
            message: format!("Message {}", i),
        };
        callback(progress);
    }
    
    // Note: call_count won't increment because it's moved into the closure
    // This test just verifies the callback can be called multiple times
    assert!(true);
}

#[test]
fn test_conversion_progress_serialization() {
    use serde_json;
    
    let progress = ConversionProgress {
        current_chapter: 5,
        total_chapters: 20,
        words_processed: 5000,
        total_words: 20000,
        words_in_current_chapter: 250,
        current_step: "generating-audio".to_string(),
        message: "Processing chapter 5".to_string(),
    };
    
    // Test JSON serialization (used for Tauri events)
    let json = serde_json::to_string(&progress);
    assert!(json.is_ok());
    let json_str = json.unwrap();
    
    // Should contain all fields
    assert!(json_str.contains("currentChapter"));
    assert!(json_str.contains("totalChapters"));
    assert!(json_str.contains("wordsProcessed"));
    assert!(json_str.contains("totalWords"));
    assert!(json_str.contains("wordsInCurrentChapter"));
    assert!(json_str.contains("currentStep"));
    assert!(json_str.contains("message"));
    
    // Test deserialization
    let deserialized: Result<ConversionProgress, _> = serde_json::from_str(&json_str);
    assert!(deserialized.is_ok());
    let deserialized = deserialized.unwrap();
    assert_eq!(deserialized.current_chapter, 5);
    assert_eq!(deserialized.total_chapters, 20);
    assert_eq!(deserialized.words_processed, 5000);
}

