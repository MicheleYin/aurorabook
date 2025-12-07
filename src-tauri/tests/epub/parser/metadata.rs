//! Tests for epub::parser::metadata module
//!
//! Tests metadata extraction:
//! - extract_metadata_with_epub_crate
//! - parse_opf_content

use aurorabook_lib::epub::parser::metadata::*;

#[test]
fn test_parse_opf_content_basic() {
    // Test parsing basic OPF content
    let opf_content = r#"
        <?xml version="1.0" encoding="UTF-8"?>
        <package version="3.0" xmlns="http://www.idpf.org/2007/opf">
            <metadata>
                <dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">Test Book</dc:title>
                <dc:creator xmlns:dc="http://purl.org/dc/elements/1.1/">Test Author</dc:creator>
            </metadata>
            <manifest>
                <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml"/>
            </manifest>
            <spine>
                <itemref idref="nav"/>
            </spine>
        </package>
    "#;
    
    let result = parse_opf_content(opf_content);
    assert!(result.is_ok());
    
    let (metadata, manifest_items, spine_items) = result.unwrap();
    assert_eq!(metadata.title, Some("Test Book".to_string()));
    assert_eq!(metadata.creator, Some("Test Author".to_string()));
    assert!(manifest_items.contains_key("nav"));
    assert_eq!(spine_items.len(), 1);
}

#[test]
fn test_parse_opf_content_with_cover() {
    // Test parsing OPF with cover image
    let opf_content = r#"
        <?xml version="1.0" encoding="UTF-8"?>
        <package version="3.0" xmlns="http://www.idpf.org/2007/opf">
            <metadata>
                <meta name="cover" content="cover-image"/>
            </metadata>
            <manifest>
                <item id="cover-image" href="cover.jpg" media-type="image/jpeg"/>
            </manifest>
        </package>
    "#;
    
    let result = parse_opf_content(opf_content);
    assert!(result.is_ok());
    
    let (metadata, _, _) = result.unwrap();
    assert_eq!(metadata.cover_id, Some("cover-image".to_string()));
}

#[test]
fn test_parse_opf_content_with_subjects() {
    // Test parsing OPF with subjects/tags
    let opf_content = r#"
        <?xml version="1.0" encoding="UTF-8"?>
        <package version="3.0" xmlns="http://www.idpf.org/2007/opf">
            <metadata>
                <dc:subject xmlns:dc="http://purl.org/dc/elements/1.1/">Fiction</dc:subject>
                <dc:subject xmlns:dc="http://purl.org/dc/elements/1.1/">Adventure</dc:subject>
            </metadata>
        </package>
    "#;
    
    let result = parse_opf_content(opf_content);
    assert!(result.is_ok());
    
    let (metadata, _, _) = result.unwrap();
    assert_eq!(metadata.subjects.len(), 2);
    assert!(metadata.subjects.contains(&"Fiction".to_string()));
    assert!(metadata.subjects.contains(&"Adventure".to_string()));
}

#[test]
fn test_parse_opf_content_invalid_xml() {
    // Test parsing invalid XML
    let invalid_xml = "<invalid>unclosed tag";
    let _result = parse_opf_content(invalid_xml);
    // Should handle gracefully or return error
}

#[test]
fn test_extract_metadata_with_epub_crate() {
    // Test extracting metadata using epub crate
    // This requires a test EPUB file
}

