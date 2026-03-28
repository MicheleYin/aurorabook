use std::io::{Read, Seek};
use zip::ZipArchive;

/// Find the content.opf path from container.xml or common locations.
///
/// This function always prioritizes reading from META-INF/container.xml as per EPUB spec.
/// It handles various XML structures, namespaces, and media types robustly.
///
/// # Arguments
/// * `archive` - Mutable reference to the EPUB ZIP archive
///
/// # Returns
/// The path to the OPF file within the EPUB archive.
pub fn find_opf_path<R: Read + Seek>(archive: &mut ZipArchive<R>) -> Result<String, String> {
    use quick_xml::events::Event;
    use quick_xml::Reader;
    use log::debug;
    
    // Always try container.xml first - this is the EPUB spec standard
    if let Ok(mut container_file) = archive.by_name("META-INF/container.xml") {
        let mut container_content = String::new();
        if container_file.read_to_string(&mut container_content).is_ok() {
            debug!("Found META-INF/container.xml, parsing for OPF path");
            let mut reader = Reader::from_str(&container_content);
            reader.trim_text(true);
            
            let mut full_path = String::new();
            let mut media_type = String::new();
            let mut found_paths: Vec<(String, String)> = Vec::new();
            
            loop {
                match reader.read_event() {
                    Ok(Event::Start(e)) | Ok(Event::Empty(e)) => {
                        // Handle both <rootfile> and <rootfile /> elements
                        // Check local name to handle namespaces (e.g., xmlns:container)
                        let name_bytes = e.name().into_inner();
                        let name_str = String::from_utf8_lossy(name_bytes);
                        
                        // Check if this is a rootfile element (handle namespaces)
                        let is_rootfile = name_bytes == b"rootfile" || 
                                         name_str.ends_with(":rootfile") ||
                                         name_str == "rootfile";
                        
                        if is_rootfile {
                            full_path.clear();
                            media_type.clear();
                            
                            // Extract attributes
                            for attr in e.attributes() {
                                if let Ok(attr) = attr {
                                    let attr_key = attr.key.as_ref();
                                    let attr_key_str = String::from_utf8_lossy(attr_key);
                                    let attr_value = String::from_utf8_lossy(&attr.value).to_string();
                                    
                                    // Handle both "full-path" and "fullPath" (some EPUBs use camelCase)
                                    if attr_key == b"full-path" || 
                                       attr_key_str.ends_with(":full-path") ||
                                       attr_key_str == "fullPath" ||
                                       attr_key_str.ends_with(":fullPath") {
                                        full_path = attr_value;
                                    }
                                    // Handle media-type attribute
                                    else if attr_key == b"media-type" || 
                                            attr_key_str.ends_with(":media-type") ||
                                            attr_key_str == "mediaType" ||
                                            attr_key_str.ends_with(":mediaType") {
                                        media_type = attr_value;
                                    }
                                }
                            }
                            
                            // If we found a full-path, store it
                            if !full_path.is_empty() {
                                found_paths.push((full_path.clone(), media_type.clone()));
                                debug!("Found rootfile in container.xml: full-path='{}', media-type='{}'", 
                                       full_path, media_type);
                                
                                // Accept if media-type matches OPF types, or if no media-type specified
                                // Common OPF media types:
                                // - application/oebps-package+xml (EPUB 2)
                                // - application/oebps-package+xml (EPUB 3)
                                // Some EPUBs might not specify media-type, so we accept any with .opf extension
                                let is_valid_opf = media_type.is_empty() ||
                                                  media_type == "application/oebps-package+xml" ||
                                                  media_type == "application/epub+zip" ||
                                                  full_path.ends_with(".opf");
                                
                                if is_valid_opf {
                                    debug!("Using OPF path from container.xml: {}", full_path);
                                    return Ok(full_path);
                                }
                            }
                        }
                    }
                    Ok(Event::End(_e)) => {
                        // End tags don't need special handling for rootfile
                    }
                    Ok(Event::Eof) => break,
                    Err(e) => {
                        debug!("XML parse error in container.xml: {}, will try fallback paths", e);
                        break;
                    }
                    _ => {}
                }
            }
            
            // If we found paths but none matched media-type, use the first one found
            // (some EPUBs might have incorrect or missing media-type)
            if !found_paths.is_empty() {
                let (first_path, first_media_type) = &found_paths[0];
                debug!("Using first rootfile path from container.xml (media-type='{}'): {}", 
                       first_media_type, first_path);
                return Ok(first_path.clone());
            }
        } else {
            debug!("Failed to read META-INF/container.xml content");
        }
    } else {
        debug!("META-INF/container.xml not found, trying fallback paths");
    }
    
    // Fallback to common paths only if container.xml is missing or unparseable
    debug!("Trying fallback OPF paths");
    let common_paths = [
        "OEBPS/content.opf",
        "content.opf",
        "OEBPS/package.opf",
        "package.opf",
        "EPUB/content.opf",
        "EPUB/package.opf",
    ];
    
    for path in &common_paths {
        if archive.by_name(path).is_ok() {
            debug!("Found OPF at fallback path: {}", path);
            return Ok(path.to_string());
        }
    }
    
    // Last resort: return default (but this should rarely happen)
    debug!("No OPF found, using default 'content.opf'");
    Ok("content.opf".to_string())
}

/// Derive the base path from an OPF path.
///
/// This function extracts the directory portion of the OPF path.
/// For example:
/// - "EPUB/content.opf" -> "EPUB/"
/// - "OEBPS/content.opf" -> "OEBPS/"
/// - "content.opf" -> ""
///
/// # Arguments
/// * `opf_path` - The path to the OPF file within the EPUB archive
///
/// # Returns
/// The base directory path (with trailing slash) or empty string if OPF is at root
pub fn derive_base_path_from_opf(opf_path: &str) -> String {
    if opf_path.contains("/") {
        opf_path.rfind("/")
            .map(|pos| opf_path[..pos + 1].to_string())
            .unwrap_or_else(|| String::new())
    } else {
        String::new()
    }
}

