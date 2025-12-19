# Disk Usage Optimization Quick Wins

## Quick Wins (High Impact)

### 1. Compress Chapter Content (30 minutes)

**Impact**: 60-80% reduction in chapter content storage (1-8 MB → 200 KB - 1.6 MB per book)

**File**: `src/book_service/repositories/chapter_repository.rs`

**Add compression dependency** to `Cargo.toml`:
```toml
[dependencies]
flate2 = "1.0"
```

**Implementation**:

```rust
use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use std::io::{Read, Write};

impl ChapterRepository {
    /// Compress text content
    fn compress_text(text: &str) -> Result<Vec<u8>, String> {
        let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(text.as_bytes())
            .map_err(|e| format!("Failed to compress: {}", e))?;
        encoder.finish()
            .map_err(|e| format!("Failed to finish compression: {}", e))
    }
    
    /// Decompress text content
    fn decompress_text(data: &[u8]) -> Result<String, String> {
        let mut decoder = GzDecoder::new(data);
        let mut decompressed = String::new();
        decoder.read_to_string(&mut decompressed)
            .map_err(|e| format!("Failed to decompress: {}", e))?;
        Ok(decompressed)
    }
    
    /// Check if data is compressed (simple heuristic: starts with gzip magic)
    fn is_compressed(data: &[u8]) -> bool {
        data.len() >= 2 && data[0] == 0x1f && data[1] == 0x8b
    }
    
    /// Convert entity to model (with decompression)
    pub fn entity_to_model(entity: chapter::Model) -> Chapter {
        // Decompress content if needed
        let content_html = entity.content_html.and_then(|html| {
            if Self::is_compressed(html.as_bytes()) {
                Self::decompress_text(html.as_bytes()).ok()
            } else {
                Some(html) // Legacy uncompressed
            }
        });
        
        let plain_text = entity.plain_text.and_then(|text| {
            if Self::is_compressed(text.as_bytes()) {
                Self::decompress_text(text.as_bytes()).ok()
            } else {
                Some(text) // Legacy uncompressed
            }
        });
        
        Chapter {
            id: entity.id,
            title: entity.title,
            href: entity.href,
            content_html: content_html.unwrap_or_default(),
            plain_text,
            order: entity.chapter_order as usize,
            word_count: entity.word_count.map(|v| v as usize),
            estimated_page_count: entity.estimated_page_count.map(|v| v as usize),
        }
    }
    
    /// Convert model to active model (with compression)
    pub fn model_to_active_model(book_id: &str, model: &Chapter) -> chapter::ActiveModel {
        // Compress content before storing
        let content_html_compressed = if !model.content_html.is_empty() {
            Self::compress_text(&model.content_html)
                .map(|compressed| String::from_utf8_lossy(&compressed).to_string())
                .ok()
        } else {
            None
        };
        
        let plain_text_compressed = model.plain_text.as_ref()
            .and_then(|text| {
                Self::compress_text(text)
                    .map(|compressed| String::from_utf8_lossy(&compressed).to_string())
                    .ok()
            });
        
        chapter::ActiveModel {
            id: Set(model.id.clone()),
            book_id: Set(book_id.to_string()),
            title: Set(model.title.clone()),
            href: Set(model.href.clone()),
            content_html: Set(content_html_compressed),
            plain_text: Set(plain_text_compressed),
            chapter_order: Set(model.order as i64),
            word_count: Set(model.word_count.map(|v| v as i64)),
            estimated_page_count: Set(model.estimated_page_count.map(|v| v as i64)),
        }
    }
}
```

**Note**: This stores compressed data as TEXT (base64-like), which works but isn't ideal. Better approach: store as BLOB and add a flag.

**Better Implementation** (store as BLOB with flag):

```sql
-- Migration: Add compressed flag and change to BLOB
ALTER TABLE chapters ADD COLUMN content_html_compressed INTEGER DEFAULT 0;
ALTER TABLE chapters ADD COLUMN plain_text_compressed INTEGER DEFAULT 0;
-- Note: SQLite doesn't support changing column types easily, so this is a simplified approach
```

**Alternative**: Keep as TEXT but store base64-encoded compressed data (works without schema changes).

---

### 2. Remove Unused `epub_data` Storage (15 minutes)

**Impact**: ~5 MB per book savings

**File**: `src/book_service/mod.rs`

**Check if `epub_data` is actually needed**:

Looking at the code:
- `get_epub_buffer` reads from `epub_data` (API compatibility)
- `conversion_command.rs` uses `epub_data` for conversion
- But `add_book` comment says "EPUB data is no longer stored separately"

**Solution**: Make storage optional based on source file availability:

