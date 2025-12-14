# useRef Analysis and Refactoring Plan

## Summary

This document analyzes all `useRef` usage in the codebase and identifies opportunities to replace them with state or derived state for better React patterns and debuggability.

## Categories of useRef Usage

### ✅ **Keep as Refs (Legitimate Use Cases)**

These refs serve purposes that cannot be replaced with state:

1. **DOM Element References** - Required for direct DOM manipulation
2. **Timer/Interval IDs** - Required for cleanup, don't need to trigger re-renders
3. **AbortController instances** - Required for cancellation, don't need to trigger re-renders
4. **Cache/Storage that shouldn't trigger re-renders** - Performance optimization

### ⚠️ **Can Be Replaced with State or Derived State**

These refs store values that could benefit from being in React state:

1. **Previous value tracking** - Can use `usePrevious` hook or derived state
2. **Mutable values that affect UI** - Should be state
3. **Callback storage to avoid re-renders** - Can use `useCallback` with proper deps
4. **Flags/booleans that affect behavior** - Should be state if they affect rendering

---

## Detailed Analysis by File

### 1. `src/hooks/audio/useAudioPlayerState.ts`

#### Current Refs:
- `currentIndexRef` - Mirrors `currentIndex` state
- `onProgressRef` - Stores callback to avoid re-renders
- `tracksRef` - Stores tracks array
- `isRestoringRef` - Mirrors `isRestoring` state
- `restorationAppliedRef` - Tracks which track restoration was applied to
- `lastProgressSnapshotRef` - Stores last emitted progress snapshot
- `initializedRef` - Tracks initialization signature

#### Analysis:
- ❌ **currentIndexRef** - Redundant with `currentIndex` state. Can be removed, use state directly.
- ⚠️ **onProgressRef** - Used to avoid re-renders. Can use `useCallback` with stable deps instead.
- ⚠️ **tracksRef** - Used to access latest tracks in callbacks. Can pass as dependency to `useCallback`.
- ❌ **isRestoringRef** - Redundant with `isRestoring` state. Can be removed.
- ⚠️ **restorationAppliedRef** - Internal flag. Could be state if needed for debugging, but acceptable as ref.
- ⚠️ **lastProgressSnapshotRef** - Internal tracking. Could be state if needed for debugging.
- ⚠️ **initializedRef** - Internal flag. Acceptable as ref.

#### Recommendation:
- Remove `currentIndexRef` and `isRestoringRef` - use state directly
- Replace `onProgressRef` and `tracksRef` with proper `useCallback` dependencies
- Keep others as refs (internal tracking)

---

### 2. `src/hooks/chapter/useChapterState.ts`

#### Current Refs:
- `currentIndexRef` - Mirrors `currentIndex` state
- `onProgressRef` - Stores callback
- `chaptersRef` - Stores chapters array
- `isRestoringRef` - Mirrors `isRestoring` state
- `restoreScrollTopRef` - Mirrors `restoreScrollTop` state
- `restoreElementIndexRef` - Mirrors `restoreElementIndex` state
- `restorationAppliedRef` - Tracks which chapter restoration was applied to
- `lastProgressSnapshotRef` - Stores last emitted progress snapshot
- `initializedRef` - Tracks initialization signature

#### Analysis:
- ❌ **currentIndexRef** - Redundant with state. Remove.
- ⚠️ **onProgressRef** - Can use `useCallback` with proper deps.
- ⚠️ **chaptersRef** - Can pass as dependency to `useCallback`.
- ❌ **isRestoringRef** - Redundant with state. Remove.
- ❌ **restoreScrollTopRef** - Redundant with state. Remove.
- ❌ **restoreElementIndexRef** - Redundant with state. Remove.
- ⚠️ **restorationAppliedRef** - Internal flag. Acceptable as ref.
- ⚠️ **lastProgressSnapshotRef** - Internal tracking. Acceptable as ref.
- ⚠️ **initializedRef** - Internal flag. Acceptable as ref.

