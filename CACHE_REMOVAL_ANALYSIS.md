# Cache Removal Analysis

## Current State

### Old Cache (`DbCache`) - TTL-based Read Cache
**Used for:**
- Books (100 entries, 5 min TTL)
- Chapters (1000 entries, 10 min TTL)
- Chapter lists (100 entries, 5 min TTL)
- Audio track lists (100 entries, 5 min TTL)
- Images (500 entries, 30 min TTL)
- Audio data (200 entries, 30 min TTL)
- App settings (1 entry, 1 hour TTL)
- Reader preferences (1 entry, 1 hour TTL)

**Characteristics:**
- TTL-based expiration (time-based)
- Read-only cache (reduces SQLite reads)
- Automatic expiration after TTL
- Used in all repositories

### Hybrid Store - LRU-based Write-Back Cache
**Currently supports:**
- Books (50 entries, LRU eviction)
- Chapter lists (100 entries, LRU eviction)
- Audio track lists (100 entries, LRU eviction)

**Missing:**
- Individual chapters
- Images
- Audio data
- App settings
- Reader preferences

**Characteristics:**
- LRU eviction (access-based)
- Write-back cache (reduces SQLite writes AND reads)
- Write queue for batching
- Background sync

## Can We Remove the Old Cache?

### Option 1: Keep Both (Recommended for Now)
**Pros:**
- Old cache handles data types not yet in hybrid store (images, audio_data, settings)
- TTL is useful for rarely-changing data (settings, preferences)
- No migration needed
- Both systems complement each other

**Cons:**
- Some duplication (books, chapters, audio tracks cached in both)
- More memory usage
- More complexity

**Verdict:** Keep both for now, but can remove old cache for books/chapters/audio_tracks once hybrid store is fully integrated.

### Option 2: Remove Old Cache Completely
**Requirements:**
1. Extend hybrid store to support:
   - Images
   - Audio data
   - App settings
   - Reader preferences
   - Individual chapters (not just lists)

2. Migrate all repositories to use hybrid store

3. Decide on eviction strategy:
   - Keep LRU only (simpler)
   - Add TTL support to hybrid store (more complex, but better for settings)

**Effort:** Medium-High (2-3 hours)

**Verdict:** Can be done, but requires migration work.

### Option 3: Remove Old Cache for Overlapping Data Only
**Keep old cache for:**
- Images (hybrid store doesn't support yet)
- Audio data (hybrid store doesn't support yet)
- App settings (hybrid store doesn't support yet)
- Reader preferences (hybrid store doesn't support yet)

**Remove old cache for:**
- Books (use hybrid store only)
- Chapters (use hybrid store only)
- Audio tracks (use hybrid store only)

**Effort:** Low-Medium (1 hour)

**Verdict:** Best compromise - reduces duplication while keeping what works.

## Recommendation

**Option 3** is the best approach:
1. Remove old cache usage for books, chapters, and audio tracks
2. Keep old cache for images, audio_data, settings, and preferences (until hybrid store supports them)
3. Gradually migrate remaining data types to hybrid store

This gives us:
- No duplication for main data (books/chapters/tracks)
- Still have caching for images/audio/settings
- Can complete migration later

## Implementation Plan

### Step 1: Remove Old Cache for Books/Chapters/Audio Tracks
- Remove `cache.books` usage from `book_repository.rs`
- Remove `cache.chapters` and `cache.chapters_list` usage from `chapter_repository.rs`
- Remove `cache.audio_tracks_list` usage from `audio_repository.rs`
- Update repositories to use hybrid store instead

### Step 2: Keep Old Cache for Images/Audio Data/Settings
- Keep `cache.images` in `image_repository.rs`
- Keep `cache.audio_data` in `audio_repository.rs`
- Keep `cache.app_settings` in `settings_repository.rs`
- Keep `cache.reader_preferences` in `reader_preferences_repository.rs`

### Step 3: Future Migration (Optional)
- Add images/audio_data/settings to hybrid store
- Remove old cache completely

## Code Changes Needed

### Remove from `cache.rs`:
```rust
// Remove these (keep others):
pub books: BookCache,              // REMOVE
pub chapters: ChapterCache,        // REMOVE  
pub chapters_list: ChaptersListCache, // REMOVE
pub audio_tracks_list: AudioTracksListCache, // REMOVE

// Keep these:
pub images: ImageCache,            // KEEP
pub audio_data: AudioDataCache,    // KEEP
pub app_settings: AppSettingsCache, // KEEP
pub reader_preferences: ReaderPreferencesCache, // KEEP
```

### Update Repositories:
- `book_repository.rs`: Use hybrid store instead of cache
- `chapter_repository.rs`: Use hybrid store instead of cache
- `audio_repository.rs`: Use hybrid store for lists, keep cache for data

## Memory Impact

**Before:**
- Old cache: ~100 books + 1000 chapters + 100 chapter lists + 100 audio lists = ~1200 entries
- Hybrid store: 50 books + 100 chapter lists + 100 audio lists = 250 entries
- **Total: ~1450 entries (with duplication)**

**After (Option 3):**
- Old cache: 500 images + 200 audio data + 1 settings + 1 preferences = ~702 entries
- Hybrid store: 50 books + 100 chapter lists + 100 audio lists = 250 entries
- **Total: ~952 entries (no duplication)**

**Savings:** ~500 entries, less duplication

