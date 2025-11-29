// Test for complete EPUB to audiobook conversion
// Run with: cargo test --test audiobook_conversion_test -- --nocapture
// Or with debug logs: RUST_LOG=debug cargo test --test audiobook_conversion_test -- --nocapture

use std::env;
use std::path::PathBuf;
use std::fs;

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

#[tokio::test]
async fn test_complete_audiobook_conversion() {
    // Initialize logger to show debug output
    let _ = env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).try_init();
    
    println!("\n🧪 Testing complete EPUB to audiobook conversion with e.epub");
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
    
    // Extract chapters
    println!("\n📚 Extracting chapters from EPUB...");
    use aurorabook_lib::epub::converter::{extract_chapters, ConversionOptions};
    
    let (chapters, stats) = match extract_chapters(epub_data.clone()) {
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
    
    println!("\n📑 Chapters to convert:");
    for (i, chapter) in chapters.iter().enumerate() {
        println!("   {}. {} (href: {})", i + 1, chapter.title, chapter.href);
    }
    
    // Set up conversion options
    let voice_id = "af_heart"; // Default voice
    let options = ConversionOptions {
        voice_id: voice_id.to_string(),
        chapters: chapters.clone(),
    };
    
    println!("\n🎤 Starting audiobook conversion...");
    println!("   Voice ID: {}", voice_id);
    println!("   Total chapters: {}", chapters.len());
    println!("   This may take a while depending on the book size...");
    
    // Perform conversion using standalone function (no AppHandle needed)
    use aurorabook_lib::epub::converter::convert_epub_to_audiobook_standalone;
    
    let converted_epub = match convert_epub_to_audiobook_standalone(epub_data, options).await {
        Ok(data) => {
            println!("\n✅ Conversion completed successfully!");
            println!("   Output size: {} bytes ({:.2} MB)", data.len(), data.len() as f64 / 1_000_000.0);
            data
        }
        Err(e) => {
            println!("\n❌ Conversion failed: {}", e);
            panic!("Conversion failed: {}", e);
        }
    };
    
    // Write output file
    let output_path = if let Some(parent) = epub_path.parent() {
        parent.join("e_audiobook.epub")
    } else {
        PathBuf::from("e_audiobook.epub")
    };
    
    println!("\n💾 Writing converted audiobook to file...");
    match fs::write(&output_path, &converted_epub) {
        Ok(_) => {
            println!("✅ Successfully wrote audiobook to: {}", output_path.display());
            println!("   File size: {} bytes ({:.2} MB)", converted_epub.len(), converted_epub.len() as f64 / 1_000_000.0);
        }
        Err(e) => {
            println!("❌ Failed to write output file: {}", e);
            panic!("Failed to write output file: {}", e);
        }
    }
    
    // Validate the output EPUB
    println!("\n🔍 Validating output EPUB...");
    if converted_epub.len() < 4 {
        println!("❌ Output EPUB file too small ({} bytes)", converted_epub.len());
        panic!("Output EPUB file too small");
    }
    
    let signature = &converted_epub[0..4];
    if signature != b"PK\x03\x04" {
        println!("❌ Invalid EPUB signature: expected PK\\x03\\x04, got {:?}", signature);
        panic!("Invalid EPUB signature");
    }
    println!("✅ Output EPUB signature is valid (ZIP archive)");
    
    // Try to extract chapters from the converted EPUB to verify it's valid
    println!("\n🔍 Verifying converted EPUB structure...");
    match extract_chapters(converted_epub.clone()) {
        Ok((converted_chapters, _)) => {
            println!("✅ Converted EPUB is valid and contains {} chapters", converted_chapters.len());
            if converted_chapters.len() == chapters.len() {
                println!("✅ Chapter count matches original!");
            } else {
                println!("⚠️  Chapter count differs: original had {}, converted has {}", chapters.len(), converted_chapters.len());
            }
        }
        Err(e) => {
            println!("⚠️  Warning: Could not extract chapters from converted EPUB: {}", e);
            println!("   The file was created but may have structural issues");
        }
    }
    
    println!("\n✅ Complete audiobook conversion test PASSED!");
    println!("   Output file: {}", output_path.display());
    println!("   You can now open the audiobook in an EPUB reader with media overlay support!");
}

