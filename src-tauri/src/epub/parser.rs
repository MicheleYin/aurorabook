use crate::book_service::models::Chapter;
use crate::utils::constants::*;
use crate::utils::path_validation::validate_epub_path;
use std::collections::HashMap;
use std::io::{Cursor, Read};
use zip::ZipArchive;

/// EPUB metadata extracted from the OPF (Open Packaging Format) file.
///
/// Contains all the metadata about the EPUB book, including title, author,
/// publisher, publication date, and cover image information.
///
/// # Fields
/// * `title` - Book title
/// * `creator` - Author/creator name
/// * `publisher` - Publisher name
/// * `subjects` - List of subject tags/categories
/// * `pubdate` - Publication date
/// * `modified_date` - Last modification date
/// * `cover_id` - ID of the cover image in the manifest
#[derive(Debug, Clone)]
pub struct EpubMetadata {
    pub title: Option<String>,
    pub creator: Option<String>,
    pub publisher: Option<String>,
    pub subjects: Vec<String>,
    pub pubdate: Option<String>,
    pub modified_date: Option<String>,
    pub cover_id: Option<String>,
}

/// Manifest item from the OPF file.
///
/// Represents a file entry in the EPUB manifest, which lists all files
/// included in the EPUB package.
///
/// # Fields
/// * `id` - Unique identifier for the item
/// * `href` - Relative path to the file
/// * `media_type` - MIME type of the file (e.g., "application/xhtml+xml")
/// * `properties` - Optional properties (e.g., "nav", "cover-image")
#[derive(Debug, Clone)]
pub struct ManifestItem {
    pub id: String,
    pub href: String,
    pub media_type: Option<String>,
    pub properties: Option<String>,
}

/// Find the content.opf path from container.xml or common locations.
///
/// EPUB files must contain a container.xml file that points to the OPF file.
/// This function first tries to read container.xml, and if that fails, it
/// checks common locations where OPF files are typically stored.
///
/// # Arguments
/// * `archive` - Mutable reference to the EPUB ZIP archive
///
/// # Returns
/// The path to the OPF file within the EPUB archive.
///
/// # Errors
/// Returns an error string if the archive cannot be read.
///
/// # Common Paths Checked
/// - `META-INF/container.xml` (EPUB 2.0/3.0 standard)
/// - `OEBPS/content.opf`
/// - `content.opf`
/// - `OEBPS/package.opf`
/// - `package.opf`
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

