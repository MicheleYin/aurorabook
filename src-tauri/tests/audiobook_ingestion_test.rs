// Test for audiobook EPUB ingestion with media-overlay chain ordering
// Run with: cargo test --test audiobook_ingestion_test -- --nocapture
// Or with debug logs: RUST_LOG=debug cargo test --test audiobook_ingestion_test -- --nocapture

use std::fs;
use std::path::PathBuf;

mod helpers;

/// Find the audiobook.epub file in sample_audio directory
fn find_audiobook_epub() -> Option<PathBuf> {
    use std::env;
    
    let mut possible_paths = Vec::new();
    
    // From project root
    if let Ok(manifest_dir) = env::var("CARGO_MANIFEST_DIR") {
        let manifest_path = PathBuf::from(&manifest_dir);
        if let Some(parent) = manifest_path.parent() {
            possible_paths.push(parent.join("sample_audio").join("audiobook.epub"));
        }
    }
    
    // Check current directory
    if let Ok(current_dir) = std::env::current_dir() {
        possible_paths.push(current_dir.join("sample_audio").join("audiobook.epub"));
        if let Some(parent) = current_dir.parent() {
            possible_paths.push(parent.join("sample_audio").join("audiobook.epub"));
        }
    }
    
    // Try relative paths
    possible_paths.push(PathBuf::from("../sample_audio").join("audiobook.epub"));
    possible_paths.push(PathBuf::from("sample_audio").join("audiobook.epub"));
    possible_paths.push(PathBuf::from("../../sample_audio").join("audiobook.epub"));

    for path in possible_paths {
        if path.exists() && path.is_file() {
            return Some(path);
        }
    }
    None
}

