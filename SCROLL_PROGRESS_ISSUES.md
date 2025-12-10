# Scroll Progress Restoration Issues

## Root Causes of Inconsistent Restoration

### Issue 1: Stale Library State in `App.tsx` (CRITICAL)

**Location**: `src/App.tsx` lines 199-221

**Problem**: When `scrollPosition: "maintain"` is used, the code reads `activeBook` from the `library` prop to check for existing progress:

```typescript
const activeBook = library.find(b => b.id === activeBookId);
if (activeBook?.progress && activeBook.progress.currentChapterId === chapterId) {
  // Preserve existing progress values
  progressUpdate.scrollTop = activeBook.progress.currentChapterScrollTop;
  // ...
}
```

**Race Condition**: 
- The `library` prop might be stale if there's a pending debounced update in `pendingProgressUpdateRef`
- `updateBookProgress` updates local state immediately (line 210 in useProgressManagement), but `App.tsx` reads from the `library` prop which might be from a previous render
- This causes the "maintain" logic to fail, and `undefined` values are passed to `updateBookProgress`

**Impact**: When navigating to a chapter with saved progress, if the library state is stale, the progress values are `undefined`, causing `useProgressManagement` to reset them to 0.

### Issue 2: `chapterMatchesExisting` Check Fails with Stale State

**Location**: `src/hooks/library/useProgressManagement.ts` lines 112-114

**Problem**: The check for matching chapter uses the `book` from the `library` array:

```typescript
const book = library.find((b) => b.id === bookId);
const existingProgress = book.progress;
const chapterMatchesExisting =
  existingProgress?.currentChapterId === chapter.id &&
  existingProgress.currentChapterIndex === chapterIndex;
```

**Issue**: If `library` is stale and doesn't have the latest progress, `chapterMatchesExisting` will be `false`, causing the code to use fallback values (0) instead of preserving existing progress:

```typescript
currentChapterScrollTop: getNumberValue(
  payload.scrollTop,
  chapterMatchesExisting
    ? getNumberValue(existingProgress?.currentChapterScrollTop, 0)  // Preserved
    : 0,  // ❌ Used when state is stale!
),
```

**Impact**: Progress is reset to 0 even though it should be preserved.

### Issue 3: Pending Update Not Considered

**Location**: `src/hooks/library/useProgressManagement.ts` lines 24-28, 183-207

**Problem**: There's a `pendingProgressUpdateRef` that stores the latest progress update before it's synced to the backend. However:

1. `App.tsx` doesn't check this ref when determining if progress should be maintained
2. `useProgressManagement.updateBookProgress` doesn't check the pending update when determining `chapterMatchesExisting`

**Impact**: The most recent progress might be in the pending ref but not in the library state, causing restoration to fail.

### Issue 4: Double Chapter Loading Race Condition

**Location**: `src/components/reader/ReaderWrapper.tsx` lines 377-433

**Problem**: There are two code paths that can trigger chapter loading:

1. `handleChapterChange` callback (lines 286-375)
2. Render-time check when `activeChapter` changes (lines 382-433)

**Issue**: If both trigger simultaneously:
- Both might call `resetRestoration()` with different `shouldRestore` values
- The second call might overwrite the first
- Restoration state becomes inconsistent

**Impact**: Restoration might be skipped even when it should occur.

### Issue 5: `updateBookProgress` Called Before Restoration Completes

**Location**: `src/App.tsx` line 230

**Problem**: `updateBookProgress` is called immediately when selecting a chapter, even when restoration should occur:

```typescript
// Line 230 - Called immediately
updateBookProgress(activeBookId, progressUpdate);

// But restoration happens later in onChapterLoaded callback
```

**Issue**: If `progressUpdate` has `undefined` values (due to stale state), it overwrites the progress before restoration can use it.

**Impact**: Progress is reset before restoration can read it.

## Solutions

### Solution 1: Check Pending Update in `useProgressManagement`

Modify `updateBookProgress` to check `pendingProgressUpdateRef` when determining existing progress:

```typescript
const updateBookProgress = useCallback(async (...) => {
  // ...
  
  // Check both library state AND pending update
  const book = library.find((b) => b.id === bookId);
  const pending = pendingProgressUpdateRef.current;
  const pendingProgress = pending?.bookId === bookId ? pending.progress : null;
  
  // Use pending progress if it's for the same chapter, otherwise use library state
  const existingProgress = 
    (pendingProgress?.currentChapterId === chapter.id) 
      ? pendingProgress 
      : book.progress;
  
  const chapterMatchesExisting =
    existingProgress?.currentChapterId === chapter.id &&
    existingProgress.currentChapterIndex === chapterIndex;
  
  // ...
}, [library, setLibrary]);
```

### Solution 2: Use Functional State Update in `App.tsx`

