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
    fn update_content_opf(
        opf_xml: &str,
        audio_files: &[(usize, String)],
        smil_files: &[(usize, String)],
        chapters: &[Chapter],
    ) -> Result<String, String> {
        use regex::Regex;
        
        let mut new_opf = opf_xml.to_string();
        
        // Remove existing audio and SMIL items
        let audio_pattern = Regex::new(r#"<item[^>]*media-type="audio/[^"]*"[^>]*/>"#).unwrap();
        new_opf = audio_pattern.replace_all(&new_opf, "").to_string();
        let smil_pattern = Regex::new(r#"<item[^>]*media-type="application/smil\+xml"[^>]*/>"#).unwrap();
        new_opf = smil_pattern.replace_all(&new_opf, "").to_string();
        
        // Remove media-overlay attributes
        let overlay_pattern = Regex::new(r#"\s+media-overlay="[^"]*""#).unwrap();
        new_opf = overlay_pattern.replace_all(&new_opf, "").to_string();
        
        // Find manifest closing tag and insert new items before it
        if let Some(manifest_end) = new_opf.find("</manifest>") {
            let mut new_items = String::new();
            
            // Add audio files
            for (idx, (_, href)) in audio_files.iter().enumerate() {
                let item_id = format!("m{:03}", idx + 1);
                let is_mp3 = href.ends_with(".mp3");
                let media_type = if is_mp3 { "audio/mpeg" } else { "audio/wav" };
                // Escape XML special characters in href
                let escaped_href = href
                    .replace('&', "&amp;")
                    .replace('<', "&lt;")
                    .replace('>', "&gt;")
                    .replace('"', "&quot;");
                new_items.push_str(&format!(
                    r#"    <item id="{}" href="{}" media-type="{}"/>
"#,
                    item_id, escaped_href, media_type
                ));
            }
            
            // Add SMIL files and link to chapters
            for (idx, (chapter_idx, href)) in smil_files.iter().enumerate() {
                let smil_item_id = format!("s{:03}", idx + 1);
                let chapter = &chapters[*chapter_idx];
                let mut chapter_href = chapter.href.clone();
                if chapter_href.starts_with("OEBPS/") {
                    chapter_href = chapter_href[6..].to_string();
                }
                
                // Escape XML special characters in href
                let escaped_smil_href = href
                    .replace('&', "&amp;")
                    .replace('<', "&lt;")
                    .replace('>', "&gt;")
                    .replace('"', "&quot;");
                new_items.push_str(&format!(
                    r#"    <item id="{}" href="{}" media-type="application/smil+xml"/>
"#,
                    smil_item_id, escaped_smil_href
                ));
                
                // Update chapter item to include media-overlay
                // Match the item tag and insert media-overlay before the closing > or />
                // Escape special regex characters in the href
                let escaped_href = regex::escape(&chapter_href);
                // Also escape for XML if needed (but hrefs in OPF are usually already properly formatted)
                let chapter_pattern = Regex::new(&format!(
                    r#"(<item[^>]*?href\s*=\s*"{}"[^>]*?)(\s*/?>)"#,
                    escaped_href
                )).unwrap();
                new_opf = chapter_pattern.replace(&new_opf, |caps: &regex::Captures| {
                    // Check if media-overlay already exists to avoid duplicates
                    if caps[1].contains("media-overlay") {
                        caps[0].to_string() // Return unchanged if already present
                    } else {
                        // Trim any trailing whitespace and ensure proper spacing
                        let prefix = caps[1].trim_end();
                        // Add space before new attribute if not already present
                        let separator = if prefix.ends_with('"') { " " } else { " " };
                        format!(r#"{}{}media-overlay="{}"{}"#, prefix, separator, smil_item_id, &caps[2])
                    }
                }).to_string();
            }
            
            new_opf.insert_str(manifest_end, &new_items);
        }
        
        // Add media overlay metadata if not present
        if !new_opf.contains("media:active-class") {
            if let Some(metadata_end) = new_opf.find("</metadata>") {
                new_opf.insert_str(
                    metadata_end,
                    r#"    <meta property="media:active-class">-epub-media-overlay-active</meta>
"#,
                );
            }
        }
        
        Ok(new_opf)
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
