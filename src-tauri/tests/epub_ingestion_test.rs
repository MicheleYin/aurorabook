// Test for EPUB ingestion to identify issues
// Run with: cargo test --test epub_ingestion_test -- --nocapture

use std::env;
use std::path::PathBuf;
use std::fs;
use std::io::Read;

/// Find the test EPUB file (e.epub)
fn find_test_epub() -> Option<PathBuf> {
    let mut possible_paths = Vec::new();
    
    // From test execution (cargo test) - relative to src-tauri
    possible_paths.push(PathBuf::from("e.epub"));
    possible_paths.push(PathBuf::from("../e.epub"));
    possible_paths.push(PathBuf::from("src-tauri/../e.epub"));
    
    // From project root
    if let Ok(manifest_dir) = env::var("CARGO_MANIFEST_DIR") {
        let manifest_path = PathBuf::from(manifest_dir);
        possible_paths.push(manifest_path.join("e.epub"));
        if let Some(parent) = manifest_path.parent() {
            possible_paths.push(parent.join("e.epub"));
        }
    }
    
    // Check current directory
    if let Ok(current_dir) = std::env::current_dir() {
        possible_paths.push(current_dir.join("e.epub"));
        if let Some(parent) = current_dir.parent() {
            possible_paths.push(parent.join("e.epub"));
        }
    }

    for path in possible_paths {
        if path.exists() && path.is_file() {
            return Some(path);
        }
    }
    None
}

