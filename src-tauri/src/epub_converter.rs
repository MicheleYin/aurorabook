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
        let mut updated_html = html.to_string();
        
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
                    new_content.push_str(&format!(r#"<span id="{}">{}</span>"#, chunk_id, sentence));
                    if idx < sentences.len() - 1 {
                        new_content.push(' ');
                    }
                    chunks.push((chunk_id.clone(), sentence.to_string()));
                    chunk_index += 1;
                }
                
                // Replace the element's text content in the HTML
                // Use the element's outer HTML to find and replace
                let _element_outer = element.html();
                let tag_name = element.value().name();
                
                // Try to find and replace the element's content
                // Match: <tag...>old_text</tag>
                let old_inner = element.inner_html();
                if !old_inner.is_empty() {
                    let _new_element = format!("<{}>{}</{}>", tag_name, new_content, tag_name);
                    // Simple replacement: find the opening tag and replace until closing tag
                    if let Some(start) = updated_html.find(&format!("<{}", tag_name)) {
                        if let Some(end) = updated_html[start..].find(&format!("</{}>", tag_name)) {
                            let end_pos = start + end + tag_name.len() + 4;
                            // Find the actual content start (after >)
                            if let Some(content_start) = updated_html[start..end_pos].find('>') {
                                let content_start_pos = start + content_start + 1;
                                let before = &updated_html[..content_start_pos];
                                let after = &updated_html[end_pos..];
                                updated_html = format!("{}<{}>{}</{}>{}", 
                                    before, tag_name, new_content, tag_name, after);
                            }
                        }
                    }
                }
            }
        }
        
        (chunks, updated_html)
    }

    /// Format time in SMIL format (HH:MM:SS.mmm)
    fn format_smil_time(seconds: f64) -> String {
        let hours = (seconds / 3600.0) as u32;
        let minutes = ((seconds % 3600.0) / 60.0) as u32;
        let secs = seconds % 60.0;
        let ms = ((secs % 1.0) * 1000.0) as u32;
        
        format!("{:02}:{:02}:{:02}.{:03}", hours, minutes, secs as u32, ms)
    }

    /// Generate SMIL file content
    fn generate_smil_file(
        chapter_href: &str,
        audio_href: &str,
        segments: &[(String, f64, f64)],
    ) -> String {
        let mut smil = String::from(r#"<?xml version="1.0" encoding="UTF-8"?>
<smil xmlns="http://www.w3.org/ns/SMIL" xmlns:epub="http://www.idpf.org/2007/ops" version="3.0">
 <body>
  <seq id="seq1" epub:textref=""#);
        smil.push_str(chapter_href);
        smil.push_str(r#"" epub:type="bodymatter chapter">
"#);
        
        for (idx, (id, start, end)) in segments.iter().enumerate() {
            smil.push_str(&format!(
                r#"   <par id="p{:06}"><text src="{}#{}"/><audio clipBegin="{}" clipEnd="{}" src="{}"/></par>
"#,
                idx + 1,
                chapter_href,
                id,
                format_smil_time(*start),
                format_smil_time(*end),
                audio_href
            ));
        }
        
        smil.push_str(r#"  </seq>
 </body>
</smil>"#);
        smil
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
                        for item_xml in &manifest_items_to_add {
                            writer.get_mut().write_all(b"    ").map_err(|e| format!("XML write error: {}", e))?;
                            writer.get_mut().write_all(item_xml).map_err(|e| format!("XML write error: {}", e))?;
                            writer.get_mut().write_all(b"\n").map_err(|e| format!("XML write error: {}", e))?;
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

    /// Main conversion function
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
            );
            
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
        let mut zip_writer = ZipWriter::new(Cursor::new(Vec::new()));
        let file_options = FileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        
        // Add all files to ZIP
        let mut file_names: Vec<String> = zip_files.keys().cloned().collect();
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
}

pub use epub_converter::*;
