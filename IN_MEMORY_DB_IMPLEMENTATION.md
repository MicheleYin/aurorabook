# In-Memory Database Implementation Guide

## Quick Start Implementation

This guide provides a practical, step-by-step implementation of an in-memory database that syncs to SQLite periodically.

## Step 1: Add Dependencies

Add to `Cargo.toml`:

```toml
[dependencies]
dashmap = "5.5"  # Lock-free concurrent HashMap
tokio = { version = "1", features = ["full"] }
```

## Step 2: Create In-Memory Store

Create `src/book_service/in_memory_store.rs`:

```rust
use dashmap::DashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use std::time::{Duration, Instant};
use crate::book_service::models::*;

/// In-memory store for fast concurrent access
/// Writes are queued and synced to SQLite periodically
pub struct InMemoryStore {
    // Primary data stores (concurrent HashMaps)
    pub books: DashMap<String, Book>,
    pub chapters: DashMap<String, Vec<Chapter>>, // book_id -> chapters
    pub audio_tracks: DashMap<String, Vec<AudioTrack>>, // book_id -> tracks
    
    // Write queue for batching SQLite syncs
    write_queue: Arc<RwLock<Vec<WriteOperation>>>,
    
    // Sync state
    last_sync: Arc<RwLock<Instant>>,
    sync_interval: Duration,
}

#[derive(Clone, Debug)]
pub enum WriteOperation {
    SaveBook(Book),
    UpdateBookProgress { book_id: String, progress: BookProgress },
    UpdateBookAudioState { book_id: String, audio_state: BookAudioState },
    SaveChapter { book_id: String, chapter: Chapter },
    UpdateChapterContent { 
        book_id: String, 
        chapter_id: String, 
        content_html: String, 
        plain_text: Option<String> 
    },
    DeleteBook { book_id: String },
}

impl InMemoryStore {
    pub fn new(sync_interval: Duration) -> Self {
        Self {
            books: DashMap::new(),
            chapters: DashMap::new(),
            audio_tracks: DashMap::new(),
            write_queue: Arc::new(RwLock::new(Vec::new())),
            last_sync: Arc::new(RwLock::new(Instant::now())),
            sync_interval,
        }
    }
    
    // Fast in-memory reads
    pub fn get_book(&self, book_id: &str) -> Option<Book> {
        self.books.get(book_id).map(|entry| entry.value().clone())
    }
    
    pub fn get_chapters(&self, book_id: &str) -> Option<Vec<Chapter>> {
        self.chapters.get(book_id).map(|entry| entry.value().clone())
    }
    
    pub fn get_audio_tracks(&self, book_id: &str) -> Option<Vec<AudioTrack>> {
        self.audio_tracks.get(book_id).map(|entry| entry.value().clone())
    }
    
    // Fast in-memory writes (queued for SQLite sync)
    pub async fn save_book(&self, book: Book) {
        // Update in-memory store immediately
        self.books.insert(book.id.clone(), book.clone());
        
        // Queue for SQLite sync
        let mut queue = self.write_queue.write().await;
        queue.push(WriteOperation::SaveBook(book));
    }
    
    pub async fn update_progress(&self, book_id: String, progress: BookProgress) {
        // Update in-memory store immediately
        if let Some(mut book) = self.books.get_mut(&book_id) {
            book.progress = Some(progress.clone());
        }
        
        // Queue for SQLite sync
        let mut queue = self.write_queue.write().await;
        queue.push(WriteOperation::UpdateBookProgress { book_id, progress });
    }
    
    pub async fn update_audio_state(&self, book_id: String, audio_state: BookAudioState) {
        if let Some(mut book) = self.books.get_mut(&book_id) {
            book.audio_state = Some(audio_state.clone());
        }
        
        let mut queue = self.write_queue.write().await;
        queue.push(WriteOperation::UpdateBookAudioState { book_id, audio_state });
    }
    
    pub async fn save_chapter(&self, book_id: String, chapter: Chapter) {
        // Update chapters list
        self.chapters.entry(book_id.clone()).or_insert_with(Vec::new)
            .push(chapter.clone());
        
        let mut queue = self.write_queue.write().await;
        queue.push(WriteOperation::SaveChapter { book_id, chapter });
    }
    
    // Get pending write count
    pub async fn pending_writes(&self) -> usize {
        self.write_queue.read().await.len()
    }
    
    // Drain write queue (for sync)
    pub async fn drain_write_queue(&self) -> Vec<WriteOperation> {
        let mut queue = self.write_queue.write().await;
        queue.drain(..).collect()
    }
    
    // Load all data from SQLite on startup
    pub async fn load_from_sqlite(
        db: &sea_orm::DatabaseConnection
    ) -> Result<Self, String> {
        use crate::book_service::repositories::BookRepository;
        
        let store = Self::new(Duration::from_secs(5)); // 5 second sync interval
        
        log::info!("Loading data from SQLite into memory...");
        
        // Load all books
        let books = BookRepository::find_all(db).await?;
        for book in books {
            store.books.insert(book.id.clone(), book);
        }
        
        log::info!("Loaded {} books into memory", store.books.len());
        
        Ok(store)
    }
}
```

