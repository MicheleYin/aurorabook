//! Tests for epub::converter::smil module
//!
//! Tests SMIL file generation:
//! - format_smil_time
//! - generate_smil_file

use aurorabook_lib::epub::converter::smil::{format_smil_time, generate_smil_file};

#[test]
fn test_format_smil_time_zero() {
    assert_eq!(format_smil_time(0.0), "00:00:00.000");
}

#[test]
fn test_format_smil_time_seconds() {
    assert_eq!(format_smil_time(5.0), "00:00:05.000");
    assert_eq!(format_smil_time(12.345), "00:00:12.345");
}

#[test]
fn test_format_smil_time_minutes() {
    assert_eq!(format_smil_time(65.0), "00:01:05.000");
    assert_eq!(format_smil_time(125.5), "00:02:05.500");
}

#[test]
fn test_format_smil_time_hours() {
    assert_eq!(format_smil_time(3661.0), "01:01:01.000");
    assert_eq!(format_smil_time(7323.456), "02:02:03.456");
}

#[test]
fn test_format_smil_time_fractional() {
    assert_eq!(format_smil_time(0.123), "00:00:00.123");
    assert_eq!(format_smil_time(0.001), "00:00:00.001");
    assert_eq!(format_smil_time(1.999), "00:00:01.999");
}

#[test]
fn test_generate_smil_file_basic() {
    let segments = vec![
        ("f000001".to_string(), 0.0, 2.5),
        ("f000002".to_string(), 2.5, 5.0),
    ];
    
    let result = generate_smil_file("chapter1.xhtml", "Audio/chapter1.mp3", &segments);
    
    assert!(result.is_ok());
    let smil = result.unwrap();
    
    // Should contain SMIL structure
    assert!(smil.contains("<smil"));
    assert!(smil.contains("xmlns"));
    assert!(smil.contains("<body"));
    assert!(smil.contains("<seq"));
    
    // Should contain chapter and audio references
    assert!(smil.contains("chapter1.xhtml"));
    assert!(smil.contains("Audio/chapter1.mp3"));
    
    // Should contain segment references
    assert!(smil.contains("f000001"));
    assert!(smil.contains("f000002"));
    assert!(smil.contains("00:00:00.000"));
    assert!(smil.contains("00:00:02.500"));
    assert!(smil.contains("00:00:05.000"));
}

#[test]
fn test_generate_smil_file_multiple_segments() {
    let segments = vec![
        ("f000001".to_string(), 0.0, 1.0),
        ("f000002".to_string(), 1.0, 2.5),
        ("f000003".to_string(), 2.5, 4.0),
        ("f000004".to_string(), 4.0, 6.5),
    ];
    
    let result = generate_smil_file("chapter2.xhtml", "Audio/chapter2.mp3", &segments);
    
    assert!(result.is_ok());
    let smil = result.unwrap();
    
    // Should contain all segments
    for i in 1..=4 {
        let span_id = format!("f{:06}", i);
        assert!(smil.contains(&span_id), "Should contain span {}", span_id);
    }
    
    // Should have proper timing
    assert!(smil.contains("00:00:00.000"));
    assert!(smil.contains("00:00:01.000"));
    assert!(smil.contains("00:00:02.500"));
    assert!(smil.contains("00:00:04.000"));
    assert!(smil.contains("00:00:06.500"));
}

#[test]
fn test_generate_smil_file_empty_segments() {
    let segments = vec![];
    
    let result = generate_smil_file("chapter3.xhtml", "Audio/chapter3.mp3", &segments);
    
    assert!(result.is_ok());
    let smil = result.unwrap();
    
    // Should still generate valid SMIL structure
    assert!(smil.contains("<smil"));
    assert!(smil.contains("<body"));
    assert!(smil.contains("<seq"));
    assert!(smil.contains("chapter3.xhtml"));
    // Audio href is only included in <par> elements, which aren't created for empty segments
    // So we don't check for Audio/chapter3.mp3 here
    
    // Should not have any par elements (no segments to create pars for)
    assert!(!smil.contains("<par"));
}

#[test]
fn test_generate_smil_file_long_duration() {
    let segments = vec![
        ("f000001".to_string(), 0.0, 3661.5), // 1 hour, 1 minute, 1.5 seconds
    ];
    
    let result = generate_smil_file("long_chapter.xhtml", "Audio/long_chapter.mp3", &segments);
    
    assert!(result.is_ok());
    let smil = result.unwrap();
    
    // Should format long duration correctly
    assert!(smil.contains("01:01:01.500"));
}

#[test]
fn test_generate_smil_file_well_formed_xml() {
    let segments = vec![
        ("f000001".to_string(), 0.0, 1.0),
        ("f000002".to_string(), 1.0, 2.0),
    ];
    
    let result = generate_smil_file("test.xhtml", "Audio/test.mp3", &segments);
    
    assert!(result.is_ok());
    let smil = result.unwrap();
    
    // Should be well-formed XML
    assert!(smil.starts_with("<?xml"));
    assert!(smil.contains("</smil>"));
    assert!(smil.contains("</body>"));
    assert!(smil.contains("</seq>"));
    
    // Count opening and closing tags should match
    let open_par = smil.matches("<par").count();
    let close_par = smil.matches("</par>").count();
    assert_eq!(open_par, close_par, "par tags should be balanced");
}

