# Frontend Resource Leaks Report

## Summary

This report documents resource leaks found in the frontend codebase and their fixes.

## Critical Leaks Found & Fixed

### 1. ✅ FIXED: App.tsx Memory Stats Logging Interval
**Location**: `src/App.tsx:37`
**Issue**: `setInterval` for logging memory stats every 30 seconds was never cleaned up
**Impact**: Interval callback would continue running indefinitely, holding memory references
**Fix**: 
- Store interval ID in a variable
- Expose cleanup function on `window.__cleanupMemoryMonitoring`
- Call cleanup in App unmount effect

### 2. ✅ FIXED: Memory Monitor Interval
**Location**: `src/lib/memory-monitor.ts`
**Issue**: `memoryMonitor.start()` creates an interval that was never stopped
**Impact**: Memory monitoring interval continues running even after app unmount
**Fix**: 
- Added cleanup call in App unmount effect
- Exposed cleanup function that calls `memoryMonitor.stop()`

### 3. ✅ VERIFIED: DOM Query Cache Interval
**Location**: `src/lib/dom-query-cache.ts:143`
**Status**: Already properly cleaned up
**Verification**: `cleanupDomQueryCache()` is called in `App.tsx` unmount effect (line 274-276)

## Resource Cleanup Status

### Event Listeners ✅
Most event listeners are properly cleaned up:
- ✅ `window.addEventListener('highlight-queue-updated')` - cleaned up in `useHighlighting.ts`
- ✅ `window.addEventListener('chapter-updated')` - cleaned up in `ReaderWrapper.tsx`
- ✅ `media.addEventListener('change')` - cleaned up in `App.tsx` and `useResolvedTheme.ts`
- ✅ Audio element event listeners - cleaned up in `ReaderAudioPlayer.tsx`
- ✅ Scroll event listeners - cleaned up in `ReaderViewport.tsx`
- ✅ Click handlers - cleaned up in `useLinkHandling.ts`

### Timers & Intervals ✅
Most timers are properly cleaned up:
- ✅ `useETA` interval - cleaned up in useEffect
- ✅ `useHighlighting` timeouts - tracked and cleaned up
- ✅ `ReaderAudioPlayer` timeouts - tracked with refs and cleaned up
- ✅ Track animation timeouts - cleaned up in useEffect
- ✅ DOM query cache interval - cleaned up on unmount
- ✅ Memory monitor interval - now cleaned up on unmount
- ✅ Memory stats logging interval - now cleaned up on unmount

### Blob URLs ✅
Blob URL management is centralized:
- ✅ `BlobURLManager` tracks all blob URLs
- ✅ URLs are revoked when tracks change
- ✅ URLs are revoked when books switch
- ✅ URLs are revoked on component unmount

### AbortControllers ✅
- ✅ `useBookConversion` AbortController - properly managed and cleaned up

## Remaining Considerations

### 1. Development-Only Resources
Some resources (memory monitoring, stats logging) are only active in dev mode. These are now properly cleaned up, but in production they don't exist anyway.

### 2. Timeout Complexity
Some components use many timeouts (e.g., `useHighlighting`, `useAudioTextSync`). These are tracked and cleaned up, but the complexity makes them harder to verify. Consider:
- Using a timeout manager utility
- Consolidating timeout logic where possible

### 3. DOM References
Some components cache DOM element references (e.g., `useAudioTextSync` caches header, player, safe area elements). These are refs that prevent GC, but they're necessary for performance. Consider:
- Using WeakRef where possible (limited browser support)
- Clearing refs when components unmount

## Recommendations

1. ✅ **DONE**: Fix memory monitoring cleanup
2. ✅ **DONE**: Fix memory stats logging cleanup
3. **Consider**: Create a timeout/interval manager utility to centralize cleanup
4. **Consider**: Add ESLint rule to detect missing cleanup in useEffect
5. **Consider**: Add unit tests for cleanup functions

## Testing

To verify no resource leaks:
1. Open app in dev mode
2. Use memory debug tools: `window.debugMemory.logAll()`
3. Navigate between views, open/close books
4. Check blob URL count should stay low (1-2)
5. Check DOM node count should be stable
6. Check for growing intervals/timeouts in browser dev tools

