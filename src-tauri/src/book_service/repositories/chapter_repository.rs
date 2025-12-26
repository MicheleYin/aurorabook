use sqlx::{SqlitePool, Executor, Row};
use sqlx::sqlite::SqliteRow;
use crate::book_service::models::Chapter;

pub struct ChapterRepository;

impl ChapterRepository {
    /// Convert database row to domain model (assumes all columns including content_html/plain_text are present)
    /// For queries that exclude content_html/plain_text, use inline conversion instead
    pub fn row_to_model(row: SqliteRow) -> Result<Chapter, String> {
        // Get content_html and plain_text - these should be present when using SELECT *
        // Use get() directly since we know the columns exist in the query
        let content_html: Option<String> = row.get("content_html");
        let plain_text: Option<String> = row.get("plain_text");
        
        Ok(Chapter {
            id: row.get("id"),
            title: row.get("title"),
            href: row.get("href"),
            content_html,
            plain_text,
            order: row.get::<i64, _>("chapter_order") as usize,
            word_count: row.get::<Option<i64>, _>("word_count").map(|v| v as usize),
            estimated_page_count: row.get::<Option<i64>, _>("estimated_page_count").map(|v| v as usize),
        })
    }
    
    /// Find all chapters for a book WITH content_html (for conversion)
    pub async fn find_by_book_id_with_content(pool: &SqlitePool, book_id: &str) -> Result<Vec<Chapter>, String> {
        let rows = sqlx::query("SELECT * FROM chapters WHERE book_id = ? ORDER BY chapter_order")
            .bind(book_id)
            .fetch_all(pool)
            .await
            .map_err(|e| format!("Failed to query chapters with content: {}", e))?;
        
        let chapters: Result<Vec<Chapter>, _> = rows.into_iter().map(Self::row_to_model).collect();
        chapters.map_err(|e| format!("Failed to convert chapters: {}", e))
    }
    
    /// Find all chapters for a book (EXCLUDE content_html and plain_text for memory efficiency)
    pub async fn find_by_book_id(pool: &SqlitePool, book_id: &str) -> Result<Vec<Chapter>, String> {
        let rows = sqlx::query(
            "SELECT id, book_id, title, href, chapter_order, word_count, estimated_page_count 
             FROM chapters 
             WHERE book_id = ? 
             ORDER BY chapter_order"
        )
        .bind(book_id)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to query chapters: {}", e))?;
        
        use sqlx::Row;
        
        let chapters: Vec<Chapter> = rows.into_iter().map(|row| {
            Chapter {
                id: row.get("id"),
                title: row.get("title"),
                href: row.get("href"),
                content_html: None, // Excluded for performance
                plain_text: None,   // Excluded for performance
                order: row.get::<i64, _>("chapter_order") as usize,
                word_count: row.get::<Option<i64>, _>("word_count").map(|v| v as usize),
                estimated_page_count: row.get::<Option<i64>, _>("estimated_page_count").map(|v| v as usize),
            }
        }).collect();
        
        Ok(chapters)
    }
    
    /// Find chapter by book ID and href
    pub async fn find_by_href(pool: &SqlitePool, book_id: &str, href: &str) -> Result<Option<Chapter>, String> {
        let row = sqlx::query("SELECT * FROM chapters WHERE book_id = ? AND href = ?")
            .bind(book_id)
            .bind(href)
            .fetch_optional(pool)
            .await
            .map_err(|e| format!("Failed to query chapter: {}", e))?;
        
        if let Some(row) = row {
            Ok(Some(Self::row_to_model(row)
                .map_err(|e| format!("Failed to convert chapter: {}", e))?))
        } else {
            Ok(None)
        }
    }
    
    /// Save chapter
    pub async fn save<'e, E: Executor<'e, Database = sqlx::Sqlite>>(
        executor: E,
        book_id: &str,
        model: &Chapter,
    ) -> Result<(), String> {
        sqlx::query(
            r#"
            INSERT INTO chapters (id, book_id, title, href, content_html, plain_text, chapter_order, word_count, estimated_page_count)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                href = excluded.href,
                content_html = excluded.content_html,
                plain_text = excluded.plain_text,
                chapter_order = excluded.chapter_order,
                word_count = excluded.word_count,
                estimated_page_count = excluded.estimated_page_count
            "#
        )
        .bind(&model.id)
        .bind(book_id)
        .bind(&model.title)
        .bind(&model.href)
        .bind(&model.content_html)
        .bind(&model.plain_text)
        .bind(model.order as i64)
        .bind(model.word_count.map(|v| v as i64))
        .bind(model.estimated_page_count.map(|v| v as i64))
        .execute(executor)
        .await
        .map_err(|e| format!("Failed to save chapter: {}", e))?;
        
        Ok(())
    }
    
    /// Load only content_html and plain_text for a chapter (lazy loading)
    pub async fn load_content_only(
        pool: &SqlitePool,
        book_id: &str,
        chapter_id: &str,
    ) -> Result<Option<(Option<String>, Option<String>)>, String> {
        let row = sqlx::query("SELECT content_html, plain_text FROM chapters WHERE book_id = ? AND id = ?")
            .bind(book_id)
            .bind(chapter_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| format!("Failed to query chapter content: {}", e))?;
        
        use sqlx::Row;
        
        if let Some(row) = row {
            Ok(Some((
                row.get("content_html"),
                row.get("plain_text"),
            )))
        } else {
            Ok(None)
        }
    }
    
    /// Update chapter content
    pub async fn update_content(
        pool: &SqlitePool,
        book_id: &str,
        chapter_id: &str,
        content_html: &str,
        plain_text: Option<&str>,
    ) -> Result<(), String> {
        sqlx::query("UPDATE chapters SET content_html = ?, plain_text = ? WHERE book_id = ? AND id = ?")
            .bind(content_html)
            .bind(plain_text)
            .bind(book_id)
            .bind(chapter_id)
            .execute(pool)
            .await
            .map_err(|e| format!("Failed to update chapter content: {}", e))?;
        
        Ok(())
    }
    
    /// Delete all chapters for a book
    pub async fn delete_by_book_id<'e, E: Executor<'e, Database = sqlx::Sqlite>>(
        executor: E,
        book_id: &str,
    ) -> Result<(), String> {
        sqlx::query("DELETE FROM chapters WHERE book_id = ?")
            .bind(book_id)
            .execute(executor)
            .await
            .map_err(|e| format!("Failed to delete chapters: {}", e))?;
        
        Ok(())
    }
}
