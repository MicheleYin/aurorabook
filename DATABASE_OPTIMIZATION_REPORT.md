# Database Architecture Optimization Report

## Executive Summary

This report identifies several optimization opportunities in the database architecture that can significantly improve performance, reduce database size, and enhance scalability.

## Critical Issues

### 1. N+1 Query Problem in `BookRepository::find_all()`

**Location**: `src/book_service/repositories/book_repository.rs:153-167`

**Problem**: 
```rust
pub async fn find_all(db: &DatabaseConnection) -> Result<Vec<Book>, String> {
    let entities = book::Entity::find().all(db).await?;
    let mut books = Vec::new();
    for entity in entities {
        let chapters = ChapterRepository::find_by_book_id(db, &entity.id).await?;  // Query #1 per book
        let audio_tracks = AudioRepository::find_by_book_id(db, &entity.id).await?; // Query #2 per book
        books.push(Self::entity_to_model(entity, chapters, audio_tracks));
    }
    Ok(books)
}
```

For 10 books, this executes **21 queries** (1 + 10×2) instead of **3 queries** (1 for books, 1 for all chapters, 1 for all audio tracks).

**Impact**: High - This scales linearly with the number of books.

**Solution**: Use eager loading or batch queries:
```rust
// Load all books
let entities = book::Entity::find().all(db).await?;
let book_ids: Vec<String> = entities.iter().map(|e| e.id.clone()).collect();

// Load all chapters for all books in one query
let all_chapters = chapter::Entity::find()
    .filter(chapter::Column::BookId.is_in(book_ids.clone()))
    .order_by_asc(chapter::Column::BookId)
    .order_by_asc(chapter::Column::ChapterOrder)
    .all(db).await?;

// Load all audio tracks for all books in one query
let all_audio_tracks = audio_track::Entity::find()
    .filter(audio_track::Column::BookId.is_in(book_ids))
    .order_by_asc(audio_track::Column::BookId)
    .order_by_asc(audio_track::Column::TrackOrder)
    .all(db).await?;

// Group by book_id in memory
let chapters_by_book: HashMap<String, Vec<Chapter>> = /* group logic */;
let audio_tracks_by_book: HashMap<String, Vec<AudioTrack>> = /* group logic */;

// Build books
for entity in entities {
    let chapters = chapters_by_book.get(&entity.id).cloned().unwrap_or_default();
    let audio_tracks = audio_tracks_by_book.get(&entity.id).cloned().unwrap_or_default();
    books.push(Self::entity_to_model(entity, chapters, audio_tracks));
}
```

### 2. Sequential Inserts Instead of Batch Inserts

**Location**: `src/book_service/repositories/book_repository.rs:288-301`

**Problem**:
```rust
// Save chapters
for chapter in &model.chapters {
    ChapterRepository::save(&txn, &model.id, chapter).await?;  // One query per chapter
}

// Save audio tracks
for track in &model.audio_tracks {
    AudioRepository::save_metadata(&txn, &model.id, track).await?;  // One query per track
}
```

For a book with 50 chapters and 50 audio tracks, this executes **100+ individual INSERT queries**.

**Impact**: High - Significantly slower for books with many chapters/tracks.

**Solution**: Use batch inserts:
```rust
// Batch insert chapters
let chapter_models: Vec<chapter::ActiveModel> = model.chapters.iter()
    .map(|ch| ChapterRepository::model_to_active_model(&model.id, ch))
    .collect();
chapter::Entity::insert_many(chapter_models)
    .exec(&txn).await?;

// Batch insert audio tracks
let track_models: Vec<audio_track::ActiveModel> = model.audio_tracks.iter()
    .map(|t| AudioRepository::model_to_active_model(&model.id, t))
    .collect();
audio_track::Entity::insert_many(track_models)
    .exec(&txn).await?;
```

**Note**: SeaORM's `insert_many` may need to be chunked for large batches (SQLite has a limit of ~500-1000 values per statement).

