use sea_orm::{DatabaseConnection, EntityTrait, QueryFilter, ColumnTrait, Set, ActiveModelTrait};
use crate::book_service::entities::book;
use crate::book_service::models::{Book, BookProgress, BookAudioState, AudioSyncMap, ConversionStatus};
use crate::book_service::repositories::{ChapterRepository, AudioRepository};
use std::sync::Arc;

pub struct BookRepository;

impl BookRepository {
    /// Convert SeaORM entity to domain model
    pub fn entity_to_model(entity: book::Model, chapters: Vec<crate::book_service::models::Chapter>, audio_tracks: Vec<crate::book_service::models::AudioTrack>) -> Book {
        // Parse subjects
        let subjects = entity.subjects
            .and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok());
        
        // Parse conversion status
        let conversion_status = match entity.conversion_status.as_str() {
            "NotStarted" => ConversionStatus::NotStarted,
            "Started" => ConversionStatus::Started,
            "Done" => ConversionStatus::Done,
            _ => ConversionStatus::NotStarted,
        };
        
        // Parse completed chapters
        let completed_chapters = entity.completed_chapters
            .and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok())
            .unwrap_or_default();
        
        // Parse progress
        let progress = if entity.progress_current_chapter_id.is_some() {
            Some(BookProgress {
                current_chapter_id: entity.progress_current_chapter_id.unwrap(),
                current_chapter_href: entity.progress_current_chapter_href.unwrap(),
                current_chapter_index: entity.progress_current_chapter_index.unwrap() as usize,
                current_chapter_element_id: entity.progress_current_chapter_element_id,
                current_chapter_element_index: entity.progress_current_chapter_element_index.map(|v| v as usize),
                current_chapter_scroll_top: entity.progress_current_chapter_scroll_top.unwrap(),
                current_chapter_scroll_height: entity.progress_current_chapter_scroll_height.unwrap(),
                current_chapter_client_height: entity.progress_current_chapter_client_height.unwrap(),
                chapter_progress_percent: entity.progress_chapter_progress_percent.unwrap(),
                book_progress_percent: entity.progress_book_progress_percent.unwrap(),
                updated_at: entity.progress_updated_at.unwrap(),
            })
        } else {
            None
        };
        
        // Parse audio state
        let audio_state = if entity.audio_state_current_track_id.is_some() {
            Some(BookAudioState {
                current_track_id: entity.audio_state_current_track_id.unwrap(),
                current_track_href: entity.audio_state_current_track_href.unwrap(),
                current_track_index: entity.audio_state_current_track_index.unwrap() as usize,
                current_time_seconds: entity.audio_state_current_time_seconds.unwrap(),
                updated_at: entity.audio_state_updated_at.unwrap(),
            })
        } else {
            None
        };
        
        // Parse audio sync map
        let audio_sync_map = entity.audio_sync_map
            .and_then(|s| serde_json::from_str::<AudioSyncMap>(&s).ok());
        
        Book {
            id: entity.id,
            title: entity.title,
            author: entity.author,
            chapters,
            cover_url: entity.cover_url,
            source_path: entity.source_path,
            publisher: entity.publisher,
            published_year: entity.published_year,
            subjects,
            file_size_bytes: entity.file_size_bytes.map(|v| v as usize),
            audio_tracks,
            audio_state,
            audio_sync_map,
            progress,
            page_count: entity.page_count.map(|v| v as usize),
            conversion_status,
            completed_chapters,
            voice_id: entity.voice_id,
            total_words: entity.total_words.map(|v| v as usize),
            words_processed: entity.words_processed.map(|v| v as usize),
            last_opened_time: entity.last_opened_time,
        }
    }
    
    /// Convert domain model to SeaORM active model
    pub fn model_to_active_model(model: &Book) -> book::ActiveModel {
        let subjects_json = model.subjects.as_ref()
            .and_then(|s| serde_json::to_string(s).ok());
        
        let completed_chapters_json = if model.completed_chapters.is_empty() {
            None
        } else {
            serde_json::to_string(&model.completed_chapters).ok()
        };
        
        let audio_sync_map_json = model.audio_sync_map.as_ref()
            .and_then(|m| {
                match serde_json::to_string(m) {
                    Ok(json) => {
                        log::debug!("Serialized audio_sync_map to JSON ({} bytes)", json.len());
                        Some(json)
                    }
                    Err(e) => {
                        log::warn!("Failed to serialize audio_sync_map: {}", e);
                        None
                    }
                }
            });
        
        book::ActiveModel {
            id: Set(model.id.clone()),
            title: Set(model.title.clone()),
            author: Set(model.author.clone()),
            source_path: Set(model.source_path.clone()),
            cover_url: Set(model.cover_url.clone()),
            publisher: Set(model.publisher.clone()),
            published_year: Set(model.published_year.clone()),
            subjects: Set(subjects_json),
            file_size_bytes: Set(model.file_size_bytes.map(|v| v as i64)),
            progress_current_chapter_id: Set(model.progress.as_ref().map(|p| p.current_chapter_id.clone())),
            progress_current_chapter_href: Set(model.progress.as_ref().map(|p| p.current_chapter_href.clone())),
            progress_current_chapter_index: Set(model.progress.as_ref().map(|p| p.current_chapter_index as i64)),
            progress_current_chapter_element_id: Set(model.progress.as_ref().and_then(|p| p.current_chapter_element_id.clone())),
            progress_current_chapter_element_index: Set(model.progress.as_ref().and_then(|p| p.current_chapter_element_index.map(|v| v as i64))),
            progress_current_chapter_scroll_top: Set(model.progress.as_ref().map(|p| p.current_chapter_scroll_top)),
            progress_current_chapter_scroll_height: Set(model.progress.as_ref().map(|p| p.current_chapter_scroll_height)),
            progress_current_chapter_client_height: Set(model.progress.as_ref().map(|p| p.current_chapter_client_height)),
            progress_chapter_progress_percent: Set(model.progress.as_ref().map(|p| p.chapter_progress_percent)),
            progress_book_progress_percent: Set(model.progress.as_ref().map(|p| p.book_progress_percent)),
            progress_updated_at: Set(model.progress.as_ref().map(|p| p.updated_at.clone())),
            audio_state_current_track_id: Set(model.audio_state.as_ref().map(|a| a.current_track_id.clone())),
            audio_state_current_track_href: Set(model.audio_state.as_ref().map(|a| a.current_track_href.clone())),
            audio_state_current_track_index: Set(model.audio_state.as_ref().map(|a| a.current_track_index as i64)),
            audio_state_current_time_seconds: Set(model.audio_state.as_ref().map(|a| a.current_time_seconds)),
            audio_state_updated_at: Set(model.audio_state.as_ref().map(|a| a.updated_at.clone())),
            audio_sync_map: Set(audio_sync_map_json),
            page_count: Set(model.page_count.map(|v| v as i64)),
            conversion_status: Set(format!("{:?}", model.conversion_status)),
            completed_chapters: Set(completed_chapters_json),
            voice_id: Set(model.voice_id.clone()),
            total_words: Set(model.total_words.map(|v| v as i64)),
            words_processed: Set(model.words_processed.map(|v| v as i64)),
            last_opened_time: Set(model.last_opened_time.clone()),
        }
    }
    
    /// Load all books (optimized - no N+1 queries)
    pub async fn find_all(db: &DatabaseConnection) -> Result<Vec<Book>, String> {
        use std::collections::HashMap;
        use sea_orm::QueryOrder;
        
        // Load all books
        let entities = book::Entity::find()
            .all(db)
            .await
            .map_err(|e| format!("Failed to query books: {}", e))?;
        
        if entities.is_empty() {
            return Ok(Vec::new());
        }
        
        // Collect all book IDs
        let book_ids: Vec<String> = entities.iter().map(|e| e.id.clone()).collect();
        
        // Load all chapters for all books in one query (EXCLUDE content_html and plain_text BLOBs for performance)
        // These large fields will be loaded lazily when chapters are opened
        // Using select_only to exclude BLOBs, then manually constructing models with None for excluded fields
        use sea_orm::QuerySelect;
        use sea_orm::FromQueryResult;
        
        #[derive(Debug, FromQueryResult)]
        struct ChapterPartial {
            id: String,
            book_id: String,
            title: String,
            href: String,
            chapter_order: i64,
            word_count: Option<i64>,
            estimated_page_count: Option<i64>,
        }
        
        let chapter_partials = crate::book_service::entities::chapter::Entity::find()
            .select_only()
            .columns([
                crate::book_service::entities::chapter::Column::Id,
                crate::book_service::entities::chapter::Column::BookId,
                crate::book_service::entities::chapter::Column::Title,
                crate::book_service::entities::chapter::Column::Href,
                crate::book_service::entities::chapter::Column::ChapterOrder,
                crate::book_service::entities::chapter::Column::WordCount,
                crate::book_service::entities::chapter::Column::EstimatedPageCount,
                // Explicitly EXCLUDE: ContentHtml, PlainText (large BLOBs)
            ])
            .filter(crate::book_service::entities::chapter::Column::BookId.is_in(book_ids.clone()))
            .order_by_asc(crate::book_service::entities::chapter::Column::BookId)
            .order_by_asc(crate::book_service::entities::chapter::Column::ChapterOrder)
            .into_model::<ChapterPartial>()
            .all(db)
            .await
            .map_err(|e| format!("Failed to query chapters: {}", e))?;
        
        // Convert partial results to full chapter models (with content_html and plain_text as None)
        let all_chapters: Vec<crate::book_service::entities::chapter::Model> = chapter_partials
            .into_iter()
            .map(|p| crate::book_service::entities::chapter::Model {
                id: p.id,
                book_id: p.book_id,
                title: p.title,
                href: p.href,
                content_html: None, // Excluded for performance - loaded lazily
                plain_text: None,   // Excluded for performance - loaded lazily
                chapter_order: p.chapter_order,
                word_count: p.word_count,
                estimated_page_count: p.estimated_page_count,
            })
            .collect();
        
        // Load all audio tracks for all books in one query (EXCLUDE data BLOB for performance)
        // The data field will be loaded lazily when tracks are played
        #[derive(Debug, FromQueryResult)]
        struct AudioTrackPartial {
            id: String,
            book_id: String,
            title: String,
            href: String,
            url: Option<String>,
            duration: Option<f64>,
            track_order: i64,
        }
        
        let audio_track_partials = crate::book_service::entities::audio_track::Entity::find()
            .select_only()
            .columns([
                crate::book_service::entities::audio_track::Column::Id,
                crate::book_service::entities::audio_track::Column::BookId,
                crate::book_service::entities::audio_track::Column::Title,
                crate::book_service::entities::audio_track::Column::Href,
                crate::book_service::entities::audio_track::Column::Url,
                crate::book_service::entities::audio_track::Column::Duration,
                crate::book_service::entities::audio_track::Column::TrackOrder,
                // Explicitly EXCLUDE: Data (large BLOB)
            ])
            .filter(crate::book_service::entities::audio_track::Column::BookId.is_in(book_ids.clone()))
            .order_by_asc(crate::book_service::entities::audio_track::Column::BookId)
            .order_by_asc(crate::book_service::entities::audio_track::Column::TrackOrder)
            .into_model::<AudioTrackPartial>()
            .all(db)
            .await
            .map_err(|e| format!("Failed to query audio tracks: {}", e))?;
        
        // Convert partial results to full audio track models (with data as None)
        let all_audio_tracks: Vec<crate::book_service::entities::audio_track::Model> = audio_track_partials
            .into_iter()
            .map(|p| crate::book_service::entities::audio_track::Model {
                id: p.id,
                book_id: p.book_id,
                title: p.title,
                href: p.href,
                url: p.url,
                duration: p.duration,
                track_order: p.track_order,
                data: None, // Excluded for performance - loaded lazily
            })
            .collect();
        
        // Group chapters by book_id
        // Note: content_html and plain_text are None (excluded for performance)
        // They will be loaded lazily when chapters are opened
        let mut chapters_by_book: HashMap<String, Vec<crate::book_service::models::Chapter>> = HashMap::new();
        for entity in all_chapters {
            // Create chapter model with content_html and plain_text as None
            // (since we excluded them from the query for performance)
            let chapter = ChapterRepository::entity_to_model(entity.clone());
            chapters_by_book
                .entry(entity.book_id.clone())
                .or_insert_with(Vec::new)
                .push(chapter);
        }
        
        // Group audio tracks by book_id
        // Note: data is None (excluded for performance)
        // It will be loaded lazily when tracks are played
        let mut audio_tracks_by_book: HashMap<String, Vec<crate::book_service::models::AudioTrack>> = HashMap::new();
        for entity in all_audio_tracks {
            // AudioTrack model doesn't include data field, so this is fine
            let track = AudioRepository::entity_to_model(entity.clone());
            audio_tracks_by_book
                .entry(entity.book_id.clone())
                .or_insert_with(Vec::new)
                .push(track);
        }
        
        // Build books
        let mut books = Vec::new();
        for entity in entities {
            let chapters = chapters_by_book.remove(&entity.id).unwrap_or_default();
            let audio_tracks = audio_tracks_by_book.remove(&entity.id).unwrap_or_default();
            books.push(Self::entity_to_model(entity, chapters, audio_tracks));
        }
        
        Ok(books)
    }
    
    /// Find book by ID (with hybrid store)
    pub async fn find_by_id(db: &DatabaseConnection, book_id: &str) -> Result<Option<Book>, String> {
        // Try hybrid store first
        if let Ok(store) = crate::book_service::database::get_hybrid_store() {
            if let Some(book) = store.get_book(book_id) {
                log::debug!("Hybrid store hit for book: {}", book_id);
                return Ok(Some(book));
            }
        }
        
        // Store miss - query database
        let entity = book::Entity::find_by_id(book_id)
            .one(db)
            .await
            .map_err(|e| format!("Failed to query book: {}", e))?;
        
        if let Some(entity) = entity {
            let chapters = ChapterRepository::find_by_book_id(db, &entity.id).await?;
            let audio_tracks = AudioRepository::find_by_book_id(db, &entity.id).await?;
            let book = Self::entity_to_model(entity, chapters, audio_tracks);
            
            // Load into hybrid store
            if let Ok(store) = crate::book_service::database::get_hybrid_store() {
                store.load_book(book.clone()).await;
            }
            
            Ok(Some(book))
        } else {
            Ok(None)
        }
    }
    
    /// Find book by source path
    pub async fn find_by_source_path(db: &DatabaseConnection, source_path: &str) -> Result<Option<Book>, String> {
        let entity = book::Entity::find()
            .filter(book::Column::SourcePath.eq(source_path))
            .one(db)
            .await
            .map_err(|e| format!("Failed to query book: {}", e))?;
        
        if let Some(entity) = entity {
            let chapters = ChapterRepository::find_by_book_id(db, &entity.id).await?;
            let audio_tracks = AudioRepository::find_by_book_id(db, &entity.id).await?;
            Ok(Some(Self::entity_to_model(entity, chapters, audio_tracks)))
        } else {
            Ok(None)
        }
    }
    
    /// Save book (insert or update)
    pub async fn save(db: &DatabaseConnection, model: &Book) -> Result<(), String> {
        use sea_orm::TransactionTrait;
        
        let txn = db.begin().await
            .map_err(|e| format!("Failed to begin transaction: {}", e))?;
        
        // Save book
        let active_model = Self::model_to_active_model(model);
        // Log audio sync map status for debugging
        match &active_model.audio_sync_map {
            sea_orm::Set(Some(json)) => {
                log::debug!("Saving book with audio_sync_map JSON ({} bytes)", json.len());
            }
            sea_orm::Set(None) => {
                log::debug!("Saving book without audio_sync_map (None)");
            }
            _ => {
                log::debug!("Saving book with audio_sync_map (NotSet)");
            }
        }
        book::Entity::insert(active_model.clone())
            .on_conflict(
                sea_orm::sea_query::OnConflict::column(book::Column::Id)
                    .update_columns([
                        book::Column::Title,
                        book::Column::Author,
                        book::Column::SourcePath,
                        book::Column::CoverUrl,
                        book::Column::Publisher,
                        book::Column::PublishedYear,
                        book::Column::Subjects,
                        book::Column::FileSizeBytes,
                        book::Column::ProgressCurrentChapterId,
                        book::Column::ProgressCurrentChapterHref,
                        book::Column::ProgressCurrentChapterIndex,
                        book::Column::ProgressCurrentChapterElementId,
                        book::Column::ProgressCurrentChapterElementIndex,
                        book::Column::ProgressCurrentChapterScrollTop,
                        book::Column::ProgressCurrentChapterScrollHeight,
                        book::Column::ProgressCurrentChapterClientHeight,
                        book::Column::ProgressChapterProgressPercent,
                        book::Column::ProgressBookProgressPercent,
                        book::Column::ProgressUpdatedAt,
                        book::Column::AudioStateCurrentTrackId,
                        book::Column::AudioStateCurrentTrackHref,
                        book::Column::AudioStateCurrentTrackIndex,
                        book::Column::AudioStateCurrentTimeSeconds,
                        book::Column::AudioStateUpdatedAt,
                        book::Column::AudioSyncMap,
                        book::Column::PageCount,
                        book::Column::ConversionStatus,
                        book::Column::CompletedChapters,
                        book::Column::VoiceId,
                        book::Column::TotalWords,
                        book::Column::WordsProcessed,
                    ])
                    .to_owned()
            )
            .exec_with_returning(&txn)
            .await
            .map_err(|e| format!("Failed to save book: {}", e))?;
        
        // Delete existing chapters (always replace chapters)
        // NOTE: We do NOT delete images or audio tracks here because:
        // 1. They are saved separately after book save during ingestion
        // 2. ImageRepository and AudioRepository use upsert (ON CONFLICT) logic
        // 3. Deleting them here would cause them to be removed before they're saved
        ChapterRepository::delete_by_book_id(&txn, &model.id).await?;
        
        // Batch insert chapters (optimized - much faster than individual inserts)
        if !model.chapters.is_empty() {
            use crate::book_service::entities::chapter;
            const BATCH_SIZE: usize = 500; // SQLite limit is ~1000, use 500 for safety
            
            let chapter_models: Vec<chapter::ActiveModel> = model.chapters.iter()
                .map(|ch| ChapterRepository::model_to_active_model(&model.id, ch))
                .collect();
            
            // Insert in batches
            for chunk in chapter_models.chunks(BATCH_SIZE) {
                chapter::Entity::insert_many(chunk.to_vec())
                    .exec(&txn)
                    .await
                    .map_err(|e| format!("Failed to batch insert chapters: {}", e))?;
            }
            
            // Chapters are saved via write queue in hybrid store
        }
        
        // Batch insert audio tracks (metadata only, data is stored separately)
        // Note: Since we need upsert behavior (on_conflict) and SeaORM's insert_many
        // doesn't support it, we do individual inserts within the transaction.
        // This is still much faster than the original sequential approach because:
        // 1. All inserts are in a single transaction (atomic, efficient)
        // 2. SQLite can batch operations within a transaction
        // 3. No round-trips between transaction commits
        if !model.audio_tracks.is_empty() {
            use crate::book_service::entities::audio_track;
            
            // Log track order before saving to verify correct ordering
            log::debug!("Saving {} audio tracks with orders:", model.audio_tracks.len());
            for (idx, track) in model.audio_tracks.iter().enumerate() {
                log::debug!("  Track #{}: href='{}', order={}", idx, track.href, track.order);
            }
            
            // Prepare all track models
            let track_models: Vec<audio_track::ActiveModel> = model.audio_tracks.iter()
                .map(|t| AudioRepository::model_to_active_model(&model.id, t))
                .collect();
            
            // Insert with upsert (on_conflict) - all within the transaction
            for track_model in track_models {
                audio_track::Entity::insert(track_model)
                    .on_conflict(
                        sea_orm::sea_query::OnConflict::column(audio_track::Column::Id)
                            .update_columns([
                                audio_track::Column::Title,
                                audio_track::Column::Href,
                                audio_track::Column::Url,
                                audio_track::Column::Duration,
                                audio_track::Column::TrackOrder,
                            ])
                            .to_owned()
                    )
                    .exec(&txn)
                    .await
                    .map_err(|e| format!("Failed to save audio track: {}", e))?;
            }
            
            // Audio tracks are saved via write queue in hybrid store
        }
        
        txn.commit().await
            .map_err(|e| format!("Failed to commit transaction: {}", e))?;
        
        // Book is saved via write queue in hybrid store, no need to invalidate here
        
        Ok(())
    }
    
    /// Update only progress fields (lightweight, doesn't touch chapters/audio tracks)
    /// This is much faster than save() which deletes/re-inserts all chapters
    /// Optimized: Updates cache in-place after database update
    pub async fn update_progress_only(
        db: &DatabaseConnection,
        book_id: &str,
        progress: &BookProgress,
    ) -> Result<(), String> {
        // Fetch entity from DB (this is lightweight - just the book row, not chapters/audio)
        let mut active_model: book::ActiveModel = book::Entity::find_by_id(book_id)
            .one(db)
            .await
            .map_err(|e| format!("Failed to find book: {}", e))?
            .ok_or_else(|| format!("Book not found: {}", book_id))?
            .into();
        
        // Update only progress fields
        active_model.progress_current_chapter_id = Set(Some(progress.current_chapter_id.clone()));
        active_model.progress_current_chapter_href = Set(Some(progress.current_chapter_href.clone()));
        active_model.progress_current_chapter_index = Set(Some(progress.current_chapter_index as i64));
        active_model.progress_current_chapter_element_id = Set(progress.current_chapter_element_id.clone());
        active_model.progress_current_chapter_element_index = Set(progress.current_chapter_element_index.map(|v| v as i64));
        active_model.progress_current_chapter_scroll_top = Set(Some(progress.current_chapter_scroll_top));
        active_model.progress_current_chapter_scroll_height = Set(Some(progress.current_chapter_scroll_height));
        active_model.progress_current_chapter_client_height = Set(Some(progress.current_chapter_client_height));
        active_model.progress_chapter_progress_percent = Set(Some(progress.chapter_progress_percent));
        active_model.progress_book_progress_percent = Set(Some(progress.book_progress_percent));
        active_model.progress_updated_at = Set(Some(progress.updated_at.clone()));
        
        active_model.update(db)
            .await
            .map_err(|e| format!("Failed to update book progress: {}", e))?;
        
        // Update hybrid store if loaded
        if let Ok(store) = crate::book_service::database::get_hybrid_store() {
            store.update_progress(book_id.to_string(), progress.clone()).await;
        }
        
        Ok(())
    }
    
    /// Update only audio state fields (lightweight, doesn't touch chapters/audio tracks)
    /// This is much faster than save() which deletes/re-inserts all chapters
    /// Optimized: Updates cache in-place after database update
    pub async fn update_audio_state_only(
        db: &DatabaseConnection,
        book_id: &str,
        audio_state: &BookAudioState,
    ) -> Result<(), String> {
        // Fetch entity from DB (this is lightweight - just the book row, not chapters/audio)
        let mut active_model: book::ActiveModel = book::Entity::find_by_id(book_id)
            .one(db)
            .await
            .map_err(|e| format!("Failed to find book: {}", e))?
            .ok_or_else(|| format!("Book not found: {}", book_id))?
            .into();
        
        // Update only audio state fields
        active_model.audio_state_current_track_id = Set(Some(audio_state.current_track_id.clone()));
        active_model.audio_state_current_track_href = Set(Some(audio_state.current_track_href.clone()));
        active_model.audio_state_current_track_index = Set(Some(audio_state.current_track_index as i64));
        active_model.audio_state_current_time_seconds = Set(Some(audio_state.current_time_seconds));
        active_model.audio_state_updated_at = Set(Some(audio_state.updated_at.clone()));
        
        active_model.update(db)
            .await
            .map_err(|e| format!("Failed to update book audio state: {}", e))?;
        
        // Update hybrid store if loaded
        if let Ok(store) = crate::book_service::database::get_hybrid_store() {
            store.update_audio_state(book_id.to_string(), audio_state.clone()).await;
        }
        
        Ok(())
    }
    
    /// Delete book
    pub async fn delete(db: &DatabaseConnection, book_id: &str) -> Result<(), String> {
        book::Entity::delete_by_id(book_id)
            .exec(db)
            .await
            .map_err(|e| format!("Failed to delete book: {}", e))?;
        
        // Book deletion is handled via write queue in hybrid store
        
        Ok(())
    }
}

