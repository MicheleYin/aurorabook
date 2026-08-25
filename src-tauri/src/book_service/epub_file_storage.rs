//! Canonical EPUB files under the app container (`app_data_dir`), not Documents.
//!
//! App Sandbox (signed Mac App Store) grants read/write inside the container without extra
//! file entitlements. Using `document_dir` here caused sandbox denials for playback of EPUBs
//! copied at ingest when the webview loads `http://localhost:…` audio URLs.
//!
//! DB rows store a **relative** key (`Library/{book_id}/book.epub`) so container UUID / path
//! changes across TestFlight updates do not break opens. Absolute legacy paths are remapped.

use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use tauri::Manager;
use zip::ZipArchive;

/// Relative path stored in `epub_data.file_path` (resolved against `app_data_dir`).
pub fn relative_library_epub_key(book_id: &str) -> String {
    format!("Library/{}/book.epub", book_id)
}

/// `Application Support/<bundle-id>/Library` (same root family as `library.db`).
pub fn resolve_library_root(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data directory: {}", e))?;
    Ok(base.join("Library"))
}

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data directory: {}", e))
}

/// Per-book directory containing `book.epub`.
pub fn library_epub_path(app: &AppHandle, book_id: &str) -> Result<PathBuf, String> {
    Ok(resolve_library_root(app)?.join(book_id).join("book.epub"))
}

/// Per-book directory under the app Library root (`Library/<book_id>/`).
pub fn library_book_dir(app: &AppHandle, book_id: &str) -> Result<PathBuf, String> {
    Ok(resolve_library_root(app)?.join(book_id))
}

/// Legacy location used before the sandbox path fix (`Documents/AuroraBook/Library/...`).
pub fn legacy_documents_epub_path(app: &AppHandle, book_id: &str) -> Result<PathBuf, String> {
    let docs = app
        .path()
        .document_dir()
        .map_err(|e| format!("Failed to resolve document directory: {}", e))?;
    Ok(docs
        .join("AuroraBook")
        .join("Library")
        .join(book_id)
        .join("book.epub"))
}

/// If `stored` embeds `Library/{book_id}/book.epub`, remap onto the current `app_data_dir`
/// (handles iOS container UUID changes across updates without matching macOS's
/// `.../Library/Application Support/...` segment).
fn remap_library_suffix_to_app_data(
    app: &AppHandle,
    stored: &str,
    book_id: &str,
) -> Option<PathBuf> {
    let relative = relative_library_epub_key(book_id);
    let normalized = stored.replace('\\', "/");
    let marker = format!("/{}", relative);
    if normalized.ends_with(&relative) || normalized.contains(&marker) {
        return app_data_dir(app).ok().map(|base| base.join(relative));
    }
    None
}

/// Resolve an on-disk EPUB for `book_id`, trying stored path (relative or absolute), remapped
/// container paths, the canonical library location, then the legacy Documents location.
pub fn resolve_epub_file(
    app: &AppHandle,
    book_id: &str,
    stored: Option<&str>,
) -> Result<Option<PathBuf>, String> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Some(raw) = stored.map(str::trim).filter(|s| !s.is_empty()) {
        let path = Path::new(raw);
        if path.is_absolute() {
            candidates.push(path.to_path_buf());
            if let Some(remapped) = remap_library_suffix_to_app_data(app, raw, book_id) {
                candidates.push(remapped);
            }
        } else {
            candidates.push(app_data_dir(app)?.join(raw));
        }
    }

    candidates.push(library_epub_path(app, book_id)?);
    if let Ok(legacy) = legacy_documents_epub_path(app, book_id) {
        candidates.push(legacy);
    }

    let mut seen = std::collections::HashSet::new();
    for candidate in candidates {
        let key = candidate.to_string_lossy().to_string();
        if !seen.insert(key) {
            continue;
        }
        if candidate.is_file() {
            return Ok(Some(candidate));
        }
    }
    Ok(None)
}

/// Copy a legacy Documents EPUB into the canonical library location when needed.
pub fn ensure_canonical_epub_copy(app: &AppHandle, book_id: &str, source: &Path) -> Result<PathBuf, String> {
    let dest = library_epub_path(app, book_id)?;
    if source == dest.as_path() {
        return Ok(dest);
    }
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create library dir {:?}: {}", parent, e))?;
    }
    if !dest.is_file() {
        std::fs::copy(source, &dest).map_err(|e| {
            format!(
                "Failed to copy EPUB from {:?} to {:?}: {}",
                source, dest, e
            )
        })?;
    }
    Ok(dest)
}

/// Per-chapter temporary sentence audio directory under `Library/<book_id>/live-audio/`.
pub fn live_audio_chapter_dir(
    app: &AppHandle,
    book_id: &str,
    chapter_index: usize,
) -> Result<PathBuf, String> {
    Ok(library_book_dir(app, book_id)?
        .join("live-audio")
        .join(format!("chapter-{}", chapter_index)))
}