### 3. Missing Composite Indexes

**Location**: `src/book_service/database.rs:258-272`

**Current Indexes**:
- `idx_chapters_book_id ON chapters(book_id)`
- `idx_images_book_id ON images(book_id)`
- `idx_audio_tracks_book_id ON audio_tracks(book_id)`

**Problem**: Many queries filter by both `book_id` AND `href`:
- `ChapterRepository::find_by_href()` - filters by `book_id` and `href`
- `ImageRepository::find_by_href()` - filters by `book_id` and `href`
- `AudioRepository::find_data_by_href()` - filters by `book_id` and `href`

**Impact**: Medium - Queries scan more rows than necessary.

**Solution**: Add composite indexes:
```sql
CREATE INDEX IF NOT EXISTS idx_chapters_book_id_href ON chapters(book_id, href);
CREATE INDEX IF NOT EXISTS idx_images_book_id_href ON images(book_id, href);
CREATE INDEX IF NOT EXISTS idx_audio_tracks_book_id_href ON audio_tracks(book_id, href);
```

**Note**: Since `(book_id, href)` is already UNIQUE, SQLite automatically creates an index. However, explicit composite indexes can help with query planning.

### 4. Large BLOB Storage in Database

**Location**: 
- `images` table: `data BLOB NOT NULL`
- `audio_tracks` table: `data BLOB`

**Problem**: Storing large binary data (images, audio files) directly in the database:
- Increases database file size significantly
- Slows down backups and migrations
- Reduces query performance (even when not selecting BLOB columns)
- Can hit SQLite's practical size limits (~140TB theoretical, but performance degrades with large files)

**Impact**: High - Database file can grow to several GB for a few books.

**Solution**: Store large BLOBs in filesystem, keep only metadata in DB:
```rust
// Store images/audio in: {app_data_dir}/media/{book_id}/{hash}.{ext}
// Store only path in database
ALTER TABLE images ADD COLUMN file_path TEXT;
ALTER TABLE audio_tracks ADD COLUMN file_path TEXT;
```

**Migration Strategy**:
1. Add `file_path` columns (nullable)
2. Migrate existing BLOBs to filesystem
3. Update queries to read from filesystem
4. Eventually remove `data` columns (or keep for backward compatibility)

### 5. Large TEXT Fields in Chapters Table

**Location**: `chapters` table: `content_html TEXT`, `plain_text TEXT`

**Problem**: Chapter content can be very large (hundreds of KB to MB per chapter). Storing this in the main table:
- Slows down queries that don't need content (e.g., listing chapters)
- Increases memory usage when loading chapter lists
- Makes the database file larger

**Impact**: Medium - Noticeable slowdown when loading chapter lists.

**Solution Options**:

**Option A**: Separate content table (normalize):
```sql
CREATE TABLE chapter_content (
    chapter_id TEXT PRIMARY KEY,
    content_html TEXT,
    plain_text TEXT,
    FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
);
```

**Option B**: Lazy loading - don't load content_html/plain_text in `find_by_book_id()`, only load when needed.

**Option C**: Store content in filesystem (similar to BLOBs).

**Recommendation**: Option B (lazy loading) is simplest and most effective. Add a separate method `find_content_by_id()` for when content is actually needed.

### 6. No Connection Pool Configuration

**Location**: `src/book_service/database.rs:53`

**Problem**: Using default SeaORM connection pool settings, which may not be optimal for SQLite.

**Impact**: Low-Medium - May limit concurrent operations.

**Solution**: Configure connection pool explicitly:
```rust
let mut opt = sea_orm::ConnectOptions::new(&db_url);
opt.max_connections(10)  // SQLite can handle multiple readers
    .min_connections(1)
    .sqlx_logging(false)  // Disable if not needed
    .sqlx_logging_level(log::LevelFilter::Info);

let db = Database::connect(opt).await?;
```

