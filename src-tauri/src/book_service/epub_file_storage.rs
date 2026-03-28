//! Canonical EPUB files under the app container (`app_data_dir`), not Documents.
//!
//! App Sandbox (signed Mac App Store) grants read/write inside the container without extra
//! file entitlements. Using `document_dir` here caused sandbox denials for playback of EPUBs
//! copied at ingest when the webview loads `http://localhost:…` audio URLs.

use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use tauri::Manager;
use zip::ZipArchive;

/// `Application Support/<bundle-id>/Library` (same root family as `library.db`).
pub fn resolve_library_root(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data directory: {}", e))?;
    Ok(base.join("Library"))
}

/// Per-book directory containing `book.epub`.
pub fn library_epub_path(app: &AppHandle, book_id: &str) -> Result<PathBuf, String> {
    Ok(resolve_library_root(app)?.join(book_id).join("book.epub"))
}

/// Read an audio (or any) member from an on-disk EPUB, using the same path rules as ingestion.
pub fn read_member_from_epub_file(epub_path: &Path, inner_href: &str) -> Result<Vec<u8>, String> {
    let file = File::open(epub_path).map_err(|e| format!("Failed to open EPUB: {}", e))?;
    let mut archive = ZipArchive::new(file).map_err(|e| format!("Invalid EPUB zip: {}", e))?;

    use crate::epub::parser::{derive_base_path_from_opf, find_opf_path};

    let opf_path = find_opf_path(&mut archive)?;
    let base_path = derive_base_path_from_opf(&opf_path);

    let audio_path_primary = if inner_href.starts_with('/') {
        inner_href[1..].to_string()
    } else {
        format!("{}{}", base_path, inner_href)
    };

    let paths_to_try = vec![
        audio_path_primary.clone(),
        inner_href.to_string(),
        if inner_href.starts_with('/') {
            inner_href[1..].to_string()
        } else {
            inner_href.to_string()
        },
        format!(
            "{}{}",
            base_path,
            if inner_href.starts_with('/') {
                &inner_href[1..]
            } else {
                inner_href
            }
        ),
    ];

    for path_to_try in &paths_to_try {
        if let Ok(mut zf) = archive.by_name(path_to_try) {
            let mut buf = Vec::new();
            if zf.read_to_end(&mut buf).is_ok() && !buf.is_empty() {
                return Ok(buf);
            }
        }
    }

    Err(format!(
        "Member not found in EPUB (href: {}, tried: {:?})",
        inner_href, paths_to_try
    ))
}