#### Recommendation:
- Remove redundant refs that mirror state
- Replace callback refs with proper `useCallback` dependencies

---

### 3. `src/components/ReaderPanel.tsx`

#### Current Refs:
- `preserveChromeNextSelectionRef` - Flag to preserve chrome on next selection
- `previousBookIdRef` - Tracks previous book ID for change detection
- `previousChapterIdRef` - Tracks previous chapter ID for change detection
- `previousChromeVisibleRef` - Tracks previous chrome visibility

#### Analysis:
- ⚠️ **preserveChromeNextSelectionRef** - Internal flag. Could be state if needed for debugging.
- ❌ **previousBookIdRef** - Can use `usePrevious` hook or derived state.
- ❌ **previousChapterIdRef** - Can use `usePrevious` hook or derived state.
- ❌ **previousChromeVisibleRef** - Can use `usePrevious` hook or `useEffect` with proper deps.

#### Recommendation:
- Use `usePrevious` hook for previous value tracking
- Replace `previousChromeVisibleRef` with `useEffect` that watches `chromeVisible`

---

### 4. `src/hooks/useResourceLoader.ts`

#### Current Refs:
- `cacheRef` - Map cache for resources
- `abortControllerRef` - AbortController for cancellation
- `cachedResourcesCacheRef` - Cache for computed results
- `cacheVersionRef` - Version number for cache invalidation

#### Analysis:
- ✅ **cacheRef** - Internal cache, shouldn't trigger re-renders. Keep as ref.
- ✅ **abortControllerRef** - Required for cancellation. Keep as ref.
- ✅ **cachedResourcesCacheRef** - Internal cache. Keep as ref.
- ✅ **cacheVersionRef** - Internal version tracking. Keep as ref.

#### Recommendation:
- All refs are legitimate - keep as is

---

### 5. `src/components/reader/ReaderAudioPlayer.tsx`

#### Current Refs:
- `audioRef` - DOM element reference
- `isPlayingRef` - Mirrors `isPlaying` state
- `userScrubbingRef` - Flag for user scrubbing
- `lastEmitTimestampRef` - Timestamp tracking
- `lastEmittedSecondsRef` - Last emitted time
- `lastCurrentTimeUpdateRef` - Last UI update time
- `isRestoringRef` - Mirrors `isRestoring` state
- `hasBeenDismissedRef` - Flag for dismissal state
- `isAutoAdvancingRef` - Flag for auto-advance
- `trackLoadedForRestorationRef` - Flag for restoration
- `restorationInProgressRef` - Lock for restoration
- `emitProgressTimeoutRef` - Timeout ID
- `dismissTimeoutRef` - Timeout ID
- `previousTrackIndexRef` - Previous track index
- `onTrackLoadedRef` - Callback storage
- `emitProgressRef` - Callback storage

#### Analysis:
- ✅ **audioRef** - DOM element. Keep as ref.
- ❌ **isPlayingRef** - Redundant with `isPlaying` state. Remove.
- ⚠️ **userScrubbingRef** - Internal flag. Could be state if affects UI.
- ⚠️ **lastEmitTimestampRef** - Internal tracking. Acceptable as ref.
- ⚠️ **lastEmittedSecondsRef** - Internal tracking. Acceptable as ref.
- ⚠️ **lastCurrentTimeUpdateRef** - Internal tracking. Acceptable as ref.
- ❌ **isRestoringRef** - Redundant with `isRestoring` state. Remove.
- ⚠️ **hasBeenDismissedRef** - Internal flag. Could be state.
- ⚠️ **isAutoAdvancingRef** - Internal flag. Could be state if affects UI.
- ⚠️ **trackLoadedForRestorationRef** - Internal flag. Acceptable as ref.
- ⚠️ **restorationInProgressRef** - Internal lock. Acceptable as ref.
- ✅ **emitProgressTimeoutRef** - Timeout ID. Keep as ref.
- ✅ **dismissTimeoutRef** - Timeout ID. Keep as ref.
- ❌ **previousTrackIndexRef** - Can use `usePrevious` hook.
- ⚠️ **onTrackLoadedRef** - Can use `useCallback` with proper deps.
- ⚠️ **emitProgressRef** - Can use `useCallback` with proper deps.