#[test]
fn test_epub_ingestion() {
    println!("\n🧪 Testing EPUB ingestion with e.epub");
    println!("{}", "=".repeat(60));
    
    // Find the test EPUB file
    let epub_path = match find_test_epub() {
        Some(path) => {
            println!("✅ Found test EPUB: {}", path.display());
            path
        }
        None => {
            println!("❌ Test EPUB file (e.epub) not found");
            println!("   Please ensure e.epub is in the project root or src-tauri directory");
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
    
    // Validate EPUB signature
    println!("\n🔍 Validating EPUB signature...");
    if epub_data.len() < 4 {
        println!("❌ EPUB file too small ({} bytes)", epub_data.len());
        panic!("EPUB file too small");
    }
    
    let signature = &epub_data[0..4];
    println!("   First 4 bytes: {:?}", signature);
    if signature != b"PK\x03\x04" {
        println!("❌ Invalid EPUB signature: expected PK\\x03\\x04, got {:?}", signature);
        panic!("Invalid EPUB signature");
    }
    println!("✅ EPUB signature is valid (ZIP archive)");
    
    // Test chapter extraction
    println!("\n📚 Extracting chapters from EPUB...");
    use aurorabook_lib::epub::parser::extract_chapters_from_epub;
    
    match extract_chapters_from_epub(&epub_data) {
        Ok((chapters, stats)) => {
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
                println!("   This is the issue - the EPUB has no readable chapters after filtering.");
                println!("   Check the filtering logic in extract_chapters_from_epub.");
                panic!("No chapters extracted from EPUB");
            }
            
            println!("\n📑 Extracted chapters:");
            for (i, chapter) in chapters.iter().enumerate() {
                println!("   {}. {} (href: {})", i + 1, chapter.title, chapter.href);
            }
            
            println!("\n✅ EPUB ingestion test PASSED!");
        }
        Err(e) => {
            println!("❌ Failed to extract chapters: {}", e);
            println!("\n🔍 Debugging information:");
            
            // Try to open as ZIP and inspect structure
            use std::io::Cursor;
            use zip::ZipArchive;
            
            match ZipArchive::new(Cursor::new(&epub_data)) {
                Ok(mut archive) => {
                    println!("   ✅ Can open as ZIP archive");
                    println!("   Archive has {} files", archive.len());
                    
                    // Try to find container.xml
                    match archive.by_name("META-INF/container.xml") {
                        Ok(mut file) => {
                            let mut content = String::new();
                            if file.read_to_string(&mut content).is_ok() {
                                println!("   ✅ Found container.xml");
                                println!("   Content preview: {}", &content.chars().take(200).collect::<String>());
                            }
                        }
                        Err(e) => {
                            println!("   ❌ Failed to read container.xml: {}", e);
                        }
                    }
                    
                    // Try to find OPF file
                    let opf_paths = vec!["OEBPS/content.opf", "content.opf", "OEBPS/package.opf", "package.opf"];
                    for opf_path in opf_paths {
                        match archive.by_name(opf_path) {
                            Ok(mut file) => {
                                let mut content = String::new();
                                if file.read_to_string(&mut content).is_ok() {
                                    println!("   ✅ Found OPF at: {}", opf_path);
                                    println!("   Content preview: {}", &content.chars().take(300).collect::<String>());
                                    break;
                                }
                            }
                            Err(_) => continue,
                        }
                    }
                }
                Err(e) => {
                    println!("   ❌ Failed to open as ZIP: {}", e);
                }
            }
            
            panic!("Failed to extract chapters: {}", e);
        }
    }
}

#[test]
fn test_epub_opf_parsing() {
    println!("\n🧪 Testing OPF parsing separately");
    println!("{}", "=".repeat(60));
    
    // Find the test EPUB file
    let epub_path = match find_test_epub() {
        Some(path) => path,
        None => {
            println!("⚠️ Skipping test - e.epub not found");
            return;
        }
    };
    
    // Read the EPUB file
    let epub_data = match fs::read(&epub_path) {
        Ok(data) => data,
        Err(e) => {
            println!("❌ Failed to read EPUB: {}", e);
            return;
        }
    };
    
    // Open as ZIP
    use std::io::Cursor;
    use zip::ZipArchive;
    
    let epub_data_slice: &[u8] = &epub_data;
    let mut archive = match ZipArchive::new(Cursor::new(epub_data_slice)) {
        Ok(archive) => archive,
        Err(e) => {
            println!("❌ Failed to open as ZIP: {}", e);
            return;
        }
    };
    
    // Find and parse OPF
    use aurorabook_lib::epub::parser::{find_opf_path, parse_opf_content};
    
    println!("\n🔍 Finding OPF path...");
    let opf_path = match find_opf_path(&mut archive) {
        Ok(path) => {
            println!("✅ Found OPF path: {}", path);
            path
        }
        Err(e) => {
            println!("❌ Failed to find OPF path: {}", e);
            return;
        }
    };
    
    println!("\n📄 Reading OPF content...");
    let mut opf_file = match archive.by_name(&opf_path) {
        Ok(file) => file,
        Err(e) => {
            println!("❌ Failed to open OPF file: {}", e);
            return;
        }
    };
    
    let mut opf_content = String::new();
    match opf_file.read_to_string(&mut opf_content) {
        Ok(_) => {
            println!("✅ Successfully read OPF content");
            println!("   OPF size: {} bytes", opf_content.len());
            println!("   Preview: {}", &opf_content.chars().take(500).collect::<String>());
        }
        Err(e) => {
            println!("❌ Failed to read OPF content: {}", e);
            return;
        }
    }
    
    println!("\n🔍 Parsing OPF content...");
    match parse_opf_content(&opf_content) {
        Ok((metadata, manifest_items, spine_items)) => {
            println!("✅ Successfully parsed OPF!");
            println!("\n📊 Metadata:");
            println!("   Title: {:?}", metadata.title);
            println!("   Creator: {:?}", metadata.creator);
            println!("   Publisher: {:?}", metadata.publisher);
            println!("   Subjects: {:?}", metadata.subjects);
            println!("   Publication date: {:?}", metadata.pubdate);
            println!("   Cover ID: {:?}", metadata.cover_id);
            
            println!("\n📋 Manifest items ({}):", manifest_items.len());
            for (id, item) in manifest_items.iter().take(10) {
                println!("   - {}: {} ({:?})", id, item.href, item.media_type);
            }
            if manifest_items.len() > 10 {
                println!("   ... and {} more", manifest_items.len() - 10);
            }
            
            println!("\n📖 Spine items ({}):", spine_items.len());
            for (i, (idref, href)) in spine_items.iter().enumerate() {
                println!("   {}. idref={}, href={}", i + 1, idref, href);
            }
            
            println!("\n✅ OPF parsing test PASSED!");
        }
        Err(e) => {
            println!("❌ Failed to parse OPF: {}", e);
            println!("\n🔍 OPF content (first 1000 chars):");
            println!("{}", &opf_content.chars().take(1000).collect::<String>());
            panic!("OPF parsing failed: {}", e);
        }
    }
}

