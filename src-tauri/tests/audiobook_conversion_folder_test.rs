// Test for complete EPUB to audiobook conversion - extracts files to folder instead of EPUB
// Run with: cargo test --test audiobook_conversion_folder_test -- --nocapture
// Or with debug logs: RUST_LOG=debug cargo test --test audiobook_conversion_folder_test -- --nocapture

use std::fs;
use std::io::{Cursor, Read};
use std::path::PathBuf;

mod helpers;
use helpers::find_test_epub;

#[tokio::test]
async fn test_complete_audiobook_conversion_to_folder() {
    // Initialize logger to show debug output
    let _ = env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).try_init();
    
    println!("\n🧪 Testing complete EPUB to audiobook conversion (extracting to folder)");
    println!("{}", "=".repeat(60));
    
    // Find the test EPUB file
    let epub_path = match find_test_epub("e.epub") {
        Some(path) => {
            println!("✅ Found test EPUB: {}", path.display());
            path
        }
        None => {
            println!("❌ Test EPUB file (e.epub) not found in test_data directory");
            println!("   Please ensure e.epub is in src-tauri/tests/test_data/");
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
    
    let converted_epub = match convert_epub_to_audiobook_standalone(epub_data, options, None).await {
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
    
    // Determine output folder
    let output_folder = if let Some(parent) = epub_path.parent() {
        parent.join("e_audiobook_extracted")
    } else {
        PathBuf::from("e_audiobook_extracted")
    };
    
    // Remove existing folder if it exists
    if output_folder.exists() {
        println!("\n🗑️  Removing existing output folder...");
        fs::remove_dir_all(&output_folder)
            .expect("Failed to remove existing output folder");
    }
    
    // Create output folder
    println!("\n📁 Creating output folder: {}", output_folder.display());
    fs::create_dir_all(&output_folder)
        .expect("Failed to create output folder");
    
    // Extract all files from the converted EPUB
    println!("\n📦 Extracting files from converted EPUB...");
    use zip::ZipArchive;
    
    let mut archive = match ZipArchive::new(Cursor::new(&converted_epub)) {
        Ok(archive) => archive,
        Err(e) => {
            println!("❌ Failed to open converted EPUB as ZIP: {}", e);
            panic!("Failed to open converted EPUB: {}", e);
        }
    };
    
    println!("   Archive contains {} files", archive.len());
    
    // Extract each file
    for i in 0..archive.len() {
        // Get file name first
        let file_path = {
            let file = match archive.by_index(i) {
                Ok(f) => f,
                Err(e) => {
                    println!("⚠️  Warning: Failed to read file {}: {}", i, e);
                    continue;
                }
            };
            file.name().to_string()
        };
        
        let output_path = output_folder.join(&file_path);
        
        // Create parent directories if needed
        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent)
                .expect(&format!("Failed to create directory: {}", parent.display()));
        }
        
        // Skip directories (they're already created)
        if file_path.ends_with('/') {
            continue;
        }
        
        // Read file contents (need to get file again)
        let mut file = match archive.by_index(i) {
            Ok(f) => f,
            Err(e) => {
                println!("⚠️  Warning: Failed to read file {}: {}", i, e);
                continue;
            }
        };
        
        let mut contents = Vec::new();
        match file.read_to_end(&mut contents) {
            Ok(_) => {
                // Write file
                match fs::write(&output_path, &contents) {
                    Ok(_) => {
                        println!("   ✅ Extracted: {} ({} bytes)", file_path, contents.len());
                    }
                    Err(e) => {
                        println!("   ❌ Failed to write {}: {}", file_path, e);
                    }
                }
            }
            Err(e) => {
                println!("   ❌ Failed to read {}: {}", file_path, e);
            }
        }
    }
    
    // Print summary
    println!("\n📊 Extraction Summary:");
    println!("   Output folder: {}", output_folder.display());
    
    // Count files and calculate total size
    let mut file_count = 0;
    let mut total_size = 0u64;
    
    fn count_files(dir: &PathBuf, count: &mut usize, size: &mut u64) {
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries {
                if let Ok(entry) = entry {
                    let path = entry.path();
                    if path.is_file() {
                        *count += 1;
                        if let Ok(metadata) = fs::metadata(&path) {
                            *size += metadata.len();
                        }
                    } else if path.is_dir() {
                        count_files(&path, count, size);
                    }
                }
            }
        }
    }
    
    count_files(&output_folder, &mut file_count, &mut total_size);
    
    println!("   Total files extracted: {}", file_count);
    println!("   Total size: {} bytes ({:.2} MB)", total_size, total_size as f64 / 1_000_000.0);
    
    // List directory structure
    println!("\n📂 Directory structure:");
    fn print_tree(dir: &PathBuf, prefix: &str, is_last: bool) {
        let display_name = dir.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("?");
        
        let current_prefix = if is_last {
            println!("{}└── {}", prefix, display_name);
            format!("{}    ", prefix)
        } else {
            println!("{}├── {}", prefix, display_name);
            format!("{}│   ", prefix)
        };
        
        if dir.is_dir() {
            if let Ok(entries) = fs::read_dir(dir) {
                let mut entries: Vec<_> = entries
                    .filter_map(|e| e.ok())
                    .collect();
                entries.sort_by_key(|e| e.path());
                
                for (i, entry) in entries.iter().enumerate() {
                    let path = entry.path();
                    let is_last_entry = i == entries.len() - 1;
                    print_tree(&path, &current_prefix, is_last_entry);
                }
            }
        }
    }
    
    print_tree(&output_folder, "", true);
    
    println!("\n✅ Complete audiobook conversion and extraction test PASSED!");
    println!("   All files extracted to: {}", output_folder.display());
    println!("   You can now inspect the folder structure to debug any EPUB issues!");
}

