use sqlx::{SqlitePool, Row};
use crate::book_service::models::{Book, BookProgress, BookAudioState, AudioSyncMap, ConversionStatus};
use crate::book_service::repositories::{ChapterRepository, AudioRepository};

pub struct BookRepository;

impl BookRepository {
    /// Convert database row to domain model
    fn row_to_model(
        row: sqlx::sqlite::SqliteRow,
        chapters: Vec<crate::book_service::models::Chapter>,
        audio_tracks: Vec<crate::book_service::models::AudioTrack>,
    ) -> Result<Book, String> {
        // Parse subjects
        let subjects: Option<String> = row.get("subjects");
        let subjects = subjects.and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok());
        
        // Parse conversion status
        let conversion_status_str: String = row.get("conversion_status");
        let conversion_status = match conversion_status_str.as_str() {
            "NotStarted" => ConversionStatus::NotStarted,
            "Started" => ConversionStatus::Started,
            "Done" => ConversionStatus::Done,
            _ => ConversionStatus::NotStarted,
        };
        
        // Parse completed chapters
        let completed_chapters_str: Option<String> = row.get("completed_chapters");
        let completed_chapters = completed_chapters_str
            .and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok())
            .unwrap_or_default();
        
        // Parse progress
        let progress = if row.get::<Option<String>, _>("progress_current_chapter_id").is_some() {
            Some(BookProgress {
                current_chapter_id: row.get("progress_current_chapter_id"),
                current_chapter_href: row.get("progress_current_chapter_href"),
                current_chapter_index: row.get::<Option<i64>, _>("progress_current_chapter_index").unwrap_or(0) as usize,
                current_chapter_element_id: row.get("progress_current_chapter_element_id"),
                current_chapter_element_index: row.get::<Option<i64>, _>("progress_current_chapter_element_index").map(|v| v as usize),
                current_chapter_scroll_top: row.get::<Option<f64>, _>("progress_current_chapter_scroll_top").unwrap_or(0.0),
                current_chapter_scroll_height: row.get::<Option<f64>, _>("progress_current_chapter_scroll_height").unwrap_or(0.0),
                current_chapter_client_height: row.get::<Option<f64>, _>("progress_current_chapter_client_height").unwrap_or(0.0),
                chapter_progress_percent: row.get::<Option<f64>, _>("progress_chapter_progress_percent").unwrap_or(0.0),
                book_progress_percent: row.get::<Option<f64>, _>("progress_book_progress_percent").unwrap_or(0.0),
                updated_at: row.get("progress_updated_at"),
            })
        } else {
            None
        };
        
        // Parse audio state
        let audio_state = if row.get::<Option<String>, _>("audio_state_current_track_id").is_some() {
            Some(BookAudioState {
                current_track_id: row.get("audio_state_current_track_id"),
                current_track_href: row.get("audio_state_current_track_href"),
                current_track_index: row.get::<Option<i64>, _>("audio_state_current_track_index").unwrap_or(0) as usize,
                current_time_seconds: row.get::<Option<f64>, _>("audio_state_current_time_seconds").unwrap_or(0.0),
                updated_at: row.get("audio_state_updated_at"),
            })
        } else {
            None
        };
        
        // Parse audio sync map
        let audio_sync_map_str: Option<String> = row.get("audio_sync_map");
        let audio_sync_map = audio_sync_map_str
            .and_then(|s| serde_json::from_str::<AudioSyncMap>(&s).ok());
        
        Ok(Book {
            id: row.get("id"),
            title: row.get("title"),
            author: row.get("author"),
            chapters,
            cover_url: row.get("cover_url"),
            source_path: row.get("source_path"),
            publisher: row.get("publisher"),
            published_year: row.get("published_year"),
            subjects,
            file_size_bytes: row.get::<Option<i64>, _>("file_size_bytes").map(|v| v as usize),
            audio_tracks,
            audio_state,
            audio_sync_map,
            progress,
            page_count: row.get::<Option<i64>, _>("page_count").map(|v| v as usize),
            conversion_status,
            completed_chapters,
            voice_id: row.get("voice_id"),
            total_words: row.get::<Option<i64>, _>("total_words").map(|v| v as usize),
            words_processed: row.get::<Option<i64>, _>("words_processed").map(|v| v as usize),
            last_opened_time: row.get("last_opened_time"),
        })
    }
    
    /// Load all books (optimized - no N+1 queries)
    pub async fn find_all(pool: &SqlitePool) -> Result<Vec<Book>, String> {
        use std::collections::HashMap;
        
        // Load all books
        let rows = sqlx::query("SELECT * FROM books")
            .fetch_all(pool)
            .await
            .map_err(|e| format!("Failed to query books: {}", e))?;
        
        if rows.is_empty() {
            return Ok(Vec::new());
        }
        
        use sqlx::Row;
        
        // Collect all book IDs
        let book_ids: Vec<String> = rows.iter()
            .map(|row| row.get::<String, _>("id"))
            .collect();
        
        // Load all chapters for all books (EXCLUDE content_html and plain_text for performance)
        // For SQLite, we need to build the query with placeholders
        let chapter_rows = if book_ids.is_empty() {
            vec![]
        } else {
            let placeholders = vec!["?"; book_ids.len()].join(",");
            let query = format!(
                "SELECT id, book_id, title, href, chapter_order, word_count, estimated_page_count 
                 FROM chapters 
                 WHERE book_id IN ({})
                 ORDER BY book_id, chapter_order",
                placeholders
            );
            let mut query_builder = sqlx::query(&query);
            for book_id in &book_ids {
                query_builder = query_builder.bind(book_id);
            }
            query_builder
                .fetch_all(pool)
                .await
                .map_err(|e| format!("Failed to query chapters: {}", e))?
        };
        
        // Group chapters by book_id
        // Note: We use inline conversion here because the query excludes content_html and plain_text
        let mut chapters_by_book: HashMap<String, Vec<crate::book_service::models::Chapter>> = 
            HashMap::with_capacity(rows.len());
        for row in chapter_rows {
            let book_id: String = row.get("book_id");
            let chapter = crate::book_service::models::Chapter {
                id: row.get("id"),
                title: row.get("title"),
                href: row.get("href"),
                content_html: None, // Excluded for performance
                plain_text: None,   // Excluded for performance
                order: row.get::<i64, _>("chapter_order") as usize,
                word_count: row.get::<Option<i64>, _>("word_count").map(|v| v as usize),
                estimated_page_count: row.get::<Option<i64>, _>("estimated_page_count").map(|v| v as usize),
            };
            chapters_by_book
                .entry(book_id)
                .or_insert_with(Vec::new)
                .push(chapter);
        }
        
        // Load all audio tracks for all books (EXCLUDE data BLOB for performance)
        let audio_rows = if book_ids.is_empty() {
            vec![]
        } else {
            let placeholders = vec!["?"; book_ids.len()].join(",");
            let query = format!(
                "SELECT id, book_id, title, href, url, duration, track_order 
                 FROM audio_tracks 
                 WHERE book_id IN ({})
                 ORDER BY book_id, track_order",
                placeholders
            );
            let mut query_builder = sqlx::query(&query);
            for book_id in &book_ids {
                query_builder = query_builder.bind(book_id);
            }
            query_builder
                .fetch_all(pool)
                .await
                .map_err(|e| format!("Failed to query audio tracks: {}", e))?
        };
        
        // Group audio tracks by book_id
        let mut audio_tracks_by_book: HashMap<String, Vec<crate::book_service::models::AudioTrack>> = 
            HashMap::with_capacity(rows.len());
        for row in audio_rows {
            let book_id: String = row.get("book_id");
            let track = AudioRepository::row_to_model(row)
                .map_err(|e| format!("Failed to convert audio track: {}", e))?;
            audio_tracks_by_book
                .entry(book_id)
                .or_insert_with(Vec::new)
                .push(track);
        }
        
        // Build books
        let mut books = Vec::with_capacity(rows.len());
        for row in rows {
            let book_id: String = row.get("id");
            let chapters = chapters_by_book.remove(&book_id).unwrap_or_default();
            let audio_tracks = audio_tracks_by_book.remove(&book_id).unwrap_or_default();
            books.push(Self::row_to_model(row, chapters, audio_tracks)?);
        }
        
        Ok(books)
    }
    
    /// Find book by ID
    pub async fn find_by_id(pool: &SqlitePool, book_id: &str) -> Result<Option<Book>, String> {
        let row = sqlx::query("SELECT * FROM books WHERE id = ?")
            .bind(book_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| format!("Failed to query book: {}", e))?;
        
        if let Some(row) = row {
            let chapters = ChapterRepository::find_by_book_id(pool, book_id).await?;
            let audio_tracks = AudioRepository::find_by_book_id(pool, book_id).await?;
            Ok(Some(Self::row_to_model(row, chapters, audio_tracks)
                .map_err(|e| format!("Failed to convert row to model: {}", e))?))
        } else {
            Ok(None)
        }
    }
    
    /// Find book by source path
    pub async fn find_by_source_path(pool: &SqlitePool, source_path: &str) -> Result<Option<Book>, String> {
        let row = sqlx::query("SELECT * FROM books WHERE source_path = ?")
            .bind(source_path)
            .fetch_optional(pool)
            .await
            .map_err(|e| format!("Failed to query book: {}", e))?;
        
        use sqlx::Row;
        
        if let Some(row) = row {
            let book_id: String = row.get("id");
            let chapters = ChapterRepository::find_by_book_id(pool, &book_id).await?;
            let audio_tracks = AudioRepository::find_by_book_id(pool, &book_id).await?;
            Ok(Some(Self::row_to_model(row, chapters, audio_tracks)?))
        } else {
            Ok(None)
        }
    }
    
    /// Save book (insert or update)
    pub async fn save(pool: &SqlitePool, model: &Book) -> Result<(), String> {
        let mut txn = pool.begin().await
            .map_err(|e| format!("Failed to begin transaction: {}", e))?;
        
        // Serialize JSON fields
        let subjects_json = model.subjects.as_ref()
            .and_then(|s| serde_json::to_string(s).ok());
        let completed_chapters_json = if model.completed_chapters.is_empty() {
            None
        } else {
            serde_json::to_string(&model.completed_chapters).ok()
        };
        let audio_sync_map_json = model.audio_sync_map.as_ref()
            .and_then(|m| serde_json::to_string(m).ok());
        
        // Upsert book
        sqlx::query(
            r#"
            INSERT INTO books (
                id, title, author, source_path, cover_url, publisher, published_year, subjects,
                file_size_bytes, progress_current_chapter_id, progress_current_chapter_href,
                progress_current_chapter_index, progress_current_chapter_element_id,
                progress_current_chapter_element_index, progress_current_chapter_scroll_top,
                progress_current_chapter_scroll_height, progress_current_chapter_client_height,
                progress_chapter_progress_percent, progress_book_progress_percent, progress_updated_at,
                audio_state_current_track_id, audio_state_current_track_href,
                audio_state_current_track_index, audio_state_current_time_seconds,
                audio_state_updated_at, audio_sync_map, page_count, conversion_status,
                completed_chapters, voice_id, total_words, words_processed, last_opened_time
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                author = excluded.author,
                source_path = excluded.source_path,
                cover_url = excluded.cover_url,
                publisher = excluded.publisher,
                published_year = excluded.published_year,
                subjects = excluded.subjects,
                file_size_bytes = excluded.file_size_bytes,
                progress_current_chapter_id = excluded.progress_current_chapter_id,
                progress_current_chapter_href = excluded.progress_current_chapter_href,
                progress_current_chapter_index = excluded.progress_current_chapter_index,
                progress_current_chapter_element_id = excluded.progress_current_chapter_element_id,
                progress_current_chapter_element_index = excluded.progress_current_chapter_element_index,
                progress_current_chapter_scroll_top = excluded.progress_current_chapter_scroll_top,
                progress_current_chapter_scroll_height = excluded.progress_current_chapter_scroll_height,
                progress_current_chapter_client_height = excluded.progress_current_chapter_client_height,
                progress_chapter_progress_percent = excluded.progress_chapter_progress_percent,
                progress_book_progress_percent = excluded.progress_book_progress_percent,
                progress_updated_at = excluded.progress_updated_at,
                audio_state_current_track_id = excluded.audio_state_current_track_id,
                audio_state_current_track_href = excluded.audio_state_current_track_href,
                audio_state_current_track_index = excluded.audio_state_current_track_index,
                audio_state_current_time_seconds = excluded.audio_state_current_time_seconds,
                audio_state_updated_at = excluded.audio_state_updated_at,
                audio_sync_map = excluded.audio_sync_map,
                page_count = excluded.page_count,
                conversion_status = excluded.conversion_status,
                completed_chapters = excluded.completed_chapters,
                voice_id = excluded.voice_id,
                total_words = excluded.total_words,
                words_processed = excluded.words_processed,
                last_opened_time = excluded.last_opened_time
            "#
        )
        .bind(&model.id)
        .bind(&model.title)
        .bind(&model.author)
        .bind(&model.source_path)
        .bind(&model.cover_url)
        .bind(&model.publisher)
        .bind(&model.published_year)
        .bind(&subjects_json)
        .bind(model.file_size_bytes.map(|v| v as i64))
        .bind(model.progress.as_ref().map(|p| &p.current_chapter_id))
        .bind(model.progress.as_ref().map(|p| &p.current_chapter_href))
        .bind(model.progress.as_ref().map(|p| p.current_chapter_index as i64))
        .bind(model.progress.as_ref().and_then(|p| p.current_chapter_element_id.as_ref()))
        .bind(model.progress.as_ref().and_then(|p| p.current_chapter_element_index.map(|v| v as i64)))
        .bind(model.progress.as_ref().map(|p| p.current_chapter_scroll_top))
        .bind(model.progress.as_ref().map(|p| p.current_chapter_scroll_height))
        .bind(model.progress.as_ref().map(|p| p.current_chapter_client_height))
        .bind(model.progress.as_ref().map(|p| p.chapter_progress_percent))
        .bind(model.progress.as_ref().map(|p| p.book_progress_percent))
        .bind(model.progress.as_ref().map(|p| &p.updated_at))
        .bind(model.audio_state.as_ref().map(|a| &a.current_track_id))
        .bind(model.audio_state.as_ref().map(|a| &a.current_track_href))
        .bind(model.audio_state.as_ref().map(|a| a.current_track_index as i64))
        .bind(model.audio_state.as_ref().map(|a| a.current_time_seconds))
        .bind(model.audio_state.as_ref().map(|a| &a.updated_at))
        .bind(&audio_sync_map_json)
        .bind(model.page_count.map(|v| v as i64))
        .bind(format!("{:?}", model.conversion_status))
        .bind(&completed_chapters_json)
        .bind(&model.voice_id)
        .bind(model.total_words.map(|v| v as i64))
        .bind(model.words_processed.map(|v| v as i64))
        .bind(&model.last_opened_time)
        .execute(&mut *txn)
        .await
        .map_err(|e| format!("Failed to save book: {}", e))?;
        
        // Delete existing chapters
        ChapterRepository::delete_by_book_id(&mut *txn, &model.id).await?;
        
        // Batch insert chapters
        if !model.chapters.is_empty() {
            let chapters_to_save = model.chapters.clone();
            // Insert chapters in batches
            for chunk in chapters_to_save.chunks(500) {
                for chapter in chunk {
                    ChapterRepository::save(&mut *txn, &model.id, chapter).await?;
                }
            }
        }
        
        // Insert audio tracks
        if !model.audio_tracks.is_empty() {
            for track in &model.audio_tracks {
                AudioRepository::save_metadata(&mut *txn, &model.id, track).await?;
            }
        }
        
        txn.commit().await
            .map_err(|e| format!("Failed to commit transaction: {}", e))?;
        
        Ok(())
    }
    
    /// Update only progress fields (lightweight)
    pub async fn update_progress_only(
        pool: &SqlitePool,
        book_id: &str,
        progress: &BookProgress,
    ) -> Result<(), String> {
        sqlx::query(
            r#"
            UPDATE books SET
                progress_current_chapter_id = ?,
                progress_current_chapter_href = ?,
                progress_current_chapter_index = ?,
                progress_current_chapter_element_id = ?,
                progress_current_chapter_element_index = ?,
                progress_current_chapter_scroll_top = ?,
                progress_current_chapter_scroll_height = ?,
                progress_current_chapter_client_height = ?,
                progress_chapter_progress_percent = ?,
                progress_book_progress_percent = ?,
                progress_updated_at = ?
            WHERE id = ?
            "#
        )
        .bind(&progress.current_chapter_id)
        .bind(&progress.current_chapter_href)
        .bind(progress.current_chapter_index as i64)
        .bind(&progress.current_chapter_element_id)
        .bind(progress.current_chapter_element_index.map(|v| v as i64))
        .bind(progress.current_chapter_scroll_top)
        .bind(progress.current_chapter_scroll_height)
        .bind(progress.current_chapter_client_height)
        .bind(progress.chapter_progress_percent)
        .bind(progress.book_progress_percent)
        .bind(&progress.updated_at)
        .bind(book_id)
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to update book progress: {}", e))?;
        
        Ok(())
    }
    
    /// Update only audio state fields (lightweight)
    pub async fn update_audio_state_only(
        pool: &SqlitePool,
        book_id: &str,
        audio_state: &BookAudioState,
    ) -> Result<(), String> {
        sqlx::query(
            r#"
            UPDATE books SET
                audio_state_current_track_id = ?,
                audio_state_current_track_href = ?,
                audio_state_current_track_index = ?,
                audio_state_current_time_seconds = ?,
                audio_state_updated_at = ?
            WHERE id = ?
            "#
        )
        .bind(&audio_state.current_track_id)
        .bind(&audio_state.current_track_href)
        .bind(audio_state.current_track_index as i64)
        .bind(audio_state.current_time_seconds)
        .bind(&audio_state.updated_at)
        .bind(book_id)
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to update book audio state: {}", e))?;
        
        Ok(())
    }
    
    /// Delete book
    pub async fn delete(pool: &SqlitePool, book_id: &str) -> Result<(), String> {
        sqlx::query("DELETE FROM books WHERE id = ?")
            .bind(book_id)
            .execute(pool)
            .await
            .map_err(|e| format!("Failed to delete book: {}", e))?;
        
        Ok(())
    }
}
