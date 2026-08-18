use quick_xml::events::{Event, BytesEnd, BytesStart, BytesDecl};
use quick_xml::Reader;
use quick_xml::Writer;
use std::io::Cursor;
use crate::utils::errors::{AppError, AppResult};
use crate::book_service::models::{AudioSyncSegment, AudioSyncMap, Chapter};

/// Format time in SMIL format (HH:MM:SS.mmm).
///
/// Converts a time value in seconds to the SMIL time format used in
/// EPUB media overlay files. The format is hours:minutes:seconds.milliseconds.
///
/// # Arguments
/// * `seconds` - Time in seconds (can be fractional)
///
/// # Returns
/// A formatted time string in SMIL format (e.g., "00:01:23.456")
///
/// # Example
/// ```rust
/// let time_str = format_smil_time(83.456);
/// assert_eq!(time_str, "00:01:23.456");
/// ```
pub fn format_smil_time(seconds: f64) -> String {
    let hours = (seconds / 3600.0) as u32;
    let minutes = ((seconds % 3600.0) / 60.0) as u32;
    let secs_float = seconds % 60.0;
    let secs = secs_float.floor() as u32;
    let ms = ((secs_float % 1.0) * 1000.0) as u32;
    
    format!("{:02}:{:02}:{:02}.{:03}", hours, minutes, secs, ms)
}