/// Raw f32 sentence audio file path under the live-audio chapter directory.
pub fn live_audio_sentence_path(
    app: &AppHandle,
    book_id: &str,
    chapter_index: usize,
    sentence_index: usize,
) -> Result<PathBuf, String> {
    Ok(live_audio_chapter_dir(app, book_id, chapter_index)?
        .join(format!("sentence-{}.bin", sentence_index)))
}

/// Deletes `Library/<book_id>/` and everything inside (canonical EPUB and any other per-book files).
pub fn remove_book_library_dir(app: &AppHandle, book_id: &str) -> Result<(), String> {
    let dir = library_book_dir(app, book_id)?;
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| {
            format!(
                "Failed to remove book library directory {:?}: {}",
                dir, e
            )
        })?;
    }
    Ok(())
}

/// Read an audio (or any) member from an on-disk EPUB, using the same path rules as ingestion.
pub fn read_member_from_epub_file(epub_path: &Path, inner_href: &str) -> Result<Vec<u8>, String> {
    read_resource_from_epub_file(epub_path, inner_href, None).map(|(bytes, _)| bytes)
}

fn sanitize_href(href: &str) -> String {
    let trimmed = href.trim();
    let no_fragment = trimmed.split('#').next().unwrap_or(trimmed);
    let no_query = no_fragment.split('?').next().unwrap_or(no_fragment);
    no_query.trim().to_string()
}

fn resolve_relative_path(base_path: &str, relative_path: &str) -> String {
    let mut resolved_parts: Vec<&str> = base_path.split('/').filter(|s| !s.is_empty()).collect();
    let relative_parts: Vec<&str> = relative_path.split('/').collect();

    for part in relative_parts {
        if part == ".." {
            resolved_parts.pop();
        } else if part != "." && !part.is_empty() {
            resolved_parts.push(part);
        }
    }

    resolved_parts.join("/")
}

/// Read any EPUB member from an on-disk EPUB with chapter-aware path resolution.
/// Returns bytes and the member path that matched in the ZIP.
pub fn read_resource_from_epub_file(
    epub_path: &Path,
    resource_href: &str,
    chapter_href: Option<&str>,
) -> Result<(Vec<u8>, String), String> {
    let file = File::open(epub_path).map_err(|e| format!("Failed to open EPUB: {}", e))?;
    let mut archive = ZipArchive::new(file).map_err(|e| format!("Invalid EPUB zip: {}", e))?;

    use crate::epub::parser::{derive_base_path_from_opf, find_opf_path};

    let opf_path = find_opf_path(&mut archive)?;
    let base_path = derive_base_path_from_opf(&opf_path);

    let raw_href = sanitize_href(resource_href);
    let cleaned_href = raw_href.trim_start_matches('/').to_string();

    let mut paths_to_try: Vec<String> = vec![
        cleaned_href.clone(),
        raw_href.clone(),
        format!("{}{}", base_path, cleaned_href),
    ];

    if let Some(ch) = chapter_href {
        let ch_clean = sanitize_href(ch);
        let chapter_abs = if ch_clean.starts_with('/') {
            ch_clean[1..].to_string()
        } else if !base_path.is_empty() && ch_clean.starts_with(&base_path) {
            ch_clean
        } else {
            format!("{}{}", base_path, ch_clean)
        };

        let chapter_dir = chapter_abs
            .rfind('/')
            .map(|pos| chapter_abs[..pos + 1].to_string())
            .unwrap_or_else(|| base_path.clone());

        let chapter_relative = resolve_relative_path(&chapter_dir, &raw_href);
        if !chapter_relative.is_empty() {
            paths_to_try.push(chapter_relative.clone());
            paths_to_try.push(chapter_relative.trim_start_matches('/').to_string());
        }
    }

    if let Some(filename) = cleaned_href.split('/').last() {
        if !filename.is_empty() {
            paths_to_try.push(filename.to_string());
        }
    }

    let mut seen = std::collections::HashSet::new();
    paths_to_try.retain(|p| !p.is_empty() && seen.insert(p.clone()));

    for path_to_try in &paths_to_try {
        if let Ok(mut zf) = archive.by_name(path_to_try) {
            let mut buf = Vec::new();
            if zf.read_to_end(&mut buf).is_ok() && !buf.is_empty() {
                return Ok((buf, path_to_try.clone()));
            }
        }
    }

    if !cleaned_href.is_empty() {
        let suffix = cleaned_href.to_ascii_lowercase();
        for idx in 0..archive.len() {
            if let Ok(mut zf) = archive.by_index(idx) {
                let name = zf.name().to_string();
                let name_lc = name.to_ascii_lowercase();
                if name_lc.ends_with(&suffix) || name_lc.ends_with(&format!("/{}", suffix)) {
                    let mut buf = Vec::new();
                    if zf.read_to_end(&mut buf).is_ok() && !buf.is_empty() {
                        return Ok((buf, name));
                    }
                }
            }
        }
    }

    Err(format!(
        "Resource not found in EPUB (href: {}, chapter: {:?}, tried: {:?})",
        resource_href, chapter_href, paths_to_try
    ))
}
