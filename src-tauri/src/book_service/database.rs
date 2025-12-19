use sea_orm::{Database, DatabaseConnection};
use tauri::AppHandle;
use std::sync::Arc;
use tokio::sync::OnceCell;
use crate::book_service::cache::DbCache;

/// Global database connection (initialized once)
static DB_CONNECTION: OnceCell<Arc<DatabaseConnection>> = OnceCell::const_new();

/// Global database cache (initialized once)
static DB_CACHE: OnceCell<Arc<DbCache>> = OnceCell::const_new();

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
    
    // Create SQLite connection string
    let db_url = format!("sqlite://{}?mode=rwc", db_path_str);
    
    // Connect to database (this creates a connection pool)
    let db = Database::connect(&db_url)
        .await
        .map_err(|e| format!("Failed to connect to database at {:?}: {}", db_path, e))?;
    
    // Initialize schema
    init_database_schema(&db).await?;
    
    // Store connection globally
    DB_CONNECTION
        .set(Arc::new(db))
        .map_err(|_| "Database connection already initialized".to_string())?;
    
    // Initialize cache
    DB_CACHE
        .set(Arc::new(DbCache::new()))
        .map_err(|_| "Database cache already initialized".to_string())?;
    
    log::info!("Database connection and cache initialized successfully");
    
    Ok(())
}

/// Get database connection from global state
/// Returns a reference to the shared connection pool
/// The connection is initialized once and reused across all calls
/// This ensures all database operations use the same shared session
pub async fn get_db_connection(_app: &AppHandle) -> Result<Arc<DatabaseConnection>, String> {
    // Get the connection from the global state
    // Return Arc directly to ensure explicit sharing of the same connection pool
    let db_arc = DB_CONNECTION
        .get()
        .ok_or_else(|| "Database connection not initialized. Call init_db_connection first.".to_string())?;
    
    // Return the Arc directly to ensure all code uses the same shared connection pool
    Ok(db_arc.clone())
}

/// Get database cache from global state
/// Returns a reference to the shared cache
pub fn get_db_cache() -> Result<Arc<DbCache>, String> {
    DB_CACHE
        .get()
        .ok_or_else(|| "Database cache not initialized. Call init_db_connection first.".to_string())
        .map(|cache| cache.clone())
}

