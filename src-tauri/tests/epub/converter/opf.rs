//! Tests for epub::converter::opf module
//!
//! Tests OPF update functionality:
//! - update_content_opf with existing audio/SMIL files
//! - ID generation when resuming conversion
//! - Duplicate ID prevention

use aurorabook_lib::epub::converter::opf::update_content_opf;

#[test]
fn test_update_content_opf_resume_scenario() {
    // Test the resume scenario: OPF already has m001/s001 for prologue,
    // and we're adding chapter002 - should get m002/s002, not duplicate m001/s001
    
    let opf_xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="pub-id" version="3.0" xml:lang="en">
    <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:title>Test Book</dc:title>
        <dc:identifier id="pub-id">urn:uuid:test</dc:identifier>
    </metadata>
    <manifest>
        <item href="prologue.xhtml" id="prologue" media-type="application/xhtml+xml" media-overlay="s001" />
        <item href="chapter002.xhtml" id="chapter002" media-type="application/xhtml+xml" />
        <item id="m001" href="Audio/prologue.mp3" media-type="audio/mpeg" />
        <item id="s001" href="prologue.smil" media-type="application/smil+xml" />
    </manifest>
    <spine>
        <itemref idref="prologue" />
        <itemref idref="chapter002" />
    </spine>
</package>"#;

    // Simulate adding chapter002 audio and SMIL files
    // chapter_index 1 corresponds to chapter002 (0-indexed, so prologue=0, chapter002=1)
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

    let result = update_content_opf(&opf_xml, &audio_files, &smil_files, &chapters);
    
    assert!(result.is_ok(), "update_content_opf should succeed: {:?}", result);
    let updated_opf = result.unwrap();
    
    // Debug: print the manifest section
    if let Some(start) = updated_opf.find("<manifest") {
        if let Some(end) = updated_opf[start..].find("</manifest>") {
            let manifest_section = &updated_opf[start..start+end];
            println!("Manifest section:\n{}", manifest_section);
        }
    }
    
    // Count all audio/SMIL IDs in output
    println!("Audio IDs in output: {:?}", updated_opf.matches("id=\"m").collect::<Vec<_>>());
    println!("SMIL IDs in output: {:?}", updated_opf.matches("id=\"s").collect::<Vec<_>>());
    
    // Verify that chapter002 got m002 and s002, not m001/s001
    assert!(
        updated_opf.contains("id=\"m002\""),
        "New audio file should have id m002, not m001. Output: {}",
        updated_opf
    );
    assert!(
        updated_opf.contains("id=\"s002\""),
        "New SMIL file should have id s002, not s001"
    );
    
    // Verify existing items are preserved
    assert!(
        updated_opf.contains("id=\"m001\""),
        "Existing audio file should still have id m001"
    );
    assert!(
        updated_opf.contains("id=\"s001\""),
        "Existing SMIL file should still have id s001"
    );
    
    // Verify chapter002 got media-overlay="s002"
    assert!(
        updated_opf.contains("chapter002.xhtml") && updated_opf.contains("media-overlay=\"s002\""),
        "chapter002 should have media-overlay=\"s002\""
    );
    
    // Verify no duplicate IDs
    let m001_count = updated_opf.matches("id=\"m001\"").count();
    let m002_count = updated_opf.matches("id=\"m002\"").count();
    let s001_count = updated_opf.matches("id=\"s001\"").count();
    let s002_count = updated_opf.matches("id=\"s002\"").count();
    
    assert_eq!(m001_count, 1, "Should have exactly one m001");
    assert_eq!(m002_count, 1, "Should have exactly one m002");
    assert_eq!(s001_count, 1, "Should have exactly one s001");
    assert_eq!(s002_count, 1, "Should have exactly one s002");
    
    println!("✅ Resume scenario test passed: chapter002 correctly got m002/s002");
}

#[test]
fn test_update_content_opf_handles_duplicate_ids_in_input() {
    // Test that if input OPF already has duplicate IDs, they get reassigned
    
    let opf_xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="pub-id" version="3.0" xml:lang="en">
    <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:title>Test Book</dc:title>
        <dc:identifier id="pub-id">urn:uuid:test</dc:identifier>
    </metadata>
    <manifest>
        <item href="prologue.xhtml" id="prologue" media-type="application/xhtml+xml" media-overlay="s001" />
        <item id="m001" href="Audio/prologue.mp3" media-type="audio/mpeg" />
        <item id="s001" href="prologue.smil" media-type="application/smil+xml" />
        <item id="m001" href="Audio/chapter002.mp3" media-type="audio/mpeg" />
        <item id="s001" href="chapter002.smil" media-type="application/smil+xml" />
    </manifest>
    <spine>
        <itemref idref="prologue" />
    </spine>
</package>"#;

    // Adding a new chapter - should get m002/s002
    let audio_files = vec![
        (2, "Audio/chapter003.mp3".to_string()),
    ];
    let smil_files = vec![
        (2, "chapter003.smil".to_string()),
    ];
    let chapters = vec![
        "prologue.xhtml".to_string(),
        "chapter002.xhtml".to_string(),
        "chapter003.xhtml".to_string(),
    ];

    let result = update_content_opf(&opf_xml, &audio_files, &smil_files, &chapters);
    
    assert!(result.is_ok(), "update_content_opf should succeed even with duplicate input IDs");
    let updated_opf = result.unwrap();
    
    // The duplicate IDs in input should be reassigned, and new item should get m002/s002
    // Count occurrences - should have at most one of each ID
    let m001_count = updated_opf.matches("id=\"m001\"").count();
    let m002_count = updated_opf.matches("id=\"m002\"").count();
    let s001_count = updated_opf.matches("id=\"s001\"").count();
    let s002_count = updated_opf.matches("id=\"s002\"").count();
    
    assert!(m001_count <= 1, "Should have at most one m001 after reassignment");
    assert!(m002_count >= 1, "Should have at least one m002 (for new chapter003)");
    assert!(s001_count <= 1, "Should have at most one s001 after reassignment");
    assert!(s002_count >= 1, "Should have at least one s002 (for new chapter003)");
    
    println!("✅ Duplicate ID handling test passed");
}

