use sqlx::{SqlitePool, sqlite::SqlitePoolOptions};
use tauri::AppHandle;
use std::sync::Arc;
use tokio::sync::OnceCell;

/// Global database connection pool (initialized once)
static DB_POOL: OnceCell<Arc<SqlitePool>> = OnceCell::const_new();

/// Initialize database connection and store it globally
/// This should be called once during app setup
pub async fn init_db_connection(app: &AppHandle) -> Result<(), String> {
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
    
    log::info!("Initializing database connection at: {:?}", db_path);
    
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
    
    // Create SQLite connection string for SQLx
    let db_url = format!("sqlite:{}", db_path_str);
    
    // Create connection pool with minimal connections for memory efficiency
    let pool = SqlitePoolOptions::new()
        .max_connections(1) // Single connection for maximum memory efficiency
        .connect(&db_url)
        .await
        .map_err(|e| format!("Failed to connect to database at {:?}: {}", db_path, e))?;
    
    // Initialize schema
    init_database_schema(&pool).await?;
    
    // Store pool globally (wrap in Arc)
    let pool_arc = Arc::new(pool);
    DB_POOL
        .set(pool_arc.clone())
        .map_err(|_| "Database connection already initialized".to_string())?;
    
    log::info!("Database connection initialized successfully");
    
    Ok(())
}

/// Get database connection pool from global state
/// Returns a reference to the shared connection pool
/// The pool is initialized once and reused across all calls
pub async fn get_db_connection(_app: &AppHandle) -> Result<Arc<SqlitePool>, String> {
    // Get the pool from the global state
    let pool_arc = DB_POOL
        .get()
        .ok_or_else(|| "Database connection not initialized. Call init_db_connection first.".to_string())?;
    
    // Return the Arc directly to ensure all code uses the same shared connection pool
    Ok(pool_arc.clone())
}

