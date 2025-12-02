use std::collections::HashMap;
use std::io::Cursor;
use zip::ZipArchive;
use epub::doc::EpubDoc;

use crate::book_service::models::Chapter;
use crate::utils::constants::*;
use crate::utils::path_validation::validate_epub_path;

use super::types::ManifestItem;
use super::opf::{find_opf_path, derive_base_path_from_opf};
use super::navigation::parse_ncx_titles;

/// Extract chapters from an EPUB file.
///
/// This is the main function for parsing an EPUB and extracting all chapters
/// with their metadata. It processes the OPF file, navigation document, and
/// chapter content to build a complete list of chapters.
///
/// # Arguments
/// * `epub_data` - The EPUB file as a byte vector
///
/// # Returns
/// A tuple containing:
/// * `Vec<Chapter>` - List of chapters with metadata and content
/// * `(usize, usize, usize, usize, usize)` - Statistics tuple:
///   - Manifest item count
///   - Spine itemref count
///   - Missing manifest count
///   - Non-HTML file count
///   - Filtered count
///
/// # Errors
/// Returns an error string if:
/// - The EPUB cannot be opened as a ZIP archive
/// - The OPF file cannot be found or parsed
/// - Chapter files cannot be read
///
/// # Example
/// ```rust
/// let epub_data = std::fs::read("book.epub")?;
/// let (chapters, stats) = extract_chapters_from_epub(&epub_data)?;
/// println!("Found {} chapters", chapters.len());
/// ```
pub fn extract_chapters_from_epub(
    epub_data: &[u8],
) -> Result<(Vec<Chapter>, (usize, usize, usize, usize, usize)), String> {
    use uuid::Uuid;
    use log::{debug, warn};
    
    // Open EPUB using the epub crate
    // EpubDoc::new() requires a file path, but we have bytes, so we need to use from_reader
    // The epub crate supports reading from a Cursor
    let mut epub = EpubDoc::from_reader(Cursor::new(epub_data.to_vec()))
        .map_err(|e| format!("Failed to open EPUB with epub crate: {}", e))?;
    
    // Get OPF path from the epub crate
    // The epub crate stores the OPF internally, we can get it via the resources
    let opf_path = find_opf_path(&mut ZipArchive::new(Cursor::new(epub_data))
        .map_err(|e| format!("Failed to open EPUB archive: {}", e))?)?;
    debug!("Using OPF path: {}", opf_path);
    
    // Determine base path from OPF location  
    let base_path = derive_base_path_from_opf(&opf_path);
    debug!("Base path derived from OPF: '{}' (OPF: '{}')", base_path, opf_path);
    
    // Build manifest items map from epub crate resources
    let mut manifest_items: HashMap<String, ManifestItem> = HashMap::new();
    let resources = epub.resources.clone();
    
    for (id, resource) in resources {
        let href = resource.path.to_string_lossy().to_string();
        let media_type = resource.mime.clone();
        
        // Properties in epub crate is already Option<String>, just clone it
        let properties_str = resource.properties.clone();
        
        manifest_items.insert(id.clone(), ManifestItem {
            id,
            href,
            media_type: Some(media_type),
            properties: properties_str,
        });
    }
    
    let manifest_count = manifest_items.len();
    let mut spine_itemref_count = 0;
    let mut missing_manifest_count = 0;
    let mut non_html_count = 0;
    let mut filtered_count = 0;
    
    // Get navigation titles from NCX if available
    let mut ncx_title_map: HashMap<String, String> = HashMap::new();
    // Try to get NCX content and parse it
    if let Some(ncx_content) = epub.get_resource_by_path("toc.ncx") {
        if let Ok(ncx_str) = String::from_utf8(ncx_content) {
            if let Ok(titles) = parse_ncx_titles(&ncx_str) {
                ncx_title_map = titles;
            }
        }
    }
    
    // Extract chapters from spine using epub crate's spine iterator
    let mut chapters = Vec::new();
    let mut chapter_index = 0;
    
    // The epub crate provides a spine() method that returns spine items
    // We need to iterate through the spine and get each resource
    let spine = epub.spine.clone();
    
    for spine_item in spine {
        spine_itemref_count += 1;
        
        let idref = spine_item.idref;
        let linear = spine_item.linear;
        
        // Skip non-linear items (like notes, references)
        if !linear {
            filtered_count += 1;
            continue;
        }
        
        // Get the resource for this spine item
        if let Some(resource) = epub.resources.get(&idref) {
            let href = resource.path.to_string_lossy().to_string();
            
            // Validate and sanitize href path for security
            let validated_href = match validate_epub_path(&href) {
                Ok(v) => v,
                Err(e) => {
                    warn!("Invalid chapter path '{}': {}, skipping", href, e);
                    filtered_count += 1;
                    continue;
                }
            };
            
            // Only include HTML/XHTML chapters
            let media_type = &resource.mime;
            let is_html_content = media_type == MEDIA_TYPE_XHTML 
                || media_type == MEDIA_TYPE_HTML 
                || media_type == MEDIA_TYPE_HTML_XML
                || validated_href.ends_with(".xhtml")
                || validated_href.ends_with(".html");
            
            if !is_html_content {
                non_html_count += 1;
                continue;
            }
            
            // Exclude navigation, toc, and copyright pages
            let href_lower = validated_href.to_lowercase();
            let is_excluded = href_lower.contains("toc")
                || href_lower.contains("nav")
                || href_lower.contains("copyright")
                || href_lower.contains("cover")
                || href_lower.contains("titlepage");
            
            if is_excluded {
                filtered_count += 1;
                continue;
            }
            
            // Extract title from navigation if available, otherwise use fallback
            let normalized_href = if validated_href.starts_with("/") {
                validated_href[1..].to_string()
            } else {
                validated_href.clone()
            };
            
            // Try to find title in navigation map
            let title = if let Some(nav_title) = ncx_title_map.get(&normalized_href) {
                debug!("Using navigation title '{}' for href '{}'", nav_title, normalized_href);
                nav_title.clone()
            } else {
                debug!("No navigation title found for href '{}', using fallback", normalized_href);
                format!("Section {}", chapter_index + 1)
            };
            
            chapter_index += 1;
            
            chapters.push(Chapter {
                id: format!("{}-{}", Uuid::new_v4().to_string(), idref),
                title,
                content_html: None, // Lazy loading
                plain_text: None,
                order: chapter_index - 1, // Use 0-based index
                href: validated_href,
                word_count: None,
                estimated_page_count: None,
            });
        } else {
            missing_manifest_count += 1;
            warn!("Manifest item '{}' not found in manifest", idref);
        }
    }
    
    let stats = (manifest_count, spine_itemref_count, missing_manifest_count, non_html_count, filtered_count);
    Ok((chapters, stats))
}

