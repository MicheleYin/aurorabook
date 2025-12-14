# Frontend Memory Usage Analysis & Optimization Recommendations

## Executive Summary

This document provides a comprehensive analysis of memory usage patterns in the frontend codebase and actionable recommendations to reduce memory consumption. The analysis covers caching strategies, DOM references, event listeners, state management, and resource cleanup.

## Current Memory Usage Patterns

### 1. **Resource Caching** ⚠️

#### Chapter Cache (`lazy-chapter-loader.ts`)
- **Current**: LRU cache with max 5 chapters, 15min TTL
- **Memory Impact**: ~50-250KB per chapter × 5 = 250KB-1.25MB
- **Status**: ✅ Already optimized (reduced from 50)

#### Audio Track Cache (`lazy-chapter-loader.ts`)
- **Current**: LRU cache with max 1 track URL
- **Issue**: Blob URLs stored but may not be revoked when cache evicts
- **Memory Impact**: Blob URLs hold audio data in memory until revoked

#### Resource Loader Cache (`useResourceLoader.ts`)
- **Current**: Map-based cache with no size limit per book
- **Issue**: Can grow unbounded if many resources are loaded
- **Memory Impact**: Duplicates chapter/audio track data already in LRU cache

**Recommendation**: Add size limits and cleanup on book switch

### 2. **DOM Query Cache** ⚠️⚠️

#### Global DOM Cache (`dom-query-cache.ts`)
- **Current**: 
  - Max 100 elements per cache (elementCache, queryCache)
  - Global `setInterval` cleanup every 10 seconds (NEVER CLEANED UP)
  - TTL: 5 seconds
- **Issues**:
  1. **CRITICAL**: Global `setInterval` on line 140 never gets cleared - memory leak
  2. Cache can hold up to 200 DOM element references (100 × 2)
  3. Elements may be removed from DOM but still cached
- **Memory Impact**: 
  - DOM references prevent garbage collection
  - ~200 elements × ~1KB each = ~200KB minimum
  - Plus closure memory from interval callback

**Recommendation**: Fix interval cleanup, reduce cache size, add better invalidation

### 3. **Event Listeners & Timers** ⚠️

#### Highlight Queue Event Listener (`useHighlighting.ts`)
- **Current**: `window.addEventListener('highlight-queue-updated')` 
- **Status**: ✅ Properly cleaned up in useEffect cleanup

#### ETA Interval (`useETA.ts`)
- **Current**: `setInterval` for ETA updates
- **Status**: ✅ Properly cleaned up

#### DOM Query Cache Interval (`dom-query-cache.ts`)
- **Current**: Global `setInterval(clearExpiredCaches, 10000)` 
- **Status**: ❌ **NEVER CLEANED UP** - memory leak

#### Multiple Timeouts (`useHighlighting.ts`, `useAudioTextSync.ts`)
- **Current**: Many `setTimeout` calls for animations
- **Status**: ✅ Mostly cleaned up, but complex timeout tracking

**Recommendation**: Fix global interval, review timeout cleanup

### 4. **Blob URL Management** ⚠️

#### Audio Track Blob URLs (`useAudioTrackLoader.ts`)
- **Current**: 
  - Blob URLs tracked in `blobUrlsRef` Set
  - Cleaned up on unmount
  - Also in `lazy-chapter-loader.ts` audioTrackCache
- **Issues**:
  1. Blob URLs stored in two places (potential double-revocation)
  2. If cache evicts before component unmounts, blob may leak
  3. No cleanup when switching books
- **Memory Impact**: Each blob URL holds full audio file in memory (~1-50MB per track)

**Recommendation**: Centralize blob URL management, cleanup on book switch

### 5. **State Management & Refs** ⚠️

#### Multiple Cache Layers
- **Current**: 
  - LRU cache (`lazy-chapter-loader.ts`)
  - Resource loader cache (`useResourceLoader.ts`)
  - React state/refs in components
- **Issue**: Same data stored in multiple places
- **Memory Impact**: 2-3x memory usage for cached resources

#### DOM Element Refs
- **Current**: Multiple refs holding DOM elements:
  - `headerCacheRef`, `playerCacheRef`, `safeAreaCacheRef` in `useAudioTextSync.ts`
  - `currentElement` in `useHighlighting.ts`
  - Various refs in components
- **Memory Impact**: DOM references prevent GC

#### Highlighting Timeout Maps
- **Current**: 
  - `exitTimeouts` Map in `useHighlighting.ts`
  - `exitTimeoutsWeakMap` WeakMap (good!)
  - Both maintained simultaneously