#[tokio::test]
async fn test_audiobook_ingestion_with_audio_tracks() {
    // Initialize logger to show debug output
    let _ = env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).try_init();
    
    println!("\n🧪 Testing audiobook EPUB ingestion with media-overlay chain ordering");
    println!("{}", "=".repeat(70));
    
    // Find the audiobook EPUB file
    let epub_path = match find_audiobook_epub() {
        Some(path) => {
            println!("✅ Found audiobook EPUB: {}", path.display());
            path
        }
        None => {
            println!("❌ Audiobook EPUB file (audiobook.epub) not found in sample_audio directory");
            println!("   Please ensure audiobook.epub is in sample_audio/");
            panic!("Audiobook EPUB file not found");
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
    if signature != b"PK\x03\x04" {
        println!("❌ Invalid EPUB signature: expected PK\\x03\\x04, got {:?}", signature);
        panic!("Invalid EPUB signature");
    }
    println!("✅ EPUB signature is valid (ZIP archive)");
    
    // Extract chapters
    println!("\n📚 Extracting chapters from EPUB...");
    use aurorabook_lib::epub::parser::extract_chapters_from_epub;
    
    let (chapters, stats) = match extract_chapters_from_epub(&epub_data) {
        Ok(result) => {
            println!("✅ Successfully extracted chapters!");
            result
        }
        Err(e) => {
            println!("❌ Failed to extract chapters: {}", e);
            panic!("Failed to extract chapters: {}", e);
        }
    };
    
    let (manifest_count, spine_itemref_count, missing_manifest_count, non_html_count, filtered_count) = stats;
    println!("\n📊 Chapter extraction statistics:");
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
    
    println!("\n📑 Extracted chapters (in order):");
    for (i, chapter) in chapters.iter().enumerate() {
        println!("   {}. {} (order: {}, href: {})", i + 1, chapter.title, chapter.order, chapter.href);
    }
    
    // Extract metadata and manifest (must parse OPF directly to get media-overlay attributes)
    println!("\n📋 Extracting metadata and manifest...");
    use std::io::{Cursor, Read};
    use zip::ZipArchive;
    use aurorabook_lib::epub::parser::{find_opf_path, parse_opf_content, extract_audio_tracks_from_manifest};
    
    // Open EPUB as ZIP to parse OPF directly (needed for media-overlay attributes)
    let epub_slice: &[u8] = &epub_data;
    let mut archive = match ZipArchive::new(Cursor::new(epub_slice)) {
        Ok(archive) => archive,
        Err(e) => {
            println!("❌ Failed to open EPUB as ZIP: {}", e);
            panic!("Failed to open EPUB as ZIP: {}", e);
        }
    };
    
    let opf_path = match find_opf_path(&mut archive) {
        Ok(path) => path,
        Err(e) => {
            println!("❌ Failed to find OPF path: {}", e);
            panic!("Failed to find OPF path: {}", e);
        }
    };
    
    let mut opf_file = match archive.by_name(&opf_path) {
        Ok(file) => file,
        Err(e) => {
            println!("❌ Failed to open OPF file: {}", e);
            panic!("Failed to open OPF file: {}", e);
        }
    };
    
    let mut opf_content = String::new();
    match opf_file.read_to_string(&mut opf_content) {
        Ok(_) => {}
        Err(e) => {
            println!("❌ Failed to read OPF content: {}", e);
            panic!("Failed to read OPF content: {}", e);
        }
    }
    
    let (metadata, manifest_items, _spine_items) = match parse_opf_content(&opf_content) {
        Ok(result) => {
            println!("✅ Successfully parsed OPF with media-overlay attributes!");
            result
        }
        Err(e) => {
            println!("❌ Failed to parse OPF: {}", e);
            panic!("Failed to parse OPF: {}", e);
        }
    };
    
    println!("\n📊 Metadata:");
    println!("   Title: {:?}", metadata.title);
    println!("   Creator: {:?}", metadata.creator);
    println!("   Publisher: {:?}", metadata.publisher);
    
    // Extract audio tracks
    println!("\n🎵 Extracting audio tracks from manifest...");
    let audio_tracks = extract_audio_tracks_from_manifest(&manifest_items);
    println!("✅ Found {} audio tracks in manifest", audio_tracks.len());
    
    if audio_tracks.is_empty() {
        println!("\n❌ No audio tracks found!");
        panic!("No audio tracks found in EPUB");
    }
    
    println!("\n🎵 Audio tracks (before ordering):");
    for (i, track) in audio_tracks.iter().enumerate() {
        println!("   {}. {} (href: {}, order: {})", i + 1, track.title, track.href, track.order);
    }
    
    // Build a map of actual file paths in the EPUB archive for path normalization
    use std::collections::HashSet;
    
    let mut archive_for_paths = match zip::ZipArchive::new(std::io::Cursor::new(&epub_data)) {
        Ok(archive) => archive,
        Err(e) => {
            println!("❌ Failed to open EPUB as ZIP: {}", e);
            panic!("Failed to open EPUB as ZIP: {}", e);
        }
    };
    
    let mut archive_file_paths = HashSet::new();
    for i in 0..archive_for_paths.len() {
        if let Ok(file) = archive_for_paths.by_index(i) {
            let name = file.name().to_string();
            archive_file_paths.insert(name.clone());
            // Also add normalized versions (without leading slash, etc.)
            archive_file_paths.insert(name.trim_start_matches('/').to_string());
        }
    }
    
    // Order audio tracks by chapters using media-overlay chain
    println!("\n🔗 Ordering audio tracks by chapters (via media-overlay chain)...");
    use aurorabook_lib::epub::order_audio_tracks_by_chapters;
    
    let ordered_tracks = order_audio_tracks_by_chapters(&audio_tracks, &chapters, &manifest_items, &archive_file_paths);
    println!("✅ Ordered {} audio tracks", ordered_tracks.len());
    
    println!("\n🎵 Audio tracks (after ordering by media-overlay chain):");
    for (i, track) in ordered_tracks.iter().enumerate() {
        println!("   {}. {} (href: {}, order: {})", i + 1, track.title, track.href, track.order);
    }
    
    // Verify ordering is correct (should be 01, 02, 03, 04, 05, 06, 07)
    println!("\n✅ Verifying audio track order...");
    let expected_order = vec!["01.mp3", "02.mp3", "03.mp3", "04.mp3", "05.mp3", "06.mp3", "07.mp3"];
    
    if ordered_tracks.len() != expected_order.len() {
        println!("⚠️  Warning: Expected {} tracks, got {}", expected_order.len(), ordered_tracks.len());
    }
    
    let mut all_correct = true;
    for (i, expected_filename) in expected_order.iter().enumerate() {
        if i < ordered_tracks.len() {
            let track = &ordered_tracks[i];
            let track_filename = track.href.split("/").last().unwrap_or(&track.href);
            
            if track_filename == *expected_filename {
                println!("   ✅ Track {}: {} (order: {}) - CORRECT", i + 1, track_filename, track.order);
            } else {
                println!("   ❌ Track {}: Expected {}, got {} (order: {}) - WRONG ORDER!", 
                    i + 1, expected_filename, track_filename, track.order);
                all_correct = false;
            }
        } else {
            println!("   ❌ Track {}: Expected {}, but track not found", i + 1, expected_filename);
            all_correct = false;
        }
    }
    
    // Verify order values are sequential (0, 1, 2, ...)
    // Tracks should have sequential order values starting from 0, regardless of chapter order
    println!("\n🔍 Verifying order values are sequential...");
    let mut order_correct = true;
    
    for (i, track) in ordered_tracks.iter().enumerate() {
        let expected_order = i;
        if track.order == expected_order {
            println!("   ✅ Track {} (order: {}) has correct sequential order", 
                track.href.split("/").last().unwrap_or(&track.href), 
                track.order);
        } else {
            println!("   ❌ Track {} (order: {}) should have order {}, but got {}", 
                track.href.split("/").last().unwrap_or(&track.href), 
                track.order, expected_order, track.order);
            order_correct = false;
        }
    }
    
    if order_correct {
        println!("   ✅ All track order values are sequential (0, 1, 2, ...)");
    } else {
        println!("   ❌ Some track order values are not sequential");
    }
    
    // Check that tracks are ordered by media-overlay chain, not alphabetically
    println!("\n🔍 Verifying tracks are ordered by media-overlay chain (not alphabetically)...");
    
    // Extract filenames and check if they would be different if sorted alphabetically
    let track_filenames: Vec<String> = ordered_tracks.iter()
        .map(|t| t.href.split("/").last().unwrap_or(&t.href).to_string())
        .collect();
    
    let mut sorted_filenames = track_filenames.clone();
    sorted_filenames.sort();
    
    if track_filenames == sorted_filenames {
        println!("   ⚠️  Warning: Tracks happen to be in alphabetical order");
        println!("      This could be coincidental - verify they're ordered by media-overlay chain");
    } else {
        println!("   ✅ Tracks are NOT in alphabetical order - good!");
        println!("      Current order: {:?}", track_filenames);
        println!("      Alphabetical would be: {:?}", sorted_filenames);
    }
    
    if all_correct && order_correct {
        println!("\n✅✅✅ Audiobook ingestion test PASSED!");
        println!("   All {} audio tracks are in the correct order (01-07)", ordered_tracks.len());
        println!("   Tracks are ordered by media-overlay chain based on chapter order");
        println!("   Track order values are sequential (0, 1, 2, ...)");
    } else {
        println!("\n❌❌❌ Audiobook ingestion test FAILED!");
        if !all_correct {
            println!("   Audio tracks are not in the correct sequence");
        }
        if !order_correct {
            println!("   Track order values are not sequential");
        }
        panic!("Audio track ordering failed");
    }
}

