use crate::book_service::models::Chapter;
use crate::utils::constants::*;
use crate::utils::path_validation::validate_epub_path;
use std::collections::HashMap;
use std::io::{Cursor, Read};
use zip::ZipArchive;
use epub::doc::EpubDoc;

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

/// Extract EPUB metadata using the epub crate.
///
/// This function uses the epub crate to extract metadata, manifest items, and spine items
/// in a more efficient way than manually parsing the OPF file.
///
/// # Arguments
/// * `epub_data` - The EPUB file as a byte slice
///
/// # Returns
/// A tuple containing:
/// * `EpubMetadata` - Extracted metadata
/// * `HashMap<String, ManifestItem>` - Map of manifest item IDs to items
/// * `Vec<(String, String)>` - Spine items as (idref, linear) pairs
/// * `String` - OPF path
///
/// # Errors
/// Returns an error string if the EPUB cannot be opened or parsed.
pub fn extract_metadata_with_epub_crate(
    epub_data: &[u8],
) -> Result<(EpubMetadata, HashMap<String, ManifestItem>, Vec<(String, String)>, String), String> {
    use log::debug;
    
    // Open EPUB using the epub crate
    let epub = EpubDoc::from_reader(Cursor::new(epub_data.to_vec()))
        .map_err(|e| format!("Failed to open EPUB with epub crate: {}", e))?;
    
    // Get OPF path (we still need to find it via container.xml for compatibility)
    let opf_path = find_opf_path(&mut ZipArchive::new(Cursor::new(epub_data))
        .map_err(|e| format!("Failed to open EPUB archive: {}", e))?)?;
    debug!("Using OPF path: {}", opf_path);
    
    // Extract metadata using epub crate's mdata() method
    // mdata() returns Option<&MetadataItem>, we need to extract the value
    let metadata = EpubMetadata {
        title: epub.mdata("title")
            .or_else(|| epub.mdata("dc:title"))
            .map(|item| item.value.clone()),
        creator: epub.mdata("creator")
            .or_else(|| epub.mdata("dc:creator"))
            .map(|item| item.value.clone()),
        publisher: epub.mdata("publisher")
            .or_else(|| epub.mdata("dc:publisher"))
            .map(|item| item.value.clone()),
        subjects: epub.mdata("subject")
            .or_else(|| epub.mdata("dc:subject"))
            .map(|item| vec![item.value.clone()])
            .unwrap_or_default(),
        pubdate: epub.mdata("date")
            .or_else(|| epub.mdata("dc:date"))
            .map(|item| item.value.clone()),
        modified_date: epub.mdata("dcterms:modified")
            .map(|item| item.value.clone()),
        cover_id: epub.mdata("cover")
            .or_else(|| epub.mdata("cover-image"))
            .map(|item| item.value.clone()),
    };
    
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
    
    // Build spine items from epub crate's spine
    let mut spine_items = Vec::new();
    let spine = epub.spine.clone();
    
    for spine_item in spine {
        let linear_str = if spine_item.linear { "yes" } else { "no" }.to_string();
        spine_items.push((spine_item.idref, linear_str));
    }
    
    Ok((metadata, manifest_items, spine_items, opf_path))
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

/// Compute audio duration from audio bytes using symphonia
fn compute_audio_duration(audio_bytes: &[u8], mime_type: &str) -> Option<f64> {
    use symphonia::core::formats::FormatOptions;
    use symphonia::core::io::MediaSourceStream;
    use symphonia::core::meta::MetadataOptions;
    use symphonia::core::probe::Hint;
    use symphonia::default::get_probe;
    
    // Create a hint based on MIME type
    let mut hint = Hint::new();
    if mime_type.contains("mpeg") || mime_type.contains("mp3") {
        hint.with_extension("mp3");
    } else if mime_type.contains("wav") {
        hint.with_extension("wav");
    } else if mime_type.contains("mp4") || mime_type.contains("m4a") {
        hint.with_extension("m4a");
    } else if mime_type.contains("ogg") {
        hint.with_extension("ogg");
    } else if mime_type.contains("opus") {
        hint.with_extension("opus");
    }
    
    // Create a media source stream from the bytes
    // Clone bytes to ensure we own them for 'static lifetime
    let audio_bytes_owned = audio_bytes.to_vec();
    let mss = MediaSourceStream::new(
        Box::new(std::io::Cursor::new(audio_bytes_owned)),
        Default::default(),
    );
    
    // Probe the format
    match get_probe().format(
        &hint,
        mss,
        &FormatOptions::default(),
        &MetadataOptions::default(),
    ) {
        Ok(probed) => {
            // Get the format
            let format = probed.format;
            
            // Get the first track
            let track = format.tracks().first()?;
            
            // Get the codec parameters
            let params = &track.codec_params;
            
            // Calculate duration from codec parameters
            if let (Some(time_base), Some(n_frames)) = (params.time_base, params.n_frames) {
                let duration_secs = time_base.calc_time(n_frames).seconds as f64;
                Some(duration_secs)
            } else {
                // If we can't get duration from codec params, return None
                // The duration will need to be computed when the track is actually played
                None
            }
        }
        Err(e) => {
            log::debug!("Failed to compute audio duration: {}", e);
            None
        }
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

/// Compute durations for audio tracks by reading them from the EPUB archive
pub fn compute_audio_track_durations(
    epub_data: &[u8],
    audio_tracks: &mut [crate::book_service::models::AudioTrack],
    opf_path: &str,
) {
    use std::io::Cursor;
    use log::debug;
    
    let mut archive = match ZipArchive::new(Cursor::new(epub_data)) {
        Ok(archive) => archive,
        Err(e) => {
            log::warn!("Failed to open EPUB for duration computation: {}", e);
            return;
        }
    };
    
    // Determine base path from OPF location
    let base_path = derive_base_path_from_opf(opf_path);
    
    for track in audio_tracks.iter_mut() {
        // Resolve audio path relative to OPF location
        let audio_path = if track.href.starts_with("/") {
            track.href[1..].to_string()
        } else {
            let mut resolved_parts: Vec<&str> = base_path.split("/").filter(|s| !s.is_empty()).collect();
            let audio_parts: Vec<&str> = track.href.split("/").collect();
            
            for part in audio_parts {
                if part == ".." {
                    resolved_parts.pop();
                } else if part != "." && !part.is_empty() {
                    resolved_parts.push(part);
                }
            }
            
            resolved_parts.join("/")
        };
        
        // Try to read the audio file
        let mut audio_bytes = Vec::new();
        let mut found_audio = false;
        
        // Try primary path first
        if let Ok(mut file) = archive.by_name(&audio_path) {
            if file.read_to_end(&mut audio_bytes).is_ok() && !audio_bytes.is_empty() {
                found_audio = true;
            }
        }
        
        // Try alternative paths if primary didn't work
        if !found_audio {
            let mut alt_paths = vec![
                track.href.clone(),
            ];
            
            // Add base path variants if base path exists
            if !base_path.is_empty() {
                alt_paths.push(format!("{}{}", base_path, audio_path));
                alt_paths.push(format!("{}{}", base_path, track.href));
            }
            
            for alt_path in &alt_paths {
                if let Ok(mut file) = archive.by_name(alt_path) {
                    audio_bytes.clear();
                    if file.read_to_end(&mut audio_bytes).is_ok() && !audio_bytes.is_empty() {
                        found_audio = true;
                        break;
                    }
                }
            }
        }
        
        if found_audio && !audio_bytes.is_empty() {
            // Determine MIME type from file extension
            let mime_type = if track.href.ends_with(".mp3") {
                "audio/mpeg"
            } else if track.href.ends_with(".wav") {
                "audio/wav"
            } else if track.href.ends_with(".m4a") {
                "audio/mp4"
            } else if track.href.ends_with(".ogg") {
                "audio/ogg"
            } else if track.href.ends_with(".opus") {
                "audio/opus"
            } else {
                "audio/mpeg" // Default fallback
            };
            
            // Compute duration
            if let Some(duration) = compute_audio_duration(&audio_bytes, mime_type) {
                track.duration = Some(duration);
                debug!("Computed duration for track '{}': {:.2}s", track.href, duration);
            } else {
                debug!("Failed to compute duration for track '{}'", track.href);
            }
        } else {
            debug!("Could not find audio file for track '{}'", track.href);
        }
    }
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

/// Parse NCX file and extract chapter titles mapped by href.
///
/// The NCX (Navigation Control file for XML) contains the table of contents
/// with proper chapter titles. This function extracts those titles and maps
/// them to their corresponding href paths.
///
/// # Arguments
/// * `ncx_content` - The content of the NCX file as a string
///
/// # Returns
/// A HashMap mapping href paths to chapter titles
///
/// # Example
/// ```rust
/// let ncx_content = std::fs::read_to_string("toc.ncx")?;
/// let title_map = parse_ncx_titles(&ncx_content)?;
/// println!("Found {} chapter titles", title_map.len());
/// ```
pub fn parse_ncx_titles(ncx_content: &str) -> Result<HashMap<String, String>, String> {
    use quick_xml::events::Event;
    use quick_xml::Reader;
    use log::{debug, warn};
    
    debug!("NCX: Starting to parse NCX content ({} bytes)", ncx_content.len());
    debug!("NCX: First 200 chars: {}", &ncx_content.chars().take(200).collect::<String>());
    
    let mut title_map: HashMap<String, String> = HashMap::new();
    let mut reader = Reader::from_str(ncx_content);
    reader.trim_text(true);
    reader.check_end_names(false); // Don't require namespace matching
    
    let mut in_nav_point = false;
    let mut current_title = String::new();
    let mut current_href = String::new();
    let mut in_nav_label = false;
    let mut in_text = false;
    let mut element_count = 0;
    let mut start_event_count = 0;
    let mut text_event_count = 0;
    let mut end_event_count = 0;
    
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => {
                start_event_count += 1;
                element_count += 1;
                let name_bytes_vec = e.name().as_ref().to_vec();
                let full_name = String::from_utf8_lossy(&name_bytes_vec);
                
                // Handle namespaces: get local name (everything after colon if present)
                let local_name = if let Some(colon_pos) = name_bytes_vec.iter().position(|&b| b == b':') {
                    &name_bytes_vec[colon_pos + 1..]
                } else {
                    &name_bytes_vec
                };
                
                let name_str = String::from_utf8_lossy(local_name);
                debug!("NCX: Start element #{}: full='{}', local='{}'", start_event_count, full_name, name_str);
                
                if local_name == b"navPoint" {
                    in_nav_point = true;
                    current_title.clear();
                    current_href.clear();
                    debug!("NCX: ✓ Entered navPoint (state: in_nav_point=true)");
                } else if in_nav_point && local_name == b"navLabel" {
                    in_nav_label = true;
                    debug!("NCX: ✓ Entered navLabel (state: in_nav_point=true, in_nav_label=true)");
                } else if in_nav_label && local_name == b"text" {
                    in_text = true;
                    debug!("NCX: ✓ Entered text (state: in_nav_point=true, in_nav_label=true, in_text=true)");
                } else if in_nav_point && local_name == b"content" {
                    debug!("NCX: ✓ Found content element (state: in_nav_point=true)");
                    // Extract src attribute
                    let mut found_src = false;
                    for attr in e.attributes() {
                        if let Ok(attr) = attr {
                            let attr_key = attr.key.as_ref();
                            let attr_full = String::from_utf8_lossy(attr_key);
                            let attr_local = if let Some(colon_pos) = attr_key.iter().position(|&b| b == b':') {
                                &attr_key[colon_pos + 1..]
                            } else {
                                attr_key
                            };
                            let attr_local_str = String::from_utf8_lossy(attr_local);
                            debug!("NCX:   Attribute: full='{}', local='{}'", attr_full, attr_local_str);
                            
                            if attr_local == b"src" {
                                current_href = String::from_utf8_lossy(&attr.value).to_string();
                                // Remove fragment identifier if present
                                if let Some(fragment_pos) = current_href.find('#') {
                                    current_href = current_href[..fragment_pos].to_string();
                                }
                                debug!("NCX: ✓ Found src attribute: '{}'", current_href);
                                found_src = true;
                                break;
                            }
                        }
                    }
                    if !found_src {
                        warn!("NCX: ⚠ No 'src' attribute found in content element");
                    }
                } else {
                    // Log other elements we encounter
                    if element_count <= 20 { // Only log first 20 to avoid spam
                        debug!("NCX: Other element: '{}' (in_nav_point={}, in_nav_label={}, in_text={})", 
                               name_str, in_nav_point, in_nav_label, in_text);
                    }
                }
            }
            Ok(Event::Text(t)) => {
                text_event_count += 1;
                let text_bytes = t.into_inner();
                let text = String::from_utf8_lossy(&text_bytes);
                let trimmed_text = text.trim();
                
                if in_text {
                    debug!("NCX: ✓ Text event #{} (in_text=true): '{}'", text_event_count, trimmed_text);
                    current_title.push_str(&text);
                } else if !trimmed_text.is_empty() && text_event_count <= 10 {
                    // Log text events we're not capturing
                    debug!("NCX: Text event #{} (in_text=false, ignored): '{}'", text_event_count, trimmed_text);
                }
            }
            Ok(Event::End(e)) => {
                end_event_count += 1;
                let name_bytes_vec = e.name().as_ref().to_vec();
                let full_name = String::from_utf8_lossy(&name_bytes_vec);
                
                // Handle namespaces: get local name
                let local_name = if let Some(colon_pos) = name_bytes_vec.iter().position(|&b| b == b':') {
                    &name_bytes_vec[colon_pos + 1..]
                } else {
                    &name_bytes_vec
                };
                
                let name_str = String::from_utf8_lossy(local_name);
                debug!("NCX: End element #{}: full='{}', local='{}'", end_event_count, full_name, name_str);
                
                if local_name == b"navPoint" {
                    debug!("NCX: Ending navPoint - title='{}', href='{}'", current_title, current_href);
                    if !current_title.is_empty() && !current_href.is_empty() {
                        // Normalize href path (remove leading slash if present)
                        let normalized_href = if current_href.starts_with("/") {
                            current_href[1..].to_string()
                        } else {
                            current_href.clone()
                        };
                        let trimmed_title = current_title.trim().to_string();
                        debug!("NCX: ✓✓✓ MAPPING title '{}' to href '{}'", trimmed_title, normalized_href);
                        title_map.insert(normalized_href.clone(), trimmed_title);
                        debug!("NCX: Title map now has {} entries", title_map.len());
                    } else {
                        warn!("NCX: ⚠ Skipping navPoint - title='{}' (empty={}), href='{}' (empty={})", 
                              current_title, current_title.is_empty(), current_href, current_href.is_empty());
                    }
                    in_nav_point = false;
                    current_title.clear();
                    current_href.clear();
                } else if local_name == b"navLabel" {
                    debug!("NCX: Ending navLabel (current_title so far: '{}')", current_title);
                    in_nav_label = false;
                } else if local_name == b"text" {
                    debug!("NCX: Ending text (current_title so far: '{}')", current_title);
                    in_text = false;
                }
            }
            Ok(Event::Eof) => {
                debug!("NCX: Reached EOF - processed {} start events, {} text events, {} end events", 
                       start_event_count, text_event_count, end_event_count);
                break;
            }
            Err(e) => {
                warn!("NCX: Parse error at event #{}: {}", element_count, e);
                // Continue parsing even if there are minor errors
            }
            Ok(Event::Empty(e)) => {
                let name_bytes_vec = e.name().as_ref().to_vec();
                let local_name = if let Some(colon_pos) = name_bytes_vec.iter().position(|&b| b == b':') {
                    &name_bytes_vec[colon_pos + 1..]
                } else {
                    &name_bytes_vec
                };
                let name_str = String::from_utf8_lossy(local_name);
                debug!("NCX: Empty element: '{}'", name_str);
                
                // Handle self-closing <content src="..."/> elements
                if in_nav_point && local_name == b"content" {
                    debug!("NCX: ✓ Found empty content element (state: in_nav_point=true)");
                    // Extract src attribute
                    let mut found_src = false;
                    for attr in e.attributes() {
                        if let Ok(attr) = attr {
                            let attr_key = attr.key.as_ref();
                            let attr_local = if let Some(colon_pos) = attr_key.iter().position(|&b| b == b':') {
                                &attr_key[colon_pos + 1..]
                            } else {
                                attr_key
                            };
                            if attr_local == b"src" {
                                current_href = String::from_utf8_lossy(&attr.value).to_string();
                                // Remove fragment identifier if present
                                if let Some(fragment_pos) = current_href.find('#') {
                                    current_href = current_href[..fragment_pos].to_string();
                                }
                                debug!("NCX: ✓ Found src attribute in empty content: '{}'", current_href);
                                found_src = true;
                                break;
                            }
                        }
                    }
                    if !found_src {
                        warn!("NCX: ⚠ No 'src' attribute found in empty content element");
                    }
                }
            }
            _ => {
                debug!("NCX: Other event type encountered");
            }
        }
    }
    
    debug!("NCX: Finished parsing - extracted {} titles", title_map.len());
    if !title_map.is_empty() {
        debug!("NCX: Sample titles:");
        for (href, title) in title_map.iter().take(5) {
            debug!("NCX:   '{}' -> '{}'", href, title);
        }
    } else {
        warn!("NCX: ⚠⚠⚠ NO TITLES EXTRACTED! This indicates a parsing problem.");
    }
    
    Ok(title_map)
}