- **Issue**: Map prevents GC, WeakMap allows it - why maintain both?

**Recommendation**: Use WeakMap exclusively where possible, reduce duplicate state

### 6. **Context & Provider Memory** ✅

#### ReaderCoordinatorContext
- **Current**: Operation state tracking with refs
- **Status**: ✅ Good - uses refs to avoid re-renders

#### HighlightQueueContext
- **Current**: Queue limited to 10 items
- **Status**: ✅ Good - bounded queue

## Priority Recommendations

### 🔴 Priority 1: Critical Memory Leaks

#### 1.1 Fix Global Interval in DOM Query Cache
**File**: `src/lib/dom-query-cache.ts:139-141`

**Issue**: Global `setInterval` never cleaned up

**Fix**:
```typescript
// Store interval ID for cleanup
let cleanupIntervalId: number | null = null;

// Periodically clean up expired caches
if (typeof window !== 'undefined') {
  cleanupIntervalId = setInterval(clearExpiredCaches, 10000);
}

// Export cleanup function
export function cleanupDomQueryCache(): void {
  if (cleanupIntervalId !== null) {
    clearInterval(cleanupIntervalId);
    cleanupIntervalId = null;
  }
  clearAllCaches();
}
```

**Impact**: Prevents interval callback from holding memory indefinitely

#### 1.2 Centralize Blob URL Management
**Files**: `useAudioTrackLoader.ts`, `lazy-chapter-loader.ts`

**Issue**: Blob URLs managed in multiple places, potential leaks

**Fix**: Create centralized blob URL manager:
```typescript
// src/lib/blob-url-manager.ts
class BlobURLManager {
  private urls = new Set<string>();
  
  register(url: string): void {
    if (url.startsWith('blob:')) {
      this.urls.add(url);
    }
  }
  
  revoke(url: string): void {
    if (this.urls.has(url)) {
      URL.revokeObjectURL(url);
      this.urls.delete(url);
    }
  }
  
  revokeAll(): void {
    this.urls.forEach(url => URL.revokeObjectURL(url));
    this.urls.clear();
  }
  
  revokeForBook(bookId: string): void {
    // Track bookId with URLs for book-specific cleanup
  }
}

export const blobURLManager = new BlobURLManager();
```

**Impact**: Prevents blob URL leaks, easier cleanup

### 🟡 Priority 2: High Impact Optimizations

#### 2.1 Reduce DOM Query Cache Size
**File**: `src/lib/dom-query-cache.ts`

**Current**: Max 100 elements per cache (200 total)

**Recommendation**: Reduce to 50 per cache (100 total)
```typescript
const MAX_CACHE_SIZE = 50; // Reduced from 100
```

**Impact**: ~50% reduction in cached DOM references (~100KB saved)

#### 2.2 Add Cache Size Limit to Resource Loader
**File**: `src/hooks/useResourceLoader.ts`

**Current**: No size limit per book

**Fix**: Add LRU-style eviction:
```typescript
const MAX_RESOURCES_PER_BOOK = 20; // Limit resources per book

const load = useCallback(async (bookId: string, resource: T) => {
  // ... existing code ...
  
  // Evict oldest if over limit
  const bookResources = Array.from(cacheRef.current.entries())
    .filter(([key]) => key.startsWith(`${bookId}:`));
  if (bookResources.length >= MAX_RESOURCES_PER_BOOK) {
    // Remove oldest (first in array)
    const oldestKey = bookResources[0][0];
    cacheRef.current.delete(oldestKey);
  }
}, [/* ... */]);
```

**Impact**: Prevents unbounded cache growth

#### 2.3 Clear Caches on Book Switch
**Files**: `App.tsx`, `ReaderWrapper.tsx`

**Recommendation**: Clear non-active book caches when switching books:
```typescript
useEffect(() => {
  if (activeBookId && previousBookId && activeBookId !== previousBookId) {
    // Clear resource loader cache for previous book
    chapterLoader.clearCache(previousBookId);
    audioTrackLoader.clearCache(previousBookId);
    
    // Clear DOM query cache
    clearAllCaches();
    
    // Revoke blob URLs for previous book
    blobURLManager.revokeForBook(previousBookId);
  }
}, [activeBookId]);
```

**Impact**: Frees memory when switching books

#### 2.4 Use WeakMap Exclusively for Highlighting Timeouts
**File**: `src/hooks/reader/useHighlighting.ts`

**Current**: Both Map and WeakMap maintained

