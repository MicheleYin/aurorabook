use crate::epub::converter::types::{ConversionContext, ChapterProcessResult};
use crate::epub::converter::opf::update_content_opf;
use anyhow::{Context, Result as AnyhowResult};
use tauri::Emitter;

/// Build the final EPUB ZIP file with all content
pub(crate) fn build_epub_zip(
    context: &ConversionContext,
    updated_opf: &str,
) -> AnyhowResult<Vec<u8>> {
    use std::io::{Cursor, Write};
    use zip::{ZipWriter, write::FileOptions};
    
    let mut zip_writer = ZipWriter::new(Cursor::new(Vec::new()));
    let file_options = FileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    let mimetype_options = FileOptions::default()
        .compression_method(zip::CompressionMethod::Stored);
    
    // Add mimetype first (EPUB spec requirement)
    if let Some(mimetype_data) = context.original_files.get("mimetype") {
        zip_writer.start_file("mimetype", mimetype_options)
            .context("Failed to add mimetype to ZIP")?;
        zip_writer.write_all(mimetype_data)
            .context("Failed to write mimetype")?;
    } else {
        zip_writer.start_file("mimetype", mimetype_options)
            .context("Failed to add mimetype to ZIP")?;
        zip_writer.write_all(b"application/epub+zip")
            .context("Failed to write mimetype")?;
    }
    
    // Add META-INF/container.xml
    let container_xml = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="{}" media-type="application/oebps-package+xml" />
  </rootfiles>
</container>"#,
        context.opf_path
    );
    zip_writer.start_file("META-INF/container.xml", file_options)
        .context("Failed to add container.xml to ZIP")?;
    zip_writer.write_all(container_xml.as_bytes())
        .context("Failed to write container.xml")?;
    
    // Add other META-INF files
    let mut meta_inf_files: Vec<_> = context.original_files.iter()
        .filter(|(path, _)| path.starts_with("META-INF/") && *path != "META-INF/container.xml")
        .collect();
    meta_inf_files.sort_by_key(|(path, _)| *path);
    
    for (file_path, file_data) in meta_inf_files {
        zip_writer.start_file(file_path, file_options)
            .with_context(|| format!("Failed to add {} to ZIP", file_path))?;
        zip_writer.write_all(file_data)
            .with_context(|| format!("Failed to write {}", file_path))?;
    }
    
    // Add updated OPF
    zip_writer.start_file(&context.opf_path, file_options)
        .context("Failed to add OPF to ZIP")?;
    zip_writer.write_all(updated_opf.as_bytes())
        .context("Failed to write OPF")?;
    
    // Add all other files
    let mut other_files: Vec<_> = context.original_files.iter()
        .filter(|(path, _)| {
            *path != "mimetype" 
            && *path != "META-INF/container.xml" 
            && *path != &context.opf_path
        })
        .collect();
    other_files.sort_by_key(|(path, _)| *path);
    
    for (file_path, file_data) in other_files {
        zip_writer.start_file(file_path, file_options)
            .with_context(|| format!("Failed to add file {} to ZIP", file_path))?;
        zip_writer.write_all(file_data)
            .with_context(|| format!("Failed to write file data for {}", file_path))?;
    }
    
    let zip_data = zip_writer.finish()
        .context("Failed to finalize ZIP")?;
    
    Ok(zip_data.into_inner())
}

/// Initialize conversion context and read original OPF content
pub(crate) fn initialize_conversion_context(
    epub_data: &[u8],
) -> AnyhowResult<(ConversionContext, String)> {
    use std::io::{Cursor, Read};
    use zip::ZipArchive;
    use crate::epub::converter::extraction::{initialize_conversion, extract_original_files};
    
    let (opf_path, base_path) = initialize_conversion(epub_data)?;
    let original_files = extract_original_files(epub_data, &opf_path)?;
    
    let context = ConversionContext {
        opf_path: opf_path.clone(),
        base_path,
        original_files,
        audio_files: Vec::new(),
        smil_files: Vec::new(),
    };
    
    // Read original OPF content
    let mut archive = ZipArchive::new(Cursor::new(epub_data))
        .context("Failed to open EPUB for OPF read")?;
    let original_opf_content = archive.by_name(&opf_path)
        .and_then(|mut f| {
            let mut content = String::new();
            f.read_to_string(&mut content)?;
            Ok(content)
        })
        .context("Failed to read original OPF")?;
    
    Ok((context, original_opf_content))
}

/// Merge a chapter processing result into the conversion context
pub(crate) fn merge_chapter_result(
    context: &mut ConversionContext,
    result: ChapterProcessResult,
) {
    // Merge files into context
    for (path, data) in result.files {
        context.original_files.insert(path, data);
    }
    
    // Add audio and SMIL file entries only if they're not empty
    if !result.audio_file.1.is_empty() {
        context.audio_files.push(result.audio_file);
    }
    if !result.smil_file.1.is_empty() {
        context.smil_files.push(result.smil_file);
    }
    
    // Sort audio and SMIL files by chapter index to maintain order
    context.audio_files.sort_by_key(|(idx, _)| *idx);
    context.smil_files.sort_by_key(|(idx, _)| *idx);
}

