use std::collections::HashMap;
use std::io::Cursor;
use zip::ZipArchive;
use epub::doc::EpubDoc;

use super::types::{EpubMetadata, ManifestItem};
use super::opf::{find_opf_path, derive_base_path_from_opf};

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

