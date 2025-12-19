use crate::book_service::hybrid_store::HybridStore;
use crate::book_service::models::*;
use sea_orm::DatabaseConnection;

/// Hybrid repository that uses in-memory store with SQLite fallback
pub struct HybridRepository;

impl HybridRepository {
    /// Find book by ID (memory first, then SQLite)
    pub async fn find_book_by_id(
        store: &HybridStore,
        db: &DatabaseConnection,
        book_id: &str,
    ) -> Result<Option<Book>, String> {
        // Try memory first (instant if loaded)
        if let Some(book) = store.get_book(book_id) {
            return Ok(Some(book));
        }
        
        // Fall back to SQLite
        use crate::book_service::repositories::BookRepository;
        let book = BookRepository::find_by_id(db, book_id).await?;
        
        // Load into memory for next time (if found)
        if let Some(ref book) = book {
            store.load_book(book.clone()).await;
        }
        
        Ok(book)
    }
    
    /// Find all books (loads frequently accessed ones into memory)
    pub async fn find_all_books(
        store: &HybridStore,
        db: &DatabaseConnection,
    ) -> Result<Vec<Book>, String> {
        use crate::book_service::repositories::BookRepository;
        
        // Get all books from SQLite
        let books = BookRepository::find_all(db).await?;
        
        // Load recently accessed books into memory (e.g., last 20)
        // This is a simple heuristic - could be improved with access tracking
        let books_to_load = books.iter()
            .take(20) // Load first 20 (could be based on last_opened_time)
            .cloned()
            .collect::<Vec<_>>();
        
        for book in books_to_load {
            if !store.is_book_loaded(&book.id) {
                store.load_book(book).await;
            }
        }
        
        Ok(books)
    }
    
    /// Get chapters (memory first, then SQLite)
    pub async fn get_chapters(
        store: &HybridStore,
        db: &DatabaseConnection,
        book_id: &str,
    ) -> Result<Vec<Chapter>, String> {
        // Try memory first
        if let Some(chapters) = store.get_chapters(book_id) {
            return Ok(chapters);
        }
        
        // Fall back to SQLite
        use crate::book_service::repositories::ChapterRepository;
        let chapters = ChapterRepository::find_by_book_id(db, book_id).await?;
        
        // Load into memory for next time
        store.load_chapters(book_id.to_string(), chapters.clone()).await;
        
        Ok(chapters)
    }
    
    /// Get audio tracks (memory first, then SQLite)
    pub async fn get_audio_tracks(
        store: &HybridStore,
        db: &DatabaseConnection,
        book_id: &str,
    ) -> Result<Vec<AudioTrack>, String> {
        // Try memory first
        if let Some(tracks) = store.get_audio_tracks(book_id) {
            return Ok(tracks);
        }
        
        // Fall back to SQLite
        use crate::book_service::repositories::AudioRepository;
        let tracks = AudioRepository::find_by_book_id(db, book_id).await?;
        
        // Load into memory for next time
        store.load_audio_tracks(book_id.to_string(), tracks.clone()).await;
        
        Ok(tracks)
    }
    
    /// Save book (writes to memory if loaded, queues for SQLite)
    pub async fn save_book(
        store: &HybridStore,
        book: Book,
    ) -> Result<(), String> {
        // Write to memory if loaded, queue for SQLite
        store.save_book(book).await;
        Ok(())
    }
    
    /// Update progress (updates memory if loaded, syncs immediately for critical ops)
    pub async fn update_progress(
        store: &HybridStore,
        db: &DatabaseConnection,
        book_id: &str,
        progress: &BookProgress,
        sync_immediately: bool,
    ) -> Result<(), String> {
        // Update memory if loaded
        store.update_progress(book_id.to_string(), progress.clone()).await;
        
        if sync_immediately {
            // Critical operation - sync now
            use crate::book_service::repositories::BookRepository;
            BookRepository::update_progress_only(db, book_id, progress).await?;
        }
        // Otherwise, let background task handle it
        
        Ok(())
    }
    
    /// Update audio state (updates memory if loaded, syncs immediately for critical ops)
    pub async fn update_audio_state(
        store: &HybridStore,
        db: &DatabaseConnection,
        book_id: &str,
        audio_state: &BookAudioState,
        sync_immediately: bool,
    ) -> Result<(), String> {
        store.update_audio_state(book_id.to_string(), audio_state.clone()).await;
        
        if sync_immediately {
            use crate::book_service::repositories::BookRepository;
            BookRepository::update_audio_state_only(db, book_id, audio_state).await?;
        }
        
        Ok(())
    }
}