/// Parse OPF file and extract all needed data in one pass.
///
/// This function parses the EPUB's OPF (Open Packaging Format) file and extracts:
/// - Metadata (title, author, publisher, etc.)
/// - Manifest items (all files in the EPUB)
/// - Spine items (reading order of chapters)
///
/// The parsing is done in a single pass for efficiency.
///
/// # Arguments
/// * `opf_content` - The OPF file content as a string
///
/// # Returns
/// A tuple containing:
/// * `EpubMetadata` - Extracted metadata
/// * `HashMap<String, ManifestItem>` - Map of manifest item IDs to items
/// * `Vec<(String, String)>` - Spine items as (idref, linear) pairs
///
/// # Errors
/// Returns an error string if XML parsing fails or the OPF structure is invalid.
///
/// # Example
/// ```rust
/// let opf_content = std::fs::read_to_string("content.opf")?;
/// let (metadata, manifest, spine) = parse_opf_content(&opf_content)?;
/// println!("Title: {:?}", metadata.title);
/// ```
pub fn parse_opf_content(opf_content: &str) -> Result<(EpubMetadata, HashMap<String, ManifestItem>, Vec<(String, String)>), String> {
    use quick_xml::events::Event;
    use quick_xml::Reader;
    use log::{debug, warn};
    
    debug!("Starting to parse OPF content ({} bytes)", opf_content.len());
    debug!("First 500 chars of OPF: {}", &opf_content.chars().take(500).collect::<String>());
    
    let mut metadata = EpubMetadata {
        title: None,
        creator: None,
        publisher: None,
        subjects: Vec::new(),
        pubdate: None,
        modified_date: None,
        cover_id: None,
    };
    
    let mut manifest_items: HashMap<String, ManifestItem> = HashMap::new();
    let mut spine_items = Vec::new();
    
    let mut reader = Reader::from_str(opf_content);
    reader.trim_text(true);
    
    let mut in_metadata = false;
    let mut in_manifest = false;
    let mut in_spine = false;
    let mut current_item: Option<ManifestItem> = None;
    
    // Helper to extract text from current element
    let extract_text = |reader: &mut Reader<&[u8]>, end_tag: &[u8]| -> Result<String, String> {
        let mut text = String::new();
        let mut depth = 1;
        loop {
            match reader.read_event() {
                Ok(Event::Text(t)) => {
                    if depth == 1 {
                        text.push_str(&String::from_utf8_lossy(&t.into_inner()));
                    }
                }
                Ok(Event::Start(_)) => {
                    depth += 1;
                }
                Ok(Event::End(e)) => {
                    if e.name().as_ref() == end_tag {
                        depth -= 1;
                        if depth == 0 {
                            break;
                        }
                    } else {
                        depth -= 1;
                    }
                }
                Ok(Event::Eof) => break,
                Err(e) => return Err(format!("XML parse error: {}", e)),
                _ => {}
            }
        }
        Ok(text.trim().to_string())
    };
    
    let mut event_count = 0;
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => {
                event_count += 1;
                let name_vec: Vec<u8> = e.name().as_ref().to_vec();
                let name_bytes = name_vec.as_slice();
                let element_name = String::from_utf8_lossy(name_bytes);
                
                // Handle namespaced elements by checking local name
                let local_name = if let Some(colon_pos) = element_name.find(':') {
                    &element_name[colon_pos + 1..]
                } else {
                    &element_name
                };
                let local_name_bytes = local_name.as_bytes();
                
                if name_bytes == b"metadata" || local_name == "metadata" {
                    in_metadata = true;
                    debug!("Entered <metadata> section");
                } else if name_bytes == b"manifest" || local_name == "manifest" {
                    in_manifest = true;
                    debug!("Entered <manifest> section");
                } else if name_bytes == b"spine" || local_name == "spine" {
                    in_spine = true;
                    debug!("Entered <spine> section");
                } else if in_metadata {
                    // Handle metadata elements
                    if name_bytes == b"title" || local_name_bytes == b"title" ||
                       name_bytes == b"creator" || local_name_bytes == b"creator" ||
                       name_bytes == b"publisher" || local_name_bytes == b"publisher" ||
                       name_bytes == b"subject" || local_name_bytes == b"subject" {
                        let element_name_for_match = element_name.clone();
                        let local_name_for_match = local_name.to_string();
                        let mut text = String::new();
                        let mut depth = 1;
                        
                        loop {
                            match reader.read_event() {
                                Ok(Event::Text(t)) => {
                                    if depth == 1 {
                                        text.push_str(&String::from_utf8_lossy(&t.into_inner()));
                                    }
                                }
                                Ok(Event::Start(_)) => {
                                    depth += 1;
                                }
                                Ok(Event::End(e)) => {
                                    let name_bytes = e.name().into_inner();
                                    let end_name_owned = String::from_utf8_lossy(&name_bytes).to_string();
                                    let end_local_owned = if let Some(colon_pos) = end_name_owned.find(':') {
                                        end_name_owned[colon_pos + 1..].to_string()
                                    } else {
                                        end_name_owned.clone()
                                    };
                                    if end_name_owned == element_name_for_match || end_local_owned == local_name_for_match {
                                        depth -= 1;
                                        if depth == 0 {
                                            break;
                                        }
                                    } else {
                                        depth -= 1;
                                    }
                                }
                                Ok(Event::Eof) => break,
                                Err(e) => {
                                    warn!("Error reading text: {}", e);
                                    break;
                                }
                                _ => {}
                            }
                        }
                        let text = text.trim().to_string();
                        if !text.is_empty() {
                            debug!("Extracted text: '{}'", text);
                            if local_name_bytes == b"title" {
                                metadata.title = Some(text);
                            } else if local_name_bytes == b"creator" {
                                metadata.creator = Some(text);
                            } else if local_name_bytes == b"publisher" {
                                metadata.publisher = Some(text);
                            } else if local_name_bytes == b"subject" {
                                metadata.subjects.push(text);
                            }
                        }
                    } else if name_bytes == b"date" || local_name_bytes == b"date" {
                        let mut event_type = String::new();
                        for attr in e.attributes() {
                            if let Ok(attr) = attr {
                                if attr.key.as_ref() == b"event" {
                                    event_type = String::from_utf8_lossy(&attr.value).to_string();
                                }
                            }
                        }
                        if let Ok(text) = extract_text(&mut reader, name_bytes) {
                            if !text.is_empty() && (event_type == "publication" || metadata.pubdate.is_none()) {
                                metadata.pubdate = Some(text);
                            }
                        }
                    } else if name_bytes == b"meta" {
                        let mut name_attr = String::new();
                        let mut content_attr = String::new();
                        let mut is_modified = false;
                        
                        for attr in e.attributes() {
                            if let Ok(attr) = attr {
                                match attr.key.as_ref() {
                                    b"name" => {
                                        name_attr = String::from_utf8_lossy(&attr.value).to_string();
                                    }
                                    b"content" => {
                                        content_attr = String::from_utf8_lossy(&attr.value).to_string();
                                    }
                                    b"property" => {
                                        if String::from_utf8_lossy(&attr.value) == "dcterms:modified" {
                                            is_modified = true;
                                        }
                                    }
                                    _ => {}
                                }
                            }
                        }
                        
                        if is_modified {
                            if let Ok(text) = extract_text(&mut reader, name_bytes) {
                                if !text.is_empty() {
                                    metadata.modified_date = Some(text);
                                }
                            }
                        } else if name_attr == "cover" && !content_attr.is_empty() {
                            metadata.cover_id = Some(content_attr);
                        }
                    }
                } else if in_manifest && (name_bytes == b"item" || local_name == "item") {
                    debug!("Found <item> in manifest");
                    let mut item = ManifestItem {
                        id: String::new(),
                        href: String::new(),
                        media_type: None,
                        properties: None,
                    };
                    
                    for attr in e.attributes() {
                        if let Ok(attr) = attr {
                            let attr_value = String::from_utf8_lossy(&attr.value);
                            match attr.key.as_ref() {
                                b"id" => {
                                    item.id = attr_value.to_string();
                                    debug!("  item id: {}", item.id);
                                }
                                b"href" => {
                                    item.href = attr_value.to_string();
                                    debug!("  item href: {}", item.href);
                                }
                                b"media-type" => {
                                    item.media_type = Some(attr_value.to_string());
                                    debug!("  item media-type: {}", attr_value);
                                }
                                b"properties" => {
                                    item.properties = Some(attr_value.to_string());
                                    debug!("  item properties: {}", attr_value);
                                }
                                _ => {}
                            }
                        }
                    }
                    
                    if !item.id.is_empty() {
                        debug!("  Storing manifest item: id='{}', href='{}'", item.id, item.href);
                        // For Event::Start, store in current_item to be finalized on Event::End
                        current_item = Some(item);
                    } else {
                        warn!("  Item has empty id, skipping");
                    }
                } else if in_spine && (name_bytes == b"itemref" || local_name == "itemref") {
                    debug!("Found <itemref> in spine");
                    let mut idref = String::new();
                    for attr in e.attributes() {
                        if let Ok(attr) = attr {
                            if attr.key.as_ref() == b"idref" {
                                idref = String::from_utf8_lossy(&attr.value).to_string();
                                debug!("  itemref idref: {}", idref);
                                break;
                            }
                        }
                    }
                    if !idref.is_empty() {
                        if let Some(item) = manifest_items.get(&idref) {
                            debug!("  Found manifest item for idref '{}', adding to spine", idref);
                            spine_items.push((idref.clone(), item.href.clone()));
                        } else {
                            warn!("  No manifest item found for idref '{}' (manifest has {} items)", idref, manifest_items.len());
                        }
                    } else {
                        warn!("  itemref has empty idref");
                    }
                }
            }
            Ok(Event::Empty(e)) => {
                // Handle self-closing elements (like <item ... />)
                event_count += 1;
                let name_vec: Vec<u8> = e.name().as_ref().to_vec();
                let name_bytes = name_vec.as_slice();
                let element_name = String::from_utf8_lossy(name_bytes);
                
                // Handle namespaced elements by checking local name
                let local_name = if let Some(colon_pos) = element_name.find(':') {
                    &element_name[colon_pos + 1..]
                } else {
                    &element_name
                };
                
                if name_bytes == b"metadata" || local_name == "metadata" {
                    in_metadata = true;
                    debug!("Entered <metadata> section (empty)");
                } else if name_bytes == b"manifest" || local_name == "manifest" {
                    in_manifest = true;
                    debug!("Entered <manifest> section (empty)");
                } else if name_bytes == b"spine" || local_name == "spine" {
                    in_spine = true;
                    debug!("Entered <spine> section (empty)");
                } else if in_manifest && (name_bytes == b"item" || local_name == "item") {
                    // Handle self-closing <item /> elements - store immediately
                    debug!("Found self-closing <item> in manifest");
                    let mut item = ManifestItem {
                        id: String::new(),
                        href: String::new(),
                        media_type: None,
                        properties: None,
                    };
                    
                    for attr in e.attributes() {
                        if let Ok(attr) = attr {
                            let attr_value = String::from_utf8_lossy(&attr.value);
                            match attr.key.as_ref() {
                                b"id" => {
                                    item.id = attr_value.to_string();
                                    debug!("  item id: {}", item.id);
                                }
                                b"href" => {
                                    item.href = attr_value.to_string();
                                    debug!("  item href: {}", item.href);
                                }
                                b"media-type" => {
                                    item.media_type = Some(attr_value.to_string());
                                    debug!("  item media-type: {}", attr_value);
                                }
                                b"properties" => {
                                    item.properties = Some(attr_value.to_string());
                                    debug!("  item properties: {}", attr_value);
                                }
                                _ => {}
                            }
                        }
                    }
                    
                    if !item.id.is_empty() {
                        debug!("  Storing self-closing manifest item: id='{}', href='{}'", item.id, item.href);
                        manifest_items.insert(item.id.clone(), item);
                    } else {
                        warn!("  Self-closing item has empty id, skipping");
                    }
                } else if in_spine && (name_bytes == b"itemref" || local_name == "itemref") {
                    // Handle self-closing <itemref /> elements
                    debug!("Found self-closing <itemref> in spine");
                    let mut idref = String::new();
                    for attr in e.attributes() {
                        if let Ok(attr) = attr {
                            if attr.key.as_ref() == b"idref" {
                                idref = String::from_utf8_lossy(&attr.value).to_string();
                                debug!("  itemref idref: {}", idref);
                                break;
                            }
                        }
                    }
                    if !idref.is_empty() {
                        if let Some(item) = manifest_items.get(&idref) {
                            debug!("  Found manifest item for idref '{}', adding to spine", idref);
                            spine_items.push((idref.clone(), item.href.clone()));
                        } else {
                            warn!("  No manifest item found for idref '{}' (manifest has {} items)", idref, manifest_items.len());
                        }
                    } else {
                        warn!("  Self-closing itemref has empty idref");
                    }
                }
            }
            Ok(Event::End(e)) => {
                let name_bytes_vec = e.name().into_inner();
                let name_bytes = &name_bytes_vec[..];
                let end_element_name = String::from_utf8_lossy(name_bytes);
                let end_local_name = if let Some(colon_pos) = end_element_name.find(':') {
                    &end_element_name[colon_pos + 1..]
                } else {
                    &end_element_name
                };
                
                if name_bytes == b"metadata" || end_local_name == "metadata" {
                    in_metadata = false;
                    debug!("Exited <metadata> section");
                } else if name_bytes == b"manifest" || end_local_name == "manifest" {
                    in_manifest = false;
                    debug!("Exited <manifest> section (collected {} items)", manifest_items.len());
                } else if name_bytes == b"spine" || end_local_name == "spine" {
                    in_spine = false;
                    debug!("Exited <spine> section (collected {} items)", spine_items.len());
                } else if (name_bytes == b"item" || end_local_name == "item") && in_manifest {
                    if let Some(item) = current_item.take() {
                        debug!("Finalizing manifest item: id='{}', href='{}'", item.id, item.href);
                        manifest_items.insert(item.id.clone(), item);
                    } else {
                        warn!("Found </item> end tag but current_item is None");
                    }
                }
            }
            Ok(Event::Eof) => {
                debug!("Reached end of file. Processed {} events", event_count);
                break;
            }
            Err(e) => {
                warn!("XML parse error at event #{}: {}", event_count, e);
                return Err(format!("XML parse error: {}", e));
            }
            _ => {}
        }
    }
    
    debug!("Parsing complete:");
    debug!("  - Metadata: title={:?}, creator={:?}", metadata.title, metadata.creator);
    debug!("  - Manifest items: {}", manifest_items.len());
    debug!("  - Spine items: {}", spine_items.len());
    
    Ok((metadata, manifest_items, spine_items))
}

