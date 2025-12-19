# Hybrid Store Usage Guide

## Overview

The hybrid store implements Option 2: Hybrid (Memory + SQLite Reads) architecture. It keeps frequently accessed data in memory with LRU eviction, while falling back to SQLite for cold data.

## Key Features

1. **Smart Loading**: Only loads frequently accessed books/chapters into memory
2. **LRU Eviction**: Automatically evicts least recently used data when limits are reached
3. **Write Queue**: Batches writes and syncs to SQLite periodically (every 5 seconds)
4. **Immediate Sync**: Critical operations (progress updates) can sync immediately
5. **Memory Efficient**: Configurable limits prevent unbounded memory growth

## Configuration

Default limits (in `database.rs`):
- **Max books in memory**: 50
- **Max chapter lists in memory**: 100
- **Max audio track lists in memory**: 100
- **Sync interval**: 5 seconds

## Usage Examples

### Reading Data

```rust
use crate::book_service::database::get_hybrid_store;
use crate::book_service::hybrid_repository::HybridRepository;

// Get book (memory first, then SQLite)
let store = get_hybrid_store()?;
let db = get_db_connection(&app).await?;

let book = HybridRepository::find_book_by_id(
    store.as_ref(),
    db.as_ref(),
    &book_id,
).await?;
```

### Writing Data

```rust
// Save book (queued for background sync)
HybridRepository::save_book(store.as_ref(), book).await?;

// Update progress (immediate sync for critical ops)
HybridRepository::update_progress(
    store.as_ref(),
    db.as_ref(),
    &book_id,
    &progress,
    true, // sync immediately
).await?;
```

### Loading Data into Memory

```rust
// Manually load a book into memory (useful for preloading)
let book = BookRepository::find_by_id(db.as_ref(), &book_id).await?;
if let Some(book) = book {
    store.load_book(book).await;
}
```

## Benefits

1. **Handles Large Libraries**: Only keeps hot data in memory
2. **Fast for Hot Data**: Instant reads for frequently accessed books
3. **Memory Bounded**: LRU eviction prevents unbounded growth
4. **No Write Blocking**: Writes go to memory first, sync in background
5. **Scalable**: Can handle 1000+ books efficiently

## Monitoring

```rust
// Get memory statistics
let stats = store.get_stats();
println!("Books in memory: {}", stats["books_in_memory"]);
println!("Pending writes: {}", store.pending_writes().await);
```

## Migration Path

The hybrid store works alongside existing repositories. You can:
1. Use hybrid repository for new code
2. Gradually migrate existing code
3. Keep direct SQLite access for operations that don't need caching

