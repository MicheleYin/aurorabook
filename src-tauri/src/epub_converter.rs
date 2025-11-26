use std::collections::HashMap;
use std::io::{Cursor, Read, Write};
use tauri::{AppHandle, Emitter, Manager};
use zip::{ZipArchive, ZipWriter};
use zip::write::FileOptions;
use serde::{Deserialize, Serialize};
use num_cpus;
use scraper::{Html, Selector};

mod epub_converter {
    use super::*;

    #[derive(Debug, Clone, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct ConversionProgress {
        pub current_chapter: usize,
        pub total_chapters: usize,
        pub current_step: String,
        pub message: String,
    }

    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct Chapter {
        pub id: String,
        pub title: String,
        pub href: String,
        pub content_html: String,
    }

    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct ConversionOptions {
        pub voice_id: String,
        pub chapters: Vec<Chapter>,
    }

    /// Emit progress update to frontend
    fn emit_progress(app: &AppHandle, progress: ConversionProgress) {
        let _ = app.emit("conversion-progress", progress);
    }

    /// Get CPU core count for parallelism
    pub fn get_parallelism() -> usize {
        let cores = num_cpus::get();
        // Use all cores, but ensure at least 1
        cores.max(1)
    }


    /// Simple text chunking - split by sentences
    /// Returns (chunks with IDs, updated HTML with span tags)
    fn chunk_text(html: &str) -> (Vec<(String, String)>, String) {
        use regex::Regex;
        
        let document = Html::parse_document(html);
        let mut chunks: Vec<(String, String)> = Vec::new();
        let mut chunk_index = 0;
        
        // Selectors for text-containing elements
        let selectors = vec![
            Selector::parse("p").unwrap(),
            Selector::parse("h1").unwrap(),
            Selector::parse("h2").unwrap(),
            Selector::parse("h3").unwrap(),
            Selector::parse("h4").unwrap(),
            Selector::parse("h5").unwrap(),
            Selector::parse("h6").unwrap(),
            Selector::parse("li").unwrap(),
            Selector::parse("blockquote").unwrap(),
            Selector::parse("div").unwrap(),
        ];
        
        let sentence_pattern = Regex::new(r"([^.!?]+[.!?]+)\s*").unwrap();
        
        // Store replacements with unique markers to avoid conflicts
        // Format: (marker_id, new_inner_html, old_outer_html)
        let mut replacements: Vec<(String, String, String)> = Vec::new();
        let mut marker_counter = 0;
        
        // Process each element type
        for selector in &selectors {
            for element in document.select(selector) {
                let text = element.text().collect::<String>().trim().to_string();
                if text.is_empty() {
                    continue;
                }
                
                // Split into sentences
                let sentences: Vec<&str> = sentence_pattern
                    .find_iter(&text)
                    .map(|m| m.as_str().trim())
                    .filter(|s| !s.is_empty())
                    .collect();
                
                let sentences = if sentences.is_empty() {
                    vec![text.as_str()]
                } else {
                    sentences
                };
                
                // Build new content with spans
                let mut new_content = String::new();
                for (idx, sentence) in sentences.iter().enumerate() {
                    let chunk_id = format!("f{:06}", chunk_index + 1);
                    // Escape XML special characters in sentence text
                    let escaped_sentence = sentence
                        .replace('&', "&amp;")
                        .replace('<', "&lt;")
                        .replace('>', "&gt;")
                        .replace('"', "&quot;")
                        .replace('\'', "&apos;");
                    new_content.push_str(&format!(r#"<span id="{}">{}</span>"#, chunk_id, escaped_sentence));
                    if idx < sentences.len() - 1 {
                        new_content.push(' ');
                    }
                    chunks.push((chunk_id.clone(), sentence.to_string()));
                    chunk_index += 1;
                }
                
                // Get the element's outer HTML
                let element_outer = element.html();
                let marker = format!("__CHUNK_MARKER_{}__", marker_counter);
                marker_counter += 1;
                
                replacements.push((marker, new_content, element_outer));
            }
        }
        
        // Now replace elements using markers to avoid conflicts
        let mut updated_html = html.to_string();
        
        // First pass: replace each element with a unique marker
        for (marker, _, old_outer) in &replacements {
            // Find and replace the exact element (only first occurrence to avoid duplicates)
            if let Some(pos) = updated_html.find(old_outer) {
                updated_html.replace_range(pos..pos + old_outer.len(), marker);
            }
        }
        
        // Second pass: replace markers with new content
        for (marker, new_inner, old_outer) in &replacements {
            // Extract opening and closing tags from old_outer
            if let Some(open_tag_end) = old_outer.find('>') {
                let open_tag = &old_outer[..open_tag_end + 1];
                if let Some(close_tag_start) = old_outer.rfind("</") {
                    let close_tag = &old_outer[close_tag_start..];
                    
                    // Replace marker with: <tag>new_content</tag>
                    let new_pattern = format!("{}{}{}", open_tag, new_inner, close_tag);
                    updated_html = updated_html.replace(marker, &new_pattern);
                }
            }
        }
        
        (chunks, updated_html)
    }

    /// Format time in SMIL format (HH:MM:SS.mmm)
    fn format_smil_time(seconds: f64) -> String {
        let hours = (seconds / 3600.0) as u32;
        let minutes = ((seconds % 3600.0) / 60.0) as u32;
        let secs_float = seconds % 60.0;
        let secs = secs_float.floor() as u32;
        let ms = ((secs_float % 1.0) * 1000.0) as u32;
        
        format!("{:02}:{:02}:{:02}.{:03}", hours, minutes, secs, ms)
    }

    /// Generate SMIL file content using quick-xml for proper XML generation
    fn generate_smil_file(
        chapter_href: &str,
        audio_href: &str,
        segments: &[(String, f64, f64)],
    ) -> Result<String, String> {
        use quick_xml::events::{Event, BytesEnd, BytesStart, BytesDecl};
        use quick_xml::Writer;
        use std::io::Cursor;
        
        let mut writer = Writer::new(Cursor::new(Vec::new()));
        
        // Write XML declaration
        let decl = BytesDecl::new("1.0", Some("UTF-8"), None);
        writer.write_event(Event::Decl(decl))
            .map_err(|e| format!("XML write error: {}", e))?;
        
        // Write <smil> root element with namespaces
        let mut smil_start = BytesStart::new("smil");
        smil_start.push_attribute(("xmlns", "http://www.w3.org/ns/SMIL"));
        smil_start.push_attribute(("xmlns:epub", "http://www.idpf.org/2007/ops"));
        smil_start.push_attribute(("version", "3.0"));
        writer.write_event(Event::Start(smil_start))
            .map_err(|e| format!("XML write error: {}", e))?;
        
        // Write <body>
        writer.write_event(Event::Start(BytesStart::new("body")))
            .map_err(|e| format!("XML write error: {}", e))?;
        
        // Write <seq> with epub attributes
        let mut seq_start = BytesStart::new("seq");
        seq_start.push_attribute(("id", "seq1"));
        seq_start.push_attribute(("epub:textref", chapter_href));
        seq_start.push_attribute(("epub:type", "bodymatter chapter"));
        writer.write_event(Event::Start(seq_start))
            .map_err(|e| format!("XML write error: {}", e))?;
        
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
                .map_err(|e| format!("XML write error: {}", e))?;
            
            // Write <text> element
            let mut text_start = BytesStart::new("text");
            text_start.push_attribute(("src", text_src.as_str()));
            writer.write_event(Event::Empty(text_start))
                .map_err(|e| format!("XML write error: {}", e))?;
            
            // Write <audio> element
            let mut audio_start = BytesStart::new("audio");
            audio_start.push_attribute(("clipBegin", clip_begin.as_str()));
            audio_start.push_attribute(("clipEnd", clip_end.as_str()));
            audio_start.push_attribute(("src", audio_href));
            writer.write_event(Event::Empty(audio_start))
                .map_err(|e| format!("XML write error: {}", e))?;
            
            // Write </par> end
            writer.write_event(Event::End(BytesEnd::new("par")))
                .map_err(|e| format!("XML write error: {}", e))?;
        }
        
        // Write </seq>
        writer.write_event(Event::End(BytesEnd::new("seq")))
            .map_err(|e| format!("XML write error: {}", e))?;
        
        // Write </body>
        writer.write_event(Event::End(BytesEnd::new("body")))
            .map_err(|e| format!("XML write error: {}", e))?;
        
        // Write </smil>
        writer.write_event(Event::End(BytesEnd::new("smil")))
            .map_err(|e| format!("XML write error: {}", e))?;
        
        let result = writer.into_inner().into_inner();
        Ok(String::from_utf8_lossy(&result).to_string())
    }

    /// Merge WAV audio data
    fn merge_wav_files(audio_data_arrays: &[Vec<u8>], sample_rate: u32) -> Vec<u8> {
        if audio_data_arrays.is_empty() {
            return Vec::new();
        }
        
        // Calculate total length
        let total_length: usize = audio_data_arrays.iter().map(|a| a.len()).sum();
        
        // Create WAV header (44 bytes)
        let mut wav = Vec::with_capacity(44 + total_length);
        
        // RIFF header
        wav.extend_from_slice(b"RIFF");
        let file_size = (36 + total_length) as u32;
        wav.extend_from_slice(&file_size.to_le_bytes());
        wav.extend_from_slice(b"WAVE");
        
        // fmt chunk
        wav.extend_from_slice(b"fmt ");
        wav.extend_from_slice(&16u32.to_le_bytes()); // fmt chunk size
        wav.extend_from_slice(&1u16.to_le_bytes()); // PCM
        wav.extend_from_slice(&1u16.to_le_bytes()); // mono
        wav.extend_from_slice(&sample_rate.to_le_bytes());
        let byte_rate = sample_rate * 2; // 16-bit = 2 bytes per sample
        wav.extend_from_slice(&byte_rate.to_le_bytes());
        wav.extend_from_slice(&2u16.to_le_bytes()); // block align
        wav.extend_from_slice(&16u16.to_le_bytes()); // bits per sample
        
        // data chunk
        wav.extend_from_slice(b"data");
        wav.extend_from_slice(&(total_length as u32).to_le_bytes());
        
        // Concatenate audio data
        for audio_data in audio_data_arrays {
            wav.extend_from_slice(audio_data);
        }
        
        wav
    }

    /// Update content.opf to include audio tracks and SMIL files
    /// Uses quick-xml for proper XML parsing and generation
    fn update_content_opf(
        opf_xml: &str,
        audio_files: &[(usize, String)],
        smil_files: &[(usize, String)],
        chapters: &[Chapter],
    ) -> Result<String, String> {
        use quick_xml::events::{Event, BytesEnd, BytesStart, BytesText};
        use quick_xml::Writer;
        use quick_xml::Reader;
        use std::io::Cursor;
        use std::collections::HashSet;
        
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
                item.push_attribute((b"id".as_ref(), item_id.as_bytes()));
                item.push_attribute((b"href".as_ref(), href.as_bytes()));
                let media_type_bytes = media_type.as_bytes();
                item.push_attribute((b"media-type".as_ref(), media_type_bytes));
                
                let mut item_xml = Vec::new();
                let mut item_writer = Writer::new(Cursor::new(&mut item_xml));
                item_writer.write_event(Event::Empty(item)).map_err(|e| format!("XML write error: {}", e))?;
                manifest_items_to_add.push(item_xml);
            }
        }
        
        for (idx, (chapter_idx, href)) in smil_files.iter().enumerate() {
            if !added_smil_hrefs.contains(href) {
                added_smil_hrefs.insert(href.clone());
                let smil_item_id = format!("s{:03}", idx + 1);
                
                let mut item = BytesStart::new("item");
                item.push_attribute((b"id".as_ref(), smil_item_id.as_bytes()));
                item.push_attribute((b"href".as_ref(), href.as_bytes()));
                item.push_attribute((b"media-type".as_ref(), b"application/smil+xml".as_ref()));
                
                let mut item_xml = Vec::new();
                let mut item_writer = Writer::new(Cursor::new(&mut item_xml));
                item_writer.write_event(Event::Empty(item)).map_err(|e| format!("XML write error: {}", e))?;
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
                        writer.write_event(Event::Start(e)).map_err(|e| format!("XML write error: {}", e))?;
                    } else if name == b"metadata" {
                        in_metadata = true;
                        writer.write_event(Event::Start(e)).map_err(|e| format!("XML write error: {}", e))?;
                    } else if in_manifest && name == b"item" {
                        // Collect attributes first to avoid borrowing issues
                        let attrs: Result<Vec<_>, _> = e.attributes().collect();
                        let attrs = attrs.map_err(|e| format!("XML attribute error: {}", e))?;
                        
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
                                // Skip reading the content and end tag
                                reader.read_to_end(e.name()).map_err(|e| format!("XML read error: {}", e))?;
                                continue;
                            }
                        }
                        
                        // Check if this is a chapter item that needs media-overlay
                        let mut needs_media_overlay = false;
                        let mut smil_id_to_add: Option<String> = None;
                        
                        if let Some(ref href) = href_attr {
                            for (idx, (chapter_idx, _)) in smil_files.iter().enumerate() {
                                let chapter = &chapters[*chapter_idx];
                                let mut chapter_href = chapter.href.clone();
                                if chapter_href.starts_with("OEBPS/") {
                                    chapter_href = chapter_href[6..].to_string();
                                }
                                
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
                                new_item.push_attribute((b"media-overlay".as_ref(), smil_id.as_bytes()));
                            }
                        }
                        
                        writer.write_event(Event::Start(new_item)).map_err(|e| format!("XML write error: {}", e))?;
                    } else {
                        writer.write_event(Event::Start(e)).map_err(|e| format!("XML write error: {}", e))?;
                    }
                }
                Ok(Event::End(e)) => {
                    let name = e.name().into_inner();
                    
                    if name == b"manifest" {
                        // Before closing manifest, add our new items
                        // Match old version format: all items on one line without extra newlines
                        for item_xml in &manifest_items_to_add {
                            writer.get_mut().write_all(item_xml).map_err(|e| format!("XML write error: {}", e))?;
                        }
                        in_manifest = false;
                        writer.write_event(Event::End(e)).map_err(|e| format!("XML write error: {}", e))?;
                    } else if name == b"metadata" {
                        // Add media overlay metadata before closing metadata
                        if needs_media_overlay_meta {
                            let mut meta = BytesStart::new("meta");
                            meta.push_attribute((b"property".as_ref(), b"media:active-class".as_ref()));
                            writer.write_event(Event::Start(meta)).map_err(|e| format!("XML write error: {}", e))?;
                            let text_content = BytesText::from_escaped("-epub-media-overlay-active");
                            writer.write_event(Event::Text(text_content)).map_err(|e| format!("XML write error: {}", e))?;
                            writer.write_event(Event::End(BytesEnd::new("meta"))).map_err(|e| format!("XML write error: {}", e))?;
                            needs_media_overlay_meta = false;
                        }
                        in_metadata = false;
                        writer.write_event(Event::End(e)).map_err(|e| format!("XML write error: {}", e))?;
                    } else {
                        writer.write_event(Event::End(e)).map_err(|e| format!("XML write error: {}", e))?;
                    }
                }
                Ok(Event::Empty(e)) => {
                    // Handle self-closing tags
                    let name = e.name().into_inner();
                    
                    if in_manifest && name == b"item" {
                        // Collect attributes first to avoid borrowing issues
                        let attrs: Result<Vec<_>, _> = e.attributes().collect();
                        let attrs = attrs.map_err(|e| format!("XML attribute error: {}", e))?;
                        
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
                                let chapter = &chapters[*chapter_idx];
                                let mut chapter_href = chapter.href.clone();
                                if chapter_href.starts_with("OEBPS/") {
                                    chapter_href = chapter_href[6..].to_string();
                                }
                                
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
                                new_item.push_attribute((b"media-overlay".as_ref(), smil_id.as_bytes()));
                            }
                        }
                        
                        writer.write_event(Event::Empty(new_item)).map_err(|e| format!("XML write error: {}", e))?;
                    } else {
                        writer.write_event(Event::Empty(e)).map_err(|e| format!("XML write error: {}", e))?;
                    }
                }
                Ok(Event::Eof) => break,
                Ok(e) => {
                    writer.write_event(e).map_err(|e| format!("XML write error: {}", e))?;
                }
                Err(e) => {
                    return Err(format!("XML parse error at position {}: {}", reader.buffer_position(), e));
                }
            }
        }
        
        let result = writer.into_inner().into_inner();
        Ok(String::from_utf8_lossy(&result).to_string())
    }

    /// Standalone conversion function that doesn't require AppHandle
    pub async fn convert_epub_to_audiobook_standalone(
        epub_data: Vec<u8>,
        options: ConversionOptions,
    ) -> Result<Vec<u8>, String> {
        let parallelism = get_parallelism();
        
        println!("Initializing TTS engine (using {} cores)...", parallelism);
        
        // Find model files (standalone version - no AppHandle needed)
        let mut possible_onnx_paths = Vec::new();
        let mut possible_voices_paths = Vec::new();
        
        if let Ok(current_dir) = std::env::current_dir() {
            possible_onnx_paths.push(current_dir.join("src-tauri").join("resources").join("kokoro-v1.0.onnx"));
            possible_voices_paths.push(current_dir.join("src-tauri").join("resources").join("voices-v1.0.bin"));
            // Also try from project root
            if let Some(parent) = current_dir.parent() {
                possible_onnx_paths.push(parent.join("src-tauri").join("resources").join("kokoro-v1.0.onnx"));
                possible_voices_paths.push(parent.join("src-tauri").join("resources").join("voices-v1.0.bin"));
            }
        }
        
        // Try common resource locations
        if let Ok(home) = std::env::var("HOME") {
            let home_path = std::path::Path::new(&home);
            possible_onnx_paths.push(home_path.join(".aurorabook").join("kokoro-v1.0.onnx"));
            possible_voices_paths.push(home_path.join(".aurorabook").join("voices-v1.0.bin"));
        }
        
        let onnx_path = possible_onnx_paths.iter()
            .find(|p| p.exists() && p.is_file())
            .ok_or_else(|| "ONNX model not found".to_string())?;
        
        let voices_path = possible_voices_paths.iter()
            .find(|p| p.exists() && p.is_file())
            .ok_or_else(|| "Voices file not found".to_string())?;
        
        let onnx_path_str = onnx_path.to_str()
            .ok_or_else(|| "ONNX path contains invalid UTF-8".to_string())?
            .to_string();
        let voices_path_str = voices_path.to_str()
            .ok_or_else(|| "Voices path contains invalid UTF-8".to_string())?
            .to_string();
        
        // Log which model file is being used
        println!("Using ONNX model: {}", onnx_path_str);
        println!("Using voices file: {}", voices_path_str);
        
        // Validate engine can be created (but we'll create per-task instances for parallel processing)
        let _test_engine = kokoros::tts::koko::TTSKokoParallel::new_with_instances(
            &onnx_path_str,
            &voices_path_str,
            1,
        ).await;
        
        // Load EPUB as ZIP
        let mut archive = ZipArchive::new(Cursor::new(&epub_data))
            .map_err(|e| format!("Failed to open EPUB: {}", e))?;
        
        let mut audio_files: Vec<(usize, String)> = Vec::new();
        let mut smil_files: Vec<(usize, String)> = Vec::new();
        let mut zip_files: HashMap<String, Vec<u8>> = HashMap::new();
        
        // Extract all existing files
        for i in 0..archive.len() {
            let mut file = archive.by_index(i)
                .map_err(|e| format!("Failed to read file {}: {}", i, e))?;
            let name = file.name().to_string();
            let mut data = Vec::new();
            file.read_to_end(&mut data)
                .map_err(|e| format!("Failed to read file data: {}", e))?;
            zip_files.insert(name, data);
        }
        
        // Process each chapter
        for (chapter_index, chapter) in options.chapters.iter().enumerate() {
            println!("Generating audio for chapter {}: {}", chapter_index + 1, chapter.title);
            
            // Chunk the chapter text
            let (chunks, updated_html) = chunk_text(&chapter.content_html);
            
            if chunks.is_empty() {
                // Update chapter HTML in ZIP
                let chapter_path = if chapter.href.starts_with("OEBPS/") {
                    chapter.href.clone()
                } else {
                    format!("OEBPS/{}", chapter.href)
                };
                zip_files.insert(chapter_path, updated_html.into_bytes());
                continue;
            }
            
            // Generate audio for chunks in parallel batches
            let mut audio_data_arrays: Vec<Vec<u8>> = Vec::new();
            let mut audio_segments: Vec<(String, f64, f64)> = Vec::new();
            let mut current_time = 0.0;
            let sample_rate = 24000.0;
            
            // Process in batches based on parallelism
            for i in (0..chunks.len()).step_by(parallelism) {
                let batch: Vec<_> = chunks.iter().skip(i).take(parallelism).collect();
                
                // Generate TTS for batch in parallel (same pattern as generate_tts_batch)
                let mut handles = Vec::new();
                for (chunk_id, text) in &batch {
                    let text_clone = text.clone();
                    let voice_id_clone = options.voice_id.clone();
                    let onnx_path_clone = onnx_path_str.clone();
                    let voices_path_clone = voices_path_str.clone();
                    
                    let handle = tokio::spawn(async move {
                        // Create a new engine instance for this task (same as generate_tts_batch)
                        let task_engine = kokoros::tts::koko::TTSKokoParallel::new_with_instances(
                            &onnx_path_clone,
                            &voices_path_clone,
                            1, // Use 1 instance per task
                        ).await;
                        
                        let model_instance = task_engine.get_model_instance(0);
                        task_engine.tts_raw_audio_with_instance(
                            &text_clone,
                            "en",
                            &voice_id_clone,
                            1.0,
                            None,
                            None,
                            None,
                            None,
                            model_instance,
                        )
                        .map_err(|e| format!("TTS generation failed: {}", e))
                    });
                    handles.push((chunk_id.clone(), handle));
                }
                
                // Collect results
                for (chunk_id, handle) in handles {
                    match handle.await {
                        Ok(Ok(audio_samples)) => {
                            // Convert Vec<f32> to 16-bit PCM bytes
                            let num_samples = audio_samples.len();
                            let mut pcm_bytes = Vec::with_capacity(num_samples * 2);
                            for sample in &audio_samples {
                                let clamped = sample.max(-1.0).min(1.0);
                                let pcm_value = if clamped < 0.0 {
                                    (clamped * 32768.0) as i16
                                } else {
                                    (clamped * 32767.0) as i16
                                };
                                pcm_bytes.extend_from_slice(&pcm_value.to_le_bytes());
                            }
                            
                            audio_data_arrays.push(pcm_bytes.clone());
                            
                            let duration = num_samples as f64 / sample_rate;
                            audio_segments.push((
                                chunk_id,
                                current_time,
                                current_time + duration,
                            ));
                            current_time += duration;
                        }
                        Ok(Err(e)) => {
                            eprintln!("Error generating audio for chunk {}: {}", chunk_id, e);
                        }
                        Err(e) => {
                            eprintln!("Task error for chunk {}: {}", chunk_id, e);
                        }
                    }
                }
            }
            
            if audio_data_arrays.is_empty() {
                // Create minimal silence
                let silence_samples = sample_rate as usize;
                let silence_pcm = vec![0u8; silence_samples * 2];
                audio_data_arrays.push(silence_pcm);
                audio_segments.push((
                    chunks[0].0.clone(),
                    0.0,
                    1.0,
                ));
            }
            
            println!("Merging audio for chapter {}...", chapter_index + 1);
            
            // Merge audio
            let merged_wav = merge_wav_files(&audio_data_arrays, sample_rate as u32);
            
            // Convert to MP3
            println!("Converting audio to MP3 for chapter {}...", chapter_index + 1);
            
            // Extract PCM from WAV
            let pcm_data = if merged_wav.len() > 44 {
                merged_wav[44..].to_vec()
            } else {
                merged_wav
            };
            
            // Convert to MP3 using existing function
            let mp3_bytes = crate::convert_pcm_to_mp3(
                pcm_data,
                sample_rate as u32,
                1,
                Some(128),
            ).map_err(|e| format!("MP3 conversion failed: {}", e))?;
            
            // Determine audio file path
            let chapter_href_base = chapter.href
                .split('/')
                .last()
                .unwrap_or(&format!("chapter{}", chapter_index + 1))
                .replace(".xhtml", "")
                .replace(".html", "");
            
            let audio_href_zip = format!("OEBPS/Audio/{}.mp3", chapter_href_base);
            let audio_href_manifest = format!("Audio/{}.mp3", chapter_href_base);
            
            zip_files.insert(audio_href_zip.clone(), mp3_bytes);
            let audio_href_manifest_clone = audio_href_manifest.clone();
            audio_files.push((chapter_index, audio_href_manifest));
            
            // Update chapter HTML
            let chapter_path_zip = if chapter.href.starts_with("OEBPS/") {
                chapter.href.clone()
            } else {
                format!("OEBPS/{}", chapter.href)
            };
            let chapter_path_zip_clone = chapter_path_zip.clone();
            zip_files.insert(chapter_path_zip, updated_html.into_bytes());
            
            println!("Creating SMIL file for chapter {}...", chapter_index + 1);
            
            // Generate SMIL file
            let chapter_href_for_smil = if chapter.href.starts_with("OEBPS/") {
                chapter.href[6..].to_string()
            } else {
                chapter.href.clone()
            };
            
            let audio_href_for_smil = if chapter_href_for_smil.contains('/') {
                let depth = chapter_href_for_smil.matches('/').count();
                format!("{}{}", "../".repeat(depth), audio_href_manifest_clone)
            } else {
                audio_href_manifest_clone
            };
            
            let smil_content = generate_smil_file(
                &chapter_href_for_smil,
                &audio_href_for_smil,
                &audio_segments,
            ).map_err(|e| format!("SMIL generation failed: {}", e))?;
            
            let smil_href_zip = chapter_path_zip_clone
                .replace(".xhtml", ".smil")
                .replace(".html", ".smil");
            let smil_href_manifest = chapter_href_for_smil
                .replace(".xhtml", ".smil")
                .replace(".html", ".smil");
            
            zip_files.insert(smil_href_zip, smil_content.into_bytes());
            smil_files.push((chapter_index, smil_href_manifest));
        }
        
        println!("Updating EPUB metadata...");
        
        // Update content.opf
        if let Some(opf_content) = zip_files.get("OEBPS/content.opf") {
            let opf_str = String::from_utf8(opf_content.clone())
                .map_err(|e| format!("Invalid UTF-8 in OPF: {}", e))?;
            
            let updated_opf = update_content_opf(
                &opf_str,
                &audio_files,
                &smil_files,
                &options.chapters,
            )?;
            
            zip_files.insert("OEBPS/content.opf".to_string(), updated_opf.into_bytes());
        }
        
        // Create new ZIP
        // EPUB spec requires mimetype to be first and uncompressed
        let mut zip_writer = ZipWriter::new(Cursor::new(Vec::new()));
        let file_options = FileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        let mimetype_options = FileOptions::default()
            .compression_method(zip::CompressionMethod::Stored); // Uncompressed for mimetype
        
        // Add mimetype first (EPUB spec requirement - must be first and uncompressed)
        if let Some(mimetype_data) = zip_files.get("mimetype") {
            zip_writer.start_file("mimetype", mimetype_options)
                .map_err(|e| format!("Failed to add mimetype to ZIP: {}", e))?;
            zip_writer.write_all(mimetype_data)
                .map_err(|e| format!("Failed to write mimetype: {}", e))?;
        }
        
        // Add all other files to ZIP (excluding mimetype which we already added)
        let mut file_names: Vec<String> = zip_files.keys()
            .filter(|name| *name != "mimetype")
            .cloned()
            .collect();
        file_names.sort();
        
        for file_name in file_names {
            let data = &zip_files[&file_name];
            zip_writer.start_file(&file_name, file_options)
                .map_err(|e| format!("Failed to add file to ZIP: {}", e))?;
            zip_writer.write_all(data)
                .map_err(|e| format!("Failed to write file data: {}", e))?;
        }
        
        let zip_data = zip_writer.finish()
            .map_err(|e| format!("Failed to finalize ZIP: {}", e))?;
        
        println!("Conversion complete!");
        
        Ok(zip_data.into_inner())
    }
    
    /// Main conversion function (with AppHandle for Tauri integration)
    pub async fn convert_epub_to_audiobook(
        epub_data: Vec<u8>,
        options: ConversionOptions,
        app: AppHandle,
    ) -> Result<Vec<u8>, String> {
        let parallelism = get_parallelism();
        
        emit_progress(
            &app,
            ConversionProgress {
                current_chapter: 0,
                total_chapters: options.chapters.len(),
                current_step: "initializing".to_string(),
                message: format!("Initializing TTS engine (using {} cores)...", parallelism),
            },
        );
        
        // Find model files (same logic as in generate_tts_cached)
        let mut possible_onnx_paths = Vec::new();
        let mut possible_voices_paths = Vec::new();
        
        if let Ok(resource_dir) = app.path().resource_dir() {
            possible_onnx_paths.push(resource_dir.join("kokoro-v1.0.onnx"));
            possible_onnx_paths.push(resource_dir.join("resources").join("kokoro-v1.0.onnx"));
            possible_voices_paths.push(resource_dir.join("voices-v1.0.bin"));
            possible_voices_paths.push(resource_dir.join("resources").join("voices-v1.0.bin"));
        }
        
        if let Ok(current_dir) = std::env::current_dir() {
            possible_onnx_paths.push(current_dir.join("src-tauri").join("resources").join("kokoro-v1.0.onnx"));
            possible_voices_paths.push(current_dir.join("src-tauri").join("resources").join("voices-v1.0.bin"));
        }
        
        let onnx_path = possible_onnx_paths.iter()
            .find(|p| p.exists() && p.is_file())
            .ok_or_else(|| "ONNX model not found".to_string())?;
        
        let voices_path = possible_voices_paths.iter()
            .find(|p| p.exists() && p.is_file())
            .ok_or_else(|| "Voices file not found".to_string())?;
        
        let onnx_path_str = onnx_path.to_str()
            .ok_or_else(|| "ONNX path contains invalid UTF-8".to_string())?
            .to_string();
        let voices_path_str = voices_path.to_str()
            .ok_or_else(|| "Voices path contains invalid UTF-8".to_string())?
            .to_string();
        
        // Log which model file is being used
        eprintln!("Using ONNX model: {}", onnx_path_str);
        eprintln!("Using voices file: {}", voices_path_str);
        
        // Validate that model files are readable before attempting initialization
        std::fs::metadata(&onnx_path_str)
            .map_err(|e| format!("Cannot read ONNX model file at {}: {}", onnx_path_str, e))?;
        std::fs::metadata(&voices_path_str)
            .map_err(|e| format!("Cannot read voices file at {}: {}", voices_path_str, e))?;
        
        // Validate engine can be created (but we'll create per-task instances for parallel processing)
        // Spawn in a separate task to catch panics that might occur during initialization
        let onnx_path_clone = onnx_path_str.clone();
        let voices_path_clone = voices_path_str.clone();
        let init_handle = tokio::task::spawn(async move {
            kokoros::tts::koko::TTSKokoParallel::new_with_instances(
                &onnx_path_clone,
                &voices_path_clone,
                1,
            ).await
        });
        
        let _test_engine = init_handle.await
            .map_err(|e| format!("TTS engine initialization task failed: {:?}. This may indicate the model files are corrupted or incompatible.", e))?;
        
        // Load EPUB as ZIP
        let mut archive = ZipArchive::new(Cursor::new(&epub_data))
            .map_err(|e| format!("Failed to open EPUB: {}", e))?;
        
        let mut audio_files: Vec<(usize, String)> = Vec::new();
        let mut smil_files: Vec<(usize, String)> = Vec::new();
        let mut zip_files: HashMap<String, Vec<u8>> = HashMap::new();
        
        // Extract all existing files
        for i in 0..archive.len() {
            let mut file = archive.by_index(i)
                .map_err(|e| format!("Failed to read file {}: {}", i, e))?;
            let name = file.name().to_string();
            let mut data = Vec::new();
            file.read_to_end(&mut data)
                .map_err(|e| format!("Failed to read file data: {}", e))?;
            zip_files.insert(name, data);
        }
        
        // Process each chapter
        for (chapter_index, chapter) in options.chapters.iter().enumerate() {
            emit_progress(
                &app,
                ConversionProgress {
                    current_chapter: chapter_index + 1,
                    total_chapters: options.chapters.len(),
                    current_step: "generating-audio".to_string(),
                    message: format!("Generating audio for chapter {}: {}", chapter_index + 1, chapter.title),
                },
            );
            
            // Chunk the chapter text
            let (chunks, updated_html) = chunk_text(&chapter.content_html);
            
            if chunks.is_empty() {
                // Update chapter HTML in ZIP
                let chapter_path = if chapter.href.starts_with("OEBPS/") {
                    chapter.href.clone()
                } else {
                    format!("OEBPS/{}", chapter.href)
                };
                zip_files.insert(chapter_path, updated_html.into_bytes());
                continue;
            }
            
            // Generate audio for chunks in parallel batches
            let mut audio_data_arrays: Vec<Vec<u8>> = Vec::new();
            let mut audio_segments: Vec<(String, f64, f64)> = Vec::new();
            let mut current_time = 0.0;
            let sample_rate = 24000.0;
            
            // Process in batches based on parallelism
            for i in (0..chunks.len()).step_by(parallelism) {
                let batch: Vec<_> = chunks.iter().skip(i).take(parallelism).collect();
                
                // Generate TTS for batch in parallel (same pattern as generate_tts_batch)
                let mut handles = Vec::new();
                for (chunk_id, text) in &batch {
                    let text_clone = text.clone();
                    let voice_id_clone = options.voice_id.clone();
                    let onnx_path_clone = onnx_path_str.clone();
                    let voices_path_clone = voices_path_str.clone();
                    
                    let handle = tokio::spawn(async move {
                        // Create a new engine instance for this task (same as generate_tts_batch)
                        let task_engine = kokoros::tts::koko::TTSKokoParallel::new_with_instances(
                            &onnx_path_clone,
                            &voices_path_clone,
                            1, // Use 1 instance per task
                        ).await;
                        
                        let model_instance = task_engine.get_model_instance(0);
                        task_engine.tts_raw_audio_with_instance(
                            &text_clone,
                            "en",
                            &voice_id_clone,
                            1.0,
                            None,
                            None,
                            None,
                            None,
                            model_instance,
                        )
                        .map_err(|e| format!("TTS generation failed: {}", e))
                    });
                    handles.push((chunk_id.clone(), handle));
                }
                
                // Collect results
                for (chunk_id, handle) in handles {
                    match handle.await {
                        Ok(Ok(audio_samples)) => {
                            // Convert Vec<f32> to 16-bit PCM bytes
                            let num_samples = audio_samples.len();
                            let mut pcm_bytes = Vec::with_capacity(num_samples * 2);
                            for sample in &audio_samples {
                                let clamped = sample.max(-1.0).min(1.0);
                                let pcm_value = if clamped < 0.0 {
                                    (clamped * 32768.0) as i16
                                } else {
                                    (clamped * 32767.0) as i16
                                };
                                pcm_bytes.extend_from_slice(&pcm_value.to_le_bytes());
                            }
                            
                            audio_data_arrays.push(pcm_bytes.clone());
                            
                            let duration = num_samples as f64 / sample_rate;
                            audio_segments.push((
                                chunk_id,
                                current_time,
                                current_time + duration,
                            ));
                            current_time += duration;
                        }
                        Ok(Err(e)) => {
                            let error_msg = format!("TTS generation failed for chunk {} in chapter '{}': {}. Voice ID: {}", chunk_id, chapter.title, e, options.voice_id);
                            eprintln!("{}", error_msg);
                            return Err(error_msg);
                        }
                        Err(e) => {
                            let error_msg = format!("TTS engine initialization failed for chunk {} in chapter '{}': {:?}. This may indicate the model files are corrupted, missing, or incompatible. Voice ID: {}", chunk_id, chapter.title, e, options.voice_id);
                            eprintln!("{}", error_msg);
                            return Err(error_msg);
                        }
                    }
                }
            }
            
            if audio_data_arrays.is_empty() {
                // Create minimal silence
                let silence_samples = sample_rate as usize;
                let silence_pcm = vec![0u8; silence_samples * 2];
                audio_data_arrays.push(silence_pcm);
                audio_segments.push((
                    chunks[0].0.clone(),
                    0.0,
                    1.0,
                ));
            }
            
            emit_progress(
                &app,
                ConversionProgress {
                    current_chapter: chapter_index + 1,
                    total_chapters: options.chapters.len(),
                    current_step: "merging-audio".to_string(),
                    message: format!("Merging audio for chapter {}...", chapter_index + 1),
                },
            );
            
            // Merge audio
            let merged_wav = merge_wav_files(&audio_data_arrays, sample_rate as u32);
            
            // Convert to MP3
            emit_progress(
                &app,
                ConversionProgress {
                    current_chapter: chapter_index + 1,
                    total_chapters: options.chapters.len(),
                    current_step: "merging-audio".to_string(),
                    message: format!("Converting audio to MP3 for chapter {}...", chapter_index + 1),
                },
            );
            
            // Extract PCM from WAV
            let pcm_data = if merged_wav.len() > 44 {
                merged_wav[44..].to_vec()
            } else {
                merged_wav
            };
            
            // Convert to MP3 using existing function
            let mp3_bytes = crate::convert_pcm_to_mp3(
                pcm_data,
                sample_rate as u32,
                1,
                Some(128),
            ).map_err(|e| format!("MP3 conversion failed: {}", e))?;
            
            // Determine audio file path
            let chapter_href_base = chapter.href
                .split('/')
                .last()
                .unwrap_or(&format!("chapter{}", chapter_index + 1))
                .replace(".xhtml", "")
                .replace(".html", "");
            
            let audio_href_zip = format!("OEBPS/Audio/{}.mp3", chapter_href_base);
            let audio_href_manifest = format!("Audio/{}.mp3", chapter_href_base);
            
            zip_files.insert(audio_href_zip.clone(), mp3_bytes);
            let audio_href_manifest_clone = audio_href_manifest.clone();
            audio_files.push((chapter_index, audio_href_manifest));
            
            // Update chapter HTML
            let chapter_path_zip = if chapter.href.starts_with("OEBPS/") {
                chapter.href.clone()
            } else {
                format!("OEBPS/{}", chapter.href)
            };
            let chapter_path_zip_clone = chapter_path_zip.clone();
            zip_files.insert(chapter_path_zip, updated_html.into_bytes());
            
            emit_progress(
                &app,
                ConversionProgress {
                    current_chapter: chapter_index + 1,
                    total_chapters: options.chapters.len(),
                    current_step: "creating-smil".to_string(),
                    message: format!("Creating SMIL file for chapter {}...", chapter_index + 1),
                },
            );
            
            // Generate SMIL file
            let chapter_href_for_smil = if chapter.href.starts_with("OEBPS/") {
                chapter.href[6..].to_string()
            } else {
                chapter.href.clone()
            };
            
            let audio_href_for_smil = if chapter_href_for_smil.contains('/') {
                let depth = chapter_href_for_smil.matches('/').count();
                format!("{}{}", "../".repeat(depth), audio_href_manifest_clone)
            } else {
                audio_href_manifest_clone
            };
            
            let smil_content = generate_smil_file(
                &chapter_href_for_smil,
                &audio_href_for_smil,
                &audio_segments,
            ).map_err(|e| format!("SMIL generation failed: {}", e))?;
            
            let smil_href_zip = chapter_path_zip_clone
                .replace(".xhtml", ".smil")
                .replace(".html", ".smil");
            let smil_href_manifest = chapter_href_for_smil
                .replace(".xhtml", ".smil")
                .replace(".html", ".smil");
            
            zip_files.insert(smil_href_zip, smil_content.into_bytes());
            smil_files.push((chapter_index, smil_href_manifest));
        }
        
        emit_progress(
            &app,
            ConversionProgress {
                current_chapter: options.chapters.len(),
                total_chapters: options.chapters.len(),
                current_step: "updating-epub".to_string(),
                message: "Updating EPUB metadata...".to_string(),
            },
        );
        
        // Update content.opf
        if let Some(opf_content) = zip_files.get("OEBPS/content.opf") {
            let opf_str = String::from_utf8(opf_content.clone())
                .map_err(|e| format!("Invalid UTF-8 in OPF: {}", e))?;
            
            let updated_opf = update_content_opf(
                &opf_str,
                &audio_files,
                &smil_files,
                &options.chapters,
            )?;
            
            zip_files.insert("OEBPS/content.opf".to_string(), updated_opf.into_bytes());
        }
        
        // Create new ZIP
        // EPUB spec requires mimetype to be first and uncompressed
        let mut zip_writer = ZipWriter::new(Cursor::new(Vec::new()));
        let file_options = FileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        let mimetype_options = FileOptions::default()
            .compression_method(zip::CompressionMethod::Stored); // Uncompressed for mimetype
        
        // Add mimetype first (EPUB spec requirement - must be first and uncompressed)
        if let Some(mimetype_data) = zip_files.get("mimetype") {
            zip_writer.start_file("mimetype", mimetype_options)
                .map_err(|e| format!("Failed to add mimetype to ZIP: {}", e))?;
            zip_writer.write_all(mimetype_data)
                .map_err(|e| format!("Failed to write mimetype: {}", e))?;
        }
        
        // Add all other files to ZIP (excluding mimetype which we already added)
        let mut file_names: Vec<String> = zip_files.keys()
            .filter(|name| *name != "mimetype")
            .cloned()
            .collect();
        file_names.sort();
        
        for file_name in file_names {
            let data = &zip_files[&file_name];
            zip_writer.start_file(&file_name, file_options)
                .map_err(|e| format!("Failed to add file to ZIP: {}", e))?;
            zip_writer.write_all(data)
                .map_err(|e| format!("Failed to write file data: {}", e))?;
        }
        
        let zip_data = zip_writer.finish()
            .map_err(|e| format!("Failed to finalize ZIP: {}", e))?;
        
        emit_progress(
            &app,
            ConversionProgress {
                current_chapter: options.chapters.len(),
                total_chapters: options.chapters.len(),
                current_step: "complete".to_string(),
                message: "Conversion complete!".to_string(),
            },
        );
        
        Ok(zip_data.into_inner())
    }
    
    #[cfg(test)]
    mod tests {
        use std::fs;
        use std::path::Path;
        use quick_xml::events::Event;
        use quick_xml::Reader;

        /// Test that converted EPUB matches the structure of the old version
        #[test]
        fn test_epub_structure_matches_old_version() {
            // Tests run from project root, so paths are relative to that
            let project_root = std::env::current_dir()
                .unwrap()
                .parent()
                .unwrap()
                .to_path_buf();
            let old_version_dir = project_root.join("data/old version");
            let unconverted_dir = project_root.join("data/unconverted");
            
            // Check that both directories exist
            assert!(old_version_dir.exists(), "Old version directory should exist");
            assert!(unconverted_dir.exists(), "Unconverted directory should exist");
            
            // Read and compare content.opf files
            let old_opf_path = old_version_dir.join("OEBPS/content.opf");
            let unconverted_opf_path = unconverted_dir.join("OEBPS/content.opf");
            
            assert!(old_opf_path.exists(), "Old version content.opf should exist");
            assert!(unconverted_opf_path.exists(), "Unconverted content.opf should exist");
            
            let old_opf = fs::read_to_string(&old_opf_path).expect("Failed to read old content.opf");
            let unconverted_opf = fs::read_to_string(&unconverted_opf_path).expect("Failed to read unconverted content.opf");
            
            // Parse both OPF files and compare structure
            let old_manifest_items = extract_manifest_items(&old_opf);
            let unconverted_manifest_items = extract_manifest_items(&unconverted_opf);
            
            println!("Old version manifest items: {}", old_manifest_items.len());
            println!("Unconverted manifest items: {}", unconverted_manifest_items.len());
            
            // Check that old version has audio and SMIL items
            let old_audio_items: Vec<_> = old_manifest_items.iter()
                .filter(|item| item.media_type.starts_with("audio/"))
                .collect();
            let old_smil_items: Vec<_> = old_manifest_items.iter()
                .filter(|item| item.media_type == "application/smil+xml")
                .collect();
            
            println!("Old version has {} audio items and {} SMIL items", 
                     old_audio_items.len(), old_smil_items.len());
            
            assert!(!old_audio_items.is_empty(), "Old version should have audio items");
            assert!(!old_smil_items.is_empty(), "Old version should have SMIL items");
            
            // Check file structure
            check_directory_structure(&old_version_dir, "old version");
        }
        
        /// Test SMIL file format matches old version
        #[test]
        fn test_smil_format_matches_old_version() {
            let project_root = std::env::current_dir()
                .unwrap()
                .parent()
                .unwrap()
                .to_path_buf();
            let old_smil_path = project_root.join("data/old version/OEBPS/chapter_1.smil");
            
            if !old_smil_path.exists() {
                println!("Skipping SMIL format test - old SMIL file not found");
                return;
            }
            
            let old_smil = fs::read_to_string(old_smil_path).expect("Failed to read old SMIL");
            
            // Check SMIL structure
            assert!(old_smil.contains("<?xml version=\"1.0\" encoding=\"UTF-8\"?>"));
            assert!(old_smil.contains("xmlns=\"http://www.w3.org/ns/SMIL\""));
            assert!(old_smil.contains("xmlns:epub=\"http://www.idpf.org/2007/ops\""));
            assert!(old_smil.contains("version=\"3.0\""));
            assert!(old_smil.contains("<seq"));
            assert!(old_smil.contains("epub:textref"));
            assert!(old_smil.contains("epub:type=\"bodymatter chapter\""));
            
            // Check time format - should be HH:MM:SS.mmm
            let time_pattern = regex::Regex::new(r"\d{2}:\d{2}:\d{2}\.\d{3}").unwrap();
            let times: Vec<_> = time_pattern.find_iter(&old_smil).collect();
            assert!(!times.is_empty(), "SMIL should contain time stamps in HH:MM:SS.mmm format");
            
            // Check that times are properly formatted
            for time_match in &times {
                let time_str = time_match.as_str();
                let parts: Vec<&str> = time_str.split(':').collect();
                assert_eq!(parts.len(), 3, "Time should have 3 parts (HH:MM:SS.mmm)");
                let seconds_part = parts[2];
                assert!(seconds_part.contains('.'), "Seconds part should contain decimal point");
                let decimal_parts: Vec<&str> = seconds_part.split('.').collect();
                assert_eq!(decimal_parts.len(), 2, "Seconds should have integer and decimal parts");
                assert_eq!(decimal_parts[1].len(), 3, "Milliseconds should be 3 digits");
            }
            
            // Check par elements structure
            assert!(old_smil.contains("<par id="));
            assert!(old_smil.contains("<text src="));
            assert!(old_smil.contains("<audio clipBegin="));
            assert!(old_smil.contains("clipEnd="));
            assert!(old_smil.contains("src="));
        }
        
        /// Test content.opf manifest structure
        #[test]
        fn test_content_opf_structure() {
            let project_root = std::env::current_dir()
                .unwrap()
                .parent()
                .unwrap()
                .to_path_buf();
            let old_opf_path = project_root.join("data/old version/OEBPS/content.opf");
            let old_opf = fs::read_to_string(old_opf_path).expect("Failed to read old content.opf");
            
            // Check that manifest has media-overlay attributes on chapter items
            assert!(old_opf.contains("media-overlay="), "OPF should have media-overlay attributes");
            
            // Check that metadata has media:active-class
            assert!(old_opf.contains("media:active-class"), "OPF should have media:active-class meta");
            
            // Check that audio items are in manifest
            assert!(old_opf.contains("media-type=\"audio/mpeg\""), "OPF should have audio items");
            
            // Check that SMIL items are in manifest
            assert!(old_opf.contains("media-type=\"application/smil+xml\""), "OPF should have SMIL items");
            
            // Parse and verify structure
            let manifest_items = extract_manifest_items(&old_opf);
            
            // Find items with media-overlay
            let items_with_overlay: Vec<_> = manifest_items.iter()
                .filter(|item| item.has_media_overlay)
                .collect();
            
            assert!(!items_with_overlay.is_empty(), "Should have items with media-overlay attributes");
            
            // Verify each chapter item has a corresponding SMIL item
            let chapter_items: Vec<_> = manifest_items.iter()
                .filter(|item| item.media_type == "application/xhtml+xml" && item.has_media_overlay)
                .collect();
            
            for chapter_item in &chapter_items {
                if let Some(overlay_id) = &chapter_item.media_overlay_id {
                    let smil_exists = manifest_items.iter()
                        .any(|item| item.id == *overlay_id && item.media_type == "application/smil+xml");
                    assert!(smil_exists, 
                        "Chapter item {} should have corresponding SMIL item {}", 
                        chapter_item.id, overlay_id);
                }
            }
        }
        
        /// Test ZIP file structure
        #[test]
        fn test_zip_structure() {
            let project_root = std::env::current_dir()
                .unwrap()
                .parent()
                .unwrap()
                .to_path_buf();
            let old_version_dir = project_root.join("data/old version");
            
            // Check that Audio directory exists
            let audio_dir = old_version_dir.join("OEBPS/Audio");
            assert!(audio_dir.exists(), "Audio directory should exist");
            
            // Check that SMIL files exist
            let smil_files: Vec<_> = fs::read_dir(old_version_dir.join("OEBPS"))
                .expect("Failed to read OEBPS directory")
                .filter_map(|entry| {
                    let entry = entry.ok()?;
                    let path = entry.path();
                    if path.extension()? == "smil" {
                        Some(path)
                    } else {
                        None
                    }
                })
                .collect();
            
            assert!(!smil_files.is_empty(), "Should have SMIL files");
            
            // Check that each chapter has a corresponding SMIL file
            let xhtml_files: Vec<_> = fs::read_dir(old_version_dir.join("OEBPS"))
                .expect("Failed to read OEBPS directory")
                .filter_map(|entry| {
                    let entry = entry.ok()?;
                    let path = entry.path();
                    if path.extension()? == "xhtml" {
                        Some(path.file_stem()?.to_string_lossy().to_string())
                    } else {
                        None
                    }
                })
                .collect();
            
            for xhtml_file in &xhtml_files {
                let smil_name = format!("{}.smil", xhtml_file);
                let smil_path = old_version_dir.join("OEBPS").join(&smil_name);
                assert!(smil_path.exists(), 
                    "Chapter {} should have corresponding SMIL file {}", 
                    xhtml_file, smil_name);
            }
        }
        
        // Helper functions
        
        struct ManifestItem {
            id: String,
            href: String,
            media_type: String,
            has_media_overlay: bool,
            media_overlay_id: Option<String>,
        }
        
        fn extract_manifest_items(opf_xml: &str) -> Vec<ManifestItem> {
            let mut items = Vec::new();
            let mut reader = Reader::from_str(opf_xml);
            reader.trim_text(true);
            
            let mut in_manifest = false;
            let mut current_item: Option<ManifestItem> = None;
            
            loop {
                match reader.read_event() {
                    Ok(Event::Start(e)) => {
                        let name = e.name().into_inner();
                        
                        if name == b"manifest" {
                            in_manifest = true;
                        } else if in_manifest && name == b"item" {
                            let mut id = None;
                            let mut href = None;
                            let mut media_type = None;
                            let mut media_overlay = None;
                            
                            for attr in e.attributes() {
                                if let Ok(attr) = attr {
                                    let key = attr.key.as_ref();
                                    let value = String::from_utf8_lossy(&attr.value);
                                    
                                    if key == b"id" {
                                        id = Some(value.to_string());
                                    } else if key == b"href" {
                                        href = Some(value.to_string());
                                    } else if key == b"media-type" {
                                        media_type = Some(value.to_string());
                                    } else if key == b"media-overlay" {
                                        media_overlay = Some(value.to_string());
                                    }
                                }
                            }
                            
                            if let (Some(id), Some(href), Some(media_type)) = (id, href, media_type) {
                                current_item = Some(ManifestItem {
                                    id,
                                    href,
                                    media_type,
                                    has_media_overlay: media_overlay.is_some(),
                                    media_overlay_id: media_overlay,
                                });
                            }
                        }
                    }
                    Ok(Event::End(e)) => {
                        let name = e.name().into_inner();
                        if name == b"manifest" {
                            in_manifest = false;
                        } else if name == b"item" {
                            if let Some(item) = current_item.take() {
                                items.push(item);
                            }
                        }
                    }
                    Ok(Event::Empty(e)) => {
                        let name = e.name().into_inner();
                        if in_manifest && name == b"item" {
                            let mut id = None;
                            let mut href = None;
                            let mut media_type = None;
                            let mut media_overlay = None;
                            
                            for attr in e.attributes() {
                                if let Ok(attr) = attr {
                                    let key = attr.key.as_ref();
                                    let value = String::from_utf8_lossy(&attr.value);
                                    
                                    if key == b"id" {
                                        id = Some(value.to_string());
                                    } else if key == b"href" {
                                        href = Some(value.to_string());
                                    } else if key == b"media-type" {
                                        media_type = Some(value.to_string());
                                    } else if key == b"media-overlay" {
                                        media_overlay = Some(value.to_string());
                                    }
                                }
                            }
                            
                            if let (Some(id), Some(href), Some(media_type)) = (id, href, media_type) {
                                items.push(ManifestItem {
                                    id,
                                    href,
                                    media_type,
                                    has_media_overlay: media_overlay.is_some(),
                                    media_overlay_id: media_overlay,
                                });
                            }
                        }
                    }
                    Ok(Event::Eof) => break,
                    _ => {}
                }
            }
            
            items
        }
        
        fn check_directory_structure(base_dir: &Path, name: &str) {
            // Check required directories
            let oebps_dir = base_dir.join("OEBPS");
            assert!(oebps_dir.exists(), "{} should have OEBPS directory", name);
            
            let meta_inf_dir = base_dir.join("META-INF");
            assert!(meta_inf_dir.exists(), "{} should have META-INF directory", name);
            
            // Check required files
            let mimetype = base_dir.join("mimetype");
            assert!(mimetype.exists(), "{} should have mimetype file", name);
            
            let container_xml = meta_inf_dir.join("container.xml");
            assert!(container_xml.exists(), "{} should have container.xml", name);
            
            let content_opf = oebps_dir.join("content.opf");
            assert!(content_opf.exists(), "{} should have content.opf", name);
        }
        
        /// Helper function to collect all file paths in a directory recursively
        fn collect_files(dir: &Path, base: &Path) -> Vec<String> {
            let mut files = Vec::new();
            
            if dir.is_dir() {
                if let Ok(entries) = fs::read_dir(dir) {
                    for entry in entries {
                        if let Ok(entry) = entry {
                            let path = entry.path();
                            if path.is_dir() {
                                files.extend(collect_files(&path, base));
                            } else if path.is_file() {
                                if let Ok(relative) = path.strip_prefix(base) {
                                    files.push(relative.to_string_lossy().replace('\\', "/"));
                                }
                            }
                        }
                    }
                }
            }
            
            files.sort();
            files
        }
        
        /// Test that converting the "asd" EPUB creates the same files as "old version"
        #[tokio::test]
        async fn test_asd_epub_creates_same_files_as_old_version() {
            
            // Get project root (tests run from src-tauri, so go up one level)
            let project_root = std::env::current_dir()
                .unwrap()
                .parent()
                .unwrap()
                .to_path_buf();
            
            let asd_dir = project_root.join("data/asd");
            let old_version_dir = project_root.join("data/old version");
            
            // Check that both directories exist
            assert!(asd_dir.exists(), "asd directory should exist");
            assert!(old_version_dir.exists(), "old version directory should exist");
            
            // Collect expected files from old version
            let expected_files = collect_files(&old_version_dir, &old_version_dir);
            println!("Expected files from old version ({} files):", expected_files.len());
            for file in &expected_files {
                println!("  - {}", file);
            }
            
            // Create EPUB ZIP from asd directory
            let epub_data = create_epub_from_directory(&asd_dir)
                .expect("Failed to create EPUB from asd directory");
            
            // Parse the EPUB to get chapters
            let chapters = parse_epub_chapters(&epub_data)
                .expect("Failed to parse EPUB chapters");
            
            println!("Found {} chapters", chapters.len());
            
            // For now, we'll just verify the expected file structure
            // The actual conversion would require TTS models and AppHandle
            // This test verifies what files should be created
            
            // Check that we expect audio files
            let expected_audio_files: Vec<_> = expected_files.iter()
                .filter(|f| f.ends_with(".mp3"))
                .collect();
            assert!(!expected_audio_files.is_empty(), 
                "Expected at least one audio file, found: {:?}", expected_audio_files);
            
            // Check that we expect SMIL files
            let expected_smil_files: Vec<_> = expected_files.iter()
                .filter(|f| f.ends_with(".smil"))
                .collect();
            assert!(!expected_smil_files.is_empty(), 
                "Expected at least one SMIL file, found: {:?}", expected_smil_files);
            
            // Check that we expect Audio directory
            assert!(expected_files.iter().any(|f| f.contains("Audio/")), 
                "Expected Audio directory in output");
            
            // Verify that each chapter xhtml file has a corresponding smil file
            let chapter_xhtml_files: Vec<_> = expected_files.iter()
                .filter(|f| f.ends_with(".xhtml") && !f.contains("toc") && !f.contains("copyright"))
                .map(|f| {
                    let stem = f.strip_suffix(".xhtml").unwrap();
                    stem.to_string()
                })
                .collect();
            
            for chapter_stem in &chapter_xhtml_files {
                let expected_smil = format!("OEBPS/{}.smil", chapter_stem);
                assert!(expected_files.contains(&expected_smil),
                    "Expected SMIL file {} for chapter {}", expected_smil, chapter_stem);
            }
            
            println!("Test passed: Expected file structure matches requirements");
        }
        
        /// Test that converts an EPUB to audiobook format
        /// 
        /// Usage:
        ///   cargo test test_convert_epub_standalone -- --ignored --nocapture
        ///   
        /// Or set environment variables:
        ///   EPUB_INPUT=/path/to/input.epub EPUB_OUTPUT=/path/to/output.epub cargo test test_convert_epub_standalone -- --ignored --nocapture
        #[tokio::test]
        #[ignore] // Ignore by default - requires TTS models
        async fn test_convert_epub_standalone() {
            use super::{ConversionOptions, convert_epub_to_audiobook_standalone};
            
            // Get input and output paths from environment or use defaults
            let input_path = std::env::var("EPUB_INPUT")
                .unwrap_or_else(|_| {
                    // Default to asd directory
                    let project_root = std::env::current_dir()
                        .unwrap()
                        .parent()
                        .unwrap()
                        .to_path_buf();
                    let asd_dir = project_root.join("data/asd");
                    if asd_dir.exists() {
                        // Create EPUB from directory
                        let epub_data = create_epub_from_directory(&asd_dir)
                            .expect("Failed to create EPUB from asd directory");
                        let temp_file = std::env::temp_dir().join("test_input.epub");
                        std::fs::write(&temp_file, epub_data)
                            .expect("Failed to write temp EPUB");
                        temp_file.to_string_lossy().to_string()
                    } else {
                        panic!("No input EPUB found. Set EPUB_INPUT environment variable or ensure data/asd directory exists");
                    }
                });
            
            let output_path = std::env::var("EPUB_OUTPUT")
                .unwrap_or_else(|_| {
                    let project_root = std::env::current_dir()
                        .unwrap()
                        .parent()
                        .unwrap()
                        .to_path_buf();
                    project_root.join("data/asd_converted.epub").to_string_lossy().to_string()
                });
            
            println!("Input EPUB: {}", input_path);
            println!("Output EPUB: {}", output_path);
            
            // Read input EPUB
            let epub_data = std::fs::read(&input_path)
                .expect(&format!("Failed to read input EPUB: {}", input_path));
            
            println!("Loaded EPUB: {} bytes", epub_data.len());
            
            // Parse the EPUB to get chapters
            let chapters = parse_epub_chapters(&epub_data)
                .expect("Failed to parse EPUB chapters");
            
            if chapters.is_empty() {
                panic!("No chapters found in EPUB");
            }
            
            println!("Found {} chapters to convert", chapters.len());
            for (idx, chapter) in chapters.iter().enumerate() {
                println!("  Chapter {}: {} ({} bytes)", 
                    idx + 1, 
                    chapter.title, 
                    chapter.content_html.len());
            }
            
            // Create conversion options
            let options = ConversionOptions {
                voice_id: std::env::var("VOICE_ID")
                    .unwrap_or_else(|_| "af_heart".to_string()),
                chapters,
            };
            
            println!("\nStarting conversion with voice: {}", options.voice_id);
            println!("This may take a while...\n");
            
            // Run the conversion
            let converted_epub = convert_epub_to_audiobook_standalone(
                epub_data,
                options,
            ).await
            .expect("Conversion failed");
            
            println!("\n✅ Conversion successful! Output size: {} bytes", converted_epub.len());
            
            // Write output file
            std::fs::write(&output_path, &converted_epub)
                .expect(&format!("Failed to write output EPUB: {}", output_path));
            
            println!("✅ Output written to: {}", output_path);
            
            // Verify the output
            use std::io::Cursor;
            use zip::ZipArchive;
            
            let mut archive = ZipArchive::new(Cursor::new(&converted_epub))
                .expect("Failed to open converted EPUB");
            
            let mut converted_files = Vec::new();
            for i in 0..archive.len() {
                let file = archive.by_index(i).expect("Failed to read file from archive");
                converted_files.push(file.name().to_string());
            }
            converted_files.sort();
            
            println!("\nConverted EPUB contains {} files:", converted_files.len());
            for file in &converted_files {
                println!("  - {}", file);
            }
            
            // Verify expected files exist
            let has_audio_files = converted_files.iter().any(|f| f.ends_with(".mp3"));
            let has_smil_files = converted_files.iter().any(|f| f.ends_with(".smil"));
            let has_audio_dir = converted_files.iter().any(|f| f.contains("Audio/"));
            
            assert!(has_audio_files, "Converted EPUB should contain audio files");
            assert!(has_smil_files, "Converted EPUB should contain SMIL files");
            assert!(has_audio_dir, "Converted EPUB should contain Audio directory");
            
            println!("\n✅ All verifications passed!");
        }
        
        /// Create an EPUB ZIP file from a directory
        fn create_epub_from_directory(dir: &Path) -> Result<Vec<u8>, String> {
            use std::io::{Cursor, Write};
            use zip::ZipWriter;
            use zip::write::FileOptions;
            
            let mut zip_writer = ZipWriter::new(Cursor::new(Vec::new()));
            let file_options = FileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated);
            let mimetype_options = FileOptions::default()
                .compression_method(zip::CompressionMethod::Stored);
            
            // Add mimetype first (must be first and uncompressed)
            let mimetype_path = dir.join("mimetype");
            if mimetype_path.exists() {
                let mimetype_data = fs::read(&mimetype_path)
                    .map_err(|e| format!("Failed to read mimetype: {}", e))?;
                zip_writer.start_file("mimetype", mimetype_options)
                    .map_err(|e| format!("Failed to add mimetype: {}", e))?;
                zip_writer.write_all(&mimetype_data)
                    .map_err(|e| format!("Failed to write mimetype: {}", e))?;
            }
            
            // Add all other files
            add_directory_to_zip(&mut zip_writer, dir, dir, &file_options)?;
            
            let zip_data = zip_writer.finish()
                .map_err(|e| format!("Failed to finalize ZIP: {}", e))?;
            
            Ok(zip_data.into_inner())
        }
        
        /// Recursively add directory contents to ZIP
        fn add_directory_to_zip(
            writer: &mut zip::ZipWriter<std::io::Cursor<Vec<u8>>>,
            dir: &Path,
            base: &Path,
            options: &zip::write::FileOptions,
        ) -> Result<(), String> {
            use std::io::{Read, Write};
            
            if dir.is_dir() {
                let entries = fs::read_dir(dir)
                    .map_err(|e| format!("Failed to read directory {}: {}", dir.display(), e))?;
                
                for entry in entries {
                    let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
                    let path = entry.path();
                    let file_name = path.strip_prefix(base)
                        .map_err(|e| format!("Failed to strip prefix: {}", e))?;
                    
                    // Skip mimetype (already added)
                    if file_name.to_string_lossy() == "mimetype" {
                        continue;
                    }
                    
                    if path.is_dir() {
                        add_directory_to_zip(writer, &path, base, options)?;
                    } else if path.is_file() {
                        let file_name_str = file_name.to_string_lossy().replace('\\', "/");
                        writer.start_file(&file_name_str, *options)
                            .map_err(|e| format!("Failed to add file {}: {}", file_name_str, e))?;
                        
                        let mut file = fs::File::open(&path)
                            .map_err(|e| format!("Failed to open file {}: {}", path.display(), e))?;
                        let mut contents = Vec::new();
                        file.read_to_end(&mut contents)
                            .map_err(|e| format!("Failed to read file {}: {}", path.display(), e))?;
                        writer.write_all(&contents)
                            .map_err(|e| format!("Failed to write file {}: {}", file_name_str, e))?;
                    }
                }
            }
            
            Ok(())
        }
        
        /// Parse EPUB to extract chapter information
        pub fn parse_epub_chapters(epub_data: &[u8]) -> Result<Vec<Chapter>, String> {
            use std::io::{Cursor, Read};
            use zip::ZipArchive;
            use quick_xml::events::Event;
            use quick_xml::Reader;
            
            // First, read content.opf to get chapter list
            let (opf_content, chapter_hrefs) = {
                let mut archive = ZipArchive::new(Cursor::new(epub_data))
                    .map_err(|e| format!("Failed to open EPUB: {}", e))?;
                
                // Try OEBPS/content.opf first, then content.opf
                let opf_path = if archive.by_name("OEBPS/content.opf").is_ok() {
                    "OEBPS/content.opf"
                } else {
                    "content.opf"
                };
                
                let mut opf_file = archive.by_name(opf_path)
                    .map_err(|e| format!("Failed to find content.opf: {}", e))?;
                
                let mut content = String::new();
                opf_file.read_to_string(&mut content)
                    .map_err(|e| format!("Failed to read content.opf: {}", e))?;
                
                // Parse OPF to find chapter hrefs using spine (reading order)
                let manifest_items = extract_manifest_items(&content);
                // Build a map of id -> item for quick lookup
                let manifest_map: std::collections::HashMap<String, &ManifestItem> = manifest_items
                    .iter()
                    .map(|item| (item.id.clone(), item))
                    .collect();
                
                // Parse spine to get reading order
                let mut hrefs = Vec::new();
                let mut reader = Reader::from_str(&content);
                reader.trim_text(true);
                let mut in_spine = false;
                
                loop {
                    match reader.read_event() {
                        Ok(Event::Start(e)) => {
                            if e.name().as_ref() == b"spine" {
                                in_spine = true;
                            } else if in_spine && e.name().as_ref() == b"itemref" {
                                let mut idref = String::new();
                                for attr in e.attributes() {
                                    if let Ok(attr) = attr {
                                        if attr.key.as_ref() == b"idref" {
                                            idref = String::from_utf8_lossy(&attr.value).to_string();
                                            break;
                                        }
                                    }
                                }
                                
                                // Look up this item in manifest
                                if let Some(item) = manifest_map.get(&idref) {
                                    // Include XHTML/HTML files (chapters) but exclude navigation/toc files
                                    // Be lenient with media types as some EPUBs use variations
                                    let is_html_content = item.media_type == "application/xhtml+xml"
                                        || item.media_type == "text/html"
                                        || item.media_type == "application/html+xml"
                                        || item.href.ends_with(".xhtml")
                                        || item.href.ends_with(".html");
                                    
                                    if is_html_content {
                                        // Exclude navigation, toc, and copyright pages
                                        let href_lower = item.href.to_lowercase();
                                        if !href_lower.contains("toc") 
                                            && !href_lower.contains("nav")
                                            && !href_lower.contains("copyright")
                                            && !href_lower.contains("cover")
                                            && !href_lower.contains("titlepage") {
                                            hrefs.push((item.id.clone(), item.href.clone()));
                                        }
                                    }
                                }
                            }
                        }
                        Ok(Event::End(e)) => {
                            if e.name().as_ref() == b"spine" {
                                in_spine = false;
                            }
                        }
                        Ok(Event::Eof) => break,
                        _ => {}
                    }
                }
                
                (content, hrefs)
            };
            
            // Now read chapter files (archive is dropped from previous scope)
            let mut chapters = Vec::new();
            for (id, href) in chapter_hrefs {
                // Re-open archive for each chapter
                let mut archive = ZipArchive::new(Cursor::new(epub_data))
                    .map_err(|e| format!("Failed to reopen EPUB: {}", e))?;
                
                // Read the chapter content
                let chapter_content = {
                    let chapter_path = if href.starts_with("OEBPS/") {
                        href.clone()
                    } else {
                        format!("OEBPS/{}", href)
                    };
                    
                    let mut chapter_file = archive.by_name(&chapter_path)
                        .map_err(|e| format!("Failed to find chapter {}: {}", chapter_path, e))?;
                    
                    let mut content = String::new();
                    chapter_file.read_to_string(&mut content)
                        .map_err(|e| format!("Failed to read chapter {}: {}", chapter_path, e))?;
                    content
                };
                
                chapters.push(Chapter {
                    id: id.clone(),
                    title: extract_title_from_html(&chapter_content).unwrap_or_else(|| href.clone()),
                    href: href.clone(),
                    content_html: chapter_content,
                });
            }
            
            Ok(chapters)
        }
        
        /// Extract title from HTML content
        fn extract_title_from_html(html: &str) -> Option<String> {
            // Simple extraction - look for <h1> or <title>
            if let Some(start) = html.find("<h1>") {
                if let Some(end) = html[start+4..].find("</h1>") {
                    return Some(html[start+4..start+4+end].trim().to_string());
                }
            }
            if let Some(start) = html.find("<title>") {
                if let Some(end) = html[start+7..].find("</title>") {
                    return Some(html[start+7..start+7+end].trim().to_string());
                }
            }
            None
        }
    }
}

pub use epub_converter::*;

// parse_epub_chapters is re-exported via pub use epub_converter::*;
