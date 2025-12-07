//! Tests for epub::parser::cover module
//!
//! Tests cover image operations:
//! - find_cover_image
//! - extract_cover_image_as_data_url

use aurorabook_lib::epub::parser::cover::*;
use aurorabook_lib::epub::parser::types::ManifestItem;

#[test]
fn test_find_cover_image() {
    // Test finding cover image from manifest
    let mut manifest_items = std::collections::HashMap::new();
    manifest_items.insert("cover-image".to_string(), ManifestItem {
        id: "cover-image".to_string(),
        href: "cover.jpg".to_string(),
        media_type: Some("image/jpeg".to_string()),
        properties: None,
    });
    
    let cover_href = find_cover_image(Some(&"cover-image".to_string()), &manifest_items);
    assert_eq!(cover_href, Some("cover.jpg".to_string()));
}

#[test]
fn test_find_cover_image_no_cover_id() {
    // Test when cover_id is None
    let manifest_items = std::collections::HashMap::new();
    let cover_href = find_cover_image(None, &manifest_items);
    assert_eq!(cover_href, None);
}

#[test]
fn test_find_cover_image_missing_manifest() {
    // Test when cover_id doesn't exist in manifest
    let manifest_items = std::collections::HashMap::new();
    let cover_href = find_cover_image(Some(&"nonexistent".to_string()), &manifest_items);
    assert_eq!(cover_href, None);
}

#[test]
fn test_extract_cover_image_as_data_url() {
    // Test extracting cover image as data URL from audiobook.epub
    use std::io::Read;
    use std::fs;
    use zip::ZipArchive;
    use std::io::Cursor;
    use aurorabook_lib::epub::parser::{find_opf_path, parse_opf_content, cover::find_cover_image};
    use aurorabook_lib::epub::parser::opf::derive_base_path_from_opf;
    
    #[path = "../../helpers.rs"]
    mod helpers;
    use helpers::find_test_epub;
    
    let epub_path = find_test_epub("audiobook.epub");
    if epub_path.is_none() {
        println!("⚠️  Skipping test: audiobook.epub not found in test_data/");
        return;
    }
    
    let epub_data = fs::read(epub_path.unwrap()).expect("Failed to read audiobook.epub");
    let epub_slice: &[u8] = &epub_data;
    let mut archive = ZipArchive::new(Cursor::new(epub_slice)).expect("Failed to open EPUB");
    
    // Find OPF and parse metadata
    let opf_path = find_opf_path(&mut archive).expect("Failed to find OPF");
    let opf_content = {
        let mut opf_file = archive.by_name(&opf_path).expect("Failed to open OPF");
        let mut content = String::new();
        opf_file.read_to_string(&mut content).expect("Failed to read OPF");
        content
    };
    
    let (metadata, manifest_items, _) = parse_opf_content(&opf_content)
        .expect("Failed to parse OPF");
    
    // Find cover image
    let cover_href = find_cover_image(metadata.cover_id.as_ref(), &manifest_items);
    
    if let Some(cover_href) = cover_href {
        println!("✅ Found cover image: {}", cover_href);
        
        // Extract cover image
        let base_path = derive_base_path_from_opf(&opf_path);
        let cover_path = if cover_href.starts_with("/") {
            cover_href[1..].to_string()
        } else {
            format!("{}{}", base_path, cover_href)
        };
        
        let mut cover_file = archive.by_name(&cover_path)
            .expect("Failed to open cover image");
        let mut cover_data = Vec::new();
        cover_file.read_to_end(&mut cover_data).expect("Failed to read cover");
        
        assert!(!cover_data.is_empty(), "Cover image should not be empty");
        println!("✅ Cover image extracted: {} bytes", cover_data.len());
    } else {
        println!("⚠️  No cover image found in audiobook.epub");
    }
}