/// Parse navigation document to extract chapter titles
pub fn parse_navigation(nav_content: &str) -> Result<HashMap<String, String>, String> {
    use quick_xml::events::Event;
    use quick_xml::Reader;
    
    let mut nav_map = HashMap::new();
    let mut reader = Reader::from_str(nav_content);
    reader.trim_text(true);
    
    let mut in_nav_toc = false;
    let mut current_href = String::new();
    let mut current_label = String::new();
    
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => {
                let name_vec: Vec<u8> = e.name().as_ref().to_vec();
                let name_bytes = name_vec.as_slice();
                if name_bytes == b"nav" {
                    for attr in e.attributes() {
                        if let Ok(attr) = attr {
                            if attr.key.as_ref() == b"epub:type" {
                                let epub_type = String::from_utf8_lossy(&attr.value);
                                if epub_type == "toc" {
                                    in_nav_toc = true;
                                }
                            }
                        }
                    }
                } else if in_nav_toc && name_bytes == b"a" {
                    for attr in e.attributes() {
                        if let Ok(attr) = attr {
                            if attr.key.as_ref() == b"href" {
                                current_href = String::from_utf8_lossy(&attr.value).to_string();
                                // Remove fragment
                                if let Some(pos) = current_href.find('#') {
                                    current_href = current_href[..pos].to_string();
                                }
                            }
                        }
                    }
                }
            }
            Ok(Event::Text(t)) => {
                if in_nav_toc && !current_href.is_empty() {
                    current_label.push_str(&String::from_utf8_lossy(&t.into_inner()));
                }
            }
            Ok(Event::End(e)) => {
                let name_vec: Vec<u8> = e.name().as_ref().to_vec();
                let name_bytes = name_vec.as_slice();
                if name_bytes == b"a" && !current_href.is_empty() && !current_label.trim().is_empty() {
                    nav_map.insert(current_href.clone(), current_label.trim().to_string());
                    current_href.clear();
                    current_label.clear();
                } else if name_bytes == b"nav" {
                    in_nav_toc = false;
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(format!("XML parse error: {}", e)),
            _ => {}
        }
    }
    
    Ok(nav_map)
}

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
        let alt_paths = [
            format!("OEBPS/{}", cover_path),
            format!("OPS/{}", cover_path),
            cover_href.to_string(),
            format!("OEBPS/{}", cover_href),
            format!("OPS/{}", cover_href),
        ];
        
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

