use sqlx::{SqlitePool, sqlite::{SqlitePoolOptions, SqliteConnectOptions}};
use std::str::FromStr;
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
    
    // Use SqliteConnectOptions to properly handle paths with spaces and special characters
    // This is the recommended approach for SQLx as it handles path encoding correctly
    let connect_options = SqliteConnectOptions::from_str(db_path_str)
        .map_err(|e| {
            format!(
                "Failed to create SQLite connection options from path {:?}: {}. \
                Check that the path is valid.",
                db_path, e
            )
        })?
        .create_if_missing(true); // Create database file if it doesn't exist
    
    log::info!("Database connection options created for path: {:?}", db_path);
    
    // Create connection pool — allow a few concurrent acquires under conversion
    // + progress saves + live stream (WAL already enabled). Keep small on iOS.
    let max_connections = if cfg!(target_os = "ios") { 3 } else { 5 };
    let pool = SqlitePoolOptions::new()
        .max_connections(max_connections)
        .acquire_timeout(std::time::Duration::from_secs(30))
        .connect_with(connect_options)
        .await
        .map_err(|e| {
            format!(
                "Failed to connect to database at {:?}: {}. \
                Ensure the directory exists and is writable.",
                db_path, e
            )
        })?;
    
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


/// Migrate legacy epub_data (BLOB NOT NULL, no file_path) to nullable BLOB + file_path.
async fn migrate_epub_data_schema(pool: &SqlitePool) -> Result<(), String> {
    use sqlx::Row;
    let row = sqlx::query("SELECT sql FROM sqlite_master WHERE type='table' AND name='epub_data'")
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("Failed to read epub_data schema: {}", e))?;
    let Some(row) = row else {
        return Ok(());
    };
    let sql: String = row
        .try_get("sql")
        .map_err(|e| format!("Invalid sqlite_master row: {}", e))?;
    let needs = sql.contains("data BLOB NOT NULL") || !sql.contains("file_path");
    if !needs {
        return Ok(());
    }
    log::info!("Migrating epub_data table (nullable data + file_path column)");
    sqlx::query(
        r#"
        CREATE TABLE epub_data__m (
            source_path TEXT PRIMARY KEY,
            book_id TEXT NOT NULL,
            data BLOB,
            file_path TEXT,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
        )
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to create epub_data__m: {}", e))?;
    sqlx::query(
        "INSERT INTO epub_data__m (source_path, book_id, data, file_path, updated_at)          SELECT source_path, book_id, data, NULL, updated_at FROM epub_data",
    )
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to copy epub_data: {}", e))?;
    sqlx::query("DROP TABLE epub_data")
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to drop old epub_data: {}", e))?;
    sqlx::query("ALTER TABLE epub_data__m RENAME TO epub_data")
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to rename epub_data: {}", e))?;
    if let Err(e) = sqlx::query("CREATE INDEX IF NOT EXISTS idx_epub_data_book_id ON epub_data(book_id)")
        .execute(pool)
        .await
    {
        log::warn!("Failed to recreate idx_epub_data_book_id: {}", e);
    }
    Ok(())
}

