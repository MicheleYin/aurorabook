use std::collections::HashMap;
use std::io::{Cursor, Read};
use zip::ZipArchive;

use super::types::ManifestItem;
use super::opf::derive_base_path_from_opf;

/// Find cover image from manifest
pub fn find_cover_image(
    cover_id: Option<&String>,
    manifest_items: &HashMap<String, ManifestItem>,
) -> Option<String> {
    // Try cover ID first
    if let Some(id) = cover_id {
        if let Some(item) = manifest_items.get(id) {
            return Some(item.href.clone());
        }
    }
    
    // Try properties="cover-image"
    for item in manifest_items.values() {
        if let Some(props) = &item.properties {
            if props.contains("cover-image") {
                return Some(item.href.clone());
            }
        }
    }
    
    // Try id or href containing "cover" with image media type
    for item in manifest_items.values() {
        if let Some(mt) = &item.media_type {
            if mt.starts_with("image/") && (item.id.contains("cover") || item.href.contains("cover")) {
                return Some(item.href.clone());
            }
        }
    }
    
    None
}

/// Extract cover image as base64 data URL from EPUB
///
/// This function finds the cover image in the EPUB manifest, extracts its bytes,
/// and converts them to a base64 data URL that can be used directly in HTML img tags.
///
/// # Arguments
/// * `epub_data` - The EPUB file as a byte vector
/// * `cover_href` - The relative path to the cover image (from find_cover_image)
/// * `opf_base_path` - The base path of the OPF file (used to resolve relative paths)
///
/// # Returns
/// A base64 data URL string (e.g., "data:image/jpeg;base64,...") or None if extraction fails
pub fn extract_cover_image_as_data_url(
    epub_data: &[u8],
    cover_href: &str,
    opf_base_path: &str,
) -> Option<String> {
    use log::{debug, warn};
    
    let mut archive = match ZipArchive::new(Cursor::new(epub_data)) {
        Ok(arch) => arch,
        Err(e) => {
            warn!("Failed to open EPUB for cover extraction: {}", e);
            return None;
        }
    };
    
    // Resolve the cover image path relative to the OPF file
    let cover_path = if cover_href.starts_with("/") {
        // Absolute path from EPUB root
        cover_href.trim_start_matches("/").to_string()
    } else {
        // Relative path - resolve against OPF base path
        let opf_dir = if opf_base_path.contains("/") {
            opf_base_path.rfind("/")
                .map(|pos| &opf_base_path[..pos + 1])
                .unwrap_or("")
        } else {
            ""
        };
        
        // Handle path resolution
        let mut resolved_parts: Vec<&str> = opf_dir.split("/").filter(|s| !s.is_empty()).collect();
        let cover_parts: Vec<&str> = cover_href.split("/").collect();
        
        for part in cover_parts {
            if part == ".." {
                resolved_parts.pop();
            } else if part != "." && !part.is_empty() {
                resolved_parts.push(part);
            }
        }
        
        resolved_parts.join("/")
    };
    
    debug!("Attempting to extract cover from path: '{}'", cover_path);
    
    // Try to read the cover image from the archive
    // Try primary path first, then alternatives
    let mut cover_bytes = Vec::new();
    let mut found_cover = false;
    
    // Try primary path
    if let Ok(mut file) = archive.by_name(&cover_path) {
        if file.read_to_end(&mut cover_bytes).is_ok() && !cover_bytes.is_empty() {
            found_cover = true;
            debug!("Found cover at primary path: '{}'", cover_path);
        }
    }
    
    // Try alternative paths if primary didn't work
    if !found_cover {
        let mut alt_paths = vec![
            cover_href.to_string(),
        ];
        
        // Add base path variants if base path exists
        let opf_base = derive_base_path_from_opf(opf_base_path);
        if !opf_base.is_empty() {
            alt_paths.push(format!("{}{}", opf_base, cover_path));
            alt_paths.push(format!("{}{}", opf_base, cover_href));
        }
        
        for alt_path in &alt_paths {
            if let Ok(mut file) = archive.by_name(alt_path) {
                cover_bytes.clear();
                if file.read_to_end(&mut cover_bytes).is_ok() && !cover_bytes.is_empty() {
                    debug!("Found cover at alternative path: '{}'", alt_path);
                    found_cover = true;
                    break;
                }
            }
        }
    }
    
    if !found_cover || cover_bytes.is_empty() {
        warn!("Cover image not found at path '{}' or alternatives", cover_path);
        return None;
    }
    
    // Determine MIME type from file extension (try both cover_path and cover_href)
    // or detect from magic bytes
    let mime_type = if cover_path.ends_with(".png") || cover_href.ends_with(".png") {
        "image/png"
    } else if cover_path.ends_with(".jpg") || cover_path.ends_with(".jpeg") ||
              cover_href.ends_with(".jpg") || cover_href.ends_with(".jpeg") {
        "image/jpeg"
    } else if cover_path.ends_with(".gif") || cover_href.ends_with(".gif") {
        "image/gif"
    } else if cover_path.ends_with(".webp") || cover_href.ends_with(".webp") {
        "image/webp"
    } else if cover_path.ends_with(".svg") || cover_href.ends_with(".svg") {
        "image/svg+xml"
    } else {
        // Try to detect from magic bytes
        if cover_bytes.len() >= 4 {
            match &cover_bytes[0..4] {
                [0x89, 0x50, 0x4E, 0x47] => "image/png",
                [0xFF, 0xD8, 0xFF, _] => "image/jpeg",
                [0x47, 0x49, 0x46, 0x38] => "image/gif",
                _ => "image/jpeg", // Default fallback
            }
        } else {
            "image/jpeg"
        }
    };
    
    // Encode to base64
    use base64::{Engine as _, engine::general_purpose};
    let base64_data = general_purpose::STANDARD.encode(&cover_bytes);
    
    // Create data URL
    let data_url = format!("data:{};base64,{}", mime_type, base64_data);
    
    debug!("Successfully extracted cover image ({} bytes, type: {})", cover_bytes.len(), mime_type);
    
    Some(data_url)
}

