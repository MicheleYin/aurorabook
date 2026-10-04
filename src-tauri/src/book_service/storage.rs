use serde::Serialize;
use sqlx::Row;
use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::io::ErrorKind;
use std::path::{Component, Path, PathBuf};
use tauri::{AppHandle, Manager};

use crate::book_service::database::get_db_connection;
use crate::book_service::epub_file_storage::resolve_epub_file;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageReport {
    pub total_bytes: u64,
    pub database_bytes: u64,
    pub books: Vec<BookStorageUsage>,
    pub issues: Vec<StorageIssue>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookStorageUsage {
    pub book_id: String,
    pub title: String,
    pub bytes: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageIssue {
    pub kind: String,
    pub book_id: Option<String>,
    pub title: Option<String>,
    pub relative_path: String,
    pub bytes: u64,
    pub removable: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageCleanupResult {
    pub removed_directories: usize,
    pub removed_bytes: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookDeletionResult {
    pub bytes_removed: u64,
    pub cleanup_warnings: Vec<String>,
}

#[tauri::command]
pub async fn get_storage_report(app: AppHandle) -> Result<StorageReport, String> {
    let db = get_db_connection(&app).await?;
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))?;
    let library_dir = app_data_dir.join("Library");
    let checkpoints_dir = app_data_dir.join("checkpoints");

    let rows = sqlx::query(
        "SELECT b.id, b.title, b.source_path, \
            (SELECT file_path FROM epub_data e WHERE e.book_id = b.id \
                AND e.file_path IS NOT NULL AND e.file_path != '' LIMIT 1) AS file_path, \
            EXISTS(SELECT 1 FROM epub_data e WHERE e.book_id = b.id AND e.data IS NOT NULL) \
                AS has_embedded_data \
         FROM books b ORDER BY b.title COLLATE NOCASE",
    )
    .fetch_all(db.as_ref())
    .await
    .map_err(|error| format!("Failed to load books for storage report: {error}"))?;

    let mut book_titles = BTreeMap::new();
    let mut books = Vec::with_capacity(rows.len());
    let mut issues = Vec::new();

    for row in rows {
        let book_id: String = row.get("id");
        let title: String = row.get("title");
        let source_path: String = row.get("source_path");
        let file_path: Option<String> = row.get("file_path");
        let has_embedded_data: i64 = row.get("has_embedded_data");
        let resolved_epub = resolve_epub_file(&app, &book_id, file_path.as_deref())?;
        if resolved_epub.is_none()
            && has_embedded_data == 0
            && !Path::new(&source_path).is_file()
        {
            issues.push(StorageIssue {
                kind: "missingEpub".to_string(),
                book_id: Some(book_id.clone()),
                title: Some(title.clone()),
                relative_path: format!("Library/{book_id}/book.epub"),
                bytes: 0,
                removable: false,
            });
        }

        let bytes = directory_bytes(&managed_book_dir(&library_dir, &book_id)?)?
            + directory_bytes(&managed_book_dir(&checkpoints_dir, &book_id)?)?;
        book_titles.insert(book_id.clone(), title.clone());
        books.push(BookStorageUsage {
            book_id,
            title,
            bytes,
        });
    }

    let book_ids: HashSet<String> = book_titles.keys().cloned().collect();
    for (directory_id, path) in child_directories(&library_dir)? {
        if !book_ids.contains(&directory_id) {
            issues.push(StorageIssue {
                kind: "orphanedBookDirectory".to_string(),
                book_id: None,
                title: None,
                relative_path: format!("Library/{directory_id}"),
                bytes: directory_bytes(&path)?,
                removable: true,
            });
        }
    }
    for (directory_id, path) in child_directories(&checkpoints_dir)? {
        if !book_ids.contains(&directory_id) {
            issues.push(StorageIssue {
                kind: "orphanedCheckpointDirectory".to_string(),
                book_id: None,
                title: None,
                relative_path: format!("checkpoints/{directory_id}"),
                bytes: directory_bytes(&path)?,
                removable: true,
            });
        }
    }

    let foreign_key_rows = sqlx::query("PRAGMA foreign_key_check")
        .fetch_all(db.as_ref())
        .await
        .map_err(|error| format!("Failed to check database references: {error}"))?;
    for row in foreign_key_rows {
        let table: String = row.get("table");
        let row_id: Option<i64> = row.try_get("rowid").unwrap_or(None);
        issues.push(StorageIssue {
            kind: "danglingDatabaseReference".to_string(),
            book_id: None,
            title: None,
            relative_path: format!("database/{table}/{}", row_id.unwrap_or_default()),
            bytes: 0,
            removable: false,
        });
    }

    let checkpoint_rows = sqlx::query(
        "SELECT book_id, audio_file_path FROM live_sentence_alignment",
    )
    .fetch_all(db.as_ref())
    .await
    .map_err(|error| format!("Failed to check checkpoint files: {error}"))?;
    for row in checkpoint_rows {
        let book_id: String = row.get("book_id");
        if !book_ids.contains(&book_id) {
            continue;
        }
        let audio_file_path: String = row.get("audio_file_path");
        let stored_path = PathBuf::from(audio_file_path);
        let resolved_path = if stored_path.is_absolute() {
            stored_path
        } else {
            app_data_dir.join(stored_path)
        };
        if !resolved_path.is_file() {
            issues.push(StorageIssue {
                kind: "missingCheckpointAudio".to_string(),
                title: book_titles.get(&book_id).cloned(),
                book_id: Some(book_id.clone()),
                relative_path: format!("checkpoints/{book_id}"),
                bytes: 0,
                removable: false,
            });
        }
    }

    let total_bytes = directory_bytes(&app_data_dir)?;
    let database_bytes = ["library.db", "library.db-wal", "library.db-shm"]
        .iter()
        .map(|name| directory_bytes(&app_data_dir.join(name)))
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .sum();

    Ok(StorageReport {
        total_bytes,
        database_bytes,
        books,
        issues,
    })
}

#[tauri::command]
pub async fn cleanup_orphaned_storage(app: AppHandle) -> Result<StorageCleanupResult, String> {
    let db = get_db_connection(&app).await?;
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))?;
    let book_ids: HashSet<String> = sqlx::query_scalar("SELECT id FROM books")
        .fetch_all(db.as_ref())
        .await
        .map_err(|error| format!("Failed to load current book IDs: {error}"))?
        .into_iter()
        .collect();

    let mut result = StorageCleanupResult {
        removed_directories: 0,
        removed_bytes: 0,
    };
    for root_name in ["Library", "checkpoints"] {
        let root = app_data_dir.join(root_name);
        for (directory_id, path) in child_directories(&root)? {
            if book_ids.contains(&directory_id) {
                continue;
            }
            let still_referenced: i64 = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM books WHERE id = ?)",
            )
            .bind(&directory_id)
            .fetch_one(db.as_ref())
            .await
            .map_err(|error| format!("Failed to recheck book before cleanup: {error}"))?;
            if still_referenced != 0 {
                continue;
            }

            let bytes = directory_bytes(&path)?;
            fs::remove_dir_all(&path).map_err(|error| {
                format!("Failed to remove orphaned directory {}: {error}", path.display())
            })?;
            result.removed_directories += 1;
            result.removed_bytes += bytes;
        }
    }
    Ok(result)
}