/// Rebuild EPUB with current progress and save to Tauri store
pub(crate) async fn rebuild_and_save_epub(
    context: &ConversionContext,
    original_opf_content: &str,
    chapter_hrefs: &[String],
    chapter_index: usize,
    total_chapters: usize,
    words_processed: usize,
    total_words: usize,
    words_in_current_chapter: usize,
    progress_callback: &crate::epub::converter::progress::ProgressCallback,
    app: Option<&tauri::AppHandle>,
    source_path: Option<&str>,
    chapter_title: Option<&str>,
) -> AnyhowResult<Vec<u8>> {
    use crate::epub::converter::types::ConversionProgress;
    
    // Update progress
    progress_callback(ConversionProgress {
        current_chapter: chapter_index + 1,
        total_chapters,
        words_processed,
        total_words,
        words_in_current_chapter,
        current_step: "saving-epub".to_string(),
        message: format!("Saving EPUB after chapter {}...", chapter_index + 1),
    });
    
    // Update OPF with current progress
    let updated_opf = update_content_opf(
        original_opf_content,
        &context.audio_files,
        &context.smil_files,
        chapter_hrefs,
    )
    .map_err(|e| anyhow::anyhow!("Failed to update content.opf: {}", e))?;
    
    // Build EPUB with current progress
    let epub_output = build_epub_zip(context, &updated_opf)?;
    
    // Save to Tauri store if app and source_path are provided
    if let (Some(app_ref), Some(source_path_ref)) = (app, source_path) {
        // EPUB buffer is no longer stored separately - all content is in structured tables
        // The converted EPUB is not stored, only the structured data
        log::debug!("EPUB conversion complete - structured data stored in database");
        log::debug!("Saved EPUB to store after chapter {}", chapter_index + 1);
        
        // Update book audio tracks so user can listen as soon as one chapter is ready
        use crate::epub::book_update::update_book_audio_tracks;
        if let Err(e) = update_book_audio_tracks(&epub_output, source_path_ref, app_ref).await {
            log::warn!("Failed to update book audio tracks after chapter {}: {}", chapter_index + 1, e);
            // Don't fail the conversion if audio track update fails
        } else {
            log::debug!("Updated book audio tracks after chapter {}", chapter_index + 1);
            
            // Mark chapter as completed in the book
            use crate::book_service::database::get_db_connection;
            use crate::book_service::repositories::BookRepository;
            use crate::book_service::models::ConversionStatus;
            if let Ok(db) = get_db_connection(app_ref).await {
                if let Ok(Some(mut book)) = BookRepository::find_by_source_path(&db, source_path_ref).await {
                // Get the chapter href for this chapter
                if chapter_index < chapter_hrefs.len() {
                    let chapter_href = &chapter_hrefs[chapter_index];
                    if !book.completed_chapters.contains(chapter_href) {
                        book.completed_chapters.push(chapter_href.clone());
                        log::debug!("Marked chapter {} as completed", chapter_href);
                        
                        // Check if all chapters with text content are completed
                        // Only count chapters that have text content (word_count > 0)
                        let chapters_with_text: usize = book.chapters.iter()
                            .filter(|ch| ch.word_count.map(|wc| wc > 0).unwrap_or(false))
                            .count();
                        
                        if book.completed_chapters.len() >= chapters_with_text {
                            book.conversion_status = ConversionStatus::Done;
                            log::info!("All chapters with text content completed ({} of {} total chapters), marking conversion as done", 
                                book.completed_chapters.len(), book.chapters.len());
                        }
                        
                        // Save the updated book
                        if let Err(e) = BookRepository::save(&db, &book).await {
                            log::warn!("Failed to save completed chapter: {}", e);
                        }
                        }
                    }
                }
            }
            
            // Check if audio was generated for this chapter
            // Audio files are stored as (chapter_index, audio_path) tuples
            let audio_generated = context.audio_files.iter()
                .any(|(idx, _)| *idx == chapter_index);
            
            // Emit event to frontend to refetch the book
            use crate::epub::converter::types::ChapterCompletedEvent;
            let event = ChapterCompletedEvent {
                source_path: source_path_ref.to_string(),
                chapter_index: chapter_index + 1,
                total_chapters,
                chapter_title: chapter_title.unwrap_or(&format!("Chapter {}", chapter_index + 1)).to_string(),
                audio_generated,
            };
            
            if let Err(e) = app_ref.emit("chapter-completed", event) {
                log::warn!("Failed to emit chapter-completed event: {}", e);
            } else {
                log::debug!("Emitted chapter-completed event for chapter {} (audio_generated: {})", chapter_index + 1, audio_generated);
            }
        }
    }
    
    Ok(epub_output)
}

/// Build final EPUB with all completed chapters
pub(crate) fn build_final_epub(
    context: &ConversionContext,
    original_opf_content: &str,
    chapter_hrefs: &[String],
) -> AnyhowResult<Vec<u8>> {
    let updated_opf = update_content_opf(
        original_opf_content,
        &context.audio_files,
        &context.smil_files,
        chapter_hrefs,
    )
    .map_err(|e| anyhow::anyhow!("Failed to update content.opf: {}", e))?;
    
    build_epub_zip(context, &updated_opf)
}