## Step 3: Create Background Sync Task

Add to `src/book_service/in_memory_store.rs`:

```rust
impl InMemoryStore {
    /// Start background task that syncs writes to SQLite periodically
    pub fn start_sync_task(
        store: Arc<InMemoryStore>,
        db: Arc<sea_orm::DatabaseConnection>,
    ) -> tokio::task::JoinHandle<()> {
        let sync_interval = store.sync_interval;
        
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
                            *store.last_sync.write().await = Instant::now();
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
        db: &sea_orm::DatabaseConnection,
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
            }
        }
        
        // Batch write to SQLite in a single transaction
        let txn = db.begin().await
            .map_err(|e| format!("Failed to begin transaction: {}", e))?;
        
        let mut count = 0;
        
        // Batch save books
        for book in books_to_save {
            BookRepository::save(&txn, &book).await?;
            count += 1;
        }
        
        // Batch update progress
        for (book_id, progress) in progress_updates {
            BookRepository::update_progress_only(&txn, &book_id, &progress).await?;
            count += 1;
        }
        
        // Batch update audio state
        for (book_id, audio_state) in audio_state_updates {
            BookRepository::update_audio_state_only(&txn, &book_id, &audio_state).await?;
            count += 1;
        }
        
        // Batch save chapters
        for (book_id, chapter) in chapters_to_save {
            ChapterRepository::save(&txn, &book_id, &chapter).await?;
            count += 1;
        }
        
        // Batch update chapter content
        for (book_id, chapter_id, content_html, plain_text) in chapter_content_updates {
            ChapterRepository::update_content(
                &txn,
                &book_id,
                &chapter_id,
                &content_html,
                plain_text.as_deref(),
            ).await?;
            count += 1;
        }
        
        // Batch delete books
        for book_id in books_to_delete {
            BookRepository::delete(&txn, &book_id).await?;
            count += 1;
        }
        
        txn.commit().await
            .map_err(|e| format!("Failed to commit transaction: {}", e))?;
        
        Ok(count)
    }
    
    /// Force immediate sync (for critical operations)
    pub async fn sync_now(
        &self,
        db: &sea_orm::DatabaseConnection,
    ) -> Result<usize, String> {
        let operations = self.drain_write_queue().await;
        Self::sync_to_sqlite(db, operations).await
    }
}
```

## Step 4: Integrate with Database Module

Modify `src/book_service/database.rs`:

```rust
use crate::book_service::in_memory_store::InMemoryStore;
use tokio::sync::OnceCell;

static IN_MEMORY_STORE: OnceCell<Arc<InMemoryStore>> = OnceCell::const_new();
static SYNC_HANDLE: OnceCell<tokio::task::JoinHandle<()>> = OnceCell::const_new();

pub async fn init_db_connection(app: &AppHandle) -> Result<(), String> {
    // ... existing SQLite initialization ...
    
    // Create in-memory store and load data
    let memory_store = Arc::new(
        InMemoryStore::load_from_sqlite(&db).await?
    );
    
    // Start background sync task
    let sync_handle = InMemoryStore::start_sync_task(
        memory_store.clone(),
        Arc::new(db.clone()),
    );
    
    // Store globally
    IN_MEMORY_STORE.set(memory_store)
        .map_err(|_| "In-memory store already initialized")?;
    
    SYNC_HANDLE.set(sync_handle)
        .map_err(|_| "Sync handle already initialized")?;
    
    log::info!("In-memory store initialized with background sync");
    
    Ok(())
}

pub fn get_in_memory_store() -> Result<Arc<InMemoryStore>, String> {
    IN_MEMORY_STORE
        .get()
        .ok_or_else(|| "In-memory store not initialized".to_string())
        .map(|store| store.clone())
}
```

## Step 5: Create Hybrid Repository

Create `src/book_service/repositories/book_repository_memory.rs`:

