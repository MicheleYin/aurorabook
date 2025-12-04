use crate::book_service::models::Book;
use tauri::AppHandle;
use sqlx::sqlite::{SqlitePool, SqliteConnectOptions};
use sqlx::Row;
use std::str::FromStr;

/// Get database connection pool
/// Stores database in Application Support directory for persistent storage
/// Uses app_data_dir() which maps to Application Support on macOS
async fn get_db_pool(app: &AppHandle) -> Result<SqlitePool, String> {
    use tauri::Manager;
    
    // Get the app data directory (Application Support on macOS)
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;
    
    // Ensure the directory exists
    std::fs::create_dir_all(&app_data_dir)
        .map_err(|e| format!("Failed to create app data directory: {}", e))?;
    
    // Construct the database path
    let db_path = app_data_dir.join("library.db");
    
    // Convert path to string
    let db_path_str = db_path
        .to_str()
        .ok_or_else(|| "Database path contains invalid UTF-8".to_string())?;
    
    log::debug!("Connecting to database at: {:?}", db_path);
    
    // Verify the directory is writable before attempting connection
    if let Some(parent) = db_path.parent() {
        // Try to create a test file to verify write permissions
        let test_file = parent.join(".db_test_write");
        if let Err(e) = std::fs::File::create(&test_file) {
            log::warn!("Warning: Cannot write to database directory {:?}: {}", parent, e);
        } else {
            let _ = std::fs::remove_file(&test_file);
        }
    }
    
    // Use SqliteConnectOptions for reliable connection, especially with paths containing spaces
    // This is the recommended approach for sqlx with SQLite
    let connect_options = SqliteConnectOptions::from_str(db_path_str)
        .map_err(|e| format!("Failed to parse database path {:?}: {}", db_path, e))?
        .create_if_missing(true);
    
    let pool = SqlitePool::connect_with(connect_options)
        .await
        .map_err(|e| format!("Failed to connect to database at {:?}: {}", db_path, e))?;
    
    // Initialize schema if tables don't exist
    init_database_schema(&pool).await?;
    
    Ok(pool)
}

/// Initialize database schema - creates tables if they don't exist
async fn init_database_schema(pool: &SqlitePool) -> Result<(), String> {
    // Create books table
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS books (
            id TEXT PRIMARY KEY,
            data TEXT NOT NULL
        )
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to create books table: {}", e))?;
    
    // Create epub_cache table
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS epub_cache (
            source_path TEXT PRIMARY KEY,
            data BLOB NOT NULL
        )
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to create epub_cache table: {}", e))?;
    
    Ok(())
}

/// Load all books from storage
pub async fn load_all_books(app: &AppHandle) -> Result<Vec<Book>, String> {
    let pool = get_db_pool(app).await?;
    
    let rows = sqlx::query("SELECT data FROM books")
        .fetch_all(&pool)
        .await
        .map_err(|e| format!("Failed to query books: {}", e))?;
    
    let mut books = Vec::new();
    for row in rows {
        let data: String = row.get(0);
        match serde_json::from_str::<Book>(&data) {
            Ok(book) => books.push(book),
            Err(e) => {
                log::warn!("Failed to deserialize book: {}", e);
                continue;
            }
        }
    }
    
    Ok(books)
}
/// Add or update a single book in storage
pub async fn add_book(app: &AppHandle, book: &Book) -> Result<(), String> {
    let pool = get_db_pool(app).await?;
    let data = serde_json::to_string(book)
        .map_err(|e| format!("Failed to serialize book: {}", e))?;
    
    sqlx::query("INSERT OR REPLACE INTO books (id, data) VALUES (?1, ?2)")
        .bind(&book.id)
        .bind(&data)
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to insert/update book: {}", e))?;

    Ok(())
}

/// Get a single book by ID from storage
pub async fn get_book(app: &AppHandle, book_id: &str) -> Result<Option<Book>, String> {
    let pool = get_db_pool(app).await?;
    
    let row = sqlx::query("SELECT data FROM books WHERE id = ?1")
        .bind(book_id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| format!("Failed to query book: {}", e))?;
    
    if let Some(row) = row {
        let data: String = row.get(0);
        match serde_json::from_str::<Book>(&data) {
            Ok(book) => Ok(Some(book)),
            Err(e) => {
                log::warn!("Failed to deserialize book: {}", e);
                Ok(None)
            }
        }
    } else {
        Ok(None)
    }
}