#### Recommendation:
- Remove redundant refs that mirror state
- Use `usePrevious` for previous value tracking
- Replace callback refs with proper `useCallback` dependencies

---

### 6. `src/hooks/audio/useAudioTextSync.ts`

#### Current Refs:
- `lastScrolledElementRef` - Last scrolled element ID
- `lastScrollTimeRef` - Last scroll timestamp
- `lastChapterChangeTimeRef` - Last chapter change timestamp
- `lastReloadAttemptRef` - Last reload attempt info
- `lastChapterIdRef` - Previous chapter ID
- `trackChangeInProgressRef` - Track change flag
- `chapterChangeInProgressRef` - Chapter change flag
- `trackChangeTimeoutRef` - Timeout ID
- `chapterChangeTimeoutRef` - Timeout ID
- `pendingScrollRef` - Pending scroll operation
- DOM element refs (header, player, safeArea) - DOM references

#### Analysis:
- ⚠️ **lastScrolledElementRef** - Internal tracking. Acceptable as ref.
- ⚠️ **lastScrollTimeRef** - Internal tracking. Acceptable as ref.
- ⚠️ **lastChapterChangeTimeRef** - Internal tracking. Acceptable as ref.
- ⚠️ **lastReloadAttemptRef** - Internal tracking. Acceptable as ref.
- ❌ **lastChapterIdRef** - Can use `usePrevious` hook.
- ⚠️ **trackChangeInProgressRef** - Internal flag. Acceptable as ref.
- ⚠️ **chapterChangeInProgressRef** - Internal flag. Acceptable as ref.
- ✅ **trackChangeTimeoutRef** - Timeout ID. Keep as ref.
- ✅ **chapterChangeTimeoutRef** - Timeout ID. Keep as ref.
- ⚠️ **pendingScrollRef** - Internal operation tracking. Acceptable as ref.
- ✅ **DOM element refs** - Required for DOM access. Keep as refs.

#### Recommendation:
- Use `usePrevious` for `lastChapterIdRef`
- Keep others as refs (internal tracking/throttling)

---

### 7. `src/hooks/reader/useHighlighting.ts`

#### Current Refs:
- `exitTimeoutsWeakMap` - WeakMap for timeouts
- `timeoutIdsRef` - Set of timeout IDs
- `highlightRef` - Object with processing state

#### Analysis:
- ✅ **exitTimeoutsWeakMap** - WeakMap for GC. Keep as ref.
- ✅ **timeoutIdsRef** - Timeout IDs for cleanup. Keep as ref.
- ⚠️ **highlightRef** - Internal processing state. Could be state if needed for debugging, but acceptable as ref for performance.

#### Recommendation:
- Keep as refs (internal processing state)

---

### 8. `src/hooks/reader/useElementIndex.ts`

#### Current Refs:
- `indexRef` - Element index cache