**Fix**: Use only WeakMap, track timeout IDs separately:
```typescript
// Remove exitTimeouts Map, use only WeakMap
const exitTimeoutsWeakMap = useRef(new WeakMap<HTMLElement, number>());
const timeoutIdsRef = useRef(new Set<number>()); // For cleanup only

// When setting timeout:
const timeoutId = window.setTimeout(/* ... */);
exitTimeoutsWeakMap.current.set(element, timeoutId);
timeoutIdsRef.current.add(timeoutId);

// Cleanup:
timeoutIdsRef.current.forEach(id => clearTimeout(id));
timeoutIdsRef.current.clear();
```

**Impact**: Allows GC of removed DOM elements

### 🟢 Priority 3: Medium Impact Optimizations

#### 3.1 Reduce DOM Cache TTL
**File**: `src/lib/dom-query-cache.ts`

**Current**: 5 seconds TTL

**Recommendation**: Reduce to 3 seconds
```typescript
const CACHE_TTL_MS = 3000; // Reduced from 5000
```

**Impact**: Faster cleanup of stale DOM references

#### 3.2 Optimize useMemo Dependencies
**Files**: Various hooks

**Issue**: Some useMemo hooks may recreate objects unnecessarily

**Recommendation**: Review and optimize dependencies to prevent unnecessary recreations

#### 3.3 Clear DOM Cache on Chapter Change
**File**: `src/hooks/audio/useAudioTextSync.ts`

**Current**: DOM caches cleared on chapter change (good!)

**Enhancement**: Also clear global DOM query cache:
```typescript
useEffect(() => {
  // ... existing cleanup ...
  clearAllCaches(); // Clear global DOM cache
}, [activeChapterId]);
```

### 📊 Estimated Memory Savings

| Optimization | Estimated Savings | Priority |
|------------|------------------|----------|
| Fix global interval leak | ~10-50KB | 🔴 Critical |
| Centralize blob URL management | ~1-50MB per unused track | 🔴 Critical |
| Reduce DOM cache size | ~100KB | 🟡 High |
| Add resource loader limits | ~500KB-2MB | 🟡 High |
| Clear caches on book switch | ~1-5MB | 🟡 High |
| Use WeakMap exclusively | ~50-200KB | 🟡 High |
| Reduce DOM cache TTL | ~50KB | 🟢 Medium |

**Total Potential Savings**: ~3-60MB depending on usage patterns

## Implementation Checklist

- [x] Fix global interval in `dom-query-cache.ts` ✅
- [x] Create centralized blob URL manager ✅
- [x] Update `useAudioTrackLoader` to use blob manager ✅
- [x] Update `lazy-chapter-loader` to use blob manager ✅
- [x] Reduce DOM cache size to 50 ✅
- [x] Add size limits to resource loader ✅
- [x] Add cache clearing on book switch ✅
- [x] Refactor highlighting to use WeakMap only ✅
- [x] Reduce DOM cache TTL to 3 seconds ✅
- [x] Add cache clearing on chapter change ✅
- [x] Review and optimize useMemo dependencies ✅
- [ ] Test memory usage with Chrome DevTools
- [ ] Monitor memory in production

## Testing Recommendations

> **Note:** For Tauri/WebKit on macOS, see `MEMORY_PROFILING_GUIDE.md` for detailed profiling instructions.

1. **Memory Profiling**:
   - Use WebKit Inspector (Safari Develop menu) for heap snapshots
   - Use macOS Instruments for deep memory analysis
   - Use built-in memory monitor (available via `window.debugMemory` in dev mode)
   - Take heap snapshots before/after optimizations
   - Test with multiple books loaded
   - Test with audio tracks loaded

2. **Leak Detection**:
   - Monitor memory over time (10+ minutes)
   - Check for growing DOM node count (use `DOMMonitor.logStats()`)
   - Verify blob URLs are revoked (use `blobURLManager.logStats()`)
   - Check interval/timer counts
   - Use `debugMemory.logAll()` for comprehensive stats

3. **Performance Testing**:
   - Ensure optimizations don't degrade performance
   - Test chapter switching speed
   - Test audio track loading speed

### Quick Debug Commands (Development Mode)

In WebKit Inspector console:
```javascript
// Get all memory stats
debugMemory.logAll()

// Get current memory
debugMemory.getMemory()

// Get DOM node count
debugMemory.getDOMStats()

// Get blob URL count
debugMemory.getBlobStats()

// Force garbage collection (if available)
debugMemory.forceGC()
```

## Notes

- Current chapter cache (5 chapters) is well-optimized
- Most event listeners are properly cleaned up
- Context providers use refs appropriately (good!)
- Highlight queue is bounded (good!)
- Main issues are: global interval leak, blob URL management, cache size limits