**Note**: SQLite supports multiple concurrent readers but only one writer at a time. The default pool size is usually fine, but explicit configuration is better.

### 7. Inefficient Cache Key Usage

**Location**: `src/book_service/cache.rs` and repositories

**Problem**: Using tuples `(String, String)` as cache keys:
```rust
pub type ChapterCache = Cache<(String, String), Arc<Chapter>>;
let cache_key = (book_id.to_string(), href.to_string());
```

**Impact**: Low - Minor performance overhead from tuple hashing vs string.

**Solution**: Use string concatenation with delimiter:
```rust
pub type ChapterCache = Cache<String, Arc<Chapter>>;
let cache_key = format!("{}:{}", book_id, href);
```

This is slightly more efficient and easier to debug.

### 8. Missing Index on Frequently Queried Columns

**Location**: Various queries

**Problem**: Some frequently queried columns lack indexes:
- `books.source_path` - has index ✓
- `chapters.href` - no index (but has UNIQUE constraint with book_id)
- `audio_tracks.href` - no index (but has UNIQUE constraint with book_id)

**Impact**: Low - UNIQUE constraints create indexes automatically in SQLite.

**Status**: Actually fine - SQLite automatically indexes UNIQUE columns.

### 9. No Query Result Pagination

**Location**: `BookRepository::find_all()`

**Problem**: Loading all books into memory at once. For large libraries (100+ books), this can be slow and memory-intensive.

**Impact**: Medium - Will become a problem as library grows.

**Solution**: Add pagination support:
```rust
pub async fn find_all_paginated(
    db: &DatabaseConnection,
    page: usize,
    page_size: usize,
) -> Result<(Vec<Book>, usize), String> {
    let total = book::Entity::find().count(db).await?;
    let entities = book::Entity::find()
        .limit(page_size as u64)
        .offset((page * page_size) as u64)
        .all(db).await?;
    // ... rest of logic
}
```

### 10. Transaction Scope Could Be Larger

**Location**: `BookRepository::save()`

**Current**: Transaction wraps book + chapters + audio tracks save. ✓ Good!

**Potential Improvement**: When saving multiple books in sequence, consider batching them in a single transaction (if the use case exists).

## Recommended Priority

1. **High Priority** (Do First):
   - Fix N+1 query in `find_all()` (#1)
   - Implement batch inserts (#2)
   - Add composite indexes (#3)

2. **Medium Priority** (Do Soon):
   - Move BLOBs to filesystem (#4)
   - Implement lazy loading for chapter content (#5)
   - Add pagination (#9)

3. **Low Priority** (Nice to Have):
   - Configure connection pool (#6)
   - Optimize cache keys (#7)
   - Consider larger transaction scopes (#10)

## Additional Recommendations

### Database Maintenance

1. **VACUUM**: Periodically run `VACUUM` to reclaim space after deletions:
   ```rust
   db.execute_unprepared("VACUUM").await?;
   ```

2. **ANALYZE**: Update query planner statistics:
   ```rust
   db.execute_unprepared("ANALYZE").await?;
   ```

3. **WAL Mode**: Consider enabling Write-Ahead Logging for better concurrency:
   ```rust
   let db_url = format!("sqlite://{}?mode=rwc", db_path_str);
   // Enable WAL after connection
   db.execute_unprepared("PRAGMA journal_mode=WAL").await?;
   ```

### Monitoring

Add query timing/logging to identify slow queries:
```rust
let start = std::time::Instant::now();
let result = query.execute(db).await?;
log::debug!("Query took {:?}", start.elapsed());
```

### Testing

Add performance tests to ensure optimizations don't regress:
- Test `find_all()` with 100 books
- Test `save()` with 100 chapters
- Measure query execution times

## Implementation Notes

- All optimizations should be backward compatible
- Consider database migrations for schema changes
- Test thoroughly before deploying
- Monitor performance improvements with benchmarks