#### Analysis:
- ✅ **indexRef** - Internal cache. Keep as ref (doesn't need to trigger re-renders).

#### Recommendation:
- Keep as ref

---

### 9. `src/hooks/usePrevious.ts`

#### Current Refs:
- `ref` - Stores previous value

#### Analysis:
- ✅ **ref** - This is the correct pattern for `usePrevious`. Keep as ref.

#### Recommendation:
- Keep as is (this is the correct pattern)

---

### 10. `src/App.tsx`

#### Current Refs:
- `saveProgressRef` - Callback storage
- `trackChangeHandlerRef` - Callback storage
- `audioPlayerCloseTimeoutRef` - Timeout ID
- `fileOpenRetryTimeoutRef` - Timeout ID
- `lazyChapterLoaderPromiseRef` - Promise reference
- `domQueryCachePromiseRef` - Promise reference

#### Analysis:
- ⚠️ **saveProgressRef** - Can use `useCallback` with proper deps.
- ⚠️ **trackChangeHandlerRef** - Can use `useCallback` with proper deps.
- ✅ **audioPlayerCloseTimeoutRef** - Timeout ID. Keep as ref.
- ✅ **fileOpenRetryTimeoutRef** - Timeout ID. Keep as ref.
- ✅ **lazyChapterLoaderPromiseRef** - Promise tracking. Keep as ref.
- ✅ **domQueryCachePromiseRef** - Promise tracking. Keep as ref.

#### Recommendation:
- Replace callback refs with `useCallback`
- Keep timeout and promise refs

---

### 11. `src/contexts/ReaderCoordinatorContext.tsx`

#### Current Refs:
- `operationCounterRef` - Counter for operation IDs
- `locksRef` - Mirrors `locks` state

#### Analysis:
- ✅ **operationCounterRef** - Internal counter. Keep as ref.
- ✅ **locksRef** - Required for reliable cancellation checks (not affected by closures). Keep as ref.

#### Recommendation:
- Keep as refs (legitimate use cases)

---

### 12. `src/components/reader/ReaderWrapper.tsx`

#### Current Refs:
- `contentRef` - DOM element reference
- `pendingScrollToElementIdRef` - Pending scroll target
- `activeBookIdRef` - Current book ID
- `activeChapterIdRef` - Current chapter ID
- `savePromiseRef` - Save operation promise

#### Analysis:
- ✅ **contentRef** - DOM element. Keep as ref.
- ⚠️ **pendingScrollToElementIdRef** - Could be state if affects UI.
- ⚠️ **activeBookIdRef** - Used in cleanup. Could use closure or state.
- ⚠️ **activeChapterIdRef** - Used in cleanup. Could use closure or state.
- ⚠️ **savePromiseRef** - Promise tracking. Acceptable as ref.

#### Recommendation:
- Keep most as refs (cleanup/async operations)
- Consider state for `pendingScrollToElementIdRef` if it affects UI

---

### 13. `src/hooks/useBookConversion.ts`

#### Current Refs:
- `listenerSetupRef` - Flag for listener setup
- `abortControllerRef` - AbortController
- `conversionStartTimeRef` - Start time tracking

#### Analysis:
- ⚠️ **listenerSetupRef** - Internal flag. Acceptable as ref.
- ✅ **abortControllerRef** - Required for cancellation. Keep as ref.
- ⚠️ **conversionStartTimeRef** - Could be state if needed for UI, but acceptable as ref.

#### Recommendation:
- Keep as refs

---

### 14. Other Files

Most other files have legitimate ref usage (DOM refs, timeout IDs, internal caches). See full analysis below.

---

## Refactoring Priority

### 🔴 **High Priority (Remove Redundant Refs)**

1. **useAudioPlayerState.ts**
   - Remove `currentIndexRef` (use `currentIndex` state)
   - Remove `isRestoringRef` (use `isRestoring` state)

2. **useChapterState.ts**
   - Remove `currentIndexRef` (use `currentIndex` state)
   - Remove `isRestoringRef` (use `isRestoring` state)
   - Remove `restoreScrollTopRef` (use `restoreScrollTop` state)
   - Remove `restoreElementIndexRef` (use `restoreElementIndex` state)

3. **ReaderAudioPlayer.tsx**
   - Remove `isPlayingRef` (use `isPlaying` state)
   - Remove `isRestoringRef` (use `isRestoring` state)

### ⚠️ **Medium Priority (Replace with Better Patterns)**

1. **ReaderPanel.tsx**
   - Replace `previousBookIdRef` with `usePrevious` hook
   - Replace `previousChapterIdRef` with `usePrevious` hook
   - Replace `previousChromeVisibleRef` with `useEffect` watching `chromeVisible`

2. **useAudioPlayerState.ts & useChapterState.ts**
   - Replace `onProgressRef` with proper `useCallback` dependencies
   - Replace `tracksRef`/`chaptersRef` with proper `useCallback` dependencies

3. **ReaderAudioPlayer.tsx**
   - Replace `previousTrackIndexRef` with `usePrevious` hook
   - Replace callback refs with proper `useCallback` dependencies

4. **App.tsx**
   - Replace `saveProgressRef` with `useCallback`
   - Replace `trackChangeHandlerRef` with `useCallback`

### 💡 **Low Priority (Consider for Future)**

1. Internal flags that could be state for debugging (but acceptable as refs for performance)
2. Throttle/debounce tracking refs (acceptable as refs)

---

## Implementation Plan

1. ✅ **Phase 1**: Remove redundant refs that mirror state - **COMPLETED**
2. ✅ **Phase 2**: Replace previous value tracking with `usePrevious` hook - **COMPLETED**
3. ✅ **Phase 3**: Replace callback refs with proper `useCallback` dependencies - **COMPLETED**
4. **Phase 4**: Review and document remaining refs that are kept for performance reasons - **IN PROGRESS**

## Completed Refactoring

### ✅ Removed Redundant Refs

1. **useAudioPlayerState.ts**
   - ✅ Removed `currentIndexRef` - now uses `currentIndex` state directly
   - ✅ Removed `isRestoringRef` - now uses `isRestoring` state directly
   - ✅ Replaced `onProgressRef` and `tracksRef` with proper `useCallback` dependencies

2. **useChapterState.ts**
   - ✅ Removed `currentIndexRef` - now uses `currentIndex` state directly
   - ✅ Removed `isRestoringRef` - now uses `isRestoring` state directly
   - ✅ Removed `restoreScrollTopRef` - now uses `restoreScrollTop` state directly
   - ✅ Removed `restoreElementIndexRef` - now uses `restoreElementIndex` state directly
   - ✅ Replaced `onProgressRef` and `chaptersRef` with proper `useCallback` dependencies

3. **ReaderAudioPlayer.tsx**
   - ✅ Removed `isRestoringRef` - now uses `isRestoring` state from hook
   - ✅ Replaced `previousTrackIndexRef` with `usePrevious` hook

4. **ReaderPanel.tsx**
   - ✅ Replaced `previousBookIdRef` with `usePrevious` hook
   - ✅ Replaced `previousChapterIdRef` with `usePrevious` hook
   - ✅ Replaced `previousChromeVisibleRef` with `useEffect` watching `chromeVisible`
   - ✅ Converted `preserveChromeNextSelectionRef` to state (`preserveChromeNextSelection`)

### ✅ Improved Patterns

- All callbacks now use proper `useCallback` dependencies instead of refs
- Previous value tracking uses `usePrevious` hook consistently
- State changes are now visible in React DevTools
- Better debuggability and maintainability

---

## Benefits of Refactoring

1. **Better Debuggability**: State changes visible in React DevTools
2. **Clearer Code**: Less confusion between refs and state
3. **Better React Patterns**: Following React best practices
4. **Easier Testing**: State can be tested more easily
5. **Fewer Bugs**: Less chance of stale closures

## Trade-offs

- **Performance**: Some refs are kept for performance (avoiding re-renders)
- **Complexity**: Some internal tracking is simpler with refs
- **Legitimate Use Cases**: DOM refs, timeout IDs, etc. must remain refs

---

## Conclusion

Many refs can be replaced with state or better patterns. The main categories:
- **Redundant refs** (mirroring state) → Remove
- **Previous value tracking** → Use `usePrevious` hook
- **Callback storage** → Use `useCallback` with proper dependencies
- **Legitimate refs** → Keep (DOM, timers, internal caches)
