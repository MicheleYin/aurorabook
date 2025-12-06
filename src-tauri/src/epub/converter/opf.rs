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
    
    // Track if we're inside manifest/metadata
    let mut in_manifest = false;
    let mut manifest_items_to_add: Vec<Vec<u8>> = Vec::new();
    let mut _in_metadata = false;
    let mut needs_media_overlay_meta = true;
    
    // Build items to add
    log::debug!("Building manifest items: {} audio files, {} SMIL files", audio_files.len(), smil_files.len());
    log::debug!("Chapters passed to update_content_opf: {:?}", chapters);
    log::debug!("SMIL files: {:?}", smil_files.iter().map(|(idx, href)| (idx, href)).collect::<Vec<_>>());
    
    for (idx, (_, href)) in audio_files.iter().enumerate() {
        if !added_audio_hrefs.contains(href) {
            added_audio_hrefs.insert(href.clone());
            let item_id = format!("m{:03}", idx + 1);
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
    
    for (idx, (_, href)) in smil_files.iter().enumerate() {
        if !added_smil_hrefs.contains(href) {
            added_smil_hrefs.insert(href.clone());
            let smil_item_id = format!("s{:03}", idx + 1);
            
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
                    
                    // Skip audio and SMIL items (we'll add new ones)
                    if let Some(ref mt) = media_type_attr {
                        if mt.starts_with("audio/") || mt == "application/smil+xml" {
                            reader.read_to_end(e.name())
                                .context("Failed to read to end of item tag")
                                .map_err(|e| AppError::XmlParse(e.to_string()))?;
                            continue;
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
                            
                            // Match by comparing manifest href with chapter hrefs
                            // Since smil_files is sorted by chapter_index, and chapters are processed
                            // in order (chapter_index matches position in chapters vector),
                            // we can find the SMIL file by matching the chapter href
                            for (chapter_pos, chapter_href) in chapters.iter().enumerate() {
                                let normalized_chapter_href = strip_base_path_prefix(chapter_href);
                                
                                // Try exact match first
                                if normalized_href == normalized_chapter_href {
                                    // Find the SMIL file with chapter_index matching chapter_pos
                                    // Since smil_files is sorted by chapter_index, the position in the vector
                                    // should match chapter_pos (assuming no gaps in chapter indices)
                                    if let Some((smil_pos, (smil_chapter_idx, _))) = smil_files.iter().enumerate()
                                        .find(|(_, (smil_chapter_idx, _))| *smil_chapter_idx == chapter_pos) {
                                        needs_media_overlay = true;
                                        // Use the position in the sorted smil_files vector for ID generation
                                        // This matches how we generate IDs when adding SMIL items (line 100)
                                        smil_id_to_add = Some(format!("s{:03}", smil_pos + 1));
                                        log::debug!("  ✓ Exact match! Matched chapter href '{}' (position {}) with SMIL id '{}' (stored chapter_index: {})", normalized_href, chapter_pos, smil_id_to_add.as_ref().unwrap(), smil_chapter_idx);
                                        break;
                                    } else {
                                        log::debug!("  ✗ No SMIL file found with chapter_index={} for chapter href '{}'", chapter_pos, normalized_href);
                                    }
                                }
                                
                                // Try matching by filename (in case paths differ)
                                let href_filename = normalized_href.split('/').last().unwrap_or(&normalized_href);
                                let chapter_filename = normalized_chapter_href.split('/').last().unwrap_or(&normalized_chapter_href);
                                if href_filename == chapter_filename && !href_filename.is_empty() {
                                    // Find the SMIL file with chapter_index matching chapter_pos
                                    if let Some((smil_pos, (smil_chapter_idx, _))) = smil_files.iter().enumerate()
                                        .find(|(_, (smil_chapter_idx, _))| *smil_chapter_idx == chapter_pos) {
                                        needs_media_overlay = true;
                                        // Use the position in the sorted smil_files vector for ID generation
                                        smil_id_to_add = Some(format!("s{:03}", smil_pos + 1));
                                        log::debug!("  ✓ Filename match! Matched chapter by filename '{}' (position {}) with SMIL id '{}' (stored chapter_index: {})", href_filename, chapter_pos, smil_id_to_add.as_ref().unwrap(), smil_chapter_idx);
                                        break;
                                    } else {
                                        log::debug!("  ✗ No SMIL file found with chapter_index={} for chapter filename '{}'", chapter_pos, href_filename);
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
                    
                    // Skip audio and SMIL items
                    if let Some(ref mt) = media_type_attr {
                        if mt.starts_with("audio/") || mt == "application/smil+xml" {
                            continue;
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
                            
                            // Match by comparing manifest href with chapter hrefs
                            // Since smil_files is sorted by chapter_index, and chapters are processed
                            // in order (chapter_index matches position in chapters vector),
                            // we can find the SMIL file by matching the chapter href
                            for (chapter_pos, chapter_href) in chapters.iter().enumerate() {
                                let normalized_chapter_href = strip_base_path_prefix(chapter_href);
                                
                                // Try exact match first
                                if normalized_href == normalized_chapter_href {
                                    // Find the SMIL file with chapter_index matching chapter_pos
                                    // Since smil_files is sorted by chapter_index, the position in the vector
                                    // should match chapter_pos (assuming no gaps in chapter indices)
                                    if let Some((smil_pos, (smil_chapter_idx, _))) = smil_files.iter().enumerate()
                                        .find(|(_, (smil_chapter_idx, _))| *smil_chapter_idx == chapter_pos) {
                                        needs_media_overlay = true;
                                        // Use the position in the sorted smil_files vector for ID generation
                                        // This matches how we generate IDs when adding SMIL items (line 100)
                                        smil_id_to_add = Some(format!("s{:03}", smil_pos + 1));
                                        log::debug!("  ✓ Exact match! Matched chapter href '{}' (position {}) with SMIL id '{}' (stored chapter_index: {}, empty item)", normalized_href, chapter_pos, smil_id_to_add.as_ref().unwrap(), smil_chapter_idx);
                                        break;
                                    } else {
                                        log::debug!("  ✗ No SMIL file found with chapter_index={} for chapter href '{}' (empty item)", chapter_pos, normalized_href);
                                    }
                                }
                                
                                // Try matching by filename (in case paths differ)
                                let href_filename = normalized_href.split('/').last().unwrap_or(&normalized_href);
                                let chapter_filename = normalized_chapter_href.split('/').last().unwrap_or(&normalized_chapter_href);
                                if href_filename == chapter_filename && !href_filename.is_empty() {
                                    // Find the SMIL file with chapter_index matching chapter_pos
                                    if let Some((smil_pos, (smil_chapter_idx, _))) = smil_files.iter().enumerate()
                                        .find(|(_, (smil_chapter_idx, _))| *smil_chapter_idx == chapter_pos) {
                                        needs_media_overlay = true;
                                        // Use the position in the sorted smil_files vector for ID generation
                                        smil_id_to_add = Some(format!("s{:03}", smil_pos + 1));
                                        log::debug!("  ✓ Filename match! Matched chapter by filename '{}' (position {}) with SMIL id '{}' (stored chapter_index: {}, empty item)", href_filename, chapter_pos, smil_id_to_add.as_ref().unwrap(), smil_chapter_idx);
                                        break;
                                    } else {
                                        log::debug!("  ✗ No SMIL file found with chapter_index={} for chapter filename '{}' (empty item)", chapter_pos, href_filename);
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
    
    Ok(output)
}

