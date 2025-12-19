# Disk Usage Optimization Report

## Executive Summary

This report identifies opportunities to significantly reduce disk usage in the database. Current storage patterns include large BLOBs, duplicate data, and uncompressed content that can be optimized.

## Current Disk Usage Analysis

### Major Storage Consumers

1. **`epub_data` table** - Stores entire original EPUB files (typically 1-50 MB per book)
2. **`images` table** - Stores all images from EPUBs as BLOBs (can be 10-100 MB per book)
3. **`audio_tracks` table** - Stores audio files as BLOBs (can be 100+ MB per book)
4. **`chapters` table** - Stores `content_html` and `plain_text` (can be 1-10 MB per book)

### Estimated Storage per Book

For a typical EPUB book:
- Original EPUB: ~5 MB
- Images: ~10 MB
- Audio tracks: ~50 MB (if converted)
- Chapter content: ~2 MB
- **Total: ~67 MB per book**

For a library with 100 books: **~6.7 GB**

## Critical Issues

### 1. Duplicate Storage: EPUB File + Extracted Content

**Location**: `epub_data` table stores the entire EPUB, but all content is also extracted into:
- `chapters` table (content_html, plain_text)
- `images` table (data BLOB)
- `audio_tracks` table (data BLOB)

**Problem**: The same data is stored twice:
- Original EPUB file in `epub_data`
- All extracted content in separate tables

**Impact**: **HIGH** - Can double storage requirements.

**Current Usage**: 
- `epub_data` is used during conversion (`conversion_command.rs:140`)
- `get_epub_buffer` still reads from `epub_data` (API compatibility)
- But the comment says "EPUB data is no longer stored separately" in `add_book()`

**Solution Options**:

**Option A: Remove `epub_data` table entirely** (Recommended if source files are accessible)
- Store only the `source_path` in the books table
- Read EPUB from filesystem when needed for conversion
- **Savings**: 100% of EPUB storage (~5 MB per book)

**Option B: Make `epub_data` optional**
- Only store EPUB if source file might be deleted/moved
- Add a flag to indicate if source file is still available
- **Savings**: Variable, but can eliminate most EPUB storage

**Option C: Compress `epub_data`**
- Use gzip/brotli compression (EPUBs are already ZIP files, but can still compress further)
- **Savings**: 10-30% (EPUBs are already compressed)

### 2. Large BLOBs Stored in Database

**Location**: 
- `images.data BLOB NOT NULL`
- `audio_tracks.data BLOB`

**Problem**: Storing large binary files in SQLite:
- Increases database file size significantly
- Slows down backups and VACUUM operations
- Reduces query performance
- Makes database file harder to manage

**Impact**: **HIGH** - Can make database file 10+ GB for a medium library.

**Solution**: Move BLOBs to filesystem, store only file paths in database.

**Implementation**:
```rust
// Add file_path columns
ALTER TABLE images ADD COLUMN file_path TEXT;
ALTER TABLE audio_tracks ADD COLUMN file_path TEXT;

// Storage structure:
// {app_data_dir}/media/
//   {book_id}/
//     images/
//       {hash}.{ext}
//     audio/
//       {hash}.mp3
```

**Savings**: 
- Database file size: 50-90% reduction
- Better performance: Faster queries, easier backups
- **Estimated savings**: 50-100 MB per book (images + audio)

**Migration Strategy**:
1. Add `file_path` columns (nullable)
2. Create migration script to move existing BLOBs to filesystem
3. Update repositories to read from filesystem
4. Eventually remove `data` columns (or keep for backward compatibility)

### 3. Large TEXT Fields in Chapters Table

**Location**: `chapters.content_html TEXT`, `chapters.plain_text TEXT`

**Problem**: Chapter content can be very large (hundreds of KB to MB per chapter):
- Loaded even when not needed (e.g., chapter list views)
- Increases database size
- Slows down queries that don't need content

**Impact**: **MEDIUM** - Can be 1-10 MB per book.

**Solution Options**:

