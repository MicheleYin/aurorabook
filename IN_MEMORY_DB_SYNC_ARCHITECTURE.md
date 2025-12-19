# In-Memory Database with Periodic SQLite Sync Architecture

## Overview

This architecture implements a Redis-like in-memory database that provides fast concurrent access and periodically syncs to SQLite for persistence. This solves SQLite's concurrency limitations (single writer) by batching writes and performing them asynchronously.

## Architecture Design

### Components

1. **In-Memory Store** - Fast concurrent data structures (DashMap, Arc<Mutex<HashMap>>)
2. **Write Queue** - Batches writes for efficient SQLite sync
3. **Background Sync Task** - Periodically flushes writes to SQLite
4. **Read-Through Cache** - Reads from memory first, falls back to SQLite
5. **Write-Through for Critical Operations** - Immediate sync for important writes

### Data Flow

```
┌─────────────┐
│   Client    │
└──────┬──────┘
       │
       ▼
┌─────────────────────────────────┐
│   In-Memory Store (DashMap)    │  ← Fast concurrent reads/writes
│   - Books HashMap               │
│   - Chapters HashMap            │
│   - Audio Tracks HashMap        │
│   - Write Queue (Vec)          │
└──────┬──────────────────────────┘
       │
       │ Periodic Sync (every N seconds)
       │ or on critical operations
       ▼
┌─────────────────────────────────┐
│   SQLite Database (File)        │  ← Persistent storage
│   - Batched writes              │
│   - Single writer (no blocking)│
└─────────────────────────────────┘
```

## Implementation Strategy

### Option 1: Full In-Memory Store (Recommended)

**Pros:**
- Maximum concurrency (no SQLite locks)
- Very fast reads/writes
- Simple to implement

**Cons:**
- Memory usage (all data in RAM)
- Risk of data loss if app crashes before sync
- Need to load all data on startup

**Best for:** Small to medium libraries (< 1000 books)

### Option 2: Hybrid (Memory + SQLite Reads)

**Pros:**
- Lower memory usage (only frequently accessed data in memory)
- Can handle large libraries
- Still fast for hot data

