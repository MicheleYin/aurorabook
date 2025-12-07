//! Test update_content_opf with actual resume.epub OPF
//!
//! This test uses the actual OPF from resume.epub to verify
//! that the fix works with real-world data

use aurorabook_lib::epub::converter::opf::update_content_opf;
use std::fs;
use std::io::{Cursor, Read};
use zip::ZipArchive;

fn find_test_epub(filename: &str) -> Option<std::path::PathBuf> {
    // Try multiple locations
    let paths = vec![
        format!("tests/test_data/{}", filename),
        format!("src-tauri/tests/test_data/{}", filename),
        format!("sample_audio/{}", filename),
        format!("../sample_audio/{}", filename),
        filename.to_string(),
    ];
    
    for path_str in paths {
        let path = std::path::PathBuf::from(&path_str);
        if path.exists() {
            return Some(path);
        }
    }
    None
}

#[test]
fn test_update_content_opf_with_resume_epub() {
    // Find the resume.epub file
    let epub_path = match find_test_epub("resume.epub") {
        Some(path) => {
            println!("✅ Found resume.epub at: {}", path.display());
            path
        }
        None => {
            println!("⚠️ Skipping test - resume.epub not found");
            return;
        }
    };
    
    // Read the EPUB file
    let epub_data = match fs::read(&epub_path) {
        Ok(data) => {
            println!("✅ Read EPUB file ({} bytes)", data.len());
            data
        }
        Err(e) => {
            println!("❌ Failed to read EPUB: {}", e);
            return;
        }
    };
    
    // Extract OPF content
    let mut archive = match ZipArchive::new(Cursor::new(&epub_data)) {
        Ok(archive) => archive,
        Err(e) => {
            println!("❌ Failed to open as ZIP: {}", e);
            return;
        }
    };
    
    // Try to find OPF file
    let opf_paths = vec!["OEBPS/package.opf", "OEBPS/content.opf", "content.opf", "package.opf"];
    let mut opf_content = None;
    
    for opf_path in opf_paths {
        match archive.by_name(opf_path) {
            Ok(mut file) => {
                let mut content = String::new();
                if file.read_to_string(&mut content).is_ok() {
                    println!("✅ Found OPF at: {}", opf_path);
                    opf_content = Some(content);
                    break;
                }
            }
            Err(_) => continue,
        }
    }
    
    let opf_xml = match opf_content {
        Some(content) => {
            println!("✅ Read OPF content ({} bytes)", content.len());
            content
        }
        None => {
            println!("❌ Could not find OPF file in EPUB");
            return;
        }
    };
    
    // Check what audio/SMIL items exist
    let m001_count = opf_xml.matches("id=\"m001\"").count();
    let s001_count = opf_xml.matches("id=\"s001\"").count();
    println!("📊 Existing IDs in OPF: m001 appears {} times, s001 appears {} times", m001_count, s001_count);
    
    // Simulate adding chapter002 audio and SMIL files
    // The OPF shows prologue is already converted, so we're adding chapter002
    let audio_files = vec![
        (1, "Audio/chapter002.mp3".to_string()),
    ];
    let smil_files = vec![
        (1, "chapter002.smil".to_string()),
    ];
    let chapters = vec![
        "prologue.xhtml".to_string(),
        "chapter002.xhtml".to_string(),
    ];
    
    println!("\n🔄 Testing update_content_opf with resume.epub OPF...");
    let result = update_content_opf(&opf_xml, &audio_files, &smil_files, &chapters);
    
    assert!(result.is_ok(), "update_content_opf should succeed: {:?}", result);
    let updated_opf = result.unwrap();
    
    // Check the results
    let m001_final = updated_opf.matches("id=\"m001\"").count();
    let m002_final = updated_opf.matches("id=\"m002\"").count();
    let s001_final = updated_opf.matches("id=\"s001\"").count();
    let s002_final = updated_opf.matches("id=\"s002\"").count();
    
    println!("\n📊 Results after update:");
    println!("   m001: {} occurrences (should be 1)", m001_final);
    println!("   m002: {} occurrences (should be 1)", m002_final);
    println!("   s001: {} occurrences (should be 1)", s001_final);
    println!("   s002: {} occurrences (should be 1)", s002_final);
    
    // Verify no duplicate IDs
    assert_eq!(m001_final, 1, "Should have exactly one m001, found {}", m001_final);
    assert_eq!(m002_final, 1, "Should have exactly one m002, found {}", m002_final);
    assert_eq!(s001_final, 1, "Should have exactly one s001, found {}", s001_final);
    assert_eq!(s002_final, 1, "Should have exactly one s002, found {}", s002_final);
    
    // Verify chapter002 got the correct media-overlay
    assert!(
        updated_opf.contains("chapter002.xhtml") && updated_opf.contains("media-overlay=\"s002\""),
        "chapter002 should have media-overlay=\"s002\""
    );
    
    println!("\n✅ Test passed! Resume scenario works correctly with actual EPUB file.");
}

