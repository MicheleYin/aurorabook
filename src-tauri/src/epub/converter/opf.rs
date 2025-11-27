use quick_xml::events::{Event, BytesEnd, BytesStart, BytesText};
use quick_xml::Writer;
use quick_xml::Reader;
use std::io::{Cursor, Write};
use std::collections::HashSet;
use crate::utils::errors::{AppError, AppResult};
use anyhow::Context;

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
    let mut in_metadata = false;
    let mut needs_media_overlay_meta = true;
    
    // Build items to add
    for (idx, (_, href)) in audio_files.iter().enumerate() {
        if !added_audio_hrefs.contains(href) {
            added_audio_hrefs.insert(href.clone());
            let item_id = format!("m{:03}", idx + 1);
            let is_mp3 = href.ends_with(".mp3");
            let media_type = if is_mp3 { "audio/mpeg" } else { "audio/wav" };
            
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
                    in_metadata = true;
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
                        for (idx, (chapter_idx, _)) in smil_files.iter().enumerate() {
                            let chapter_href = if let Some(chapter) = chapters.get(*chapter_idx) {
                                let mut ch = chapter.clone();
                                if ch.starts_with("OEBPS/") {
                                    ch = ch[6..].to_string();
                                }
                                ch
                            } else {
                                continue;
                            };
                            
                            if href == &chapter_href {
                                needs_media_overlay = true;
                                smil_id_to_add = Some(format!("s{:03}", idx + 1));
                                break;
                            }
                        }
                    }
                    
                    // Create new item element with media-overlay if needed
                    let mut new_item = BytesStart::new("item");
                    for attr in &attrs {
                        let key = attr.key.as_ref();
                        // Skip existing media-overlay
                        if key == b"media-overlay" {
                            continue;
                        }
                        new_item.push_attribute((key, attr.value.as_ref()));
                    }
                    
                    if needs_media_overlay {
                        if let Some(ref smil_id) = smil_id_to_add {
                            new_item.push_attribute(("media-overlay", smil_id.as_str()));
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
                    for item_xml in &manifest_items_to_add {
                        writer.get_mut().write_all(item_xml)
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
                    in_metadata = false;
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
                    
                    // Check if this is a chapter item
                    let mut needs_media_overlay = false;
                    let mut smil_id_to_add: Option<String> = None;
                    
                    if let Some(ref href) = href_attr {
                        for (idx, (chapter_idx, _)) in smil_files.iter().enumerate() {
                            let chapter_href = if let Some(chapter) = chapters.get(*chapter_idx) {
                                let mut ch = chapter.clone();
                                if ch.starts_with("OEBPS/") {
                                    ch = ch[6..].to_string();
                                }
                                ch
                            } else {
                                continue;
                            };
                            
                            if href == &chapter_href {
                                needs_media_overlay = true;
                                smil_id_to_add = Some(format!("s{:03}", idx + 1));
                                break;
                            }
                        }
                    }
                    
                    let mut new_item = BytesStart::new("item");
                    for attr in &attrs {
                        let key = attr.key.as_ref();
                        if key == b"media-overlay" {
                            continue;
                        }
                        new_item.push_attribute((key, attr.value.as_ref()));
                    }
                    
                    if needs_media_overlay {
                        if let Some(ref smil_id) = smil_id_to_add {
                            new_item.push_attribute(("media-overlay", smil_id.as_str()));
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
    Ok(String::from_utf8_lossy(&result).to_string())
}

