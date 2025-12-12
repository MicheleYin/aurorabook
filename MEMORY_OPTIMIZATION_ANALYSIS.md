# Memory Optimization Analysis - Reader Panel

## Executive Summary

This document analyzes memory usage patterns in the reader panel and provides actionable recommendations to reduce memory consumption. The analysis focuses on chapter content storage, DOM manipulation, event listeners, state management, and audio synchronization.

## Current Memory Usage Patterns

### 1. Chapter Content Storage

**Current Implementation:**
- LRU cache holds up to **50 chapters** in memory (`lazy-chapter-loader.ts:20-23`)
- Each chapter contains full HTML with audio sync spans
- React state also maintains chapter content in multiple places:
  - `useChapterLoader.loadedChapter` (state)
  - `useResourceLoader.cacheRef` (ref with Map)
  - `useResourceLoader.loadedResources` (state with Map)
  - Chapter passed through props to `ReaderViewport`

**Memory Impact:**
- Large chapters (10-50KB HTML each) × 50 = 500KB-2.5MB in cache
- Duplicate storage in React state adds overhead
- Full HTML with all spans for audio sync increases size

### 2. DOM Element References

**Current Implementation:**
- Multiple `querySelector` calls throughout codebase (17+ instances)
- Cached DOM queries in refs (`headerCacheRef`, `playerCacheRef`, `safeAreaCacheRef`)
- Highlighting system maintains element references
- `useHighlighting` stores current element in ref

**Memory Impact:**
- DOM queries create temporary references
- Cached queries hold element references longer than needed
- Highlighting system maintains element references even after unmount

### 3. Event Listeners and Timers

**Current Implementation:**
- Scroll event listeners (throttled but active)
- Multiple `setTimeout` calls for animations and delays
- `requestAnimationFrame` callbacks
- Animation queue in `useHighlighting` with timeout tracking

**Memory Impact:**
- Event listeners prevent garbage collection of closures
- Timeout IDs stored in refs (Map in `useHighlighting.exitTimeouts`)
- RAF callbacks hold references to DOM elements

### 4. State Management

**Current Implementation:**
- Multiple hooks maintaining overlapping state:
  - `useChapterLoader` - chapter loading state
  - `useScrollManagement` - scroll state
  - `useHighlighting` - highlighting state
  - `useAudioTextSync` - audio sync state
  - `useChapterProgress` - progress tracking
- Multiple refs storing DOM elements and computed values

**Memory Impact:**
- Duplicate state across hooks
- Refs holding DOM elements prevent GC
- Cached computations stored in refs

### 5. Audio Synchronization

**Current Implementation:**
- Audio sync map stored in book object (in memory)
- Highlighting system queries DOM for elements frequently
- Multiple refs tracking audio state (`lastScrolledElementRef`, `lastScrollTimeRef`, etc.)

**Memory Impact:**
- Audio sync map can be large for books with many segments
- Frequent DOM queries during audio playback
- Multiple refs holding state

## Optimization Recommendations

### Priority 1: High Impact, Low Effort

#### 1.1 Reduce Chapter Cache Size
**Current:** 50 chapters cached  
**Recommended:** 10-15 chapters (current + adjacent chapters only)

```typescript
// lazy-chapter-loader.ts
const chapterCache = new LRUCache<string, { contentHtml: string; plainText: string; wordCount: number }>({
  max: 15, // Reduced from 50
  ttl: 1000 * 60 * 15, // Reduced from 30 minutes to 15
});
```

**Impact:** Reduces memory by ~70% (from 50 to 15 chapters)

#### 1.2 Clear Cache When Switching Books
**Current:** Cache persists across book switches  
**Recommended:** Clear cache for non-active books

```typescript
// In ReaderWrapper or App.tsx when switching books
useEffect(() => {
  if (activeBookId) {
    const { clearAllCachesExcept } = await import("./lib/lazy-chapter-loader");
    clearAllCachesExcept(activeBook.sourcePath);
  }
}, [activeBookId]);
```

**Impact:** Prevents accumulation of chapters from multiple books

#### 1.3 Remove Duplicate Chapter Storage
**Current:** Chapters stored in both LRU cache and React state  
**Recommended:** Use LRU cache as single source of truth, React state only for current chapter

```typescript
// useChapterLoader.ts - remove loadedResources state
// Only keep cacheRef, remove loadedResources Map
```

**Impact:** Eliminates duplicate storage

### Priority 2: Medium Impact, Medium Effort

#### 2.1 Virtualize Chapter Content
**Current:** Full chapter HTML rendered in DOM  
**Recommended:** Only render visible portion, use virtual scrolling

**Implementation:**
- Use `react-window` or `react-virtualized` for chapter content
- Render only visible paragraphs/spans
- Lazy load off-screen content

**Impact:** Reduces DOM nodes significantly (from full chapter to ~20-30 visible elements)

#### 2.2 Debounce DOM Queries
**Current:** DOM queries on every scroll/update  
**Recommended:** Debounce queries and cache results longer

```typescript
// useAudioTextSync.ts
const CACHE_TTL_MS = 5000; // Increase from 1000ms to 5000ms
```