/// Generate SMIL (Synchronized Multimedia Integration Language) file for EPUB media overlay.
///
/// SMIL files enable synchronized text highlighting and audio playback in EPUB readers.
/// This function creates a SMIL file that maps text segments (identified by span IDs)
/// to corresponding audio segments with precise timing information.
///
/// The generated SMIL structure:
/// ```xml
/// <smil xmlns="http://www.w3.org/ns/SMIL" xmlns:epub="http://www.idpf.org/2007/ops" version="3.0">
///   <body>
///     <seq id="seq1" epub:textref="chapter.xhtml" epub:type="bodymatter chapter">
///       <par id="p000001">
///         <text src="chapter.xhtml#f000001"/>
///         <audio src="Audio/chapter.mp3" clipBegin="00:00:00.000" clipEnd="00:00:02.500"/>
///       </par>
///       <!-- More par elements for each segment -->
///     </seq>
///   </body>
/// </smil>
/// ```
///
/// # Arguments
/// * `chapter_href` - Relative path to the chapter HTML file (e.g., "chapter1.xhtml")
/// * `audio_href` - Relative path to the audio file (e.g., "Audio/chapter1.mp3")
/// * `segments` - Vector of (chunk_id, start_time, end_time) tuples:
///   - `chunk_id` - The span ID from the chunked HTML (e.g., "f000001")
///   - `start_time` - Audio start time in seconds
///   - `end_time` - Audio end time in seconds
///
/// # Returns
/// The complete SMIL file as an XML string.
///
/// # Errors
/// Returns `AppError::XmlParse` if XML generation fails.
///
/// # Example
/// ```rust
/// let segments = vec![
///     ("f000001".to_string(), 0.0, 2.5),
///     ("f000002".to_string(), 2.5, 5.0),
/// ];
/// let smil = generate_smil_file("chapter1.xhtml", "Audio/chapter1.mp3", &segments)?;
/// ```
pub fn generate_smil_file(
    chapter_href: &str,
    audio_href: &str,
    segments: &[(String, f64, f64)],
) -> AppResult<String> {
    let mut writer = Writer::new(Cursor::new(Vec::new()));
    
    // Write XML declaration
    let decl = BytesDecl::new("1.0", Some("UTF-8"), None);
    writer.write_event(Event::Decl(decl))
        .map_err(|e| AppError::XmlParse(format!("Failed to write XML declaration: {}", e)))?;
    
    // Write <smil> root element with namespaces
    let mut smil_start = BytesStart::new("smil");
    smil_start.push_attribute(("xmlns", "http://www.w3.org/ns/SMIL"));
    smil_start.push_attribute(("xmlns:epub", "http://www.idpf.org/2007/ops"));
    smil_start.push_attribute(("version", "3.0"));
    writer.write_event(Event::Start(smil_start))
        .map_err(|e| AppError::XmlParse(format!("Failed to write SMIL start tag: {}", e)))?;
    
    // Write <body>
    writer.write_event(Event::Start(BytesStart::new("body")))
        .map_err(|e| AppError::XmlParse(format!("Failed to write body start tag: {}", e)))?;
    
    // Write <seq> with epub attributes
    let mut seq_start = BytesStart::new("seq");
    seq_start.push_attribute(("id", "seq1"));
    seq_start.push_attribute(("epub:textref", chapter_href));
    seq_start.push_attribute(("epub:type", "bodymatter chapter"));
    writer.write_event(Event::Start(seq_start))
        .map_err(|e| AppError::XmlParse(format!("Failed to write seq start tag: {}", e)))?;
    
    // Write <par> elements for each segment
    for (idx, (id, start, end)) in segments.iter().enumerate() {
        let par_id = format!("p{:06}", idx + 1);
        let text_src = format!("{}#{}", chapter_href, id);
        let clip_begin = format_smil_time(*start);
        let clip_end = format_smil_time(*end);
        
        // Write <par> start
        let mut par_start = BytesStart::new("par");
        par_start.push_attribute(("id", par_id.as_str()));
        writer.write_event(Event::Start(par_start))
            .map_err(|e| AppError::XmlParse(format!("Failed to write par start tag: {}", e)))?;
        
        // Write <text> element
        let mut text_start = BytesStart::new("text");
        text_start.push_attribute(("src", text_src.as_str()));
        writer.write_event(Event::Empty(text_start))
            .map_err(|e| AppError::XmlParse(format!("Failed to write text element: {}", e)))?;
        
        // Write <audio> element
        let mut audio_start = BytesStart::new("audio");
        audio_start.push_attribute(("clipBegin", clip_begin.as_str()));
        audio_start.push_attribute(("clipEnd", clip_end.as_str()));
        audio_start.push_attribute(("src", audio_href));
        writer.write_event(Event::Empty(audio_start))
            .map_err(|e| AppError::XmlParse(format!("Failed to write audio element: {}", e)))?;
        
        // Write </par> end
        writer.write_event(Event::End(BytesEnd::new("par")))
            .map_err(|e| AppError::XmlParse(format!("Failed to write par end tag: {}", e)))?;
    }
    
    // Write </seq>
    writer.write_event(Event::End(BytesEnd::new("seq")))
        .map_err(|e| AppError::XmlParse(format!("Failed to write seq end tag: {}", e)))?;
    
    // Write </body>
    writer.write_event(Event::End(BytesEnd::new("body")))
        .map_err(|e| AppError::XmlParse(format!("Failed to write body end tag: {}", e)))?;
    
    // Write </smil>
    writer.write_event(Event::End(BytesEnd::new("smil")))
        .map_err(|e| AppError::XmlParse(format!("Failed to write SMIL end tag: {}", e)))?;
    
    let result = writer.into_inner().into_inner();
    Ok(String::from_utf8_lossy(&result).to_string())
}

/// Parse SMIL time string to seconds.
///
/// Supports formats:
/// - HH:MM:SS.mmm (e.g., "00:01:23.456")
/// - MM:SS.mmm (e.g., "01:23.456")
/// - SS.mmm or SS (e.g., "83.456" or "83")
///
/// # Arguments
/// * `time_str` - Time string in SMIL format
///
/// # Returns
/// Time in seconds as f64
pub(crate) fn parse_smil_time(time_str: &str) -> f64 {
    let parts: Vec<&str> = time_str.split(':').collect();
    
    if parts.len() == 3 {
        // HH:MM:SS.mmm format
        let hours: f64 = parts[0].parse().unwrap_or(0.0);
        let minutes: f64 = parts[1].parse().unwrap_or(0.0);
        let seconds: f64 = parts[2].parse().unwrap_or(0.0);
        return hours * 3600.0 + minutes * 60.0 + seconds;
    } else if parts.len() == 2 {
        // MM:SS.mmm format
        let minutes: f64 = parts[0].parse().unwrap_or(0.0);
        let seconds: f64 = parts[1].parse().unwrap_or(0.0);
        return minutes * 60.0 + seconds;
    }
    
    // Fallback: try parsing as seconds
    time_str.parse().unwrap_or(0.0)
}

