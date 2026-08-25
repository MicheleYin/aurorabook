use sqlx::{Executor, SqlitePool};
use tauri::AppHandle;

use crate::book_service::epub_file_storage::{
    ensure_canonical_epub_copy, library_epub_path, relative_library_epub_key, resolve_epub_file,
};

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

    /// Canonical EPUB on disk only (no BLOB). `file_path` should be the relative library key.
    pub async fn save_file_backed<'e, E: Executor<'e, Database = sqlx::Sqlite>>(
        executor: E,
        source_path: &str,
        book_id: &str,
        file_path: &str,
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
        .bind(file_path)
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

        let dest = library_epub_path(app, book_id)?;
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("Failed to create library dir: {}", e))?;
        }
        fs::write(&dest, data).map_err(|e| format!("Failed to write EPUB file: {}", e))?;

        let relative = relative_library_epub_key(book_id);
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
        .bind(&relative)
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

    /// Absolute path to a readable on-disk EPUB for this book, if one can be resolved.
    pub async fn file_path_for_book_id(
        pool: &SqlitePool,
        app: &AppHandle,
        book_id: &str,
    ) -> Result<Option<String>, String> {
        let stored: Option<String> = sqlx::query_scalar(
            "SELECT file_path FROM epub_data WHERE book_id = ? AND file_path IS NOT NULL AND file_path != '' LIMIT 1",
        )
        .bind(book_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("Failed to query epub file path: {}", e))?
        .flatten();

        let resolved = resolve_epub_file(app, book_id, stored.as_deref())?;
        Ok(resolved.map(|p| p.to_string_lossy().to_string()))
    }

    fn load_row_bytes(
        app: &AppHandle,
        book_id: &str,
        data: Option<Vec<u8>>,
        file_path: Option<String>,
    ) -> Result<Option<Vec<u8>>, String> {
        if let Some(path) = resolve_epub_file(app, book_id, file_path.as_deref())? {
            return std::fs::read(&path)
                .map(Some)
                .map_err(|e| format!("Failed to read EPUB file {}: {}", path.display(), e));
        }
        Ok(data)
    }

    pub async fn find_by_source_path(
        pool: &SqlitePool,
        app: &AppHandle,
        source_path: &str,
    ) -> Result<Option<Vec<u8>>, String> {
        use sqlx::Row;
        let row = sqlx::query(
            "SELECT book_id, data, file_path FROM epub_data WHERE source_path = ?",
        )
        .bind(source_path)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("Failed to query EPUB data: {}", e))?;

        if let Some(r) = row {
            let book_id: String = r.try_get("book_id").map_err(|e| e.to_string())?;
            let data: Option<Vec<u8>> = r.try_get("data").ok().flatten();
            let fp: Option<String> = r.try_get("file_path").ok().flatten();
            Self::load_row_bytes(app, &book_id, data, fp)
        } else {
            Ok(None)
        }
    }

    pub async fn find_by_book_id(
        pool: &SqlitePool,
        app: &AppHandle,
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
            Self::load_row_bytes(app, book_id, data, fp)
        } else if let Some(path) = resolve_epub_file(app, book_id, None)? {
            // Orphan on-disk copy (row missing) — still openable.
            std::fs::read(&path)
                .map(Some)
                .map_err(|e| format!("Failed to read EPUB file {}: {}", path.display(), e))
        } else {
            Ok(None)
        }
    }

    /// Re-link `epub_data.file_path` to relative library keys; copy legacy Documents files in.
    pub async fn repair_epub_file_links(pool: &SqlitePool, app: &AppHandle) -> Result<u32, String> {
        use sqlx::Row;

        let mut repaired = 0u32;
        let relative_key_for = relative_library_epub_key;

        let rows = sqlx::query("SELECT source_path, book_id, file_path FROM epub_data")
            .fetch_all(pool)
            .await
            .map_err(|e| format!("Failed to list epub_data for repair: {}", e))?;

        for row in rows {
            let source_path: String = row.try_get("source_path").map_err(|e| e.to_string())?;
            let book_id: String = row.try_get("book_id").map_err(|e| e.to_string())?;
            let stored: Option<String> = row.try_get("file_path").ok().flatten();
            let expected = relative_key_for(&book_id);

            let Some(found) = resolve_epub_file(app, &book_id, stored.as_deref())? else {
                continue;
            };

            let canonical = match ensure_canonical_epub_copy(app, &book_id, &found) {
                Ok(p) => p,
                Err(e) => {
                    log::warn!("Failed to ensure canonical EPUB for {}: {}", book_id, e);
                    continue;
                }
            };

            if !canonical.is_file() {
                continue;
            }

            let needs_update = stored.as_deref() != Some(expected.as_str());
            if needs_update {
                let updated_at = Self::updated_at_now();
                sqlx::query(
                    "UPDATE epub_data SET file_path = ?, updated_at = ? WHERE source_path = ?",
                )
                .bind(&expected)
                .bind(&updated_at)
                .bind(&source_path)
                .execute(pool)
                .await
                .map_err(|e| format!("Failed to repair epub_data for {}: {}", book_id, e))?;
                repaired += 1;
                log::info!(
                    "Repaired EPUB link for book {} -> {}",
                    book_id,
                    expected
                );
            }
        }

        // Books with on-disk EPUB but no epub_data row.
        let books = sqlx::query("SELECT id, source_path FROM books")
            .fetch_all(pool)
            .await
            .map_err(|e| format!("Failed to list books for EPUB repair: {}", e))?;

        for row in books {
            let book_id: String = row.try_get("id").map_err(|e| e.to_string())?;
            let source_path: String = row.try_get("source_path").map_err(|e| e.to_string())?;

            let exists: Option<i64> = sqlx::query_scalar(
                "SELECT 1 FROM epub_data WHERE book_id = ? LIMIT 1",
            )
            .bind(&book_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| format!("Failed to check epub_data for {}: {}", book_id, e))?;

            if exists.is_some() {
                continue;
            }

            let Some(found) = resolve_epub_file(app, &book_id, None)? else {
                continue;
            };
            let canonical = ensure_canonical_epub_copy(app, &book_id, &found)?;
            if !canonical.is_file() {
                continue;
            }

            let relative = relative_key_for(&book_id);
            Self::save_file_backed(pool, &source_path, &book_id, &relative).await?;
            repaired += 1;
            log::info!(
                "Registered missing epub_data for book {} -> {}",
                book_id,
                relative
            );
        }

        Ok(repaired)
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
