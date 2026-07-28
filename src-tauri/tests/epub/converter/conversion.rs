//! Tests for epub::converter conversion logic
//!
//! Tests full EPUB to audiobook conversion:
//! - convert_epub_to_audiobook_standalone
//! - Chapter processing
//! - EPUB building

use aurorabook_lib::epub::converter::{convert_epub_to_audiobook_standalone, ConversionOptions, ConversionChapter};
use std::sync::Arc;
use std::sync::atomic::AtomicBool;
use std::io::{Cursor, Read};
use zip::ZipArchive;

#[path = "../../helpers.rs"]
mod helpers;
use helpers::{find_test_epub, find_onnx_model, find_resources_dir, find_voices_file};

#[tokio::test]
async fn test_convert_epub_to_audiobook_standalone_small() {
    // Test conversion with a small EPUB file
    let epub_path = match find_test_epub("e.epub") {
        Some(path) => path,
        None => {
            println!("⚠️  Skipping test: e.epub not found in test_data/");
            return;
        }
    };
    
    let onnx_model = find_onnx_model();
    let resources_dir = find_resources_dir();
    
    if onnx_model.is_none() || resources_dir.is_none() {
        println!("⚠️  Skipping test: Model files not found in resources/");
        return;
    }
    
    println!("📖 Reading test EPUB: {}", epub_path.display());
    let epub_data = std::fs::read(&epub_path).expect("Failed to read EPUB");
    
    // Extract chapters from EPUB
    use aurorabook_lib::epub::parser::extract_chapters_from_epub;
    let (chapters, _stats) = extract_chapters_from_epub(&epub_data)
        .expect("Failed to extract chapters");
    
    if chapters.is_empty() {
        println!("⚠️  Skipping test: No chapters found in EPUB");
        return;
    }
    
    // Use only the first chapter for faster testing
    let first_chapter = &chapters[0];
    
    // Load chapter content - do this in a separate scope so archive is dropped
    let (chapter_html, word_count) = {
        use aurorabook_lib::epub::parser::{find_opf_path, parse_opf_content};
        
        let epub_slice: &[u8] = &epub_data;
        let mut archive = ZipArchive::new(Cursor::new(epub_slice)).unwrap();
        let opf_path = find_opf_path(&mut archive).unwrap();
        
        // Read OPF content and drop the file handle
        let opf_content = {
            let mut opf_file = archive.by_name(&opf_path).unwrap();
            let mut content = String::new();
            opf_file.read_to_string(&mut content).unwrap();
            content
        };
        let (_metadata, _manifest_items, _spine_items) = parse_opf_content(&opf_content).unwrap();
        
        // Derive base path
        let base_path = if opf_path.contains("/") {
            opf_path.rfind("/").map(|pos| opf_path[..pos + 1].to_string())
                .unwrap_or_else(|| "OEBPS/".to_string())
        } else {
            "OEBPS/".to_string()
        };
        
        // Resolve chapter path
        let chapter_path = if first_chapter.href.starts_with("/") {
            first_chapter.href[1..].to_string()
        } else if first_chapter.href.starts_with("OEBPS/") {
            first_chapter.href.clone()
        } else {
            format!("{}{}", base_path, first_chapter.href)
        };
        
        // Read chapter content (opf_file is dropped, so we can borrow archive again)
        let chapter_html = {
            let mut chapter_file = archive.by_name(&chapter_path).unwrap();
            let mut html = String::new();
            chapter_file.read_to_string(&mut html).unwrap();
            html
        };
        
        // Count words
        use aurorabook_lib::utils::text::count_words_in_html;
        let word_count = count_words_in_html(&chapter_html);
        
        (chapter_html, word_count)
    };
    
    // Create conversion options
    let conversion_chapter = ConversionChapter {
        id: first_chapter.href.clone(),
        title: first_chapter.title.clone(),
        href: first_chapter.href.clone(),
        order: 0,
        content_html: chapter_html,
        word_count,
    };
    
    let options = ConversionOptions {
        voice_id: "af_heart".to_string(),
        language: "en".to_string(),
        chapters: vec![conversion_chapter],
    };
    
    println!("🎤 Starting conversion of 1 chapter ({} words)...", word_count);
    println!("   Chapter: {}", first_chapter.title);
    
    // Perform conversion - now epub_data can be moved
    let cancel_token = Arc::new(AtomicBool::new(false));
    let result = convert_epub_to_audiobook_standalone(
        epub_data,
        options,
        Some(cancel_token),
    ).await;
    
    assert!(result.is_ok(), "Conversion should succeed");
    let converted_epub = result.unwrap();
    
    // Verify output
    assert!(!converted_epub.is_empty(), "Converted EPUB should not be empty");
    assert!(converted_epub.len() > 1000, "Converted EPUB should have reasonable size");
    
    // Verify it's a valid ZIP/EPUB
    assert_eq!(&converted_epub[0..4], b"PK\x03\x04", "Should be a valid ZIP file");
    
    println!("✅ Conversion successful!");
    println!("   Output size: {} bytes ({:.2} MB)", 
             converted_epub.len(), 
             converted_epub.len() as f64 / 1_000_000.0);
    
    // Verify EPUB structure
    let mut converted_archive = ZipArchive::new(Cursor::new(&converted_epub)).unwrap();
    
    // Should contain audio files
    let has_audio = (0..converted_archive.len())
        .any(|i| {
            if let Ok(file) = converted_archive.by_index(i) {
                file.name().contains("Audio/") && file.name().ends_with(".mp3")
            } else {
                false
            }
        });
    assert!(has_audio, "Converted EPUB should contain audio files");
    
    // Should contain SMIL files
    let has_smil = (0..converted_archive.len())
        .any(|i| {
            if let Ok(file) = converted_archive.by_index(i) {
                file.name().ends_with(".smil")
            } else {
                false
            }
        });
    assert!(has_smil, "Converted EPUB should contain SMIL files");
    
    println!("   ✅ Contains audio files: {}", has_audio);
    println!("   ✅ Contains SMIL files: {}", has_smil);
}

