//! Tests for epub::parser::types module
//!
//! Tests data structures:
//! - EpubMetadata
//! - ManifestItem

use aurorabook_lib::epub::parser::types::*;

#[test]
fn test_epub_metadata_creation() {
    let metadata = EpubMetadata {
        title: Some("Test Book".to_string()),
        creator: Some("Test Author".to_string()),
        publisher: Some("Test Publisher".to_string()),
        subjects: vec!["Fiction".to_string()],
        pubdate: Some("2024-01-01".to_string()),
        modified_date: Some("2024-01-02".to_string()),
        cover_id: Some("cover-image".to_string()),
    };
    
    assert_eq!(metadata.title, Some("Test Book".to_string()));
    assert_eq!(metadata.creator, Some("Test Author".to_string()));
}

#[test]
fn test_manifest_item_creation() {
    let item = ManifestItem {
        id: "item1".to_string(),
        href: "item1.xhtml".to_string(),
        media_type: Some("application/xhtml+xml".to_string()),
        properties: Some("nav".to_string()),
        media_overlay: None,
    };
    
    assert_eq!(item.id, "item1");
    assert_eq!(item.href, "item1.xhtml");
    assert_eq!(item.media_type, Some("application/xhtml+xml".to_string()));
}

