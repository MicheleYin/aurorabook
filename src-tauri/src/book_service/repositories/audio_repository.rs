use sqlx::{SqlitePool, Executor, Row};
use sqlx::sqlite::SqliteRow;
use crate::book_service::models::AudioTrack;

pub struct AudioRepository;

impl AudioRepository {
    /// Convert database row to domain model
    pub fn row_to_model(row: SqliteRow) -> Result<AudioTrack, String> {
        Ok(AudioTrack {
            id: row.get("id"),
            title: row.get("title"),
            href: row.get("href"),
            url: row.get("url"),
            duration: row.get("duration"),
            order: row.get::<i64, _>("track_order") as usize,
        })
    }
    
    /// Find all audio tracks for a book (ordered by track_order)
    pub async fn find_by_book_id(pool: &SqlitePool, book_id: &str) -> Result<Vec<AudioTrack>, String> {
        let rows = sqlx::query(
            "SELECT id, book_id, title, href, url, duration, track_order 
             FROM audio_tracks 
             WHERE book_id = ? 
             ORDER BY track_order"
        )
        .bind(book_id)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to query audio tracks: {}", e))?;
        
        let tracks: Result<Vec<AudioTrack>, _> = rows.into_iter().map(Self::row_to_model).collect();
        tracks.map_err(|e| format!("Failed to convert audio tracks: {}", e))
    }
    
    /// Save audio track metadata
    pub async fn save_metadata<'e, E: Executor<'e, Database = sqlx::Sqlite>>(
        executor: E,
        book_id: &str,
        model: &AudioTrack,
    ) -> Result<(), String> {
        sqlx::query(
            r#"
            INSERT INTO audio_tracks (id, book_id, title, href, url, duration, track_order)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(book_id, href) DO UPDATE SET
                title = excluded.title,
                url = COALESCE(excluded.url, audio_tracks.url),
                duration = COALESCE(excluded.duration, audio_tracks.duration),
                track_order = excluded.track_order
            "#
        )
        .bind(&model.id)
        .bind(book_id)
        .bind(&model.title)
        .bind(&model.href)
        .bind(&model.url)
        .bind(model.duration)
        .bind(model.order as i64)
        .execute(executor)
        .await
        .map_err(|e| format!("Failed to save audio track: {}", e))?;
        
        Ok(())
    }
    
    /// Save audio track data
    pub async fn save_data(pool: &SqlitePool, book_id: &str, href: &str, data: &[u8]) -> Result<(), String> {
        // Check if track exists
        let existing = sqlx::query("SELECT id, track_order FROM audio_tracks WHERE book_id = ? AND href = ?")
            .bind(book_id)
            .bind(href)
            .fetch_optional(pool)
            .await
            .map_err(|e| format!("Failed to find audio track: {}", e))?;
        
        if let Some(row) = existing {
            // Update existing track
            let _id: String = row.get("id");
            sqlx::query("UPDATE audio_tracks SET data = ? WHERE book_id = ? AND href = ?")
                .bind(data)
                .bind(book_id)
                .bind(href)
                .execute(pool)
                .await
                .map_err(|e| format!("Failed to update audio track data: {}", e))?;
        } else {
            // Create new track with data
            let max_order: Option<i64> = sqlx::query_scalar(
                "SELECT MAX(track_order) FROM audio_tracks WHERE book_id = ?"
            )
            .bind(book_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| format!("Failed to query max order: {}", e))?;
            
            let id = format!("{}-{}", book_id, href);
            sqlx::query(
                "INSERT INTO audio_tracks (id, book_id, title, href, url, duration, track_order, data)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
            )
            .bind(&id)
            .bind(book_id)
            .bind(href)
            .bind::<Option<String>>(None)
            .bind::<Option<f64>>(None)
            .bind(max_order.map(|v| v + 1).unwrap_or(0))
            .bind(data)
            .execute(pool)
            .await
            .map_err(|e| format!("Failed to insert audio track with data: {}", e))?;
        }
        
        Ok(())
    }
    
    /// Get audio track data
    pub async fn find_data_by_href(pool: &SqlitePool, book_id: &str, href: &str) -> Result<Option<Vec<u8>>, String> {
        let row = sqlx::query("SELECT data FROM audio_tracks WHERE book_id = ? AND href = ?")
            .bind(book_id)
            .bind(href)
            .fetch_optional(pool)
            .await
            .map_err(|e| format!("Failed to query audio track: {}", e))?;
        
        if let Some(row) = row {
            Ok(row.try_get("data").ok().flatten())
        } else {
            Ok(None)
        }
    }
    
    /// Row present: `(blob, href)` where `blob` is None if audio is only inside the canonical EPUB file.
    pub async fn find_data_by_id(
        pool: &SqlitePool,
        book_id: &str,
        track_id: &str,
    ) -> Result<Option<(Option<Vec<u8>>, String)>, String> {
        let row = sqlx::query("SELECT data, href FROM audio_tracks WHERE id = ? AND book_id = ?")
            .bind(track_id)
            .bind(book_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| format!("Failed to query audio track by id: {}", e))?;

        use sqlx::Row;

        if let Some(row) = row {
            let href: String = row.get("href");
            let data: Option<Vec<u8>> = row.try_get("data").ok().flatten();
            Ok(Some((data, href)))
        } else {
            Ok(None)
        }
    }

    pub async fn can_stream_track(
        pool: &SqlitePool,
        app: &tauri::AppHandle,
        book_id: &str,
        track_id: &str,
    ) -> Result<bool, String> {
        match Self::find_data_by_id(pool, book_id, track_id).await? {
            None => Ok(false),
            Some((Some(_), _)) => Ok(true),
            Some((None, _)) => {
                let fp = crate::book_service::repositories::EpubRepository::file_path_for_book_id(
                    pool, app, book_id,
                )
                .await?;
                Ok(fp
                    .map(|p| std::path::Path::new(&p).is_file())
                    .unwrap_or(false))
            }
        }
    }

    /// Load full audio bytes: SQLite blob if present, else read from canonical EPUB on disk.
    pub async fn resolve_track_audio_bytes(
        pool: &SqlitePool,
        app: &tauri::AppHandle,
        book_id: &str,
        track_id: &str,
    ) -> Result<Option<(Vec<u8>, String)>, String> {
        let Some((blob, href)) = Self::find_data_by_id(pool, book_id, track_id).await? else {
            return Ok(None);
        };
        if let Some(b) = blob {
            return Ok(Some((b, href)));
        }
        let Some(fp) = crate::book_service::repositories::EpubRepository::file_path_for_book_id(
            pool, app, book_id,
        )
        .await?
        else {
            return Ok(None);
        };
        let fp_clone = fp.clone();
        let href_clone = href.clone();
        let bytes = tokio::task::spawn_blocking(move || {
            crate::book_service::epub_file_storage::read_member_from_epub_file(
                std::path::Path::new(&fp_clone),
                &href_clone,
            )
        })
        .await
        .map_err(|e| format!("Audio load task failed: {}", e))??;
        Ok(Some((bytes, href)))
    }
    
    /// Delete all audio tracks for a book
    pub async fn delete_by_book_id<'e, E: Executor<'e, Database = sqlx::Sqlite>>(
        executor: E,
        book_id: &str,
    ) -> Result<(), String> {
        sqlx::query("DELETE FROM audio_tracks WHERE book_id = ?")
            .bind(book_id)
            .execute(executor)
            .await
            .map_err(|e| format!("Failed to delete audio tracks: {}", e))?;
        
        Ok(())
    }
}
