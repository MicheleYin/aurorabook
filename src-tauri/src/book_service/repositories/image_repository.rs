use sqlx::{SqlitePool, Executor, Row};
use sha2::{Sha256, Digest};

pub struct ImageRepository;

impl ImageRepository {
    /// Generate image ID from book_id and href
    fn generate_id(book_id: &str, href: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(book_id.as_bytes());
        hasher.update(href.as_bytes());
        format!("{:x}", hasher.finalize())
    }
    
    /// Save image
    pub async fn save<'e, E: Executor<'e, Database = sqlx::Sqlite>>(
        executor: E,
        book_id: &str,
        href: &str,
        mime_type: &str,
        data: &[u8],
    ) -> Result<(), String> {
        let id = Self::generate_id(book_id, href);
        sqlx::query(
            r#"
            INSERT INTO images (id, book_id, href, mime_type, data)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                mime_type = excluded.mime_type,
                data = excluded.data
            "#
        )
        .bind(&id)
        .bind(book_id)
        .bind(href)
        .bind(mime_type)
        .bind(data)
        .execute(executor)
        .await
        .map_err(|e| format!("Failed to save image: {}", e))?;
        
        Ok(())
    }
    
    /// Get image
    pub async fn find_by_href(pool: &SqlitePool, book_id: &str, href: &str) -> Result<Option<(String, Vec<u8>)>, String> {
        let row = sqlx::query("SELECT mime_type, data FROM images WHERE book_id = ? AND href = ?")
            .bind(book_id)
            .bind(href)
            .fetch_optional(pool)
            .await
            .map_err(|e| format!("Failed to query image: {}", e))?;
        
        if let Some(row) = row {
            let mime_type: String = row.get("mime_type");
            let data: Vec<u8> = row.get("data");
            Ok(Some((mime_type, data)))
        } else {
            Ok(None)
        }
    }
    
    /// Delete all images for a book
    pub async fn delete_by_book_id<'e, E: Executor<'e, Database = sqlx::Sqlite>>(
        executor: E,
        book_id: &str,
    ) -> Result<(), String> {
        sqlx::query("DELETE FROM images WHERE book_id = ?")
            .bind(book_id)
            .execute(executor)
            .await
            .map_err(|e| format!("Failed to delete images: {}", e))?;
        
        Ok(())
    }
}
