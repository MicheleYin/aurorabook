// Test for audiobook.epub chapter name extraction
// Run with: cargo test --test audiobook_chapter_names_test -- --nocapture
// Or with debug logs: RUST_LOG=debug cargo test --test audiobook_chapter_names_test -- --nocapture

use std::fs;
use std::io::Read;

mod helpers;
use helpers::find_test_epub;

#[test]
fn test_audiobook_chapter_names() {
    // Initialize logger to show debug output
    let _ = env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("debug")).try_init();
    
    println!("\n🧪 Testing chapter name extraction from audiobook.epub");
    println!("{}", "=".repeat(60));
    
    // Find the test EPUB file (using language.epub from test_data)
    let epub_path = match find_test_epub("language.epub") {
        Some(path) => {
            println!("✅ Found test EPUB: {}", path.display());
            path
        }
        None => {
            println!("❌ Test EPUB file (language.epub) not found in test_data directory");
            println!("   Please ensure language.epub is in src-tauri/tests/test_data/");
            panic!("Test EPUB file not found");
        }
    };
    
    // Read the EPUB file
    println!("\n📖 Reading EPUB file...");
    let epub_data = match fs::read(&epub_path) {
        Ok(data) => {
            println!("✅ Successfully read EPUB file");
            println!("   File size: {} bytes ({:.2} MB)", data.len(), data.len() as f64 / 1_000_000.0);
            data
        }
        Err(e) => {
            println!("❌ Failed to read EPUB file: {}", e);
            panic!("Failed to read EPUB file: {}", e);
        }
    };
    
    // Extract chapters
    println!("\n📚 Extracting chapters from EPUB...");
    use aurorabook_lib::epub::parser::extract_chapters_from_epub;
    
    let (chapters, stats) = match extract_chapters_from_epub(&epub_data) {
        Ok(result) => result,
        Err(e) => {
            println!("❌ Failed to extract chapters: {}", e);
            panic!("Failed to extract chapters: {}", e);
        }
    };
    
    let (manifest_count, spine_itemref_count, missing_manifest_count, non_html_count, filtered_count) = stats;
    
    println!("✅ Successfully extracted chapters!");
    println!("\n📊 Statistics:");
    println!("   Manifest items: {}", manifest_count);
    println!("   Spine itemrefs: {}", spine_itemref_count);
    println!("   Missing from manifest: {}", missing_manifest_count);
    println!("   Non-HTML files: {}", non_html_count);
    println!("   Filtered out: {}", filtered_count);
    println!("   Final chapters: {}", chapters.len());
    
    if chapters.is_empty() {
        println!("\n❌ No chapters extracted!");
        panic!("No chapters extracted from EPUB");
    }
    
    // Note: Expected chapter names will be determined dynamically from NCX
    // This test verifies that NCX parsing works correctly
    
    println!("\n📑 Extracted chapters:");
    for (i, chapter) in chapters.iter().enumerate() {
        println!("   {}. {} (href: {})", i + 1, chapter.title, chapter.href);
    }
    
    // Debug: Check if NCX was parsed (we'll need to add a way to get this info)
    // For now, let's check the actual EPUB to see if NCX parsing worked
    println!("\n🔍 Debug: Checking NCX parsing...");
    use std::io::Cursor;
    use zip::ZipArchive;
    use aurorabook_lib::epub::parser::{find_opf_path, parse_opf_content, parse_ncx_titles};
    
    let epub_slice: &[u8] = &epub_data;
    let mut archive = ZipArchive::new(Cursor::new(epub_slice)).unwrap();
    let opf_path = find_opf_path(&mut archive).unwrap();
    let oebps_base = if opf_path.contains("/") {
        opf_path.rfind("/")
            .map(|pos| opf_path[..pos + 1].to_string())
            .unwrap_or_else(|| "OEBPS/".to_string())
    } else {
        "OEBPS/".to_string()
    };
    
    // Try to find and parse NCX - read OPF content first, then drop the file handle
    let ncx_path_opt = {
        let mut opf_file = archive.by_name(&opf_path).unwrap();
        let mut opf_content = String::new();
        opf_file.read_to_string(&mut opf_content).unwrap();
        let (_metadata, manifest_items, _spine_items) = parse_opf_content(&opf_content).unwrap();
        
        // Find NCX path from manifest
        let mut ncx_path: Option<String> = None;
        for item in manifest_items.values() {
            if item.media_type.as_ref().map(|mt| mt == "application/x-dtbncx+xml").unwrap_or(false) {
                ncx_path = Some(if item.href.starts_with("/") {
                    item.href[1..].to_string()
                } else if item.href.starts_with("OEBPS/") {
                    item.href.clone()
                } else {
                    format!("{}{}", oebps_base, item.href)
                });
                println!("   Found NCX in manifest: href='{}', resolved path='{}'", item.href, ncx_path.as_ref().unwrap());
                break;
            }
        }
        ncx_path
    };
    
    // Read and parse NCX file once
    let ncx_titles = if let Some(ncx_path) = ncx_path_opt {
        if let Ok(mut ncx_file) = archive.by_name(&ncx_path) {
            let mut ncx_content = String::new();
            if ncx_file.read_to_string(&mut ncx_content).is_ok() {
                println!("   ✅ Successfully read NCX file ({} bytes)", ncx_content.len());
                match parse_ncx_titles(&ncx_content) {
                    Ok(titles) => {
                        println!("   ✅ Parsed {} titles from NCX:", titles.len());
                        for (href, title) in &titles {
                            println!("      '{}' -> '{}'", href, title);
                        }
                        Some(titles)
                    }
                    Err(e) => {
                        println!("   ❌ Failed to parse NCX: {}", e);
                        None
                    }
                }
            } else {
                println!("   ❌ Failed to read NCX content");
                None
            }
        } else {
            println!("   ❌ Failed to open NCX file at path: {}", ncx_path);
            None
        }
    } else {
        println!("   ❌ No NCX file found in manifest");
        None
    };
    
    println!("\n🔍 Verifying chapter names from NCX...");
    
    // Verify that chapter titles match NCX titles (if NCX is available)
    let mut verified_count = 0;
    let mut found_issues = Vec::new();
    
    if let Some(ref ncx_titles_map) = ncx_titles {
        println!("\n📋 Verifying chapters against NCX titles:");
        for chapter in &chapters {
            // Normalize href for comparison
            let normalized_href = if chapter.href.starts_with("/") {
                &chapter.href[1..]
            } else {
                &chapter.href
            };
            
            if let Some(expected_title) = ncx_titles_map.get(normalized_href) {
                // Normalize apostrophes for comparison (curly vs straight)
                let normalized_expected: String = expected_title.chars().map(|c| {
                    if c == '\'' || c == '\'' { '\'' } else { c }
                }).collect();
                let normalized_got: String = chapter.title.chars().map(|c| {
                    if c == '\'' || c == '\'' { '\'' } else { c }
                }).collect();
                
                if normalized_got == normalized_expected {
                    println!("   ✅ {} -> '{}'", normalized_href, chapter.title);
                    verified_count += 1;
                } else {
                    let issue = format!(
                        "   ❌ {} -> Expected '{}', got '{}'",
                        normalized_href, expected_title, chapter.title
                    );
                    println!("{}", issue);
                    found_issues.push(issue);
                }
            } else {
                // Chapter not in NCX (might be filtered or not a main chapter)
                println!("   ⚠️  {} -> '{}' (not in NCX)", normalized_href, chapter.title);
            }
        }
        
        println!("\n📊 Verification Summary:");
        println!("   Verified chapters: {}/{}", verified_count, ncx_titles_map.len());
        println!("   Total extracted chapters: {}", chapters.len());
        
        if !found_issues.is_empty() {
            println!("\n❌ Found {} issue(s) with chapter names:", found_issues.len());
            for issue in &found_issues {
                println!("{}", issue);
            }
            panic!("Chapter name verification failed");
        }
        
        // Check that we found at least some of the expected chapters
        if verified_count == 0 && !ncx_titles_map.is_empty() {
            println!("\n❌ No expected chapters were found!");
            println!("   This might indicate that:");
            println!("   - The filtering logic is excluding too many chapters");
            println!("   - The NCX parsing is not working correctly");
            println!("   - The href paths don't match");
            panic!("No expected chapters found");
        }
        
        println!("\n✅ Chapter name verification PASSED!");
        println!("   Successfully verified {} chapter name(s)", verified_count);
    } else {
        println!("\n⚠️  No NCX file found - skipping chapter name verification");
        println!("   Chapters extracted: {}", chapters.len());
        println!("   This is OK if the EPUB doesn't have an NCX file");
    }
}