/// Parse a SMIL file and extract audio-text sync segments.
///
/// This function reads a SMIL (Synchronized Multimedia Integration Language) file
/// and extracts the synchronization information that maps text elements to audio segments.
///
/// # Arguments
/// * `smil_content` - The SMIL file content as a string
/// * `chapter_href` - The chapter href this SMIL file corresponds to
///
/// # Returns
/// A vector of `AudioSyncSegment` objects, or an error if parsing fails
///
/// # Example SMIL Structure
/// ```xml
/// <smil xmlns="http://www.w3.org/ns/SMIL" version="3.0">
///   <body>
///     <seq>
///       <par>
///         <text src="chapter.xhtml#f000001"/>
///         <audio src="Audio/chapter.mp3" clipBegin="00:00:00.000" clipEnd="00:00:02.500"/>
///       </par>
///     </seq>
///   </body>
/// </smil>
/// ```
pub fn parse_smil_file(
    smil_content: &str,
    chapter_href: &str,
) -> AppResult<Vec<AudioSyncSegment>> {
    log::debug!("Parsing SMIL file for chapter: {}", chapter_href);
    log::trace!("SMIL content length: {} bytes", smil_content.len());
    
    let mut reader = Reader::from_str(smil_content);
    reader.trim_text(true);
    
    let mut segments = Vec::new();
    let mut in_par = false;
    let mut text_src: Option<String> = None;
    let mut audio_src: Option<String> = None;
    let mut clip_begin: Option<String> = None;
    let mut clip_end: Option<String> = None;
    
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => {
                let name_bytes = e.name().into_inner();
                
                if name_bytes == b"par" {
                    log::trace!("Found <par> start");
                    in_par = true;
                    text_src = None;
                    audio_src = None;
                    clip_begin = None;
                    clip_end = None;
                } else if in_par {
                    if name_bytes == b"text" {
                        for attr in e.attributes() {
                            if let Ok(attr) = attr {
                                if attr.key.into_inner() == b"src" {
                                    let src_value = String::from_utf8_lossy(&attr.value).to_string();
                                    text_src = Some(src_value.clone());
                                    log::trace!("Found <text> with src: {}", src_value);
                                }
                            }
                        }
                    } else if name_bytes == b"audio" {
                        for attr in e.attributes() {
                            if let Ok(attr) = attr {
                                match attr.key.into_inner() {
                                    b"src" => {
                                        audio_src = Some(String::from_utf8_lossy(&attr.value).to_string());
                                    }
                                    b"clipBegin" => {
                                        clip_begin = Some(String::from_utf8_lossy(&attr.value).to_string());
                                    }
                                    b"clipEnd" => {
                                        clip_end = Some(String::from_utf8_lossy(&attr.value).to_string());
                                    }
                                    _ => {}
                                }
                            }
                        }
                    }
                }
            }
            Ok(Event::Empty(e)) => {
                let name_bytes = e.name().into_inner();
                
                // Handle self-closing elements (text and audio are typically self-closing in SMIL)
                if in_par {
                    if name_bytes == b"text" {
                        for attr in e.attributes() {
                            if let Ok(attr) = attr {
                                if attr.key.into_inner() == b"src" {
                                    text_src = Some(String::from_utf8_lossy(&attr.value).to_string());
                                    log::trace!("Found self-closing <text> with src: {}", text_src.as_ref().unwrap());
                                }
                            }
                        }
                    } else if name_bytes == b"audio" {
                        for attr in e.attributes() {
                            if let Ok(attr) = attr {
                                match attr.key.into_inner() {
                                    b"src" => {
                                        audio_src = Some(String::from_utf8_lossy(&attr.value).to_string());
                                    }
                                    b"clipBegin" => {
                                        clip_begin = Some(String::from_utf8_lossy(&attr.value).to_string());
                                    }
                                    b"clipEnd" => {
                                        clip_end = Some(String::from_utf8_lossy(&attr.value).to_string());
                                    }
                                    _ => {}
                                }
                            }
                        }
                        // Audio element is complete (self-closing), process the segment if we have all data
                        log::trace!(
                            "Found self-closing <audio> in_par={}, text_src={:?}, audio_src={:?}, clipBegin={:?}, clipEnd={:?}",
                            in_par,
                            text_src,
                            audio_src,
                            clip_begin,
                            clip_end
                        );
                        if let (Some(text_src_val), Some(audio_src_val), Some(clip_begin_val), Some(clip_end_val)) =
                            (text_src.clone(), audio_src.clone(), clip_begin.clone(), clip_end.clone())
                        {
                            // Extract element ID from text src (e.g., "p001.xhtml#f000001" -> "f000001")
                            if let Some(hash_pos) = text_src_val.rfind('#') {
                                let text_element_id = text_src_val[(hash_pos + 1)..].to_string();
                                
                                // Normalize audio src - remove leading ../ and leading slashes
                                let mut normalized_audio_src = audio_src_val.replace("../", "");
                                if normalized_audio_src.starts_with('/') {
                                    normalized_audio_src = normalized_audio_src[1..].to_string();
                                }
                                
                                let begin_seconds = parse_smil_time(&clip_begin_val);
                                let end_seconds = parse_smil_time(&clip_end_val);
                                
                                log::trace!(
                                    "Parsed SMIL segment: text_id={}, audio={}, time={:.3}-{:.3}s",
                                    text_element_id,
                                    normalized_audio_src,
                                    begin_seconds,
                                    end_seconds
                                );
                                
                                segments.push(AudioSyncSegment {
                                    text_element_id,
                                    chapter_href: chapter_href.to_string(),
                                    audio_track_href: normalized_audio_src,
                                    clip_begin: begin_seconds,
                                    clip_end: end_seconds,
                                    words: None,
                                });
                                
                                // Reset for next par element (but keep in_par true until </par>)
                                text_src = None;
                                audio_src = None;
                                clip_begin = None;
                                clip_end = None;
                            }
                        }
                    }
                }
            }
            Ok(Event::End(e)) => {
                if e.name().into_inner() == b"par" && in_par {
                    // Par element ended - if we haven't processed the segment yet (e.g., if audio wasn't self-closing),
                    // process it now. Otherwise, just reset the state.
                    if let (Some(text_src_val), Some(audio_src_val), Some(clip_begin_val), Some(clip_end_val)) =
                        (text_src.clone(), audio_src.clone(), clip_begin.clone(), clip_end.clone())
                    {
                        // Extract element ID from text src (e.g., "p001.xhtml#f000001" -> "f000001")
                        if let Some(hash_pos) = text_src_val.rfind('#') {
                            let text_element_id = text_src_val[(hash_pos + 1)..].to_string();
                            
                            // Normalize audio src - remove leading ../ and leading slashes
                            let mut normalized_audio_src = audio_src_val.replace("../", "");
                            if normalized_audio_src.starts_with('/') {
                                normalized_audio_src = normalized_audio_src[1..].to_string();
                            }
                            
                            let begin_seconds = parse_smil_time(&clip_begin_val);
                            let end_seconds = parse_smil_time(&clip_end_val);
                            
                            log::trace!(
                                "Parsed SMIL segment (from par end): text_id={}, audio={}, time={:.3}-{:.3}s",
                                text_element_id,
                                normalized_audio_src,
                                begin_seconds,
                                end_seconds
                            );
                            
                            segments.push(AudioSyncSegment {
                                text_element_id,
                                chapter_href: chapter_href.to_string(),
                                audio_track_href: normalized_audio_src,
                                clip_begin: begin_seconds,
                                clip_end: end_seconds,
                                words: None,
                            });
                        }
                    }
                    
                    // Reset state for next par element
                    in_par = false;
                    text_src = None;
                    audio_src = None;
                    clip_begin = None;
                    clip_end = None;
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => {
                return Err(AppError::XmlParse(format!(
                    "Failed to parse SMIL file for chapter {}: {}",
                    chapter_href, e
                )));
            }
            _ => {}
        }
    }
    
    log::info!(
        "Parsed {} segments from SMIL file for chapter: {}",
        segments.len(),
        chapter_href
    );
    
    Ok(segments)
}

