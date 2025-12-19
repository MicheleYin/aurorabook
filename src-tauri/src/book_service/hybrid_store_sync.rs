use crate::book_service::hybrid_store::{HybridStore, WriteOperation};
use sea_orm::DatabaseConnection;
use std::sync::Arc;
use std::time::Instant;

impl HybridStore {
    /// Start background task that syncs writes to SQLite periodically
    pub fn start_sync_task(
        store: Arc<HybridStore>,
        db: Arc<DatabaseConnection>,
    ) -> tokio::task::JoinHandle<()> {
        let sync_interval = store.sync_interval();
        let last_sync = store.last_sync();
        
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(sync_interval);
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            
            loop {
                interval.tick().await;
                
                // Check if there are writes to sync
                let pending = store.pending_writes().await;
                
                if pending > 0 {
                    log::debug!("Syncing {} pending writes to SQLite...", pending);
                    
                    // Drain write queue
                    let operations = store.drain_write_queue().await;
                    
                    // Sync to SQLite
                    match Self::sync_to_sqlite(db.as_ref(), operations).await {
                        Ok(count) => {
                            log::debug!("Successfully synced {} operations to SQLite", count);
                            *last_sync.write().await = Instant::now();
                        }
                        Err(e) => {
                            log::error!("Failed to sync to SQLite: {}", e);
                            // TODO: Re-queue failed operations or handle retry
                        }
                    }
                }
            }
        })
    }
    
    async fn sync_to_sqlite(
        db: &DatabaseConnection,
        operations: Vec<WriteOperation>,
    ) -> Result<usize, String> {
        use sea_orm::TransactionTrait;
        use crate::book_service::repositories::{BookRepository, ChapterRepository};
        
        if operations.is_empty() {
            return Ok(0);
        }
        
        // Group operations for batch processing
        let mut books_to_save = Vec::new();
        let mut progress_updates = Vec::new();
        let mut audio_state_updates = Vec::new();
        let mut chapters_to_save = Vec::new();
        let mut chapter_content_updates = Vec::new();
        let mut books_to_delete = Vec::new();
        let mut images_to_save = Vec::new();
        let mut audio_data_to_save = Vec::new();
        let mut app_settings_to_save = None;
        let mut reader_preferences_to_save = None;
        
        for op in operations {
            match op {
                WriteOperation::SaveBook(book) => {
                    books_to_save.push(book);
                }
                WriteOperation::UpdateBookProgress { book_id, progress } => {
                    progress_updates.push((book_id, progress));
                }
                WriteOperation::UpdateBookAudioState { book_id, audio_state } => {
                    audio_state_updates.push((book_id, audio_state));
                }
                WriteOperation::SaveChapter { book_id, chapter } => {
                    chapters_to_save.push((book_id, chapter));
                }
                WriteOperation::UpdateChapterContent { book_id, chapter_id, content_html, plain_text } => {
                    chapter_content_updates.push((book_id, chapter_id, content_html, plain_text));
                }
                WriteOperation::DeleteBook { book_id } => {
                    books_to_delete.push(book_id);
                }
                WriteOperation::SaveImage { book_id, href, mime_type, data } => {
                    images_to_save.push((book_id, href, mime_type, data));
                }
                WriteOperation::SaveAudioData { book_id, href, data } => {
                    audio_data_to_save.push((book_id, href, data));
                }
                WriteOperation::SaveAppSettings(settings) => {
                    app_settings_to_save = Some(settings);
                }
                WriteOperation::SaveReaderPreferences(preferences) => {
                    reader_preferences_to_save = Some(preferences);
                }
                WriteOperation::SaveAudioTrack { .. } => {
                    // Audio track metadata is handled in SaveBook
                }
            }
        }
        
        // Note: Repositories create their own transactions, so we can't batch them in a single transaction
        // Each operation will be atomic, which is still better than individual syncs
        // TODO: Create batch methods in repositories that accept transactions for true batching
        
        let mut count = 0;
        
        // Batch save books
        for book in books_to_save {
            BookRepository::save(db, &book).await?;
            count += 1;
        }
        
        // Batch update progress
        for (book_id, progress) in progress_updates {
            BookRepository::update_progress_only(db, &book_id, &progress).await?;
            count += 1;
        }
        
        // Batch update audio state
        for (book_id, audio_state) in audio_state_updates {
            BookRepository::update_audio_state_only(db, &book_id, &audio_state).await?;
            count += 1;
        }
        
        // Batch save chapters
        for (book_id, chapter) in chapters_to_save {
            ChapterRepository::save(db, &book_id, &chapter).await?;
            count += 1;
        }
        
        // Batch update chapter content
        for (book_id, chapter_id, content_html, plain_text) in chapter_content_updates {
            ChapterRepository::update_content(
                db,
                &book_id,
                &chapter_id,
                &content_html,
                plain_text.as_deref(),
            ).await?;
            count += 1;
        }
        
        // Batch delete books
        for book_id in books_to_delete {
            BookRepository::delete(db, &book_id).await?;
            count += 1;
        }
        
        // Batch save images
        use crate::book_service::repositories::ImageRepository;
        for (book_id, href, mime_type, data) in images_to_save {
            ImageRepository::save(db, &book_id, &href, &mime_type, &data).await?;
            count += 1;
        }
        
        // Batch save audio data
        use crate::book_service::repositories::AudioRepository;
        for (book_id, href, data) in audio_data_to_save {
            AudioRepository::save_data(db, &book_id, &href, &data).await?;
            count += 1;
        }
        
        // Save app settings
        if let Some(settings) = app_settings_to_save {
            use crate::book_service::repositories::SettingsRepository;
            SettingsRepository::save(db, &settings).await?;
            count += 1;
        }
        
        // Save reader preferences
        if let Some(preferences) = reader_preferences_to_save {
            use crate::book_service::repositories::ReaderPreferencesRepository;
            ReaderPreferencesRepository::save(db, &preferences).await?;
            count += 1;
        }
        
        Ok(count)
    }
    
    /// Force immediate sync (for critical operations)
    pub async fn sync_now(
        &self,
        db: &DatabaseConnection,
    ) -> Result<usize, String> {
        let operations = self.drain_write_queue().await;
        Self::sync_to_sqlite(db, operations).await
    }
}

