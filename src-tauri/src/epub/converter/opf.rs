use quick_xml::events::{Event, BytesEnd, BytesStart, BytesText};
use quick_xml::Writer;
use quick_xml::Reader;
use std::io::{Cursor, Write};
use std::collections::HashSet;
use crate::utils::errors::{AppError, AppResult};
use anyhow::Context;

/// Strip leading slash from an EPUB href.
/// The base path should already be correctly derived from the OPF file.
fn strip_base_path_prefix(href: &str) -> String {
    href.strip_prefix("/").unwrap_or(href).to_string()
}

/// Update content.opf to include audio tracks and SMIL files in the EPUB manifest.
///
/// This function modifies the EPUB's content.opf file to:
/// 1. Add audio files (MP3) to the manifest with proper media types
/// 2. Add SMIL files to the manifest for media overlay support
/// 3. Link chapters to their corresponding SMIL files via `media-overlay` attributes
/// 4. Add media overlay metadata to enable synchronized playback
///
/// The function parses the existing OPF XML, removes old audio/SMIL entries,
/// and adds new ones while preserving all other manifest items and metadata.
///
/// # Arguments
/// * `opf_xml` - The original content.opf file as an XML string
/// * `audio_files` - Vector of (chapter_index, audio_href) tuples:
///   - `chapter_index` - Index of the chapter (0-based)
///   - `audio_href` - Relative path to the audio file (e.g., "Audio/chapter1.mp3")
/// * `smil_files` - Vector of (chapter_index, smil_href) tuples:
///   - `chapter_index` - Index of the chapter (0-based)
///   - `smil_href` - Relative path to the SMIL file (e.g., "chapter1.smil")
/// * `chapters` - Vector of chapter hrefs to match with SMIL files
///
/// # Returns
/// The updated content.opf file as an XML string.
///
/// # Errors
/// Returns `AppError::XmlParse` if XML parsing or generation fails.
///
/// # Example
/// ```rust
/// let audio_files = vec![(0, "Audio/chapter1.mp3".to_string())];
/// let smil_files = vec![(0, "chapter1.smil".to_string())];
/// let chapters = vec!["chapter1.xhtml".to_string()];
/// let updated_opf = update_content_opf(opf_xml, &audio_files, &smil_files, &chapters)?;
/// ```
pub fn update_content_opf(
    opf_xml: &str,
    audio_files: &[(usize, String)],
    smil_files: &[(usize, String)],
    chapters: &[String], // chapter hrefs
) -> AppResult<String> {
    let mut reader = Reader::from_str(opf_xml);
    reader.trim_text(true);
    
    let mut writer = Writer::new(Cursor::new(Vec::new()));
    
    // Track which hrefs we've already added to avoid duplicates
    let mut added_audio_hrefs = HashSet::new();
    let mut added_smil_hrefs = HashSet::new();
    
    // Track existing IDs to avoid conflicts when generating new IDs
    let mut existing_audio_ids = HashSet::new();
    let mut existing_smil_ids = HashSet::new();
    let mut max_audio_id_num = 0;
    let mut max_smil_id_num = 0;
    
    // Map existing SMIL hrefs to their IDs (for preserving media-overlay on existing chapters)
    let mut existing_smil_href_to_id: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    // Map existing audio hrefs to their IDs (for tracking reassigned IDs)
    let mut existing_audio_href_to_id: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    
    // First pass: collect existing audio/SMIL item IDs from the OPF
    {
        let mut first_pass_reader = Reader::from_str(opf_xml);
        first_pass_reader.trim_text(true);
        let mut in_manifest_first = false;
        
        log::debug!("[update_content_opf] Starting first pass to detect existing IDs");
        
        loop {
            match first_pass_reader.read_event() {
                Ok(Event::Start(e)) => {
                    let name = e.name().into_inner();
                    if name == b"manifest" {
                        in_manifest_first = true;
                        log::debug!("[update_content_opf] First pass: Entered manifest");
                    } else if in_manifest_first && name == b"item" {
                        log::debug!("[update_content_opf] First pass: Found Start item in manifest");
                        let attrs: Result<Vec<_>, _> = e.attributes().collect();
                        if let Ok(attrs) = attrs {
                            let mut id_attr: Option<String> = None;
                            let mut media_type_attr: Option<String> = None;
                            
                            for attr in &attrs {
                                let key = attr.key.as_ref();
                                if key == b"id" {
                                    id_attr = Some(String::from_utf8_lossy(&attr.value).to_string());
                                } else if key == b"media-type" {
                                    media_type_attr = Some(String::from_utf8_lossy(&attr.value).to_string());
                                }
                            }
                            
                            let mut href_attr: Option<String> = None;
                            for attr in &attrs {
                                let key = attr.key.as_ref();
                                if key == b"href" {
                                    href_attr = Some(String::from_utf8_lossy(&attr.value).to_string());
                                    break;
                                }
                            }
                            
                            if let (Some(id), Some(mt)) = (id_attr, media_type_attr) {
                                if mt.starts_with("audio/") {
                                    // Check if this ID is already used (duplicate ID)
                                    let final_id = if existing_audio_ids.contains(&id) {
                                        // Duplicate ID detected - generate a new unique ID
                                        max_audio_id_num += 1;
                                        let new_id = format!("m{:03}", max_audio_id_num);
                                        log::warn!("Duplicate audio ID '{}' detected, reassigning to '{}' for href '{}'", 
                                            id, new_id, href_attr.as_ref().unwrap_or(&"unknown".to_string()));
                                        existing_audio_ids.insert(new_id.clone());
                                        new_id
                                    } else {
                                        existing_audio_ids.insert(id.clone());
                                        // Extract number from ID like "m001" -> 1
                                        if id.starts_with("m") {
                                            if let Ok(num) = id[1..].parse::<usize>() {
                                                max_audio_id_num = max_audio_id_num.max(num);
                                            }
                                        }
                                        id
                                    };
                                    // Map audio href to its ID (using final_id which may be reassigned)
                                    if let Some(ref href) = href_attr {
                                        let href_clone = href.clone();
                                        let final_id_clone = final_id.clone();
                                        existing_audio_href_to_id.insert(href_clone, final_id_clone.clone());
                                        log::debug!("[update_content_opf] Found existing audio track: href='{}', id='{}'", href, final_id_clone);
                                    }
                                } else if mt == "application/smil+xml" {
                                    // Check if this ID is already used (duplicate ID)
                                    let final_id = if existing_smil_ids.contains(&id) {
                                        // Duplicate ID detected - generate a new unique ID
                                        max_smil_id_num += 1;
                                        let new_id = format!("s{:03}", max_smil_id_num);
                                        log::warn!("Duplicate SMIL ID '{}' detected, reassigning to '{}' for href '{}'", 
                                            id, new_id, href_attr.as_ref().unwrap_or(&"unknown".to_string()));
                                        existing_smil_ids.insert(new_id.clone());
                                        new_id
                                    } else {
                                        existing_smil_ids.insert(id.clone());
                                        // Extract number from ID like "s001" -> 1
                                        if id.starts_with("s") {
                                            if let Ok(num) = id[1..].parse::<usize>() {
                                                max_smil_id_num = max_smil_id_num.max(num);
                                            }
                                        }
                                        id
                                    };
                                    // Map SMIL href to its ID (using final_id which may be reassigned)
                                    if let Some(href) = href_attr {
                                        existing_smil_href_to_id.insert(href, final_id);
                                    }
                                }
                            }
                        }
                    }
                    first_pass_reader.read_to_end(e.name()).ok();
                }
                Ok(Event::Empty(e)) => {
                    let name = e.name().into_inner();
                    log::debug!("[update_content_opf] First pass: Event::Empty, name={:?}, in_manifest={}", 
                        String::from_utf8_lossy(&name), in_manifest_first);
                    if in_manifest_first && name == b"item" {
                        log::debug!("[update_content_opf] First pass: Processing Empty item in manifest");
                        let attrs: Result<Vec<_>, _> = e.attributes().collect();
                        if let Ok(attrs) = attrs {
                            log::debug!("[update_content_opf] First pass: Item has {} attributes", attrs.len());
                            let mut id_attr: Option<String> = None;
                            let mut media_type_attr: Option<String> = None;
                            
                            // Read attributes - handle both with and without namespace
                            for attr in &attrs {
                                let key = attr.key.as_ref();
                                // Handle both "id" and namespaced versions
                                if key == b"id" || key.ends_with(b":id") || key == b"id" {
                                    if let Ok(id_str) = std::str::from_utf8(&attr.value) {
                                        id_attr = Some(id_str.to_string());
                                    }
                                } else if key == b"media-type" || key.ends_with(b":media-type") {
                                    if let Ok(mt_str) = std::str::from_utf8(&attr.value) {
                                        media_type_attr = Some(mt_str.to_string());
                                    }
                                }
                            }
                            
                            let mut href_attr: Option<String> = None;
                            for attr in &attrs {
                                let key = attr.key.as_ref();
                                if key == b"href" || key.ends_with(b":href") {
                                    if let Ok(href_str) = std::str::from_utf8(&attr.value) {
                                        href_attr = Some(href_str.to_string());
                                        break;
                                    }
                                }
                            }
                            
                            log::debug!("[update_content_opf] First pass - Empty item: id={:?}, media-type={:?}, href={:?}", id_attr, media_type_attr, href_attr);
                            
                            if let (Some(id), Some(mt)) = (id_attr, media_type_attr) {
                                if mt.starts_with("audio/") {
                                    // Check if this ID is already used (duplicate ID)
                                    let final_id = if existing_audio_ids.contains(&id) {
                                        // Duplicate ID detected - generate a new unique ID
                                        max_audio_id_num += 1;
                                        let new_id = format!("m{:03}", max_audio_id_num);
                                        log::warn!("Duplicate audio ID '{}' detected, reassigning to '{}' for href '{}'", 
                                            id, new_id, href_attr.as_ref().unwrap_or(&"unknown".to_string()));
                                        existing_audio_ids.insert(new_id.clone());
                                        new_id
                                    } else {
                                        existing_audio_ids.insert(id.clone());
                                        // Extract number from ID like "m001" -> 1
                                        if id.starts_with("m") {
                                            if let Ok(num) = id[1..].parse::<usize>() {
                                                max_audio_id_num = max_audio_id_num.max(num);
                                            }
                                        }
                                        id
                                    };
                                    // Map audio href to its ID (using final_id which may be reassigned)
                                    if let Some(ref href) = href_attr {
                                        let href_clone = href.clone();
                                        let final_id_clone = final_id.clone();
                                        existing_audio_href_to_id.insert(href_clone, final_id_clone.clone());
                                        log::debug!("[update_content_opf] Found existing audio track: href='{}', id='{}'", href, final_id_clone);
                                    }
                                } else if mt == "application/smil+xml" {
                                    // Check if this ID is already used (duplicate ID)
                                    let final_id = if existing_smil_ids.contains(&id) {
                                        // Duplicate ID detected - generate a new unique ID
                                        max_smil_id_num += 1;
                                        let new_id = format!("s{:03}", max_smil_id_num);
                                        log::warn!("Duplicate SMIL ID '{}' detected, reassigning to '{}' for href '{}'", 
                                            id, new_id, href_attr.as_ref().unwrap_or(&"unknown".to_string()));
                                        existing_smil_ids.insert(new_id.clone());
                                        new_id
                                    } else {
                                        existing_smil_ids.insert(id.clone());
                                        // Extract number from ID like "s001" -> 1
                                        if id.starts_with("s") {
                                            if let Ok(num) = id[1..].parse::<usize>() {
                                                max_smil_id_num = max_smil_id_num.max(num);
                                            }
                                        }
                                        id
                                    };
                                    // Map SMIL href to its ID (using final_id which may be reassigned)
                                    if let Some(href) = href_attr {
                                        existing_smil_href_to_id.insert(href, final_id);
                                    }
                                }
                            }
                        }
                    }
                }
                Ok(Event::End(e)) => {
                    if e.name().into_inner() == b"manifest" {
                        in_manifest_first = false;
                    }
                }
                Ok(Event::Eof) => break,
                _ => {}
            }
        }
    }
    
    log::info!("[update_content_opf] First pass complete: {} existing audio IDs (max: {}), {} existing SMIL IDs (max: {})", 
        existing_audio_ids.len(), max_audio_id_num, existing_smil_ids.len(), max_smil_id_num);
    
    // Fallback: If first pass didn't find expected IDs, do a direct string scan
    // This handles cases where XML parsing might miss items due to formatting
    if max_audio_id_num == 0 && max_smil_id_num == 0 {
        log::warn!("[update_content_opf] First pass found no IDs - performing fallback string scan");
        // Scan for id="m###" patterns
        let mut pos = 0;
        while let Some(start) = opf_xml[pos..].find("id=\"m") {
            let actual_start = pos + start + 4; // Skip "id=\"m"
            if let Some(end) = opf_xml[actual_start..].find('"') {
                let id_str = &opf_xml[actual_start..actual_start + end];
                if id_str.len() == 4 && id_str.starts_with('m') {
                    if let Ok(num) = id_str[1..].parse::<usize>() {
                        existing_audio_ids.insert(id_str.to_string());
                        max_audio_id_num = max_audio_id_num.max(num);
                        log::debug!("[update_content_opf] Fallback: Found audio ID {}", id_str);
                    }
                }
                pos = actual_start + end;
            } else {
                break;
            }
        }
        // Scan for id="s###" patterns
        let mut pos = 0;
        while let Some(start) = opf_xml[pos..].find("id=\"s") {
            let actual_start = pos + start + 4; // Skip "id=\"s"
            if let Some(end) = opf_xml[actual_start..].find('"') {
                let id_str = &opf_xml[actual_start..actual_start + end];
                if id_str.len() == 4 && id_str.starts_with('s') {
                    if let Ok(num) = id_str[1..].parse::<usize>() {
                        existing_smil_ids.insert(id_str.to_string());
                        max_smil_id_num = max_smil_id_num.max(num);
                        log::debug!("[update_content_opf] Fallback: Found SMIL ID {}", id_str);
                    }
                }
                pos = actual_start + end;
            } else {
                break;
            }
        }
        log::info!("[update_content_opf] Fallback scan complete: {} existing audio IDs (max: {}), {} existing SMIL IDs (max: {})", 
            existing_audio_ids.len(), max_audio_id_num, existing_smil_ids.len(), max_smil_id_num);
    }
    
    log::debug!("[update_content_opf] Existing SMIL href to ID mappings: {:?}", existing_smil_href_to_id);
    log::debug!("[update_content_opf] New audio files to add: {:?}", audio_files.iter().map(|(idx, href)| (idx, href)).collect::<Vec<_>>());
    log::debug!("[update_content_opf] New SMIL files to add: {:?}", smil_files.iter().map(|(idx, href)| (idx, href)).collect::<Vec<_>>());
    
    // Track if we're inside manifest/metadata
    let mut in_manifest = false;
    let mut manifest_items_to_add: Vec<Vec<u8>> = Vec::new();
    let mut _in_metadata = false;
    let mut needs_media_overlay_meta = true;
    
    // Counters for generating unique IDs for new items
    // Ensure we start from at least 1, and continue from max existing ID
    let mut next_audio_id_num = if max_audio_id_num > 0 { max_audio_id_num + 1 } else { 1 };
    let mut next_smil_id_num = if max_smil_id_num > 0 { max_smil_id_num + 1 } else { 1 };
    
    // Ensure generated IDs don't conflict with existing ones
    // If the calculated next ID already exists (due to reassignments), find the next available
    while existing_audio_ids.contains(&format!("m{:03}", next_audio_id_num)) {
        next_audio_id_num += 1;
    }
    while existing_smil_ids.contains(&format!("s{:03}", next_smil_id_num)) {
        next_smil_id_num += 1;
    }
    
    log::info!("[update_content_opf] Starting new ID generation from: audio={:03}, smil={:03}", next_audio_id_num, next_smil_id_num);
    
    // Map SMIL hrefs to their generated IDs for media-overlay matching
    let mut smil_href_to_id: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    
    // Build items to add
    log::debug!("Building manifest items: {} audio files, {} SMIL files", audio_files.len(), smil_files.len());
    log::debug!("Chapters passed to update_content_opf: {:?}", chapters);
    log::debug!("SMIL files: {:?}", smil_files.iter().map(|(idx, href)| (idx, href)).collect::<Vec<_>>());
    
    for (_, href) in audio_files.iter() {
        if !added_audio_hrefs.contains(href) {
            added_audio_hrefs.insert(href.clone());
            let mut item_id = format!("m{:03}", next_audio_id_num);
            // Ensure the generated ID doesn't conflict with existing ones
            while existing_audio_ids.contains(&item_id) {
                next_audio_id_num += 1;
                item_id = format!("m{:03}", next_audio_id_num);
            }
            existing_audio_ids.insert(item_id.clone()); // Track the ID we're about to use
            next_audio_id_num += 1;
            let is_mp3 = href.ends_with(".mp3");
            let media_type = if is_mp3 { "audio/mpeg" } else { "audio/wav" };
            
            log::debug!("Adding audio item: id={}, href={}, media-type={}", item_id, href, media_type);
            
            let mut item = BytesStart::new("item");
            item.push_attribute(("id", item_id.as_str()));
            item.push_attribute(("href", href.as_str()));
            item.push_attribute(("media-type", media_type));
            
            let mut item_xml = Vec::new();
            let mut item_writer = Writer::new(Cursor::new(&mut item_xml));
            item_writer.write_event(Event::Empty(item))
                .map_err(|e| AppError::XmlParse(format!("Failed to write audio item XML: {}", e)))?;
            manifest_items_to_add.push(item_xml);
        }
    }
    
    for (_, href) in smil_files.iter() {
        if !added_smil_hrefs.contains(href) {
            added_smil_hrefs.insert(href.clone());
            let mut smil_item_id = format!("s{:03}", next_smil_id_num);
            // Ensure the generated ID doesn't conflict with existing ones
            while existing_smil_ids.contains(&smil_item_id) {
                next_smil_id_num += 1;
                smil_item_id = format!("s{:03}", next_smil_id_num);
            }
            existing_smil_ids.insert(smil_item_id.clone()); // Track the ID we're about to use
            smil_href_to_id.insert(href.clone(), smil_item_id.clone());
            next_smil_id_num += 1;
            
            log::debug!("Adding SMIL item: id={}, href={}", smil_item_id, href);
            
            let mut item = BytesStart::new("item");
            item.push_attribute(("id", smil_item_id.as_str()));
            item.push_attribute(("href", href.as_str()));
            item.push_attribute(("media-type", "application/smil+xml"));
            
            let mut item_xml = Vec::new();
            let mut item_writer = Writer::new(Cursor::new(&mut item_xml));
            item_writer.write_event(Event::Empty(item))
                .map_err(|e| AppError::XmlParse(format!("Failed to write SMIL item XML: {}", e)))?;
            manifest_items_to_add.push(item_xml);
        }
    }
    
    log::debug!("Total manifest items to add: {}", manifest_items_to_add.len());
    
    // Process XML events
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => {
                let name = e.name().into_inner();
                
                if name == b"manifest" {
                    in_manifest = true;
                    writer.write_event(Event::Start(e))
                        .context("Failed to write manifest start tag")
                        .map_err(|e| AppError::XmlParse(e.to_string()))?;
                } else if name == b"metadata" {
                    _in_metadata = true;
                    writer.write_event(Event::Start(e))
                        .context("Failed to write metadata start tag")
                        .map_err(|e| AppError::XmlParse(e.to_string()))?;
                } else if in_manifest && name == b"item" {
                    // Collect attributes first
                    let attrs: Result<Vec<_>, _> = e.attributes().collect();
                    let attrs = attrs.context("Failed to read XML attributes")
                        .map_err(|e| AppError::XmlParse(e.to_string()))?;
                    
                    // Check if this is an audio or SMIL item to skip
                    let mut href_attr: Option<String> = None;
                    let mut media_type_attr: Option<String> = None;
                    
                    for attr in &attrs {
                        let key = attr.key.as_ref();
                        if key == b"href" {
                            href_attr = Some(String::from_utf8_lossy(&attr.value).to_string());
                        } else if key == b"media-type" {
                            media_type_attr = Some(String::from_utf8_lossy(&attr.value).to_string());
                        }
                    }
                    
                    // For audio and SMIL items: preserve existing ones that aren't being replaced,
                    // but skip ones that are being replaced with new versions
                    if let Some(ref mt) = media_type_attr {
                        if mt.starts_with("audio/") || mt == "application/smil+xml" {
                            // Check if this href is in the new files being added
                            let is_being_replaced = if let Some(ref href) = href_attr {
                                if mt.starts_with("audio/") {
                                    audio_files.iter().any(|(_, new_href)| new_href == href)
                                } else {
                                    smil_files.iter().any(|(_, new_href)| new_href == href)
                                }
                            } else {
                                false
                            };
                            
                            if is_being_replaced {
                                // Skip this item - we'll add the new version
                            reader.read_to_end(e.name())
                                .context("Failed to read to end of item tag")
                                .map_err(|e| AppError::XmlParse(e.to_string()))?;
                            continue;
                            } else {
                                // Preserve this existing audio/SMIL item
                                // Track it so we don't add a duplicate
                                if let Some(ref href) = href_attr {
                                    // Also track the ID to ensure new items don't conflict
                                    let mut item_id: Option<String> = None;
                                    for attr in &attrs {
                                        if attr.key.as_ref() == b"id" {
                                            if let Ok(id_str) = std::str::from_utf8(&attr.value) {
                                                item_id = Some(id_str.to_string());
                                                if mt.starts_with("audio/") {
                                                    existing_audio_ids.insert(id_str.to_string());
                                                    // Update max if needed
                                                    if id_str.starts_with("m") {
                                                        if let Ok(num) = id_str[1..].parse::<usize>() {
                                                            max_audio_id_num = max_audio_id_num.max(num);
                                                        }
                                                    }
                                                } else if mt == "application/smil+xml" {
                                                    existing_smil_ids.insert(id_str.to_string());
                                                    // Update max if needed
                                                    if id_str.starts_with("s") {
                                                        if let Ok(num) = id_str[1..].parse::<usize>() {
                                                            max_smil_id_num = max_smil_id_num.max(num);
                                                        }
                                                    }
                                                }
                                            }
                                            break;
                                        }
                                    }
                                    if mt.starts_with("audio/") {
                                        added_audio_hrefs.insert(href.clone());
                                        log::debug!("[update_content_opf] Preserving existing audio track: href='{}', id='{:?}'", href, item_id);
                                    } else {
                                        added_smil_hrefs.insert(href.clone());
                                        log::debug!("[update_content_opf] Preserving existing SMIL file: href='{}', id='{:?}'", href, item_id);
                                    }
                                }
                                // Write the existing item, but use reassigned ID if it was changed
                                let mut existing_item = BytesStart::new("item");
                                let mut id_was_reassigned = false;
                                let mut reassigned_id: Option<String> = None;
                                
                                // Check if the ID was reassigned due to duplicates (for both audio and SMIL)
                                if let Some(ref href) = href_attr {
                                    let reassigned = if mt.starts_with("audio/") {
                                        existing_audio_href_to_id.get(href)
                                    } else if mt == "application/smil+xml" {
                                        existing_smil_href_to_id.get(href)
                                    } else {
                                        None
                                    };
                                    
                                    if let Some(reassigned) = reassigned {
                                        // Check if the original ID differs from the reassigned one
                                        let mut original_id: Option<String> = None;
                                        for attr in &attrs {
                                            if attr.key.as_ref() == b"id" {
                                                original_id = Some(String::from_utf8_lossy(&attr.value).to_string());
                                                break;
                                            }
                                        }
                                        if let Some(orig_id) = original_id {
                                            if orig_id != *reassigned {
                                                id_was_reassigned = true;
                                                reassigned_id = Some(reassigned.clone());
                                                let item_type = if mt.starts_with("audio/") { "audio" } else { "SMIL" };
                                                log::info!("[update_content_opf] Reassigning {} ID from '{}' to '{}' for href '{}'", item_type, orig_id, reassigned, href);
                                            }
                                        }
                                    }
                                }
                                
                                for attr in &attrs {
                                    let key = attr.key.as_ref();
                                    // If ID was reassigned, use the new ID instead
                                    if id_was_reassigned && key == b"id" {
                                        if let Some(ref new_id) = reassigned_id {
                                            existing_item.push_attribute(("id", new_id.as_str()));
                                        }
                                    } else {
                                        existing_item.push_attribute((key, attr.value.as_ref()));
                                    }
                                }
                                writer.write_event(Event::Start(existing_item))
                                    .context("Failed to write existing audio/SMIL item start tag")
                                    .map_err(|e| AppError::XmlParse(e.to_string()))?;
                                // Read through the element content and write the end tag
                                reader.read_to_end(e.name())
                                    .context("Failed to read to end of preserved item")
                                    .map_err(|e| AppError::XmlParse(e.to_string()))?;
                                // Write the end tag
                                writer.write_event(Event::End(BytesEnd::new("item")))
                                    .context("Failed to write existing audio/SMIL item end tag")
                                    .map_err(|e| AppError::XmlParse(e.to_string()))?;
                                continue;
                            }
                        }
                    }
                    
                    // Check if this is a chapter item that needs media-overlay
                    let mut needs_media_overlay = false;
                    let mut smil_id_to_add: Option<String> = None;
                    
                    if let Some(ref href) = href_attr {
                        // Normalize the href from manifest (strip leading slash)
                        let normalized_href = strip_base_path_prefix(href);
                        
                        // Check if this is an HTML/XHTML file that might need media-overlay
                        let is_html_content = media_type_attr.as_ref()
                            .map(|mt| mt == "application/xhtml+xml" || mt == "text/html" || mt == "application/html+xml")
                            .unwrap_or(false);
                        
                        if is_html_content {
                            log::debug!("Checking for SMIL match for chapter href '{}' (normalized: '{}')", href, normalized_href);
                            
                            // First, check if there's an existing SMIL file for this chapter
                            // Generate SMIL href the same way it's done in processing.rs
                            let smil_href_candidates = vec![
                                normalized_href.replace(".xhtml", ".smil").replace(".html", ".smil"),
                                format!("{}.smil", normalized_href.replace(".xhtml", "").replace(".html", "")),
                            ];
                            
                            // Check existing SMIL files first
                            for smil_candidate in &smil_href_candidates {
                                if let Some(existing_smil_id) = existing_smil_href_to_id.get(smil_candidate) {
                                    needs_media_overlay = true;
                                    smil_id_to_add = Some(existing_smil_id.clone());
                                    log::debug!("  ✓ Found existing SMIL file '{}' with id '{}' for chapter '{}'", smil_candidate, existing_smil_id, normalized_href);
                                    break;
                                }
                            }
                            
                            // If no existing SMIL file found, check new SMIL files being added
                            if !needs_media_overlay {
                            // Match by comparing manifest href with chapter hrefs
                            // Since smil_files is sorted by chapter_index, and chapters are processed
                            // in order (chapter_index matches position in chapters vector),
                            // we can find the SMIL file by matching the chapter href
                            for (chapter_pos, chapter_href) in chapters.iter().enumerate() {
                                let normalized_chapter_href = strip_base_path_prefix(chapter_href);
                                
                                // Try exact match first
                                if normalized_href == normalized_chapter_href {
                                    // Find the SMIL file with chapter_index matching chapter_pos
                                        if let Some((smil_chapter_idx, smil_href)) = smil_files.iter()
                                            .find(|(smil_chapter_idx, _)| *smil_chapter_idx == chapter_pos)
                                            .map(|(_, href)| (chapter_pos, href)) {
                                            // Look up the ID we generated for this SMIL file
                                            if let Some(smil_id) = smil_href_to_id.get(smil_href) {
                                        needs_media_overlay = true;
                                                smil_id_to_add = Some(smil_id.clone());
                                                log::debug!("  ✓ Exact match! Matched chapter href '{}' (position {}) with new SMIL id '{}' (stored chapter_index: {})", normalized_href, chapter_pos, smil_id, smil_chapter_idx);
                                        break;
                                            } else {
                                                log::debug!("  ✗ SMIL file found but ID not in mapping for chapter href '{}'", normalized_href);
                                            }
                                    } else {
                                        log::debug!("  ✗ No SMIL file found with chapter_index={} for chapter href '{}'", chapter_pos, normalized_href);
                                    }
                                }
                                
                                // Try matching by filename (in case paths differ)
                                let href_filename = normalized_href.split('/').last().unwrap_or(&normalized_href);
                                let chapter_filename = normalized_chapter_href.split('/').last().unwrap_or(&normalized_chapter_href);
                                if href_filename == chapter_filename && !href_filename.is_empty() {
                                    // Find the SMIL file with chapter_index matching chapter_pos
                                        if let Some((smil_chapter_idx, smil_href)) = smil_files.iter()
                                            .find(|(smil_chapter_idx, _)| *smil_chapter_idx == chapter_pos)
                                            .map(|(_, href)| (chapter_pos, href)) {
                                            // Look up the ID we generated for this SMIL file
                                            if let Some(smil_id) = smil_href_to_id.get(smil_href) {
                                        needs_media_overlay = true;
                                                smil_id_to_add = Some(smil_id.clone());
                                                log::debug!("  ✓ Filename match! Matched chapter by filename '{}' (position {}) with new SMIL id '{}' (stored chapter_index: {})", href_filename, chapter_pos, smil_id, smil_chapter_idx);
                                        break;
                                            } else {
                                                log::debug!("  ✗ SMIL file found but ID not in mapping for chapter filename '{}'", href_filename);
                                            }
                                    } else {
                                        log::debug!("  ✗ No SMIL file found with chapter_index={} for chapter filename '{}'", chapter_pos, href_filename);
                                        }
                                    }
                                }
                            }
                            
                            if !needs_media_overlay {
                                log::debug!("  ✗ No SMIL match found for chapter href '{}'", normalized_href);
                            }
                        }
                    }
                    
                    // Create new item element with media-overlay if needed
                    let mut new_item = BytesStart::new("item");
                    let mut existing_media_overlay: Option<String> = None;
                    
                    for attr in &attrs {
                        let key = attr.key.as_ref();
                        // Preserve existing media-overlay if this chapter isn't being converted now
                        if key == b"media-overlay" {
                            // Check if this chapter is in the current conversion batch
                            let is_in_current_batch = if let Some(ref href) = href_attr {
                                let normalized_href = strip_base_path_prefix(href);
                                chapters.iter().any(|ch| {
                                    let normalized_ch = strip_base_path_prefix(ch);
                                    normalized_href == normalized_ch || 
                                    normalized_href.split('/').last() == normalized_ch.split('/').last()
                                })
                            } else {
                                false
                            };
                            
                                if !is_in_current_batch {
                                    // Preserve existing media-overlay for chapters not in current batch
                                    if let Ok(value_str) = std::str::from_utf8(&attr.value) {
                                        existing_media_overlay = Some(value_str.to_string());
                                        log::debug!("Preserving existing media-overlay='{}' for chapter href='{}' (not in current conversion batch)", 
                                            value_str,
                                            href_attr.as_ref().map(|h| h.as_ref()).unwrap_or("unknown"));
                                    }
                                }
                            // Skip adding it now - we'll add it back if preserving, or add new one if converting
                            continue;
                        }
                        new_item.push_attribute((key, attr.value.as_ref()));
                    }
                    
                    // Add media-overlay: either preserve existing or add new one
                    if let Some(existing) = existing_media_overlay {
                        // Preserve existing media-overlay for already-converted chapters
                        new_item.push_attribute(("media-overlay", existing.as_str()));
                    } else if needs_media_overlay {
                        // Add new media-overlay for chapters being converted now
                        if let Some(ref smil_id) = smil_id_to_add {
                            new_item.push_attribute(("media-overlay", smil_id.as_str()));
                            log::debug!("Added media-overlay='{}' to chapter item with href='{}'", smil_id, href_attr.as_ref().unwrap_or(&"unknown".to_string()));
                        }
                    } else if let Some(ref href) = href_attr {
                        // Log when we don't add media-overlay for debugging
                        let is_html = media_type_attr.as_ref()
                            .map(|mt| mt == "application/xhtml+xml" || mt == "text/html" || mt == "application/html+xml")
                            .unwrap_or(false);
                        if is_html {
                            log::debug!("No media-overlay added for chapter item href='{}' (no matching SMIL file found)", href);
                        }
                    }
                    
                    writer.write_event(Event::Start(new_item))
                        .context("Failed to write item start tag")
                        .map_err(|e| AppError::XmlParse(e.to_string()))?;
                } else {
                    writer.write_event(Event::Start(e))
                        .context("Failed to write XML start tag")
                        .map_err(|e| AppError::XmlParse(e.to_string()))?;
                }
            }
            Ok(Event::End(e)) => {
                let name = e.name().into_inner();
                
                if name == b"manifest" {
                    // Before closing manifest, add our new items
                    log::debug!("Closing manifest, adding {} items", manifest_items_to_add.len());
                    for (idx, item_xml) in manifest_items_to_add.iter().enumerate() {
                        // Write newline and indentation before each item
                        writer.get_mut().write_all(b"\n        ")
                            .map_err(|e| AppError::Io(e))?;
                        writer.get_mut().write_all(item_xml)
                            .map_err(|e| AppError::Io(e))?;
                        log::debug!("Added manifest item {} of {}", idx + 1, manifest_items_to_add.len());
                    }
                    if !manifest_items_to_add.is_empty() {
                        // Add newline before closing manifest tag
                        writer.get_mut().write_all(b"\n    ")
                            .map_err(|e| AppError::Io(e))?;
                    }
                    in_manifest = false;
                    writer.write_event(Event::End(e))
                        .context("Failed to write manifest end tag")
                        .map_err(|e| AppError::XmlParse(e.to_string()))?;
                } else if name == b"metadata" {
                    // Add media overlay metadata before closing metadata
                    if needs_media_overlay_meta {
                        let mut meta = BytesStart::new("meta");
                        meta.push_attribute(("property", "media:active-class"));
                        writer.write_event(Event::Start(meta))
                            .context("Failed to write meta start tag")
                            .map_err(|e| AppError::XmlParse(e.to_string()))?;
                        let text_content = BytesText::from_escaped("-epub-media-overlay-active");
                        writer.write_event(Event::Text(text_content))
                            .context("Failed to write meta text")
                            .map_err(|e| AppError::XmlParse(e.to_string()))?;
                        writer.write_event(Event::End(BytesEnd::new("meta")))
                            .context("Failed to write meta end tag")
                            .map_err(|e| AppError::XmlParse(e.to_string()))?;
                        needs_media_overlay_meta = false;
                    }
                    _in_metadata = false;
                    writer.write_event(Event::End(e))
                        .context("Failed to write metadata end tag")
                        .map_err(|e| AppError::XmlParse(e.to_string()))?;
                } else {
                    writer.write_event(Event::End(e))
                        .context("Failed to write XML end tag")
                        .map_err(|e| AppError::XmlParse(e.to_string()))?;
                }
            }
            Ok(Event::Empty(e)) => {
                // Handle self-closing tags
                let name = e.name().into_inner();
                
                if in_manifest && name == b"item" {
                    // Collect attributes first
                    let attrs: Result<Vec<_>, _> = e.attributes().collect();
                    let attrs = attrs.context("Failed to read XML attributes")
                        .map_err(|e| AppError::XmlParse(e.to_string()))?;
                    
                    // Check if this is an audio or SMIL item to skip
                    let mut href_attr: Option<String> = None;
                    let mut media_type_attr: Option<String> = None;
                    
                    for attr in &attrs {
                        let key = attr.key.as_ref();
                        if key == b"href" {
                            href_attr = Some(String::from_utf8_lossy(&attr.value).to_string());
                        } else if key == b"media-type" {
                            media_type_attr = Some(String::from_utf8_lossy(&attr.value).to_string());
                        }
                    }
                    
                    // For audio and SMIL items: preserve existing ones that aren't being replaced,
                    // but skip ones that are being replaced with new versions
                    if let Some(ref mt) = media_type_attr {
                        if mt.starts_with("audio/") || mt == "application/smil+xml" {
                            // Check if this href is in the new files being added
                            let is_being_replaced = if let Some(ref href) = href_attr {
                                if mt.starts_with("audio/") {
                                    audio_files.iter().any(|(_, new_href)| new_href == href)
                                } else {
                                    smil_files.iter().any(|(_, new_href)| new_href == href)
                                }
                            } else {
                                false
                            };
                            
                            if is_being_replaced {
                                // Skip this item - we'll add the new version
                                continue;
                            } else {
                                // Preserve this existing audio/SMIL item
                                // Track it so we don't add a duplicate
                                if let Some(ref href) = href_attr {
                                    if mt.starts_with("audio/") {
                                        added_audio_hrefs.insert(href.clone());
                                        log::debug!("[update_content_opf] Preserving existing audio track (empty): href='{}'", href);
                                    } else {
                                        added_smil_hrefs.insert(href.clone());
                                        log::debug!("[update_content_opf] Preserving existing SMIL file (empty): href='{}'", href);
                                    }
                                }
                                // Write the existing item, but use reassigned ID if it was changed
                                let mut existing_item = BytesStart::new("item");
                                let mut id_was_reassigned = false;
                                let mut reassigned_id: Option<String> = None;
                                
                                // For SMIL items, check if the ID was reassigned due to duplicates
                                if mt == "application/smil+xml" {
                                    if let Some(ref href) = href_attr {
                                        if let Some(reassigned) = existing_smil_href_to_id.get(href) {
                                            // Check if the original ID differs from the reassigned one
                                            let mut original_id: Option<String> = None;
                                            for attr in &attrs {
                                                if attr.key.as_ref() == b"id" {
                                                    original_id = Some(String::from_utf8_lossy(&attr.value).to_string());
                                                    break;
                                                }
                                            }
                                            if let Some(orig_id) = original_id {
                                                if orig_id != *reassigned {
                                                    id_was_reassigned = true;
                                                    reassigned_id = Some(reassigned.clone());
                                                    log::info!("[update_content_opf] Reassigning SMIL ID from '{}' to '{}' for href '{}' (empty)", orig_id, reassigned, href);
                                                }
                                            }
                                        }
                                    }
                                }
                                
                                for attr in &attrs {
                                    let key = attr.key.as_ref();
                                    // If ID was reassigned, use the new ID instead
                                    if id_was_reassigned && key == b"id" {
                                        if let Some(ref new_id) = reassigned_id {
                                            existing_item.push_attribute(("id", new_id.as_str()));
                                        }
                                    } else {
                                        existing_item.push_attribute((key, attr.value.as_ref()));
                                    }
                                }
                                writer.write_event(Event::Empty(existing_item))
                                    .context("Failed to write existing audio/SMIL empty item tag")
                                    .map_err(|e| AppError::XmlParse(e.to_string()))?;
                                continue;
                            }
                        }
                    }
                    
                    // Check if this is a chapter item that needs media-overlay
                    let mut needs_media_overlay = false;
                    let mut smil_id_to_add: Option<String> = None;
                    
                    if let Some(ref href) = href_attr {
                        // Normalize the href from manifest (strip leading slash)
                        let normalized_href = strip_base_path_prefix(href);
                        
                        // Check if this is an HTML/XHTML file that might need media-overlay
                        let is_html_content = media_type_attr.as_ref()
                            .map(|mt| mt == "application/xhtml+xml" || mt == "text/html" || mt == "application/html+xml")
                            .unwrap_or(false);
                        
                        if is_html_content {
                            log::debug!("Checking for SMIL match for chapter href '{}' (normalized: '{}', empty item)", href, normalized_href);
                            
                            // First, check if there's an existing SMIL file for this chapter
                            // Generate SMIL href the same way it's done in processing.rs
                            let smil_href_candidates = vec![
                                normalized_href.replace(".xhtml", ".smil").replace(".html", ".smil"),
                                format!("{}.smil", normalized_href.replace(".xhtml", "").replace(".html", "")),
                            ];
                            
                            // Check existing SMIL files first
                            for smil_candidate in &smil_href_candidates {
                                if let Some(existing_smil_id) = existing_smil_href_to_id.get(smil_candidate) {
                                    needs_media_overlay = true;
                                    smil_id_to_add = Some(existing_smil_id.clone());
                                    log::debug!("  ✓ Found existing SMIL file '{}' with id '{}' for chapter '{}' (empty item)", smil_candidate, existing_smil_id, normalized_href);
                                    break;
                                }
                            }
                            
                            // If no existing SMIL file found, check new SMIL files being added
                            if !needs_media_overlay {
                            // Match by comparing manifest href with chapter hrefs
                            // Since smil_files is sorted by chapter_index, and chapters are processed
                            // in order (chapter_index matches position in chapters vector),
                            // we can find the SMIL file by matching the chapter href
                            for (chapter_pos, chapter_href) in chapters.iter().enumerate() {
                                let normalized_chapter_href = strip_base_path_prefix(chapter_href);
                                
                                // Try exact match first
                                if normalized_href == normalized_chapter_href {
                                    // Find the SMIL file with chapter_index matching chapter_pos
                                        if let Some((smil_chapter_idx, smil_href)) = smil_files.iter()
                                            .find(|(smil_chapter_idx, _)| *smil_chapter_idx == chapter_pos)
                                            .map(|(_, href)| (chapter_pos, href)) {
                                            // Look up the ID we generated for this SMIL file
                                            if let Some(smil_id) = smil_href_to_id.get(smil_href) {
                                        needs_media_overlay = true;
                                                smil_id_to_add = Some(smil_id.clone());
                                                log::debug!("  ✓ Exact match! Matched chapter href '{}' (position {}) with new SMIL id '{}' (stored chapter_index: {}, empty item)", normalized_href, chapter_pos, smil_id, smil_chapter_idx);
                                        break;
                                            } else {
                                                log::debug!("  ✗ SMIL file found but ID not in mapping for chapter href '{}' (empty item)", normalized_href);
                                            }
                                    } else {
                                        log::debug!("  ✗ No SMIL file found with chapter_index={} for chapter href '{}' (empty item)", chapter_pos, normalized_href);
                                    }
                                }
                                
                                // Try matching by filename (in case paths differ)
                                let href_filename = normalized_href.split('/').last().unwrap_or(&normalized_href);
                                let chapter_filename = normalized_chapter_href.split('/').last().unwrap_or(&normalized_chapter_href);
                                if href_filename == chapter_filename && !href_filename.is_empty() {
                                    // Find the SMIL file with chapter_index matching chapter_pos
                                        if let Some((smil_chapter_idx, smil_href)) = smil_files.iter()
                                            .find(|(smil_chapter_idx, _)| *smil_chapter_idx == chapter_pos)
                                            .map(|(_, href)| (chapter_pos, href)) {
                                            // Look up the ID we generated for this SMIL file
                                            if let Some(smil_id) = smil_href_to_id.get(smil_href) {
                                        needs_media_overlay = true;
                                                smil_id_to_add = Some(smil_id.clone());
                                                log::debug!("  ✓ Filename match! Matched chapter by filename '{}' (position {}) with new SMIL id '{}' (stored chapter_index: {}, empty item)", href_filename, chapter_pos, smil_id, smil_chapter_idx);
                                        break;
                                            } else {
                                                log::debug!("  ✗ SMIL file found but ID not in mapping for chapter filename '{}' (empty item)", href_filename);
                                            }
                                    } else {
                                        log::debug!("  ✗ No SMIL file found with chapter_index={} for chapter filename '{}' (empty item)", chapter_pos, href_filename);
                                        }
                                    }
                                }
                            }
                            
                            if !needs_media_overlay {
                                log::debug!("  ✗ No SMIL match found for chapter href '{}' (empty item)", normalized_href);
                            }
                        }
                    }
                    
                    let mut new_item = BytesStart::new("item");
                    let mut existing_media_overlay: Option<String> = None;
                    
                    for attr in &attrs {
                        let key = attr.key.as_ref();
                        // Preserve existing media-overlay if this chapter isn't being converted now
                        if key == b"media-overlay" {
                            // Check if this chapter is in the current conversion batch
                            let is_in_current_batch = if let Some(ref href) = href_attr {
                                let normalized_href = strip_base_path_prefix(href);
                                chapters.iter().any(|ch| {
                                    let normalized_ch = strip_base_path_prefix(ch);
                                    normalized_href == normalized_ch || 
                                    normalized_href.split('/').last() == normalized_ch.split('/').last()
                                })
                            } else {
                                false
                            };
                            
                            if !is_in_current_batch {
                                // Preserve existing media-overlay for chapters not in current batch
                                if let Ok(value_str) = std::str::from_utf8(&attr.value) {
                                    existing_media_overlay = Some(value_str.to_string());
                                    log::debug!("Preserving existing media-overlay='{}' for chapter href='{}' (empty item, not in current conversion batch)", 
                                        value_str,
                                        href_attr.as_ref().map(|h| h.as_ref()).unwrap_or("unknown"));
                                }
                            }
                            // Skip adding it now - we'll add it back if preserving, or add new one if converting
                            continue;
                        }
                        new_item.push_attribute((key, attr.value.as_ref()));
                    }
                    
                    // Add media-overlay: either preserve existing or add new one
                    if let Some(existing) = existing_media_overlay {
                        // Preserve existing media-overlay for already-converted chapters
                        new_item.push_attribute(("media-overlay", existing.as_str()));
                    } else if needs_media_overlay {
                        // Add new media-overlay for chapters being converted now
                        if let Some(ref smil_id) = smil_id_to_add {
                            new_item.push_attribute(("media-overlay", smil_id.as_str()));
                            log::debug!("Added media-overlay='{}' to chapter item with href='{}' (empty item)", smil_id, href_attr.as_ref().unwrap_or(&"unknown".to_string()));
                        }
                    } else if let Some(ref href) = href_attr {
                        // Log when we don't add media-overlay for debugging
                        let is_html = media_type_attr.as_ref()
                            .map(|mt| mt == "application/xhtml+xml" || mt == "text/html" || mt == "application/html+xml")
                            .unwrap_or(false);
                        if is_html {
                            log::debug!("No media-overlay added for chapter item href='{}' (empty item, no matching SMIL file found)", href);
                        }
                    }
                    
                    writer.write_event(Event::Empty(new_item))
                        .context("Failed to write empty item tag")
                        .map_err(|e| AppError::XmlParse(e.to_string()))?;
                } else {
                    writer.write_event(Event::Empty(e))
                        .context("Failed to write empty XML tag")
                        .map_err(|e| AppError::XmlParse(e.to_string()))?;
                }
            }
            Ok(Event::Eof) => break,
            Ok(e) => {
                writer.write_event(e)
                    .context("Failed to write XML event")
                    .map_err(|e| AppError::XmlParse(e.to_string()))?;
            }
            Err(e) => {
                return Err(AppError::XmlParse(format!("XML parse error at position {}: {}", reader.buffer_position(), e)));
            }
        }
    }
    
    let result = writer.into_inner().into_inner();
    let output = String::from_utf8_lossy(&result).to_string();
    
    // Verify that items were added if we had any to add
    if !manifest_items_to_add.is_empty() {
        let has_audio = output.contains("audio/mpeg") || output.contains("audio/wav");
        let has_smil = output.contains("application/smil+xml");
        log::debug!("OPF output verification: has_audio={}, has_smil={}, expected {} items", 
            has_audio, has_smil, manifest_items_to_add.len());
        
        if !has_audio && !has_smil && !audio_files.is_empty() && !smil_files.is_empty() {
            log::warn!("Warning: Manifest items were built but not found in output OPF!");
        }
    }
    
    // Verify media-overlay attributes were added
    let media_overlay_count = output.matches("media-overlay").count();
    let expected_media_overlays = smil_files.len();
    log::debug!("OPF output verification: found {} media-overlay attributes, expected {}", 
        media_overlay_count, expected_media_overlays);
    
    if media_overlay_count < expected_media_overlays && !smil_files.is_empty() {
        log::warn!("Warning: Expected {} media-overlay attributes but found {} in output OPF!", 
            expected_media_overlays, media_overlay_count);
        // Log a sample of the output to help debug
        if let Some(start) = output.find("<manifest") {
            if let Some(end) = output[start..].find("</manifest>") {
                let manifest_section = &output[start..start+end.min(500)];
                log::debug!("Manifest section sample: {}", manifest_section);
            }
        }
    }
    
    // Validate that there are no duplicate IDs in the output
    let mut seen_ids = std::collections::HashSet::new();
    let mut duplicate_ids = Vec::new();
    let mut validation_reader = Reader::from_str(&output);
    validation_reader.trim_text(true);
    let mut in_manifest = false;
    
    loop {
        match validation_reader.read_event() {
            Ok(Event::Start(e)) => {
                let name = e.name().into_inner();
                if name == b"manifest" {
                    in_manifest = true;
                } else if in_manifest && name == b"item" {
                    for attr in e.attributes().flatten() {
                        if attr.key.as_ref() == b"id" {
                            if let Ok(id_str) = std::str::from_utf8(&attr.value) {
                                if seen_ids.contains(id_str) {
                                    duplicate_ids.push(id_str.to_string());
                                    log::error!("[update_content_opf] CRITICAL: Duplicate ID '{}' found in output OPF!", id_str);
                                } else {
                                    seen_ids.insert(id_str.to_string());
                                }
                            }
                            break;
                        }
                    }
                }
                validation_reader.read_to_end(e.name()).ok();
            }
            Ok(Event::Empty(e)) => {
                let name = e.name().into_inner();
                if name == b"manifest" {
                    in_manifest = true;
                } else if in_manifest && name == b"item" {
                    for attr in e.attributes().flatten() {
                        if attr.key.as_ref() == b"id" {
                            if let Ok(id_str) = std::str::from_utf8(&attr.value) {
                                if seen_ids.contains(id_str) {
                                    duplicate_ids.push(id_str.to_string());
                                    log::error!("[update_content_opf] CRITICAL: Duplicate ID '{}' found in output OPF!", id_str);
                                } else {
                                    seen_ids.insert(id_str.to_string());
                                }
                            }
                            break;
                        }
                    }
                }
            }
            Ok(Event::End(e)) => {
                if e.name().into_inner() == b"manifest" {
                    in_manifest = false;
                }
            }
            Ok(Event::Eof) => break,
            _ => {}
        }
    }
    
    if !duplicate_ids.is_empty() {
        log::error!("[update_content_opf] Found {} duplicate IDs in output: {:?}", duplicate_ids.len(), duplicate_ids);
        return Err(AppError::XmlParse(format!("Duplicate IDs found in OPF output: {:?}", duplicate_ids)));
    } else {
        log::debug!("[update_content_opf] Validation passed: no duplicate IDs found in output");
    }
    
    Ok(output)
}