/// Initialize database schema - creates tables if they don't exist
async fn init_database_schema(db: &DatabaseConnection) -> Result<(), String> {
    use sea_orm::{Statement, ConnectionTrait};
    
    // Create books table
    let stmt = Statement::from_string(
        sea_orm::DatabaseBackend::Sqlite,
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
        "#.to_string(),
    );
    db.execute_unprepared(&stmt.to_string()).await
        .map_err(|e| format!("Failed to create books table: {}", e))?;
    
    // Create chapters table
    let stmt = Statement::from_string(
        sea_orm::DatabaseBackend::Sqlite,
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
        "#.to_string(),
    );
    db.execute_unprepared(&stmt.to_string()).await
        .map_err(|e| format!("Failed to create chapters table: {}", e))?;
    
    // Create images table
    let stmt = Statement::from_string(
        sea_orm::DatabaseBackend::Sqlite,
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
        "#.to_string(),
    );
    db.execute_unprepared(&stmt.to_string()).await
        .map_err(|e| format!("Failed to create images table: {}", e))?;
    
    // Create audio_tracks table
    let stmt = Statement::from_string(
        sea_orm::DatabaseBackend::Sqlite,
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
        "#.to_string(),
    );
    db.execute_unprepared(&stmt.to_string()).await
        .map_err(|e| format!("Failed to create audio_tracks table: {}", e))?;
    
    // Create epub_data table
    let stmt = Statement::from_string(
        sea_orm::DatabaseBackend::Sqlite,
        r#"
        CREATE TABLE IF NOT EXISTS epub_data (
            source_path TEXT PRIMARY KEY,
            book_id TEXT NOT NULL,
            data BLOB NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
        )
        "#.to_string(),
    );
    db.execute_unprepared(&stmt.to_string()).await
        .map_err(|e| format!("Failed to create epub_data table: {}", e))?;
    
    // Create app_settings table (singleton - only one row)
    let stmt = Statement::from_string(
        sea_orm::DatabaseBackend::Sqlite,
        r#"
        CREATE TABLE IF NOT EXISTS app_settings (
            id TEXT PRIMARY KEY DEFAULT 'default',
            theme TEXT NOT NULL DEFAULT 'system',
            tts_voice_id TEXT NOT NULL,
            auto_scroll_enabled INTEGER NOT NULL DEFAULT 1,
            audio_playback_speed REAL NOT NULL DEFAULT 1.0,
            updated_at TEXT NOT NULL
        )
        "#.to_string(),
    );
    db.execute_unprepared(&stmt.to_string()).await
        .map_err(|e| format!("Failed to create app_settings table: {}", e))?;
    
    // Create reader_preferences table (singleton - only one row)
    let stmt = Statement::from_string(
        sea_orm::DatabaseBackend::Sqlite,
        r#"
        CREATE TABLE IF NOT EXISTS reader_preferences (
            id TEXT PRIMARY KEY DEFAULT 'default',
            theme TEXT NOT NULL DEFAULT 'system',
            font_family TEXT NOT NULL DEFAULT 'merriweather',
            content_padding TEXT NOT NULL DEFAULT 'comfortable',
            font_size TEXT NOT NULL DEFAULT 'medium',
            updated_at TEXT NOT NULL
        )
        "#.to_string(),
    );
    db.execute_unprepared(&stmt.to_string()).await
        .map_err(|e| format!("Failed to create reader_preferences table: {}", e))?;
    
    // Create indexes
    let indexes = vec![
        "CREATE INDEX IF NOT EXISTS idx_chapters_book_id ON chapters(book_id)",
        "CREATE INDEX IF NOT EXISTS idx_chapters_book_id_href ON chapters(book_id, href)",
        "CREATE INDEX IF NOT EXISTS idx_images_book_id ON images(book_id)",
        "CREATE INDEX IF NOT EXISTS idx_images_book_id_href ON images(book_id, href)",
        "CREATE INDEX IF NOT EXISTS idx_audio_tracks_book_id ON audio_tracks(book_id)",
        "CREATE INDEX IF NOT EXISTS idx_audio_tracks_book_id_href ON audio_tracks(book_id, href)",
        "CREATE INDEX IF NOT EXISTS idx_books_source_path ON books(source_path)",
        "CREATE INDEX IF NOT EXISTS idx_epub_data_book_id ON epub_data(book_id)",
    ];
    
    for index_sql in indexes {
        let stmt = Statement::from_string(sea_orm::DatabaseBackend::Sqlite, index_sql.to_string());
        if let Err(e) = db.execute_unprepared(&stmt.to_string()).await {
            log::warn!("Failed to create index: {}", e);
        }
    }
    
    // Enable WAL mode for better concurrency and performance
    db.execute_unprepared("PRAGMA journal_mode=WAL").await
        .map_err(|e| format!("Failed to enable WAL mode: {}", e))?;
    
    // Set synchronous mode to NORMAL (faster than FULL, still safe with WAL)
    db.execute_unprepared("PRAGMA synchronous=NORMAL").await
        .map_err(|e| format!("Failed to set synchronous mode: {}", e))?;
    
    // Set cache size to 64MB (negative value means KB, so -64000 = 64MB)
    db.execute_unprepared("PRAGMA cache_size=-64000").await
        .map_err(|e| format!("Failed to set cache size: {}", e))?;
    
    // Enable foreign key constraints (should be on by default, but explicit is better)
    db.execute_unprepared("PRAGMA foreign_keys=ON").await
        .map_err(|e| format!("Failed to enable foreign keys: {}", e))?;
    
    log::info!("Database schema initialized with optimizations (WAL mode, indexes)");
    
    Ok(())
}

