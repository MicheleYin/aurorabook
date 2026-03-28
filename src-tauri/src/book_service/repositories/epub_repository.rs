use sqlx::{Executor, SqlitePool};
use std::path::PathBuf;
use tauri::AppHandle;

pub struct EpubRepository;

impl EpubRepository {
    fn updated_at_now() -> String {
        use std::time::{SystemTime, UNIX_EPOCH};
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs()
            .to_string()
    }

    /// Canonical EPUB on disk only (no BLOB). Used on ingest after copy to Library.
    pub async fn save_file_backed<'e, E: Executor<'e, Database = sqlx::Sqlite>>(
        executor: E,
        source_path: &str,
        book_id: &str,
        absolute_file_path: &str,
    ) -> Result<(), String> {
        let updated_at = Self::updated_at_now();
        sqlx::query(
            r#"
            INSERT INTO epub_data (source_path, book_id, data, file_path, updated_at)
            VALUES (?, ?, NULL, ?, ?)
            ON CONFLICT(source_path) DO UPDATE SET
                book_id = excluded.book_id,
                data = NULL,
                file_path = excluded.file_path,
                updated_at = excluded.updated_at
            "#,
        )
        .bind(source_path)
        .bind(book_id)
        .bind(absolute_file_path)
        .bind(&updated_at)
        .execute(executor)
        .await
        .map_err(|e| format!("Failed to save EPUB file reference: {}", e))?;
        Ok(())
    }

    /// Write EPUB bytes to the canonical on-disk file and clear the DB blob.
    pub async fn save_write_file_and_clear_blob(
        pool: &SqlitePool,
        app: &AppHandle,
        source_path: &str,
        book_id: &str,
        data: &[u8],
    ) -> Result<(), String> {
        use std::fs;

        let existing_fp: Option<String> = sqlx::query_scalar(
            "SELECT file_path FROM epub_data WHERE source_path = ?",
        )
        .bind(source_path)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("Failed to query epub_data: {}", e))?
        .flatten();

        let dest = if let Some(ref p) = existing_fp {
            if !p.trim().is_empty() {
                PathBuf::from(p)
            } else {
                crate::book_service::epub_file_storage::library_epub_path(app, book_id)?
            }
        } else {
            crate::book_service::epub_file_storage::library_epub_path(app, book_id)?
        };

        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("Failed to create library dir: {}", e))?;
        }
        fs::write(&dest, data).map_err(|e| format!("Failed to write EPUB file: {}", e))?;

        let path_str = dest
            .to_str()
            .ok_or_else(|| "EPUB path is not valid UTF-8".to_string())?;

        let updated_at = Self::updated_at_now();
        sqlx::query(
            r#"
            INSERT INTO epub_data (source_path, book_id, data, file_path, updated_at)
            VALUES (?, ?, NULL, ?, ?)
            ON CONFLICT(source_path) DO UPDATE SET
                book_id = excluded.book_id,
                data = NULL,
                file_path = excluded.file_path,
                updated_at = excluded.updated_at
            "#,
        )
        .bind(source_path)
        .bind(book_id)
        .bind(path_str)
        .bind(&updated_at)
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to save EPUB metadata: {}", e))?;

        Ok(())
    }

    /// Legacy: store full EPUB in SQLite (tests / migration compatibility).
    pub async fn save_blob<'e, E: Executor<'e, Database = sqlx::Sqlite>>(
        executor: E,
        source_path: &str,
        book_id: &str,
        data: &[u8],
    ) -> Result<(), String> {
        let updated_at = Self::updated_at_now();
        sqlx::query(
            r#"
            INSERT INTO epub_data (source_path, book_id, data, file_path, updated_at)
            VALUES (?, ?, ?, NULL, ?)
            ON CONFLICT(source_path) DO UPDATE SET
                book_id = excluded.book_id,
                data = excluded.data,
                file_path = NULL,
                updated_at = excluded.updated_at
            "#,
        )
        .bind(source_path)
        .bind(book_id)
        .bind(data)
        .bind(&updated_at)
        .execute(executor)
        .await
        .map_err(|e| format!("Failed to save EPUB data: {}", e))?;
        Ok(())
    }

    /// Absolute path to on-disk EPUB for this book, if file-backed.
    pub async fn file_path_for_book_id(
        pool: &SqlitePool,
        book_id: &str,
    ) -> Result<Option<String>, String> {
        let row: Option<String> = sqlx::query_scalar(
            "SELECT file_path FROM epub_data WHERE book_id = ? AND file_path IS NOT NULL AND file_path != '' LIMIT 1",
        )
        .bind(book_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("Failed to query epub file path: {}", e))?
        .flatten();
        Ok(row)
    }

    fn load_row_bytes(
        data: Option<Vec<u8>>,
        file_path: Option<String>,
    ) -> Result<Option<Vec<u8>>, String> {
        if let Some(ref p) = file_path {
            if !p.trim().is_empty() {
                let pb = std::path::Path::new(p);
                if pb.is_file() {
                    return std::fs::read(pb)
                        .map(Some)
                        .map_err(|e| format!("Failed to read EPUB file: {}", e));
                }
            }
        }
        Ok(data)
    }

    pub async fn find_by_source_path(
        pool: &SqlitePool,
        source_path: &str,
    ) -> Result<Option<Vec<u8>>, String> {
        use sqlx::Row;
        let row = sqlx::query("SELECT data, file_path FROM epub_data WHERE source_path = ?")
            .bind(source_path)
            .fetch_optional(pool)
            .await
            .map_err(|e| format!("Failed to query EPUB data: {}", e))?;

        if let Some(r) = row {
            let data: Option<Vec<u8>> = r.try_get("data").ok().flatten();
            let fp: Option<String> = r.try_get("file_path").ok().flatten();
            Self::load_row_bytes(data, fp)
        } else {
            Ok(None)
        }
    }

    pub async fn find_by_book_id(
        pool: &SqlitePool,
        book_id: &str,
    ) -> Result<Option<Vec<u8>>, String> {
        use sqlx::Row;
        let row = sqlx::query("SELECT data, file_path FROM epub_data WHERE book_id = ? LIMIT 1")
            .bind(book_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| format!("Failed to query EPUB data: {}", e))?;

        if let Some(r) = row {
            let data: Option<Vec<u8>> = r.try_get("data").ok().flatten();
            let fp: Option<String> = r.try_get("file_path").ok().flatten();
            Self::load_row_bytes(data, fp)
        } else {
            Ok(None)
        }
    }

    pub async fn delete_by_source_path<'e, E: Executor<'e, Database = sqlx::Sqlite>>(
        executor: E,
        source_path: &str,
    ) -> Result<(), String> {
        sqlx::query("DELETE FROM epub_data WHERE source_path = ?")
            .bind(source_path)
            .execute(executor)
            .await
            .map_err(|e| format!("Failed to delete EPUB data: {}", e))?;
        Ok(())
    }

    pub async fn delete_by_book_id<'e, E: Executor<'e, Database = sqlx::Sqlite>>(
        executor: E,
        book_id: &str,
    ) -> Result<(), String> {
        sqlx::query("DELETE FROM epub_data WHERE book_id = ?")
            .bind(book_id)
            .execute(executor)
            .await
            .map_err(|e| format!("Failed to delete EPUB data: {}", e))?;
        Ok(())
    }
}
