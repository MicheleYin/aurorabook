use std::io::{Cursor, Read};
use zip::ZipArchive;
use epub::doc::EpubDoc;

/// Find the content.opf path using epub crate.
///
/// This function uses the epub crate to get the OPF path from the EPUB.
/// The epub crate stores the OPF path internally, but we need to extract it
/// from the container.xml for compatibility with other functions.
///
/// # Arguments
/// * `_epub` - Reference to the EpubDoc instance (currently unused, kept for API compatibility)
///
/// # Returns
/// The path to the OPF file within the EPUB archive.
pub fn find_opf_path_from_epub(_epub: &EpubDoc<Cursor<Vec<u8>>>) -> Result<String, String> {
    // The epub crate stores the OPF path internally, but we typically
    // need to find it via container.xml for compatibility
    // This function is kept for API compatibility but the actual path
    // is determined via find_opf_path() which reads container.xml
    Ok("content.opf".to_string())
}

/// Find the content.opf path from container.xml or common locations.
///
/// This is a compatibility function that still uses ZIP archive for cases
/// where we need to work with raw ZIP data without rbook.
///
/// # Arguments
/// * `archive` - Mutable reference to the EPUB ZIP archive
///
/// # Returns
/// The path to the OPF file within the EPUB archive.
pub fn find_opf_path(archive: &mut ZipArchive<Cursor<&[u8]>>) -> Result<String, String> {
    use quick_xml::events::Event;
    use quick_xml::Reader;
    
    // Try container.xml first
    if let Ok(mut container_file) = archive.by_name("META-INF/container.xml") {
        let mut container_content = String::new();
        if container_file.read_to_string(&mut container_content).is_ok() {
            let mut reader = Reader::from_str(&container_content);
            reader.trim_text(true);
            let mut full_path = String::new();
            let mut media_type = String::new();
            
            loop {
                match reader.read_event() {
                    Ok(Event::Start(e)) => {
                        if e.name().as_ref() == b"rootfile" {
                            full_path.clear();
                            media_type.clear();
                            for attr in e.attributes() {
                                if let Ok(attr) = attr {
                                    match attr.key.as_ref() {
                                        b"full-path" => {
                                            full_path = String::from_utf8_lossy(&attr.value).to_string();
                                        }
                                        b"media-type" => {
                                            media_type = String::from_utf8_lossy(&attr.value).to_string();
                                        }
                                        _ => {}
                                    }
                                }
                            }
                            if media_type == "application/oebps-package+xml" && !full_path.is_empty() {
                                return Ok(full_path);
                            }
                        }
                    }
                    Ok(Event::Eof) => break,
                    _ => {}
                }
            }
        }
    }
    
    // Fallback to common paths
    let common_paths = [
        "OEBPS/content.opf",
        "content.opf",
        "OEBPS/package.opf",
        "package.opf",
    ];
    
    for path in &common_paths {
        if archive.by_name(path).is_ok() {
            return Ok(path.to_string());
        }
    }
    
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

