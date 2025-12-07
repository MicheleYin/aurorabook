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
    // Test extracting cover image as data URL
    // This requires a test EPUB file
}