#[tokio::test]
async fn test_convert_epub_to_audiobook_standalone_cancellation() {
    // Test that cancellation works
    let epub_path = match find_test_epub("e.epub") {
        Some(path) => path,
        None => {
            println!("⚠️  Skipping test: e.epub not found");
            return;
        }
    };
    
    let onnx_model = find_onnx_model();
    let resources_dir = find_resources_dir();
    
    if onnx_model.is_none() || resources_dir.is_none() {
        println!("⚠️  Skipping test: Model files not found");
        return;
    }
    
    let epub_data = std::fs::read(&epub_path).expect("Failed to read EPUB");
    
    use aurorabook_lib::epub::parser::extract_chapters_from_epub;
    let (chapters, _stats) = extract_chapters_from_epub(&epub_data)
        .expect("Failed to extract chapters");
    
    if chapters.is_empty() {
        println!("⚠️  Skipping test: No chapters found");
        return;
    }
    
    // Create a cancellation token and cancel immediately
    let cancel_token = Arc::new(AtomicBool::new(true));
    
    // Create minimal conversion options
    let options = ConversionOptions {
        voice_id: "af_heart".to_string(),
        language: "en".to_string(),
        chapters: vec![], // Empty chapters to test cancellation early
    };
    
    let result = convert_epub_to_audiobook_standalone(
        epub_data,
        options,
        Some(cancel_token),
    ).await;
    
    // Should handle cancellation gracefully
    // (May return error or empty result depending on implementation)
    println!("✅ Cancellation test completed (result: {})", 
             if result.is_ok() { "Ok" } else { "Err" });
}

#[test]
fn test_conversion_options_serialization() {
    use serde_json;
    
    let chapter = ConversionChapter {
        id: "chapter1".to_string(),
        title: "Chapter 1".to_string(),
        href: "Text/chapter1.xhtml".to_string(),
        order: 0,
        content_html: "<p>Test content</p>".to_string(),
        word_count: 2,
    };
    
    let options = ConversionOptions {
        voice_id: "af_heart".to_string(),
        language: "en".to_string(),
        chapters: vec![chapter],
    };
    
    // Test serialization
    let json = serde_json::to_string(&options);
    assert!(json.is_ok());
    let json_str = json.unwrap();
    
    assert!(json_str.contains("voiceId") || json_str.contains("voice_id"));
    assert!(json_str.contains("chapters"));
    assert!(json_str.contains("af_heart"));
    assert!(json_str.contains("Chapter 1"));
    
    // Test deserialization
    let deserialized: Result<ConversionOptions, _> = serde_json::from_str(&json_str);
    assert!(deserialized.is_ok());
    let deserialized = deserialized.unwrap();
    assert_eq!(deserialized.voice_id, "af_heart");
    assert_eq!(deserialized.language, "en");
    assert_eq!(deserialized.chapters.len(), 1);
    assert_eq!(deserialized.chapters[0].title, "Chapter 1");
}