/// Build an AudioSyncMap from SMIL files in an EPUB archive.
///
/// This function searches for SMIL files associated with each chapter and
/// parses them to build a complete audio synchronization map.
///
/// # Arguments
/// * `archive` - Mutable reference to the EPUB ZIP archive
/// * `chapters` - Vector of chapters with their hrefs
///
/// # Returns
/// An `AudioSyncMap` containing all sync segments, or `None` if no SMIL files are found
pub fn build_audio_sync_map(
    archive: &mut zip::ZipArchive<Cursor<&[u8]>>,
    chapters: &[Chapter],
) -> AppResult<Option<AudioSyncMap>> {
    use std::io::Read;
    
    log::info!("Building audio sync map from SMIL files for {} chapters", chapters.len());
    
    // Try to detect common base path from chapter hrefs
    let detected_base_path = if let Some(first_chapter) = chapters.first() {
        let first_href = &first_chapter.href;
        if first_href.contains("/") {
            if let Some(pos) = first_href.rfind("/") {
                Some(first_href[..pos + 1].to_string())
            } else {
                None
            }
        } else {
            None
        }
    } else {
        None
    };
    
    let mut all_segments = Vec::new();
    
    for chapter in chapters {
        let chapter_href = chapter.href.split('#').next().unwrap_or(&chapter.href);
        
        // Try different SMIL file name variations
        // SMIL files are stored with the same path structure as chapters, just with .smil extension
        let base_href = chapter_href.replace(".xhtml", "").replace(".html", "");
        let mut smil_candidates = vec![
            // Direct replacement of extension (most common case)
            chapter_href.replace(".xhtml", ".smil").replace(".html", ".smil"),
            // Without extension
            format!("{}.smil", base_href),
            // Full path with extension
            format!("{}.smil", chapter_href),
        ];
        
        // Add detected base path variants if available
        if let Some(ref base) = detected_base_path {
            // If chapter already has base path, try without adding it again
            if !chapter_href.starts_with(base) {
                smil_candidates.push(format!("{}{}.smil", base, chapter_href));
                smil_candidates.push(format!("{}{}.smil", base, base_href));
            }
            smil_candidates.push(format!("{}Text/{}.smil", base, base_href));
        }
        
        // Also try without any base path (in case chapter href includes it but SMIL doesn't)
        if chapter_href.contains("/") {
            if let Some(filename) = chapter_href.split('/').last() {
                let filename_base = filename.replace(".xhtml", "").replace(".html", "");
                smil_candidates.push(format!("{}.smil", filename));
                smil_candidates.push(format!("{}.smil", filename_base));
            }
        }
        
        let mut parsed = false;
        log::debug!("Searching for SMIL file for chapter: {} (trying {} candidates)", chapter_href, smil_candidates.len());
        for candidate in &smil_candidates {
            log::trace!("Trying SMIL candidate: {}", candidate);
        }
        for smil_href in &smil_candidates {
            if let Ok(mut smil_file) = archive.by_name(smil_href) {
                log::debug!("Found SMIL file candidate: {}", smil_href);
                let mut smil_content = String::new();
                if smil_file.read_to_string(&mut smil_content).is_ok() {
                    log::debug!("Reading SMIL file: {} ({} bytes)", smil_href, smil_content.len());
                    match parse_smil_file(&smil_content, chapter_href) {
                        Ok(segments) => {
                            if !segments.is_empty() {
                                let segment_count = segments.len();
                                all_segments.extend(segments);
                                parsed = true;
                                log::info!(
                                    "Successfully parsed {} segments from SMIL: {} (total segments: {})",
                                    segment_count,
                                    smil_href,
                                    all_segments.len()
                                );
                                break;
                            } else {
                                log::warn!("SMIL file {} parsed but contains no segments", smil_href);
                            }
                        }
                        Err(e) => {
                            log::warn!("Failed to parse SMIL file {}: {}", smil_href, e);
                        }
                    }
                } else {
                    log::debug!("Failed to read SMIL file content: {}", smil_href);
                }
            }
        }
        
        if !parsed {
            log::debug!("No SMIL file found for chapter: {} (tried {} candidates)", chapter_href, smil_candidates.len());
        }
    }
    
    if all_segments.is_empty() {
        log::warn!("No audio sync segments found in any SMIL files");
        return Ok(None);
    }

    attach_word_cues_from_archive(archive, &mut all_segments);
    
    log::info!(
        "Built audio sync map with {} total segments across {} chapters",
        all_segments.len(),
        chapters.len()
    );
    
    Ok(Some(AudioSyncMap {
        segments: all_segments,
    }))
}

