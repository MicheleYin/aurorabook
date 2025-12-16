# Memory & CPU Optimization Proposal

## Current Issues

### 1. **Full Book Objects in Library State**
- All books are stored in React state with complete metadata
- Each book includes:
  - Full `chapters[]` array (metadata for all chapters)
  - Full `audioTracks[]` array (metadata for all tracks)
  - `audioSyncMap` (can be large for books with many segments)
  - Progress, audio state, etc.

### 2. **No Lazy Loading of Book Metadata**
- When library loads, ALL books are fetched with ALL chapter/audio metadata
- For a library with 100 books × 20 chapters each = 2000 chapter objects in memory
- Even though chapter content isn't loaded, the metadata arrays consume significant memory

### 3. **Inefficient Data Structure**
- Book type includes `chapters: Chapter[]` and `audioTracks: AudioTrack[]` as required fields
- These should be optional or lazy-loaded on demand

### 4. **Cache Management Issues**
- Resource cache manager is good, but books themselves aren't cached efficiently
- Library state keeps all books even when not actively viewed

## Proposed Refactoring

### Phase 1: Lazy Book Metadata Loading

#### 1.1 Split Book Type into Lightweight and Full Versions

```typescript
// Lightweight book for library view
export type BookSummary = {
  id: string;
  title: string;
  author: string;
  coverUrl?: string;
  sourcePath: string;
  contentHash?: string;
  publisher?: string;
  publishedYear?: string;
  subjects?: string[];
  fileSizeBytes?: number;
  
  // Progress summary (lightweight)
  progress?: {
    currentChapterId: string;
    currentChapterIndex: number;
    chapterProgressPercent: number;
    bookProgressPercent: number;
    updatedAt: string;
  };
  
  // Audio state summary (lightweight)
  audioState?: {
    currentTrackId: string;
    currentTimeSeconds: number;
    updatedAt: string;
  };
  
  // Counts only (not full arrays)
  chapterCount?: number;
  audioTrackCount?: number;
  totalWords?: number;
  wordsProcessed?: number;
  pageCount?: number;
  conversionStatus?: "notStarted" | "started" | "done";
  voiceId?: VoiceId;
  lastOpenedTime?: string;
  
  // NO chapters array
  // NO audioTracks array
  // NO audioSyncMap
};

// Full book for reader view (loaded on demand)
export type Book = BookSummary & {
  chapters: Chapter[];
  audioTracks: AudioTrack[];
  audioSyncMap?: AudioSyncMap;
};
```

#### 1.2 Update Backend API

Add new Tauri commands:
- `read_all_books_summary()` - Returns only BookSummary (no chapters/audio)
- `read_one_book_full(bookId)` - Returns full Book with chapters/audio
- `read_book_chapters(bookId)` - Returns only chapters array
- `read_book_audio_tracks(bookId)` - Returns only audio tracks array
- `read_book_audio_sync_map(bookId)` - Returns only audio sync map

#### 1.3 Update Library State

```typescript
// Library state stores only summaries
const [library, setLibrary] = useState<BookSummary[]>([]);

// Full book loaded on demand and cached separately
const [loadedBooks, setLoadedBooks] = useState<Map<string, Book>>(new Map());
```

### Phase 2: Virtualized Library View

#### 2.1 Implement Virtual Scrolling
- Use `react-window` or `@tanstack/react-virtual` for library grid/list
- Only render visible books
- Significantly reduces DOM nodes and React component instances

#### 2.2 Lazy Load Book Details
- Load full book data only when:
  - User opens book in reader
  - User opens book detail dialog
  - Book is scrolled into view (with debounce)

### Phase 3: Optimize Book Loading

#### 3.1 Progressive Book Loading
```typescript
// Load book in stages:
// 1. Summary (already in library)
// 2. Chapters metadata (when opening reader)
// 3. Audio tracks metadata (when opening reader)
// 4. Audio sync map (only if audio tracks exist)
// 5. Chapter content (lazy, on-demand)
// 6. Audio track blobs (lazy, on-demand)
```

#### 3.2 Smart Caching Strategy
```typescript
// Cache full books with LRU eviction
const bookCache = new LRUCache<string, Book>({
  max: 3, // Keep max 3 full books in memory
  ttl: 1000 * 60 * 30, // 30 minutes
});

// When book is evicted:
// - Keep summary in library
// - Clear chapter/audio content from resource cache
// - Revoke blob URLs
```