/// Extract published year from date string
pub fn extract_year(date: Option<&String>) -> Option<String> {
    date.and_then(|d| {
        d.chars()
            .filter(|c| c.is_ascii_digit())
            .take(4)
            .collect::<String>()
            .parse::<String>()
            .ok()
            .filter(|s| s.len() == 4)
    })
}

/// Derive title from file path
pub fn derive_title_from_path(path: &str) -> String {
    path.split('/')
        .last()
        .unwrap_or("Unknown")
        .replace(".epub", "")
        .to_string()
}

/// Generate audio track title from filename
pub fn generate_audio_track_title(filename: &str, index: usize) -> String {
    let decoded = filename.replace("%20", " ").replace("%2D", "-");
    let base_title = decoded
        .replace(".mp3", "")
        .replace(".wav", "")
        .replace(".m4a", "")
        .replace("_", " ")
        .replace("-", " ")
        .trim()
        .to_string();
    
    if base_title.is_empty() {
        format!("Track {}", index + 1)
    } else {
        base_title
    }
}

/// Extract audio tracks from EPUB manifest items.
///
/// This function scans the manifest for items with audio media types
/// (audio/mpeg, audio/wav, audio/mp4, etc.) and creates AudioTrack objects
/// for each one found.
///
/// # Arguments
/// * `manifest_items` - HashMap of manifest item IDs to ManifestItem objects
///
/// # Returns
/// A vector of AudioTrack objects sorted by their href paths.
pub fn extract_audio_tracks_from_manifest(
    manifest_items: &HashMap<String, ManifestItem>,
) -> Vec<crate::book_service::models::AudioTrack> {
    use crate::book_service::models::AudioTrack;
    use uuid::Uuid;
    
    let mut audio_tracks: Vec<AudioTrack> = Vec::new();
    
    // Collect all audio items from manifest
    for (_id, item) in manifest_items.iter() {
        if let Some(media_type) = &item.media_type {
            // Check if this is an audio file
            if media_type.starts_with("audio/") {
                // Generate a title from the filename
                let filename = item.href.split('/').last().unwrap_or(&item.href);
                let track_index = audio_tracks.len();
                let title = generate_audio_track_title(filename, track_index);
                
                audio_tracks.push(AudioTrack {
                    id: Uuid::new_v4().to_string(),
                    title,
                    href: item.href.clone(),
                    url: None, // Will be loaded lazily when needed
                    duration: None, // Will be determined when audio is loaded
                });
            }
        }
    }
    
    // Sort by href to ensure consistent ordering
    audio_tracks.sort_by(|a, b| a.href.cmp(&b.href));
    
    audio_tracks
}