/// Migrate live sentence checkpoint storage from legacy audio_bytes schema to
/// file-path based schema used by live conversion resume.
async fn migrate_live_sentence_alignment_schema(pool: &SqlitePool) -> Result<(), String> {
    use sqlx::Row;

    let table_exists = sqlx::query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='live_sentence_alignment'",
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Failed to check live_sentence_alignment table: {}", e))?;

    let Some(_) = table_exists else {
        return Ok(());
    };

    let columns = sqlx::query("PRAGMA table_info(live_sentence_alignment)")
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to inspect live_sentence_alignment columns: {}", e))?;

    let has_audio_file_path = columns.iter().any(|r| {
        r.try_get::<String, _>("name")
            .map(|n| n == "audio_file_path")
            .unwrap_or(false)
    });
    let has_audio_bytes_not_null = columns.iter().any(|r| {
        let name = r.try_get::<String, _>("name").unwrap_or_default();
        let notnull = r.try_get::<i64, _>("notnull").unwrap_or(0);
        name == "audio_bytes" && notnull == 1
    });

    // Legacy schemas with audio_bytes NOT NULL break current inserts that only
    // provide audio_file_path metadata.
    if !has_audio_bytes_not_null {
        if !has_audio_file_path {
            sqlx::query(
                "ALTER TABLE live_sentence_alignment ADD COLUMN audio_file_path TEXT NOT NULL DEFAULT ''",
            )
            .execute(pool)
            .await
            .map_err(|e| {
                format!(
                    "Failed to add audio_file_path to live_sentence_alignment: {}",
                    e
                )
            })?;
            log::info!("Migrated live_sentence_alignment: added audio_file_path column");
        }
        return Ok(());
    }

    log::info!(
        "Migrating live_sentence_alignment table (remove audio_bytes NOT NULL legacy constraint)"
    );

    let has_duration_seconds = columns.iter().any(|r| {
        r.try_get::<String, _>("name")
            .map(|n| n == "duration_seconds")
            .unwrap_or(false)
    });
    let has_sentence_text = columns.iter().any(|r| {
        r.try_get::<String, _>("name")
            .map(|n| n == "sentence_text")
            .unwrap_or(false)
    });
    let has_word_alignments = columns.iter().any(|r| {
        r.try_get::<String, _>("name")
            .map(|n| n == "word_alignments")
            .unwrap_or(false)
    });
    let has_created_at = columns.iter().any(|r| {
        r.try_get::<String, _>("name")
            .map(|n| n == "created_at")
            .unwrap_or(false)
    });

    sqlx::query(
        r#"
        CREATE TABLE live_sentence_alignment__m (
            book_id TEXT NOT NULL,
            chapter_index INTEGER NOT NULL,
            sentence_index INTEGER NOT NULL,
            audio_file_path TEXT NOT NULL,
            duration_seconds REAL NOT NULL,
            sentence_text TEXT NOT NULL,
            word_alignments TEXT NOT NULL,
            created_at TEXT NOT NULL,
            PRIMARY KEY (book_id, chapter_index, sentence_index),
            FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
        )
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to create live_sentence_alignment__m: {}", e))?;

    let audio_file_path_expr = if has_audio_file_path {
        "audio_file_path"
    } else {
        "''"
    };
    let duration_expr = if has_duration_seconds {
        "duration_seconds"
    } else {
        "0.0"
    };
    let sentence_text_expr = if has_sentence_text {
        "sentence_text"
    } else {
        "''"
    };
    let word_alignments_expr = if has_word_alignments {
        "word_alignments"
    } else {
        "'[]'"
    };
    let created_at_expr = if has_created_at {
        "created_at"
    } else {
        "strftime('%s','now')"
    };

    let copy_sql = format!(
        "INSERT INTO live_sentence_alignment__m (book_id, chapter_index, sentence_index, audio_file_path, duration_seconds, sentence_text, word_alignments, created_at) \
         SELECT book_id, chapter_index, sentence_index, {}, {}, {}, {}, {} FROM live_sentence_alignment",
        audio_file_path_expr,
        duration_expr,
        sentence_text_expr,
        word_alignments_expr,
        created_at_expr
    );

    sqlx::query(&copy_sql)
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to copy live_sentence_alignment data: {}", e))?;

    sqlx::query("DROP TABLE live_sentence_alignment")
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to drop old live_sentence_alignment table: {}", e))?;

    sqlx::query("ALTER TABLE live_sentence_alignment__m RENAME TO live_sentence_alignment")
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to rename migrated live_sentence_alignment table: {}", e))?;

    Ok(())
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
            conversion_session_baseline_words INTEGER,
            conversion_session_started_at TEXT,
            conversion_elapsed_ms INTEGER,
            last_opened_time TEXT
        )
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to create books table: {}", e))?;

    use sqlx::Row;

    // Migration: conversion session timing columns for resume-aware ETA
    {
        let books_sql_row =
            sqlx::query("SELECT sql FROM sqlite_master WHERE type='table' AND name='books'")
                .fetch_optional(pool)
                .await
                .map_err(|e| format!("Failed to check books schema: {}", e))?;
        let books_sql = books_sql_row
            .and_then(|row| row.try_get::<Option<String>, _>("sql").ok().flatten())
            .unwrap_or_default();

        if !books_sql.contains("conversion_session_baseline_words") {
            log::info!("Migrating books table (adding conversion_session_baseline_words)");
            sqlx::query(
                "ALTER TABLE books ADD COLUMN conversion_session_baseline_words INTEGER",
            )
            .execute(pool)
            .await
            .map_err(|e| {
                format!(
                    "Failed to add conversion_session_baseline_words to books: {}",
                    e
                )
            })?;
        }
        if !books_sql.contains("conversion_session_started_at") {
            log::info!("Migrating books table (adding conversion_session_started_at)");
            sqlx::query("ALTER TABLE books ADD COLUMN conversion_session_started_at TEXT")
                .execute(pool)
                .await
                .map_err(|e| {
                    format!(
                        "Failed to add conversion_session_started_at to books: {}",
                        e
                    )
                })?;
        }
        if !books_sql.contains("conversion_elapsed_ms") {
            log::info!("Migrating books table (adding conversion_elapsed_ms)");
            sqlx::query("ALTER TABLE books ADD COLUMN conversion_elapsed_ms INTEGER")
                .execute(pool)
                .await
                .map_err(|e| format!("Failed to add conversion_elapsed_ms to books: {}", e))?;
        }
    }
    
    // Migration: Remove unique constraint on source_path if it exists
    // SQLite implements UNIQUE constraints as unique indexes
    // We need to find and drop any unique indexes on books.source_path
    
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
    
    // Create epub_data table (file-backed EPUB + optional legacy BLOB)
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS epub_data (
            source_path TEXT PRIMARY KEY,
            book_id TEXT NOT NULL,
            data BLOB,
            file_path TEXT,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
        )
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to create epub_data table: {}", e))?;

    migrate_epub_data_schema(pool).await?;
    
    // Create app_settings table (singleton - only one row)
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS app_settings (
            id TEXT PRIMARY KEY DEFAULT 'default',
            theme TEXT NOT NULL DEFAULT 'system',
            language TEXT NOT NULL DEFAULT 'en',
            tts_language TEXT NOT NULL DEFAULT 'en',
            tts_voice_id TEXT NOT NULL,
            tts_synthesis_quality TEXT NOT NULL DEFAULT 'balanced',
            auto_scroll_enabled INTEGER NOT NULL DEFAULT 1,
            audio_playback_speed REAL NOT NULL DEFAULT 1.0,
            updated_at TEXT NOT NULL
        )
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to create app_settings table: {}", e))?;
    
    // Migration for app_settings: add language and tts_language columns if they don't exist
    let row = sqlx::query("SELECT sql FROM sqlite_master WHERE type='table' AND name='app_settings'")
        .fetch_one(pool)
        .await
        .map_err(|e| format!("Failed to check app_settings schema: {}", e))?;
    let table_sql: String = row.get("sql");
    
    if !table_sql.contains("language") {
        log::info!("Migrating app_settings table (adding language column)");
        sqlx::query("ALTER TABLE app_settings ADD COLUMN language TEXT NOT NULL DEFAULT 'en'")
            .execute(pool)
            .await
            .map_err(|e| format!("Failed to add language column to app_settings: {}", e))?;
    }
    
    if !table_sql.contains("tts_language") {
        log::info!("Migrating app_settings table (adding tts_language column)");
        sqlx::query("ALTER TABLE app_settings ADD COLUMN tts_language TEXT NOT NULL DEFAULT 'en'")
            .execute(pool)
            .await
            .map_err(|e| format!("Failed to add tts_language column to app_settings: {}", e))?;
    }

    if !table_sql.contains("tts_synthesis_quality") {
        log::info!("Migrating app_settings table (adding tts_synthesis_quality column)");
        sqlx::query(
            "ALTER TABLE app_settings ADD COLUMN tts_synthesis_quality TEXT NOT NULL DEFAULT 'balanced'",
        )
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to add tts_synthesis_quality column to app_settings: {}", e))?;
    }
    
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
    
    // Create live_conversion_checkpoint table for persistence during conversion
    // Tracks state of live conversions so they can be resumed if cancelled
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS live_conversion_checkpoint (
            book_id TEXT NOT NULL,
            chapter_index INTEGER NOT NULL,
            chapter_id TEXT,
            chapter_href TEXT,
            sentences_processed INTEGER NOT NULL DEFAULT 0,
            total_sentences INTEGER NOT NULL,
            audio_duration_seconds REAL NOT NULL DEFAULT 0.0,
            checkpoint_timestamp TEXT NOT NULL,
            PRIMARY KEY (book_id, chapter_index),
            FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
        )
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to create live_conversion_checkpoint table: {}", e))?;
    
    // Create live_sentence_alignment table to store word alignments during live conversion
    // Audio files are stored on filesystem to avoid SQLite BLOB performance issues
    // This enables resuming both conversion and playback with exact word timing
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS live_sentence_alignment (
            book_id TEXT NOT NULL,
            chapter_index INTEGER NOT NULL,
            sentence_index INTEGER NOT NULL,
            audio_file_path TEXT NOT NULL,
            duration_seconds REAL NOT NULL,
            sentence_text TEXT NOT NULL,
            word_alignments TEXT NOT NULL,
            created_at TEXT NOT NULL,
            PRIMARY KEY (book_id, chapter_index, sentence_index),
            FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
        )
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to create live_sentence_alignment table: {}", e))?;

    migrate_live_sentence_alignment_schema(pool).await?;
    
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
        // Live conversion checkpoint indexes
        "CREATE INDEX IF NOT EXISTS idx_live_checkpoint_book_id ON live_conversion_checkpoint(book_id)",
        "CREATE INDEX IF NOT EXISTS idx_live_checkpoint_timestamp ON live_conversion_checkpoint(checkpoint_timestamp)",
        // Live sentence alignment indexes
        "CREATE INDEX IF NOT EXISTS idx_live_alignment_book_chapter ON live_sentence_alignment(book_id, chapter_index)",
        "CREATE INDEX IF NOT EXISTS idx_live_alignment_book_chapter_sentence ON live_sentence_alignment(book_id, chapter_index, sentence_index)",
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

    // Wait up to 5s when the writer holds the lock (progress + conversion)
    sqlx::query("PRAGMA busy_timeout=5000")
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to set busy_timeout: {}", e))?;
    
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