```rust
use crate::book_service::in_memory_store::InMemoryStore;
use crate::book_service::models::*;
use sea_orm::DatabaseConnection;
use std::sync::Arc;

pub struct BookRepositoryMemory;

impl BookRepositoryMemory {
    /// Find book by ID (reads from memory first, falls back to SQLite)
    pub async fn find_by_id(
        memory: &InMemoryStore,
        db: &DatabaseConnection,
        book_id: &str,
    ) -> Result<Option<Book>, String> {
        // Try memory first (instant)
        if let Some(book) = memory.get_book(book_id) {
            return Ok(Some(book));
        }
        
        // Fall back to SQLite
        use crate::book_service::repositories::BookRepository;
        let book = BookRepository::find_by_id(db, book_id).await?;
        
        // Cache in memory for next time
        if let Some(ref book) = book {
            memory.books.insert(book_id.to_string(), book.clone());
        }
        
        Ok(book)
    }
    
    /// Save book (writes to memory immediately, queues for SQLite)
    pub async fn save(
        memory: &InMemoryStore,
        book: Book,
    ) -> Result<(), String> {
        // Write to memory immediately (no blocking)
        memory.save_book(book).await;
        Ok(())
    }
    
    /// Update progress (writes to memory + syncs immediately for critical ops)
    pub async fn update_progress(
        memory: &InMemoryStore,
        db: &DatabaseConnection,
        book_id: &str,
        progress: &BookProgress,
        sync_immediately: bool,
    ) -> Result<(), String> {
        // Update memory immediately
        memory.update_progress(book_id.to_string(), progress.clone()).await;
        
        if sync_immediately {
            // Critical operation - sync now
            use crate::book_service::repositories::BookRepository;
            BookRepository::update_progress_only(db, book_id, progress).await?;
        }
        // Otherwise, let background task handle it
        
        Ok(())
    }
    
    /// Get all books (from memory)
    pub fn find_all(memory: &InMemoryStore) -> Vec<Book> {
        memory.books.iter()
            .map(|entry| entry.value().clone())
            .collect()
    }
}
```

## Step 6: Update Module Exports

In `src/book_service/mod.rs`:

```rust
pub mod in_memory_store;
pub use in_memory_store::InMemoryStore;
```

## Step 7: Usage Example

```rust
// In your Tauri commands
#[tauri::command]
pub async fn get_book(
    book_id: String,
    app: tauri::AppHandle,
) -> AppResult<Option<Book>> {
    let memory = crate::book_service::database::get_in_memory_store()?;
    let db = get_db_connection(&app).await?;
    
    // Fast read from memory
    BookRepositoryMemory::find_by_id(
        memory.as_ref(),
        db.as_ref(),
        &book_id,
    ).await
    .map_err(|e| AppError::Store(e))
}

#[tauri::command]
pub async fn update_book_progress(
    book_id: String,
    progress: BookProgress,
    app: tauri::AppHandle,
) -> AppResult<()> {
    let memory = crate::book_service::database::get_in_memory_store()?;
    let db = get_db_connection(&app).await?;
    
    // Fast write to memory, immediate sync for progress
    BookRepositoryMemory::update_progress(
        memory.as_ref(),
        db.as_ref(),
        &book_id,
        &progress,
        true, // sync immediately
    ).await
    .map_err(|e| AppError::Store(e))
}
```

## Configuration

Add to your config or make it configurable:

```rust
// Sync interval: 5 seconds for normal operations
// Immediate sync for: progress updates, audio state, critical saves
// Background sync handles: book saves, chapter updates, etc.
```

## Benefits

1. **Zero Blocking**: Writes never block (except critical immediate syncs)
2. **Fast Reads**: Instant reads from memory
3. **Concurrent Access**: DashMap allows concurrent reads/writes
4. **Batched Writes**: Efficient SQLite writes in batches
5. **Data Safety**: Critical operations sync immediately

## Monitoring

Add monitoring to track sync performance:

```rust
pub async fn get_sync_stats(memory: &InMemoryStore) -> serde_json::Value {
    serde_json::json!({
        "pending_writes": memory.pending_writes().await,
        "books_in_memory": memory.books.len(),
        "last_sync": memory.last_sync.read().await.elapsed().as_secs(),
    })
}
```

## Migration Strategy

1. **Phase 1**: Add in-memory store, keep existing code
2. **Phase 2**: Route new code through in-memory store
3. **Phase 3**: Gradually migrate existing code
4. **Phase 4**: Remove direct SQLite access (optional)

This allows gradual migration without breaking existing functionality.