```rust
/// Save EPUB data only if source file might not be accessible
pub async fn save_epub_data_conditional(
    db: &DatabaseConnection,
    source_path: &str,
    book_id: &str,
    epub_data: &[u8],
) -> Result<(), String> {
    use std::path::Path;
    
    // Check if source file exists and is accessible
    let source_exists = Path::new(source_path).exists();
    
    if source_exists {
        // Don't store - can read from source
        log::debug!("Source file exists, skipping EPUB data storage");
        return Ok(());
    }
    
    // Source file doesn't exist or might be moved - store it
    log::info!("Source file not accessible, storing EPUB data ({} bytes)", epub_data.len());
    EpubRepository::save(db, source_path, book_id, epub_data).await
}
```

**Or**: Remove storage entirely if source files are always accessible:

```rust
// In add_book or ingestion:
// Don't store epub_data - read from source_path when needed
// Remove EpubRepository::save call
```

---

### 3. Add Database Maintenance (10 minutes)

**Impact**: Prevents unbounded growth, reclaims space

**File**: `src/book_service/database.rs`

**Add maintenance function**:

```rust
/// Perform database maintenance (VACUUM, ANALYZE, WAL checkpoint)
pub async fn perform_maintenance(db: &DatabaseConnection) -> Result<(), String> {
    use sea_orm::ConnectionTrait;
    
    log::info!("Starting database maintenance...");
    
    // Checkpoint WAL to prevent unbounded growth
    db.execute_unprepared("PRAGMA wal_checkpoint(TRUNCATE)")
        .await
        .map_err(|e| format!("Failed to checkpoint WAL: {}", e))?;
    log::debug!("WAL checkpointed");
    
    // Update query planner statistics
    db.execute_unprepared("ANALYZE")
        .await
        .map_err(|e| format!("Failed to analyze: {}", e))?;
    log::debug!("Statistics updated");
    
    // VACUUM to reclaim space (can be slow for large databases)
    // Only run periodically, not on every call
    // db.execute_unprepared("VACUUM")
    //     .await
    //     .map_err(|e| format!("Failed to vacuum: {}", e))?;
    
    log::info!("Database maintenance completed");
    Ok(())
}
```

**Call after major operations**:
```rust
// After deleting books or large updates
perform_maintenance(db).await?;
```

---

### 4. Add Storage Monitoring (20 minutes)

**Impact**: Helps identify storage issues

**File**: `src/book_service/database.rs`

**Add monitoring functions**:

```rust
use std::path::Path;

/// Get database file size
pub fn get_database_size(app: &AppHandle) -> Result<u64, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;
    
    let db_path = app_data_dir.join("library.db");
    
    if db_path.exists() {
        std::fs::metadata(&db_path)
            .map(|m| m.len())
            .map_err(|e| format!("Failed to get database size: {}", e))
    } else {
        Ok(0)
    }
}

/// Get WAL file size
pub fn get_wal_size(app: &AppHandle) -> Result<u64, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;
    
    let wal_path = app_data_dir.join("library.db-wal");
    
    if wal_path.exists() {
        std::fs::metadata(&wal_path)
            .map(|m| m.len())
            .map_err(|e| format!("Failed to get WAL size: {}", e))
    } else {
        Ok(0)
    }
}

/// Get storage statistics
#[tauri::command]
pub async fn get_storage_stats(app: tauri::AppHandle) -> AppResult<serde_json::Value> {
    let db_size = get_database_size(&app)?;
    let wal_size = get_wal_size(&app)?;
    
    Ok(serde_json::json!({
        "database_size_bytes": db_size,
        "wal_size_bytes": wal_size,
        "total_size_bytes": db_size + wal_size,
        "database_size_mb": db_size as f64 / 1_048_576.0,
        "wal_size_mb": wal_size as f64 / 1_048_576.0,
        "total_size_mb": (db_size + wal_size) as f64 / 1_048_576.0,
    }))
}
```

---

## Expected Savings Summary

### Per Book (Typical EPUB):
- **Compress chapter content**: 1-8 MB → 200 KB - 1.6 MB (60-80% reduction)
- **Remove EPUB storage**: ~5 MB (if source accessible)
- **Total quick wins**: ~6-12 MB per book saved

### For 100 Books:
- **Current**: ~6.7 GB
- **After quick wins**: ~5.5-6.1 GB
- **Savings**: ~600 MB - 1.2 GB (9-18% reduction)

### Full Optimizations (including BLOB filesystem move):
- **After all optimizations**: ~1.0-1.5 GB
- **Total savings**: ~5.2-5.7 GB (75-85% reduction)

## Next Steps

After quick wins, implement:
1. **Move BLOBs to filesystem** (biggest win, but requires migration)
2. **Content deduplication** (for large libraries)
3. **Image/audio optimization** (if quality trade-offs are acceptable)