pub fn book_storage_bytes(app: &AppHandle, book_id: &str) -> Result<u64, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))?;
    directory_bytes(&managed_book_dir(&app_data_dir.join("Library"), book_id)?)
        .and_then(|library_bytes| {
            directory_bytes(&managed_book_dir(&app_data_dir.join("checkpoints"), book_id)?)
                .map(|checkpoint_bytes| library_bytes + checkpoint_bytes)
        })
}

fn managed_book_dir(root: &Path, book_id: &str) -> Result<PathBuf, String> {
    let mut components = Path::new(book_id).components();
    if book_id.is_empty()
        || !matches!(components.next(), Some(Component::Normal(_)))
        || components.next().is_some()
    {
        return Err("Invalid book ID for storage lookup".to_string());
    }
    Ok(root.join(book_id))
}

fn child_directories(root: &Path) -> Result<Vec<(String, PathBuf)>, String> {
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(format!("Failed to read directory {}: {error}", root.display())),
    };
    let mut directories = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|error| format!("Failed to read directory entry: {error}"))?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Failed to inspect directory entry: {error}"))?;
        if file_type.is_dir() {
            directories.push((entry.file_name().to_string_lossy().into_owned(), entry.path()));
        }
    }
    Ok(directories)
}

fn directory_bytes(path: &Path) -> Result<u64, String> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(0),
        Err(error) => return Err(format!("Failed to inspect {}: {error}", path.display())),
    };
    let file_type = metadata.file_type();
    if file_type.is_symlink() {
        return Ok(0);
    }
    if file_type.is_file() {
        return Ok(metadata.len());
    }
    if !file_type.is_dir() {
        return Ok(0);
    }

    let mut total = 0;
    for entry in fs::read_dir(path)
        .map_err(|error| format!("Failed to read directory {}: {error}", path.display()))?
    {
        let entry = entry.map_err(|error| format!("Failed to read directory entry: {error}"))?;
        total += directory_bytes(&entry.path())?;
    }
    Ok(total)
}

#[cfg(test)]
mod tests {
    use super::directory_bytes;
    use std::fs;

    #[test]
    fn directory_bytes_sums_nested_regular_files() {
        let temp_dir = tempfile::tempdir().expect("create temporary directory");
        let root = temp_dir.path().join("data");
        let nested = root.join("Library/book-a");
        fs::create_dir_all(&nested).expect("create test directory");
        fs::write(root.join("library.db"), [0; 7]).expect("write database fixture");
        fs::write(nested.join("book.epub"), [0; 19]).expect("write epub fixture");

        assert_eq!(directory_bytes(&root).expect("measure test directory"), 26);
        assert_eq!(directory_bytes(&root.join("missing" )).unwrap(), 0);
    }
}