use quick_xml::events::{Event, BytesEnd, BytesStart, BytesDecl};
use quick_xml::Writer;
use std::io::Cursor;
use crate::utils::errors::{AppError, AppResult};

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

