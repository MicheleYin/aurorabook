use std::collections::HashMap;
use quick_xml::events::Event;
use quick_xml::Reader;

/// Parse navigation document to extract chapter titles
pub fn parse_navigation(nav_content: &str) -> Result<HashMap<String, String>, String> {
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

