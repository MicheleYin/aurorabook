use sqlx::{SqlitePool, Executor, Row};

pub struct EpubRepository;

impl EpubRepository {
    /// Save EPUB data by source_path
    pub async fn save<'e, E: Executor<'e, Database = sqlx::Sqlite>>(
        executor: E,
        source_path: &str,
        book_id: &str,
        data: &[u8],
    ) -> Result<(), String> {
        use std::time::{SystemTime, UNIX_EPOCH};
        let updated_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs()
            .to_string();
        
        sqlx::query(
            r#"
            INSERT INTO epub_data (source_path, book_id, data, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(source_path) DO UPDATE SET
                book_id = excluded.book_id,
                data = excluded.data,
                updated_at = excluded.updated_at
            "#
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
    
    /// Get EPUB data by source_path
    pub async fn find_by_source_path(
        pool: &SqlitePool,
        source_path: &str,
    ) -> Result<Option<Vec<u8>>, String> {
        let row = sqlx::query("SELECT data FROM epub_data WHERE source_path = ?")
            .bind(source_path)
            .fetch_optional(pool)
            .await
            .map_err(|e| format!("Failed to query EPUB data: {}", e))?;
        
        if let Some(row) = row {
            Ok(Some(row.get("data")))
        } else {
            Ok(None)
        }
    }
    
    /// Get EPUB data by book_id
    pub async fn find_by_book_id(
        pool: &SqlitePool,
        book_id: &str,
    ) -> Result<Option<Vec<u8>>, String> {
        let row = sqlx::query("SELECT data FROM epub_data WHERE book_id = ?")
            .bind(book_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| format!("Failed to query EPUB data: {}", e))?;
        
        if let Some(row) = row {
            Ok(Some(row.get("data")))
        } else {
            Ok(None)
        }
    }
    
    /// Delete EPUB data by source_path
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
    
    /// Delete EPUB data by book_id
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