Instead of reading from `library` prop, use a functional update or check pending state:

```typescript
const handleSelectChapter = useCallback(async (chapterId: string, options?: ChapterSelectionOptions) => {
  // ...
  
  const requestedScrollPosition = options?.scrollPosition ?? "maintain";
  const progressUpdate: { chapterId: string; ... } = { chapterId };

  if (requestedScrollPosition === "maintain") {
    // Use functional update to get latest state
    setLibrary((prevLibrary) => {
      const latestBook = prevLibrary.find(b => b.id === activeBookId);
      if (latestBook?.progress && latestBook.progress.currentChapterId === chapterId) {
        // Preserve existing progress
        progressUpdate.scrollTop = latestBook.progress.currentChapterScrollTop;
        progressUpdate.scrollHeight = latestBook.progress.currentChapterScrollHeight;
        progressUpdate.clientHeight = latestBook.progress.currentChapterClientHeight;
        progressUpdate.percent = latestBook.progress.chapterProgressPercent;
      }
      return prevLibrary; // No change, just reading
    });
  }
  
  updateBookProgress(activeBookId, progressUpdate);
}, [...]);
```

**Better**: Pass a callback to `updateBookProgress` that can check pending state:

```typescript
// In useProgressManagement
const updateBookProgress = useCallback(async (bookId, payload, getLatestBook?: () => Book | undefined) => {
  // Use getLatestBook if provided, otherwise use library
  const book = getLatestBook ? getLatestBook() : library.find((b) => b.id === bookId);
  // ...
}, [library, setLibrary]);
```

### Solution 3: Don't Call `updateBookProgress` When Restoring

Skip calling `updateBookProgress` in `App.tsx` when restoration should occur:

```typescript
const handleSelectChapter = useCallback(async (chapterId: string, options?: ChapterSelectionOptions) => {
  // ...
  
  // Check if we should restore BEFORE updating progress
  const activeBook = library.find(b => b.id === activeBookId);
  const shouldRestore = activeBook?.progress?.currentChapterId === chapterId && 
                       !options?.scrollPosition && 
                       !options?.isManualSelection;
  
  if (!shouldRestore) {
    // Only update progress if we're NOT restoring
    const requestedScrollPosition = options?.scrollPosition ?? "maintain";
    // ... progress update logic
    updateBookProgress(activeBookId, progressUpdate);
  }
  
  setActiveChapterId(chapterId);
  // ...
}, [...]);
```

### Solution 4: Prevent Double Chapter Loading

Add a guard to prevent the render-time check from interfering with `handleChapterChange`:

```typescript
// In ReaderWrapper
const isHandlingChapterChangeRef = useRef(false);

const handleChapterChange = useCallback(async (chapterId: string, options?: ChapterSelectionOptions) => {
  if (isHandlingChapterChangeRef.current) return;
  isHandlingChapterChangeRef.current = true;
  
  try {
    // ... existing logic
  } finally {
    isHandlingChapterChangeRef.current = false;
  }
}, [...]);

// In render-time check
if (previousChapterIdRef.current !== currentChapterId && activeChapter && activeBook) {
  if (isHandlingChapterChangeRef.current) {
    // Skip if handleChapterChange is already handling it
    return;
  }
  // ... rest of logic
}
```

### Solution 5: Flush Pending Update Before Checking Progress

In `App.tsx`, flush any pending updates before checking for existing progress:

```typescript
const handleSelectChapter = useCallback(async (chapterId: string, options?: ChapterSelectionOptions) => {
  // Flush any pending progress updates first
  await flushProgressUpdate();
  
  // Now check for existing progress with up-to-date state
  const activeBook = library.find(b => b.id === activeBookId);
  // ... rest of logic
}, [flushProgressUpdate, ...]);
```

## Recommended Fix Priority

1. **HIGH**: Solution 1 - Check pending update in `useProgressManagement` (prevents progress loss)
2. **HIGH**: Solution 3 - Don't call `updateBookProgress` when restoring (prevents overwriting)
3. **MEDIUM**: Solution 5 - Flush pending update before checking (ensures latest state)
4. **MEDIUM**: Solution 4 - Prevent double chapter loading (prevents race conditions)
5. **LOW**: Solution 2 - Use functional state update (alternative approach)

## Testing Scenarios

After fixes, test these scenarios:

1. Navigate to chapter A, scroll, navigate to chapter B, navigate back to A → Should restore scroll position
2. Rapidly navigate between chapters → Progress should be preserved for each
3. Navigate to chapter, immediately close and reopen app → Should restore from database
4. Navigate to chapter with saved progress, then manually select same chapter from TOC → Should NOT restore (manual selection)
5. Navigate to chapter, scroll, then navigate to next chapter, then back → Should restore both chapters correctly