**Impact:** Reduces DOM query frequency by 80%

#### 2.3 Clean Up Highlighting References
**Current:** Element references held after unmount  
**Recommended:** Clear references when chapter changes

```typescript
// useHighlighting.ts
useEffect(() => {
  return () => {
    // Clear all element references
    highlightRef.current.currentElement = null;
    highlightRef.current.currentElementId = null;
    // Clear exit timeouts
    highlightRef.current.exitTimeouts.clear();
  };
}, [activeChapter?.id]); // Re-run when chapter changes
```

**Impact:** Prevents memory leaks from stale DOM references

### Priority 3: High Impact, High Effort

#### 3.1 Implement Chapter Content Streaming
**Current:** Load entire chapter HTML at once  
**Recommended:** Stream chapter content in chunks

**Implementation:**
- Load chapter in paragraphs/sections
- Render progressively as content loads
- Unload off-screen content

**Impact:** Reduces initial memory spike, enables handling of very large chapters

#### 3.2 Optimize Audio Sync Map Storage
**Current:** Full sync map in memory  
**Recommended:** Store only active segment references, lazy load rest

**Implementation:**
- Store sync map as indexed data structure
- Only load segments for current chapter
- Unload segments when chapter changes

**Impact:** Reduces memory for books with extensive audio sync data

#### 3.3 Use Intersection Observer for Highlighting
**Current:** Manual DOM queries for element visibility  
**Recommended:** Use Intersection Observer API

```typescript
// useHighlighting.ts
const observerRef = useRef<IntersectionObserver | null>(null);

useEffect(() => {
  observerRef.current = new IntersectionObserver((entries) => {
    // Handle visibility changes
  }, { threshold: 0.5 });
  
  return () => {
    observerRef.current?.disconnect();
  };
}, []);
```

**Impact:** More efficient than manual queries, browser-optimized

### Priority 4: Low Impact, Low Effort

#### 4.1 Reduce Animation Queue Size
**Current:** Unlimited queue size  
**Recommended:** Limit queue to 5-10 items, drop oldest if full

```typescript
// useHighlighting.ts
const MAX_QUEUE_SIZE = 5;
if (highlightRef.current.queue.length >= MAX_QUEUE_SIZE) {
  highlightRef.current.queue.shift(); // Drop oldest
}
```

**Impact:** Prevents queue from growing unbounded

#### 4.2 Clear Timeouts More Aggressively
**Current:** Timeouts cleared on unmount only  
**Recommended:** Clear timeouts when chapter changes

```typescript
// useAudioTextSync.ts
useEffect(() => {
  return () => {
    // Clear all pending timeouts
    if (lastScrollTimeRef.current) {
      clearTimeout(lastScrollTimeRef.current);
    }
  };
}, [activeChapter?.id]);
```

**Impact:** Prevents accumulation of pending timeouts

#### 4.3 Use WeakMap for DOM Element Caching
**Current:** Regular refs hold strong references  
**Recommended:** Use WeakMap where possible

```typescript
// For cached DOM queries
const elementCache = new WeakMap<HTMLElement, CachedData>();
```

**Impact:** Allows GC of DOM elements when removed from DOM

## Implementation Priority

1. **Immediate (Week 1):**
   - Reduce chapter cache size (1.1)
   - Clear cache on book switch (1.2)
   - Remove duplicate storage (1.3)

2. **Short-term (Week 2-3):**
   - Debounce DOM queries (2.2)
   - Clean up highlighting references (2.3)
   - Reduce animation queue size (4.1)

3. **Medium-term (Month 1-2):**
   - Virtualize chapter content (2.1)
   - Use Intersection Observer (3.3)

4. **Long-term (Month 3+):**
   - Chapter content streaming (3.1)
   - Optimize audio sync map (3.2)

## Expected Memory Reduction

- **Current Baseline:** ~5-10MB for typical book (50 chapters × 100KB avg)
- **After Priority 1:** ~1.5-3MB (70% reduction)
- **After Priority 2:** ~500KB-1MB (90% reduction)
- **After Priority 3:** ~200-500KB (95% reduction)

## Monitoring Recommendations

1. Add memory profiling:
   ```typescript
   // Monitor memory usage
   if ('memory' in performance) {
     console.log('Memory:', performance.memory);
   }
   ```

2. Track cache hit rates:
   ```typescript
   // Add cache statistics
   let cacheHits = 0;
   let cacheMisses = 0;
   ```

3. Monitor DOM node count:
   ```typescript
   // Track DOM nodes
   const nodeCount = document.querySelectorAll('*').length;
   ```

## Testing Checklist

- [ ] Verify chapter cache size reduction doesn't impact performance
- [ ] Test cache clearing on book switch
- [ ] Verify highlighting still works after cleanup changes
- [ ] Test with very large chapters (100KB+)
- [ ] Test with books having many chapters (100+)
- [ ] Monitor memory usage in production
- [ ] Test audio sync with optimized map storage

## Notes

- All optimizations should maintain current functionality
- Performance should not degrade (may improve in some cases)
- User experience should remain the same or improve
- Consider A/B testing for major changes