/// Initialize database schema - creates tables if they don't exist
async fn init_database_schema(pool: &SqlitePool) -> Result<(), String> {
    // Create books table
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS books (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            author TEXT NOT NULL,
            source_path TEXT NOT NULL,
            cover_url TEXT,
            publisher TEXT,
            published_year TEXT,
            subjects TEXT,
            file_size_bytes INTEGER,
            progress_current_chapter_id TEXT,
            progress_current_chapter_href TEXT,
            progress_current_chapter_index INTEGER,
            progress_current_chapter_element_id TEXT,
            progress_current_chapter_element_index INTEGER,
            progress_current_chapter_scroll_top REAL,
            progress_current_chapter_scroll_height REAL,
            progress_current_chapter_client_height REAL,
            progress_chapter_progress_percent REAL,
            progress_book_progress_percent REAL,
            progress_updated_at TEXT,
            audio_state_current_track_id TEXT,
            audio_state_current_track_href TEXT,
            audio_state_current_track_index INTEGER,
            audio_state_current_time_seconds REAL,
            audio_state_updated_at TEXT,
            audio_sync_map TEXT,
            page_count INTEGER,
            conversion_status TEXT NOT NULL DEFAULT 'NotStarted',
            completed_chapters TEXT,
            voice_id TEXT,
            total_words INTEGER,
            words_processed INTEGER,
            last_opened_time TEXT
        )
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to create books table: {}", e))?;
    
    // Migration: Remove unique constraint on source_path if it exists
    // SQLite implements UNIQUE constraints as unique indexes
    // We need to find and drop any unique indexes on books.source_path
    use sqlx::Row;
    
    // First, get the CREATE TABLE statement to check if source_path has UNIQUE in the definition
    let table_sql_result = sqlx::query(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='books'"
    )
    .fetch_optional(pool)
    .await;
    
    let has_unique_in_table = if let Ok(Some(row)) = table_sql_result {
        if let Ok(Some(sql)) = row.try_get::<Option<String>, _>("sql") {
            // Check if source_path has UNIQUE constraint in table definition
            sql.contains("source_path") && (sql.contains("UNIQUE") || sql.contains("unique"))
        } else {
            false
        }
    } else {
        false
    };
    
    // Find all indexes on the books table
    let indexes_result = sqlx::query(
        r#"
        SELECT name, sql FROM sqlite_master 
        WHERE type='index' 
        AND tbl_name='books'
        "#
    )
    .fetch_all(pool)
    .await;
    
    if let Ok(rows) = indexes_result {
        for row in rows {
            let index_name: String = row.get("name");
            
            // Skip primary key autoindex
            if index_name == "sqlite_autoindex_books_1" {
                continue;
            }
            
            let sql: Option<String> = row.get("sql");
            let should_drop = if let Some(ref sql_str) = sql {
                // Explicit unique index on source_path
                (sql_str.contains("UNIQUE") || sql_str.contains("unique")) 
                && sql_str.contains("source_path")
            } else if index_name.starts_with("sqlite_autoindex_books_") {
                // Autoindex - if table has UNIQUE on source_path, this might be it
                // We'll try dropping non-primary-key autoindexes if table has unique constraint
                has_unique_in_table
            } else {
                false
            };
            
            if should_drop {
                let drop_sql = format!("DROP INDEX IF EXISTS {}", index_name);
                match sqlx::query(&drop_sql).execute(pool).await {
                    Ok(_) => log::info!("Dropped unique index on source_path: {}", index_name),
                    Err(e) => log::warn!("Failed to drop unique index {}: {}", index_name, e),
                }
            }
        }
    }
    
    // If the unique constraint was in the table definition itself, try to drop autoindexes
    // SQLite creates autoindexes for UNIQUE constraints in table definitions
    if has_unique_in_table {
        log::info!("Found UNIQUE constraint on source_path in table definition. Attempting to drop associated autoindexes...");
        // Try to drop all autoindexes except the primary key one
        // SQLite autoindexes for UNIQUE constraints can be dropped, which removes the constraint
        let autoindexes = sqlx::query(
            "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='books' AND name LIKE 'sqlite_autoindex_books_%'"
        )
        .fetch_all(pool)
        .await;
        
        if let Ok(rows) = autoindexes {
            for row in rows {
                let autoindex_name: String = row.get("name");
                // Skip the primary key autoindex (usually _1)
                if autoindex_name != "sqlite_autoindex_books_1" {
                    let drop_sql = format!("DROP INDEX IF EXISTS {}", autoindex_name);
                    match sqlx::query(&drop_sql).execute(pool).await {
                        Ok(_) => log::info!("Dropped autoindex {} (removed unique constraint on source_path)", autoindex_name),
                        Err(e) => log::warn!("Failed to drop autoindex {}: {}", autoindex_name, e),
                    }
                }
            }
        }
    }
    
    // Create chapters table
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS chapters (
            id TEXT PRIMARY KEY,
            book_id TEXT NOT NULL,
            title TEXT NOT NULL,
            href TEXT NOT NULL,
            content_html TEXT,
            plain_text TEXT,
            chapter_order INTEGER NOT NULL,
            word_count INTEGER,
            estimated_page_count INTEGER,
            FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
            UNIQUE(book_id, href)
        )
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to create chapters table: {}", e))?;
    
    // Create images table
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS images (
            id TEXT PRIMARY KEY,
            book_id TEXT NOT NULL,
            href TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            data BLOB NOT NULL,
            FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
            UNIQUE(book_id, href)
        )
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to create images table: {}", e))?;
    
    // Create audio_tracks table
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS audio_tracks (
            id TEXT PRIMARY KEY,
            book_id TEXT NOT NULL,
            title TEXT NOT NULL,
            href TEXT NOT NULL,
            url TEXT,
            duration REAL,
            track_order INTEGER NOT NULL,
            data BLOB,
            FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
            UNIQUE(book_id, href)
        )
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to create audio_tracks table: {}", e))?;
    
    // Create epub_data table
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS epub_data (
            source_path TEXT PRIMARY KEY,
            book_id TEXT NOT NULL,
            data BLOB NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
        )
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to create epub_data table: {}", e))?;
    
    // Create app_settings table (singleton - only one row)
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS app_settings (
            id TEXT PRIMARY KEY DEFAULT 'default',
            theme TEXT NOT NULL DEFAULT 'system',
            tts_voice_id TEXT NOT NULL,
            auto_scroll_enabled INTEGER NOT NULL DEFAULT 1,
            audio_playback_speed REAL NOT NULL DEFAULT 1.0,
            updated_at TEXT NOT NULL
        )
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to create app_settings table: {}", e))?;
    
    // Create reader_preferences table (singleton - only one row)
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS reader_preferences (
            id TEXT PRIMARY KEY DEFAULT 'default',
            theme TEXT NOT NULL DEFAULT 'system',
            font_family TEXT NOT NULL DEFAULT 'merriweather',
            content_padding TEXT NOT NULL DEFAULT 'comfortable',
            font_size TEXT NOT NULL DEFAULT 'medium',
            updated_at TEXT NOT NULL
        )
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to create reader_preferences table: {}", e))?;
    
    // Create indexes for common query patterns
    // Indexes improve query performance and reduce memory usage by enabling efficient lookups
    let indexes = vec![
        // Chapters indexes (for book lookups and href lookups)
        "CREATE INDEX IF NOT EXISTS idx_chapters_book_id ON chapters(book_id)",
        "CREATE INDEX IF NOT EXISTS idx_chapters_book_id_href ON chapters(book_id, href)",
        "CREATE INDEX IF NOT EXISTS idx_chapters_book_id_order ON chapters(book_id, chapter_order)",
        // Images indexes (for book lookups and href lookups)
        "CREATE INDEX IF NOT EXISTS idx_images_book_id ON images(book_id)",
        "CREATE INDEX IF NOT EXISTS idx_images_book_id_href ON images(book_id, href)",
        // Audio tracks indexes (for book lookups, href lookups, and ordering)
        "CREATE INDEX IF NOT EXISTS idx_audio_tracks_book_id ON audio_tracks(book_id)",
        "CREATE INDEX IF NOT EXISTS idx_audio_tracks_book_id_href ON audio_tracks(book_id, href)",
        "CREATE INDEX IF NOT EXISTS idx_audio_tracks_book_id_order ON audio_tracks(book_id, track_order)",
        // Books indexes (for source_path lookups and sorting)
        "CREATE INDEX IF NOT EXISTS idx_books_source_path ON books(source_path)",
        "CREATE INDEX IF NOT EXISTS idx_books_last_opened ON books(last_opened_time)",
        "CREATE INDEX IF NOT EXISTS idx_books_conversion_status ON books(conversion_status)",
        // EPUB data indexes
        "CREATE INDEX IF NOT EXISTS idx_epub_data_book_id ON epub_data(book_id)",
    ];
    
    for index_sql in indexes {
        if let Err(e) = sqlx::query(index_sql).execute(pool).await {
            log::warn!("Failed to create index: {}", e);
        }
    }
    
    // Enable WAL mode for better concurrency and performance
    sqlx::query("PRAGMA journal_mode=WAL")
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to enable WAL mode: {}", e))?;
    
    // Set synchronous mode to NORMAL (faster than FULL, still safe with WAL)
    sqlx::query("PRAGMA synchronous=NORMAL")
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to set synchronous mode: {}", e))?;
    
    // Optimize cache size for memory efficiency (negative = KB, positive = pages)
    // -2000KB = 2MB cache (reasonable for desktop apps, reduces memory usage)
    sqlx::query("PRAGMA cache_size=-2000")
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to set cache size: {}", e))?;
    
    // Set page size to 4KB (default, but explicit for clarity)
    // Smaller page size = less memory per page, better for smaller queries
    sqlx::query("PRAGMA page_size=4096")
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to set page size: {}", e))?;
    
    // Optimize temp store to use memory efficiently
    // 2 = use memory-mapped temp files (reduces memory pressure)
    sqlx::query("PRAGMA temp_store=2")
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to set temp store: {}", e))?;
    
    // Enable mmap for large database files (reduces memory usage)
    // 268435456 = 256MB (SQLite will use mmap for files larger than this)
    sqlx::query("PRAGMA mmap_size=268435456")
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to set mmap size: {}", e))?;
    
    // Enable query planner optimizations
    sqlx::query("PRAGMA optimize")
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to optimize database: {}", e))?;
    
    // Enable foreign key constraints (should be on by default, but explicit is better)
    sqlx::query("PRAGMA foreign_keys=ON")
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to enable foreign keys: {}", e))?;
    
    log::info!("Database schema initialized with optimizations (WAL mode, indexes, memory-efficient PRAGMA settings)");
    
    Ok(())
}