### Phase 4: Component Optimization

#### 4.1 Memoize Library Components
```typescript
// Memoize book cards to prevent unnecessary re-renders
const BookCard = memo(({ book }: { book: BookSummary }) => {
  // Only re-render if book data actually changes
}, (prev, next) => {
  return prev.book.id === next.book.id &&
         prev.book.progress?.updatedAt === next.book.progress?.updatedAt;
});
```

#### 4.2 Lazy Load Heavy Components
```typescript
// Already doing this for ReaderAudioPlayer - good!
// Consider lazy loading:
// - BookDetailDialog
// - ConvertToAudiobookDialog
// - ReaderPanel (if possible)
```

### Phase 5: Memory Management

#### 5.1 Aggressive Cleanup
```typescript
// When navigating away from reader:
// 1. Clear all caches except current book
// 2. Revoke blob URLs for evicted resources
// 3. Force garbage collection hints (if possible)

// When closing book:
// 1. Remove from loadedBooks cache
// 2. Clear all chapter/audio caches for that book
// 3. Revoke all blob URLs
```

#### 5.2 Reduce React State Updates
```typescript
// Batch state updates
// Use React.startTransition for non-urgent updates
// Debounce progress saves
```

## Implementation Priority

### High Priority (Immediate Impact)
1. ✅ **Split Book Type** - Create BookSummary type
2. ✅ **Update Library State** - Store only summaries
3. ✅ **Backend API Changes** - Add summary endpoint
4. ✅ **Lazy Load Full Books** - Load full book only when opening

### Medium Priority (Significant Impact)
5. ✅ **Virtual Scrolling** - Implement for library view
6. ✅ **Smart Caching** - LRU cache for full books
7. ✅ **Component Memoization** - Prevent unnecessary re-renders

### Low Priority (Polish)
8. ✅ **Progressive Loading** - Load book data in stages
9. ✅ **Memory Monitoring** - Add memory usage tracking
10. ✅ **Cleanup Optimization** - Aggressive resource cleanup

## Expected Memory Savings

### Current State (100 books, 20 chapters each)
- Books: 100 × ~5KB = ~500KB
- Chapters metadata: 2000 × ~1KB = ~2MB
- Audio tracks metadata: 100 × 5 tracks × ~0.5KB = ~250KB
- **Total: ~2.75MB** (just for metadata)

### After Optimization
- Book summaries: 100 × ~2KB = ~200KB
- Loaded books: 3 × ~5KB = ~15KB
- Chapters metadata: 60 × ~1KB = ~60KB (only for loaded books)
- Audio tracks metadata: 15 × ~0.5KB = ~7.5KB (only for loaded books)
- **Total: ~282KB** (90% reduction)

### Additional Benefits
- Faster library load time (less data to fetch)
- Faster library rendering (fewer components)
- Lower CPU usage (fewer re-renders)
- Better responsiveness (less memory pressure)

## Migration Strategy

1. **Phase 1**: Add BookSummary type alongside Book (backward compatible)
2. **Phase 2**: Update backend to support summary endpoint
3. **Phase 3**: Update library state to use summaries
4. **Phase 4**: Update components to handle both types
5. **Phase 5**: Remove old Book type usage
6. **Phase 6**: Add virtual scrolling
7. **Phase 7**: Optimize caching and cleanup

## Code Changes Required

### Backend (Rust)
- Add `read_all_books_summary()` command
- Modify `read_one_book()` to return full book
- Add `read_book_chapters()` command
- Add `read_book_audio_tracks()` command

### Frontend (TypeScript)
- Create `BookSummary` type
- Update `book-service.ts` with new functions
- Update `LibraryContext` to use summaries
- Update `AppContext` to lazy load full books
- Update all components to handle summaries
- Add virtual scrolling to library view
- Implement smart caching

## Testing Checklist

- [ ] Library loads faster with summaries
- [ ] Memory usage reduced by ~90%
- [ ] Opening book still works correctly
- [ ] Progress/audio state preserved
- [ ] No data loss during migration
- [ ] Performance improved on low-end devices
- [ ] Virtual scrolling works smoothly
- [ ] Cache eviction works correctly