/// Extract chapters from EPUB data
/// Returns (chapters, stats) where stats is (manifest_count, spine_itemref_count, missing_manifest_count, non_html_count, filtered_count)
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
    
    let mut archive = ZipArchive::new(Cursor::new(epub_data))
        .map_err(|e| format!("Failed to open EPUB: {}", e))?;
    
    // Find OPF path
    let opf_path = find_opf_path(&mut archive)?;
    debug!("Using OPF path: {}", opf_path);
    
    // Read OPF content
    let mut opf_file = archive.by_name(&opf_path)
        .map_err(|e| format!("Failed to find OPF at path '{}': {}", opf_path, e))?;
    
    let mut opf_content = String::new();
    opf_file.read_to_string(&mut opf_content)
        .map_err(|e| format!("Failed to read OPF: {}", e))?;
    
    // Parse OPF
    let (_metadata, manifest_items, spine_items) = parse_opf_content(&opf_content)?;
    
    let manifest_count = manifest_items.len();
    let mut spine_itemref_count = 0;
    let mut missing_manifest_count = 0;
    let mut non_html_count = 0;
    let mut filtered_count = 0;
    
    // Determine OEBPS base path
    let oebps_base = if opf_path.contains("/") {
        opf_path.rfind("/")
            .map(|pos| opf_path[..pos + 1].to_string())
            .unwrap_or_else(|| OEBPS_PREFIX.to_string())
    } else {
        OEBPS_PREFIX.to_string()
    };
    debug!("OEBPS base path: '{}'", oebps_base);
    
    // Extract chapters from spine
    let mut chapters = Vec::new();
    for (index, (idref, href)) in spine_items.iter().enumerate() {
        spine_itemref_count += 1;
        
        if let Some(item) = manifest_items.get(idref) {
            // Validate and sanitize href path for security
            let validated_href = match validate_epub_path(href) {
                Ok(v) => v,
                Err(e) => {
                    warn!("Invalid chapter path '{}': {}, skipping", href, e);
                    filtered_count += 1;
                    continue;
                }
            };
            
            // Only include HTML/XHTML chapters
            let is_html_content = item.media_type.as_ref()
                .map(|mt| mt == MEDIA_TYPE_XHTML || mt == MEDIA_TYPE_HTML || mt == MEDIA_TYPE_HTML_XML)
                .unwrap_or(false)
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
            
            // Extract title (use href as fallback)
            let title = format!("Section {}", index + 1);
            
            chapters.push(Chapter {
                id: format!("{}-{}", Uuid::new_v4().to_string(), idref),
                title,
                content_html: None, // Lazy loading
                plain_text: None,
                order: index,
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