/// Get a single book by content_hash from storage
pub async fn get_book_by_hash(app: &AppHandle, content_hash: &str) -> Result<Option<Book>, String> {
    let pool = get_db_pool(app).await?;
    
    // We need to deserialize all books to find by content_hash
    // This is less efficient but necessary since content_hash is in JSON
    // TODO: Consider adding a content_hash index column for better performance
    let rows = sqlx::query("SELECT data FROM books")
        .fetch_all(&pool)
        .await
        .map_err(|e| format!("Failed to query books: {}", e))?;
    
    for row in rows {
        let data: String = row.get(0);
        if let Ok(book) = serde_json::from_str::<Book>(&data) {
            if let Some(ref hash) = book.content_hash {
                if hash == content_hash {
                    return Ok(Some(book));
                }
            }
        }
    }
    
    Ok(None)
}

/// Get a single book by source_path from storage
pub async fn get_book_by_source_path(app: &AppHandle, source_path: &str) -> Result<Option<Book>, String> {
    let pool = get_db_pool(app).await?;
    
    // We need to deserialize all books to find by source_path
    // This is less efficient but necessary since source_path is in JSON
    // TODO: Consider adding a source_path index column for better performance
    let rows = sqlx::query("SELECT data FROM books")
        .fetch_all(&pool)
        .await
        .map_err(|e| format!("Failed to query books: {}", e))?;
    
    for row in rows {
        let data: String = row.get(0);
        if let Ok(book) = serde_json::from_str::<Book>(&data) {
            if book.source_path == source_path {
                return Ok(Some(book));
            }
        }
    }
    
    Ok(None)
}

/// Delete a single book by ID from storage
pub async fn delete_book(app: &AppHandle, book_id: &str) -> Result<(), String> {
    let pool = get_db_pool(app).await?;
    sqlx::query("DELETE FROM books WHERE id = ?1")
        .bind(book_id)
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to delete book: {}", e))?;
    
    Ok(())
}

/// Save all books to storage
pub async fn save_all_books(app: &AppHandle, books: &[Book]) -> Result<(), String> {
    let pool = get_db_pool(app).await?;
    
    // Start a transaction
    let mut tx = pool.begin()
        .await
        .map_err(|e| format!("Failed to begin transaction: {}", e))?;
    
    // Clear existing books
    sqlx::query("DELETE FROM books")
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Failed to delete existing books: {}", e))?;
    
    // Insert all books
    for book in books {
        let data = serde_json::to_string(book)
            .map_err(|e| format!("Failed to serialize book: {}", e))?;
        sqlx::query("INSERT INTO books (id, data) VALUES (?1, ?2)")
            .bind(&book.id)
            .bind(&data)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Failed to insert book: {}", e))?;
    }
    
    tx.commit()
        .await
        .map_err(|e| format!("Failed to commit transaction: {}", e))?;
    
    Ok(())
}

/// Get EPUB buffer from store
pub async fn get_epub_buffer_from_store(app: &AppHandle, source_path: &str) -> Result<Option<Vec<u8>>, String> {
    let pool = get_db_pool(app).await?;
    
    let row = sqlx::query("SELECT data FROM epub_cache WHERE source_path = ?1")
        .bind(source_path)
        .fetch_optional(&pool)
        .await
        .map_err(|e| format!("Failed to query EPUB cache: {}", e))?;
    
    if let Some(row) = row {
        let data: Vec<u8> = row.get(0);
        Ok(Some(data))
    } else {
        Ok(None)
    }
}

/// Save EPUB buffer to store
pub async fn save_epub_buffer_to_store(app: &AppHandle, source_path: &str, epub_data: &[u8]) -> Result<(), String> {
    let pool = get_db_pool(app).await?;
    
    sqlx::query("INSERT OR REPLACE INTO epub_cache (source_path, data) VALUES (?1, ?2)")
        .bind(source_path)
        .bind(epub_data)
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to save EPUB buffer: {}", e))?;
    
    Ok(())
}

/// Delete EPUB from store
pub async fn delete_epub_from_store(app: &AppHandle, source_path: &str) -> Result<(), String> {
    let pool = get_db_pool(app).await?;
    
    sqlx::query("DELETE FROM epub_cache WHERE source_path = ?1")
        .bind(source_path)
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to delete EPUB: {}", e))?;
    
    Ok(())
}
