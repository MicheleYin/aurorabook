# Save Progress Issue Analysis

## Problem

`saveProgress` is not being called when changing chapters or navigating away from the library.

## Root Cause: Three Different `saveProgress` Functions

There are **three different functions** with the same name but different signatures:

### 1. `useChapterProgress.saveProgress()` 
- **Location**: `src/hooks/library/useChapterProgress.ts:68`
- **Signature**: `() => void` (no parameters)
- **Purpose**: Saves progress for the current active chapter
- **Registered via**: `onSaveProgress(saveProgress)` callback
- **Stored in**: `App.tsx.saveProgressRef.current`

### 2. `ReaderWrapper.saveProgress(chapterId: string)`
- **Location**: `src/components/reader/ReaderWrapper.tsx:78`
- **Signature**: `(chapterId: string) => Promise<void>`
- **Purpose**: Can save progress for any chapter (current or different)
- **Used by**: `useAudioPlayerProgress` (line 502)

### 3. `App.tsx.saveProgress(context)`
- **Location**: `src/App.tsx:135`
- **Signature**: `(context: { toChapterId?: string; source: string; ... }) => Promise<void>`
- **Purpose**: Wrapper that calls `saveProgressRef.current()` and flushes updates
- **Called from**: `handleSelectChapter`, navigation handlers

## The Flow (Current - Broken)

1. **Registration**:
   - `useChapterProgress` creates `saveProgress()` function (no params)
   - Calls `onSaveProgress(saveProgress)` to register it
   - This goes through: `ReaderWrapper.onSaveProgress` → `App.handleSaveProgress` → `saveProgressRef.current = saveFn`

2. **When changing chapters**:
   - `App.handleSelectChapter` calls `saveProgress({ toChapterId, source })`
   - This calls `saveProgressRef.current()` if it exists
   - **BUT**: `saveProgressRef.current` might be null if:
     - Component hasn't mounted yet
     - `onSaveProgress` callback wasn't called
     - Component unmounted

3. **When navigating away**:
   - Similar issue - `saveProgressRef.current` might be null

## Issues

1. **`saveProgressRef.current` might be null**: No guarantee it's set before navigation
2. **Different function signatures**: `ReaderWrapper.saveProgress` takes `chapterId`, but `App.tsx` expects a no-arg function
3. **`useProgressSaving` hook is unused**: It exists but `App.tsx` has its own inline version

## Solution

### Option 1: Ensure `saveProgressRef` is always set (Quick Fix)

Add a fallback in `App.tsx.saveProgress` to use `ReaderWrapper.saveProgress` if ref is null:

```typescript
const saveProgress = useCallback(
  async (context: {
    toChapterId?: string;
    source: string;
    additionalData?: Record<string, unknown>;
  }) => {
    if (saveProgressRef.current && activeChapterId) {
      logger.log("[App] Saving progress", {
        bookId: activeBookId,
        fromChapterId: activeChapterId,
        toChapterId: context.toChapterId,
        source: context.source,
        ...context.additionalData,
      });
      saveProgressRef.current();
      await flushProgressUpdate();
    } else if (activeChapterId && activeBookId) {
      // Fallback: directly call handleChapterProgress if ref not set
      logger.warn("[App] saveProgressRef not set, using fallback", {
        bookId: activeBookId,
        chapterId: activeChapterId,
      });
      // Could trigger a manual save via ReaderWrapper if accessible
    }
  },
  [activeChapterId, activeBookId, flushProgressUpdate]
);
```

### Option 2: Unify the save functions (Better Fix)

Create a single `saveProgress` function that can handle both cases:

1. Remove `useProgressSaving` hook (unused)
2. Make `ReaderWrapper.saveProgress` the primary function
3. Have `App.tsx` call `ReaderWrapper.saveProgress` directly instead of using a ref

### Option 3: Add explicit save on unmount (Quick Fix)

Add cleanup to save progress when component unmounts or view changes:

```typescript
// In App.tsx or ReaderWrapper
useEffect(() => {
  return () => {
    // Save progress on unmount
    if (saveProgressRef.current && activeChapterId) {
      saveProgressRef.current();
      flushProgressUpdate();
    }
  };
}, [activeChapterId, flushProgressUpdate]);
```

## Recommended Fix

**Option 2** is best - unify the functions. But for a quick fix, **Option 3** ensures progress is saved on navigation.