**Option A: Move to separate table** (Normalize)
```sql
CREATE TABLE chapter_content (
    chapter_id TEXT PRIMARY KEY,
    content_html TEXT,
    plain_text TEXT,
    FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
);
```
- **Savings**: Minimal (same data, just organized differently)
- **Benefit**: Faster chapter list queries (don't load content)

**Option B: Store in filesystem**
- Store content as files: `{app_data_dir}/media/{book_id}/chapters/{chapter_id}.html`
- **Savings**: Database size reduction, but adds file management complexity

**Option C: Compress content**
- Use gzip compression for content_html and plain_text
- Store as BLOB instead of TEXT
- **Savings**: 60-80% for HTML/text content
- **Estimated**: 1-8 MB per book → 200 KB - 1.6 MB per book

**Recommendation**: Option C (compression) - Best balance of savings and simplicity.

### 4. No Compression Applied

**Location**: All BLOB and TEXT fields stored uncompressed.

**Problem**: 
- Images: Already compressed (JPEG/PNG), but could use better formats (WebP)
- Audio: Already compressed (MP3), but could optimize bitrate
- Text/HTML: Can compress 60-80%
- EPUB: Already ZIP compressed, but could use better compression

**Impact**: **MEDIUM** - 20-40% potential savings overall.

**Solution**: Add compression layer for compressible data:
- Compress `content_html` and `plain_text` with gzip/brotli
- Consider WebP for images (if re-encoding is acceptable)
- Optimize audio bitrate (if re-encoding is acceptable)

**Implementation**:
```rust
use flate2::write::GzEncoder;
use flate2::Compression;

// Compress before storing
let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
encoder.write_all(content_html.as_bytes())?;
let compressed = encoder.finish()?;

// Store compressed data as BLOB
// Add compression flag to indicate data is compressed
```

**Savings**: 
- Text content: 60-80% reduction
- **Estimated**: 2 MB per book → 400-800 KB per book

### 5. No Deduplication

**Problem**: 
- Same images might appear in multiple books (e.g., publisher logos)
- Same audio segments might be reused
- No content-addressable storage

**Impact**: **LOW-MEDIUM** - Depends on library content overlap.

**Solution**: Content-addressable storage with deduplication:
- Hash content (SHA-256)
- Store files by hash: `{app_data_dir}/media/{hash[0:2]}/{hash[2:4]}/{hash}.{ext}`
- Reference by hash in database
- **Savings**: Variable, but can eliminate duplicates

**Implementation Complexity**: High - requires careful migration and reference management.

### 6. WAL Files Can Grow Large

**Location**: SQLite WAL (Write-Ahead Log) files.

**Problem**: WAL files can grow if not checkpointed regularly.

**Impact**: **LOW** - Usually small, but can grow with heavy writes.

**Solution**: Ensure regular checkpointing:
```rust
// After major operations, checkpoint WAL
db.execute_unprepared("PRAGMA wal_checkpoint(TRUNCATE)").await?;
```

**Savings**: Minimal, but prevents unbounded growth.

## Recommended Optimizations (Priority Order)

### Priority 1: High Impact, Medium Effort

1. **Move BLOBs to Filesystem** ⭐⭐⭐
   - **Effort**: Medium (requires migration)
   - **Savings**: 50-100 MB per book
   - **Impact**: Massive reduction in database file size

2. **Compress Chapter Content** ⭐⭐
   - **Effort**: Low-Medium
   - **Savings**: 1-8 MB per book → 200 KB - 1.6 MB
   - **Impact**: Significant for text-heavy books

3. **Remove or Make Optional `epub_data` Table** ⭐⭐
   - **Effort**: Low (if source files are accessible)
   - **Savings**: ~5 MB per book
   - **Impact**: Eliminates duplicate storage

### Priority 2: Medium Impact, Low Effort

4. **Normalize Chapter Content** ⭐
   - **Effort**: Low
   - **Savings**: Minimal (organizational benefit)
   - **Impact**: Faster queries, better organization

5. **Add WAL Checkpointing** ⭐
   - **Effort**: Very Low
   - **Savings**: Prevents unbounded growth
   - **Impact**: Maintenance improvement

### Priority 3: Lower Impact, Higher Effort

6. **Content Deduplication** 
   - **Effort**: High
   - **Savings**: Variable (depends on content overlap)
   - **Impact**: Can be significant for large libraries with similar content

7. **Image/Audio Re-encoding**
   - **Effort**: High (requires re-encoding pipeline)
   - **Savings**: 10-30% for images, 20-50% for audio
   - **Impact**: Moderate, but requires user acceptance of quality changes

## Estimated Total Savings

### Per Book (Typical EPUB):
- Current: ~67 MB
- After Priority 1 optimizations: ~10-15 MB
- **Savings: 75-85% reduction**

### For 100 Books:
- Current: ~6.7 GB
- After optimizations: ~1.0-1.5 GB
- **Savings: ~5.2-5.7 GB (75-85% reduction)**

## Implementation Notes

### Migration Considerations

1. **Backward Compatibility**: 
   - Keep `data` columns initially (nullable)
   - Support both filesystem and database storage during migration
   - Add feature flag to enable new storage method

2. **Data Migration**:
   - Create migration script to move existing BLOBs
   - Verify data integrity after migration
   - Provide rollback option

3. **Performance**:
   - Filesystem access might be slightly slower than database for small files
   - But database queries will be much faster (smaller file)
   - Overall performance should improve

### Testing Requirements

1. Test with large books (100+ chapters, many images)
2. Test migration of existing databases
3. Verify file cleanup on book deletion
4. Test concurrent access to filesystem storage

## Additional Recommendations

### Database Maintenance

1. **Regular VACUUM**: Reclaim space after deletions
   ```rust
   db.execute_unprepared("VACUUM").await?;
   ```

2. **ANALYZE**: Update query planner statistics
   ```rust
   db.execute_unprepared("ANALYZE").await?;
   ```

3. **Monitor Database Size**: Add logging to track growth

### Storage Monitoring

Add utilities to:
- Report database file size
- Report filesystem media storage size
- Identify largest books
- Suggest cleanup opportunities

## Conclusion

The biggest wins for disk usage reduction are:
1. **Moving BLOBs to filesystem** (50-100 MB per book)
2. **Compressing chapter content** (1-8 MB per book)
3. **Removing duplicate EPUB storage** (~5 MB per book)

Implementing Priority 1 optimizations can reduce storage by **75-85%**, from ~67 MB per book to ~10-15 MB per book.