fn attach_word_cues_from_archive(
    archive: &mut zip::ZipArchive<Cursor<&[u8]>>,
    segments: &mut [AudioSyncSegment],
) {
    use std::collections::{HashMap, HashSet};
    use std::io::Read;
    use crate::book_service::models::WordSyncCue;

    let mut audio_hrefs: HashSet<String> = HashSet::new();
    for segment in segments.iter() {
        if !segment.audio_track_href.is_empty() {
            audio_hrefs.insert(segment.audio_track_href.clone());
        }
    }

    let zip_names: Vec<String> = (0..archive.len())
        .filter_map(|i| archive.by_index(i).ok().map(|f| f.name().to_string()))
        .collect();

    let mut words_by_span: HashMap<String, Vec<WordSyncCue>> = HashMap::new();

    for audio_href in audio_hrefs {
        let json_name = audio_href.replace(".mp3", ".words.json");
        let file_name = json_name.rsplit('/').next().unwrap_or(&json_name);
        let Some(zip_path) = zip_names.iter().find(|name| {
            *name == &json_name || name.ends_with(&json_name) || name.ends_with(file_name)
        }) else {
            continue;
        };

        let mut content = String::new();
        let read_ok = archive
            .by_name(zip_path)
            .ok()
            .and_then(|mut file| file.read_to_string(&mut content).ok());
        if read_ok.is_none() {
            continue;
        }

        match serde_json::from_str::<HashMap<String, Vec<WordSyncCue>>>(&content) {
            Ok(parsed) => {
                for (span_id, words) in parsed {
                    words_by_span.insert(span_id, words);
                }
            }
            Err(e) => {
                log::warn!("Failed to parse word timings from {}: {}", zip_path, e);
            }
        }
    }

    if words_by_span.is_empty() {
        return;
    }

    for segment in segments.iter_mut() {
        if let Some(words) = words_by_span.get(&segment.text_element_id) {
            if !words.is_empty() {
                segment.words = Some(words.clone());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Write};
    use zip::write::FileOptions;
    use zip::ZipWriter;

    #[test]
    fn parses_smil_time_formats() {
        assert!((parse_smil_time("01:01:01.500") - 3661.5).abs() < 0.001);
        assert!((parse_smil_time("01:23.456") - 83.456).abs() < 0.001);
        assert!((parse_smil_time("12.5") - 12.5).abs() < 0.001);
        assert_eq!(parse_smil_time("not-a-time"), 0.0);
    }

    #[test]
    fn parses_smil_file_into_sync_segments() {
        let smil = r#"<?xml version="1.0" encoding="UTF-8"?>
<smil xmlns="http://www.w3.org/ns/SMIL" version="3.0">
  <body>
    <seq>
      <par>
        <text src="chapter.xhtml#f000001"/>
        <audio src="Audio/chapter.mp3" clipBegin="00:00:00.000" clipEnd="00:00:02.500"/>
      </par>
      <par>
        <text src="chapter.xhtml#f000002"/>
        <audio src="Audio/chapter.mp3" clipBegin="00:00:02.500" clipEnd="00:00:05.000"/>
      </par>
    </seq>
  </body>
</smil>"#;

        let segments = parse_smil_file(smil, "Text/chapter.xhtml").expect("parse smil");
        assert_eq!(segments.len(), 2);
        assert_eq!(segments[0].text_element_id, "f000001");
        assert_eq!(segments[0].chapter_href, "Text/chapter.xhtml");
        assert_eq!(segments[0].audio_track_href, "Audio/chapter.mp3");
        assert!((segments[0].clip_begin - 0.0).abs() < 0.001);
        assert!((segments[0].clip_end - 2.5).abs() < 0.001);
        assert_eq!(segments[1].text_element_id, "f000002");
    }

    #[test]
    fn build_audio_sync_map_reads_smil_from_zip() {
        let smil = r#"<?xml version="1.0" encoding="UTF-8"?>
<smil xmlns="http://www.w3.org/ns/SMIL" version="3.0">
  <body>
    <seq>
      <par>
        <text src="Text/ch1.xhtml#w1"/>
        <audio src="Audio/ch1.mp3" clipBegin="00:00:00.000" clipEnd="00:00:01.000"/>
      </par>
    </seq>
  </body>
</smil>"#;

        let mut buffer = Cursor::new(Vec::new());
        {
            let mut zip = ZipWriter::new(&mut buffer);
            zip.start_file("Text/ch1.smil", FileOptions::default())
                .expect("start smil");
            zip.write_all(smil.as_bytes()).expect("write smil");
            zip.finish().expect("finish zip");
        }
        let bytes = buffer.into_inner();
        let mut archive = zip::ZipArchive::new(Cursor::new(bytes.as_slice())).expect("open zip");

        let chapters = vec![Chapter {
            id: "c1".into(),
            title: "One".into(),
            content_html: None,
            plain_text: None,
            order: 0,
            href: "Text/ch1.xhtml".into(),
            word_count: None,
            estimated_page_count: None,
        }];

        let map = build_audio_sync_map(&mut archive, &chapters)
            .expect("build map")
            .expect("some map");
        assert_eq!(map.segments.len(), 1);
        assert_eq!(map.segments[0].text_element_id, "w1");
        assert!(map.segments[0].words.is_none());
    }

    #[test]
    fn build_audio_sync_map_attaches_word_cues_from_sidecar() {
        let smil = r#"<?xml version="1.0" encoding="UTF-8"?>
<smil xmlns="http://www.w3.org/ns/SMIL" version="3.0">
  <body>
    <seq>
      <par>
        <text src="Text/ch1.xhtml#w1"/>
        <audio src="Audio/ch1.mp3" clipBegin="00:00:00.000" clipEnd="00:00:01.000"/>
      </par>
    </seq>
  </body>
</smil>"#;
        let words_json = r#"{"w1":[{"word":"Hello","startSec":0.05,"endSec":0.4}]}"#;

        let mut buffer = Cursor::new(Vec::new());
        {
            let mut zip = ZipWriter::new(&mut buffer);
            zip.start_file("Text/ch1.smil", FileOptions::default())
                .expect("start smil");
            zip.write_all(smil.as_bytes()).expect("write smil");
            zip.start_file("Audio/ch1.words.json", FileOptions::default())
                .expect("start words");
            zip.write_all(words_json.as_bytes()).expect("write words");
            zip.finish().expect("finish zip");
        }
        let bytes = buffer.into_inner();
        let mut archive = zip::ZipArchive::new(Cursor::new(bytes.as_slice())).expect("open zip");

        let chapters = vec![Chapter {
            id: "c1".into(),
            title: "One".into(),
            content_html: None,
            plain_text: None,
            order: 0,
            href: "Text/ch1.xhtml".into(),
            word_count: None,
            estimated_page_count: None,
        }];

        let map = build_audio_sync_map(&mut archive, &chapters)
            .expect("build map")
            .expect("some map");
        let words = map.segments[0].words.as_ref().expect("words attached");
        assert_eq!(words.len(), 1);
        assert_eq!(words[0].word, "Hello");
        assert!((words[0].start_sec - 0.05).abs() < 1e-9);
    }

    #[test]
    fn build_audio_sync_map_returns_none_without_smil() {
        let mut buffer = Cursor::new(Vec::new());
        {
            let mut zip = ZipWriter::new(&mut buffer);
            zip.start_file("Text/ch1.xhtml", FileOptions::default())
                .expect("start xhtml");
            zip.write_all(b"<html/>").expect("write xhtml");
            zip.finish().expect("finish zip");
        }
        let bytes = buffer.into_inner();
        let mut archive = zip::ZipArchive::new(Cursor::new(bytes.as_slice())).expect("open zip");
        let chapters = vec![Chapter {
            id: "c1".into(),
            title: "One".into(),
            content_html: None,
            plain_text: None,
            order: 0,
            href: "Text/ch1.xhtml".into(),
            word_count: None,
            estimated_page_count: None,
        }];
        let map = build_audio_sync_map(&mut archive, &chapters).expect("build map");
        assert!(map.is_none());
    }
}