**Cons:**
- More complex (need to track what's in memory)
- May need to evict data

**Best for:** Large libraries (1000+ books)

### Option 3: Write-Behind Cache (Current Cache + Write Queue)

**Pros:**
- Minimal changes to existing code
- Uses existing cache infrastructure
- Gradual migration

**Cons:**
- Still uses SQLite for reads (slower)
- More complex sync logic

**Best for:** Incremental migration

## Recommended Implementation: Option 1 (Full In-Memory)

### Core Data Structures

```rust
use dashmap::DashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use std::collections::HashMap;

pub struct InMemoryStore {
    // Primary data stores
    books: DashMap<String, Book>,
    chapters: DashMap<String, Vec<Chapter>>, // book_id -> chapters
    audio_tracks: DashMap<String, Vec<AudioTrack>>, // book_id -> tracks
    images: DashMap<(String, String), (String, Vec<u8>)>, // (book_id, href) -> (mime_type, data)
    audio_data: DashMap<(String, String), Vec<u8>>, // (book_id, href) -> data
    
    // Write queue for batching SQLite syncs
    write_queue: Arc<RwLock<Vec<WriteOperation>>>,
    
    // Sync state
    last_sync: Arc<RwLock<std::time::Instant>>,
    sync_interval: Duration,
}

enum WriteOperation {
    SaveBook(Book),
    UpdateBookProgress(String, BookProgress),
    UpdateBookAudioState(String, BookAudioState),
    SaveChapter(String, Chapter), // book_id, chapter
    UpdateChapterContent(String, String, String, Option<String>), // book_id, chapter_id, html, plain_text
    SaveAudioTrack(String, AudioTrack), // book_id, track
    SaveImage(String, String, String, Vec<u8>), // book_id, href, mime_type, data
    DeleteBook(String),
    // ... etc
}
```

### Key Features

1. **Concurrent Access**: DashMap provides lock-free concurrent reads and writes
2. **Write Batching**: All writes go to a queue, synced periodically
3. **Read-Through**: Reads from memory (instant), falls back to SQLite if not in memory
4. **Write-Through for Critical**: Progress updates can sync immediately
5. **Background Sync**: Tokio task syncs queue to SQLite every N seconds

## Implementation Details

### 1. In-Memory Store Module

```rust
// src/book_service/in_memory_store.rs

use dashmap::DashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use std::time::{Duration, Instant};
use crate::book_service::models::*;

pub struct InMemoryStore {
    books: DashMap<String, Book>,
    chapters: DashMap<String, Vec<Chapter>>,
    audio_tracks: DashMap<String, Vec<AudioTrack>>,
    images: DashMap<String, (String, Vec<u8>)>, // key: "{book_id}:{href}"
    audio_data: DashMap<String, Vec<u8>>, // key: "{book_id}:{href}"
    
    write_queue: Arc<RwLock<Vec<WriteOperation>>>,
    last_sync: Arc<RwLock<Instant>>,
    sync_interval: Duration,
    sync_running: Arc<RwLock<bool>>,
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
    SaveAudioTrack { book_id: String, track: AudioTrack },
    SaveImage { book_id: String, href: String, mime_type: String, data: Vec<u8> },
    DeleteBook { book_id: String },
}

impl InMemoryStore {
    pub fn new(sync_interval: Duration) -> Self {
        Self {
            books: DashMap::new(),
            chapters: DashMap::new(),
            audio_tracks: DashMap::new(),
            images: DashMap::new(),
            audio_data: DashMap::new(),
            write_queue: Arc::new(RwLock::new(Vec::new())),
            last_sync: Arc::new(RwLock::new(Instant::now())),
            sync_interval,
            sync_running: Arc::new(RwLock::new(false)),
        }
    }
    
    // Fast in-memory reads
    pub fn get_book(&self, book_id: &str) -> Option<Book> {
        self.books.get(book_id).map(|entry| entry.value().clone())
    }
    
    pub fn get_chapters(&self, book_id: &str) -> Option<Vec<Chapter>> {
        self.chapters.get(book_id).map(|entry| entry.value().clone())
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
    
    // Background sync task
    pub async fn start_sync_task(
        &self,
        db: Arc<DatabaseConnection>,
    ) -> tokio::task::JoinHandle<()> {
        let store = Arc::new(self.clone()); // Need to make InMemoryStore cloneable or use Arc
        let write_queue = self.write_queue.clone();
        let last_sync = self.last_sync.clone();
        let sync_interval = self.sync_interval;
        let sync_running = self.sync_running.clone();
        
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(sync_interval);
            
            loop {
                interval.tick().await;
                
                // Check if there are writes to sync
                let queue_len = {
                    let queue = write_queue.read().await;
                    queue.len()
                };
                
                if queue_len > 0 {
                    *sync_running.write().await = true;
                    
                    // Drain write queue
                    let operations = {
                        let mut queue = write_queue.write().await;
                        queue.drain(..).collect::<Vec<_>>()
                    };
                    
                    // Sync to SQLite
                    if let Err(e) = Self::sync_to_sqlite(&db, operations).await {
                        log::error!("Failed to sync to SQLite: {}", e);
                        // Could re-queue failed operations
                    } else {
                        *last_sync.write().await = Instant::now();
                        log::debug!("Synced {} operations to SQLite", queue_len);
                    }
                    
                    *sync_running.write().await = false;
                }
            }
        })
    }
    
    async fn sync_to_sqlite(
        db: &DatabaseConnection,
        operations: Vec<WriteOperation>,
    ) -> Result<(), String> {
        use sea_orm::TransactionTrait;
        
        // Group operations by type for batch processing
        let mut books_to_save = Vec::new();
        let mut progress_updates = Vec::new();
        // ... etc
        
        for op in operations {
            match op {
                WriteOperation::SaveBook(book) => {
                    books_to_save.push(book);
                }
                WriteOperation::UpdateBookProgress { book_id, progress } => {
                    progress_updates.push((book_id, progress));
                }
                // ... handle other operations
            }
        }
        
        // Batch write to SQLite in a single transaction
        let txn = db.begin().await
            .map_err(|e| format!("Failed to begin transaction: {}", e))?;
        
        // Batch save books
        for book in books_to_save {
            // Use existing repository save logic
            // BookRepository::save_internal(&txn, &book).await?;
        }
        
        // Batch update progress
        for (book_id, progress) in progress_updates {
            // BookRepository::update_progress_internal(&txn, &book_id, &progress).await?;
        }
        
        txn.commit().await
            .map_err(|e| format!("Failed to commit transaction: {}", e))?;
        
        Ok(())
    }
    
    // Load all data from SQLite on startup
    pub async fn load_from_sqlite(db: &DatabaseConnection) -> Result<Self, String> {
        let store = Self::new(Duration::from_secs(5)); // 5 second sync interval
        
        // Load all books
        let books = BookRepository::find_all(db).await?;
        for book in books {
            store.books.insert(book.id.clone(), book);
        }
        
        // Load chapters and audio tracks are loaded on-demand or can be preloaded
        
        Ok(store)
    }
}
```

### 2. Modified Repository Pattern

```rust
// Wrapper that uses in-memory store
pub struct BookRepositoryWithMemory {
    memory: Arc<InMemoryStore>,
    db: Arc<DatabaseConnection>,
}

impl BookRepositoryWithMemory {
    pub async fn find_by_id(&self, book_id: &str) -> Result<Option<Book>, String> {
        // Try memory first
        if let Some(book) = self.memory.get_book(book_id) {
            return Ok(Some(book));
        }
        
        // Fall back to SQLite
        let book = BookRepository::find_by_id(self.db.as_ref(), book_id).await?;
        
        // Cache in memory
        if let Some(ref book) = book {
            self.memory.books.insert(book_id.to_string(), book.clone());
        }
        
        Ok(book)
    }
    
    pub async fn save(&self, book: Book) -> Result<(), String> {
        // Write to memory immediately (fast)
        self.memory.save_book(book).await;
        
        // Optionally: sync critical writes immediately
        // For non-critical writes, let background task handle it
        Ok(())
    }
    
    pub async fn update_progress(&self, book_id: String, progress: BookProgress) -> Result<(), String> {
        // Write to memory immediately
        self.memory.update_progress(book_id.clone(), progress.clone()).await;
        
        // Progress updates are critical - sync immediately
        BookRepository::update_progress_only(self.db.as_ref(), &book_id, &progress).await?;
        
        Ok(())
    }
}
```

### 3. Initialization

```rust
// In database.rs
pub async fn init_db_connection(app: &AppHandle) -> Result<(), String> {
    // ... existing SQLite initialization ...
    
    // Create in-memory store
    let memory_store = InMemoryStore::load_from_sqlite(&db).await?;
    
    // Start background sync task
    let sync_handle = memory_store.start_sync_task(Arc::new(db.clone())).await;
    
    // Store globally
    IN_MEMORY_STORE.set(Arc::new(memory_store))
        .map_err(|_| "In-memory store already initialized")?;
    
    Ok(())
}
```

## Configuration

```rust
pub struct InMemoryConfig {
    /// How often to sync writes to SQLite (seconds)
    pub sync_interval: Duration,
    
    /// Whether to sync critical operations immediately
    pub immediate_sync_for_critical: bool,
    
    /// Maximum queue size before forcing sync
    pub max_queue_size: usize,
    
    /// Whether to preload all data on startup
    pub preload_on_startup: bool,
}

impl Default for InMemoryConfig {
    fn default() -> Self {
        Self {
            sync_interval: Duration::from_secs(5), // Sync every 5 seconds
            immediate_sync_for_critical: true, // Progress updates sync immediately
            max_queue_size: 1000, // Force sync if queue gets too large
            preload_on_startup: true, // Load all books into memory
        }
    }
}
```

## Benefits

1. **Concurrent Writes**: No SQLite write locks - all writes go to memory first
2. **Fast Reads**: Instant reads from memory (no disk I/O)
3. **Batched Writes**: Efficient SQLite writes in batches
4. **No Blocking**: App never waits for SQLite writes (except critical ops)
5. **Scalable**: Can handle many concurrent operations

## Trade-offs

1. **Memory Usage**: All data in RAM (acceptable for < 1000 books)
2. **Data Loss Risk**: Writes in queue lost if app crashes (mitigate with immediate sync for critical ops)
3. **Startup Time**: Need to load data from SQLite on startup (can be async)
4. **Complexity**: More complex than direct SQLite access

## Migration Path

1. **Phase 1**: Add in-memory store alongside existing code
2. **Phase 2**: Route reads through in-memory store (fallback to SQLite)
3. **Phase 3**: Route writes through in-memory store
4. **Phase 4**: Remove direct SQLite access from repositories

## Alternative: Use SQLite In-Memory Mode

SQLite supports in-memory databases that can be periodically saved:

```rust
// Use in-memory SQLite
let db_url = "sqlite::memory:";

// Periodically save to file
// ATTACH DATABASE 'file.db' AS disk;
// BEGIN;
// INSERT INTO disk.books SELECT * FROM books;
// COMMIT;
```

But this still has the single-writer limitation, so the custom in-memory store is better.

