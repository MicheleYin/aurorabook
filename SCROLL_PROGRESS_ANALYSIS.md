# Scroll Progress Save and Restore Analysis

This document analyzes how scroll progress in a chapter is saved and restored in the TTS Tauri application.

## Overview

The scroll progress system tracks the user's reading position within each chapter and persists it to a SQLite database. When a user returns to a chapter, the system restores their previous scroll position.

## Data Flow

### 1. Progress Tracking (Saving)

#### Components Involved:
- **`useChapterProgress`** (`src/hooks/library/useChapterProgress.ts`) - Tracks scroll metrics
- **`progress-utils.ts`** - Creates progress snapshots from scroll metrics
- **`scroll-utils.ts`** - Computes scroll metrics from DOM elements
- **`useProgressManagement`** - Manages progress updates with debouncing
- **`book-service.ts`** - Backend API for persisting progress

#### Flow:

1. **Scroll Event Detection**
   - User scrolls the chapter content
   - `useChapterProgress.updateMetricsOnScroll()` is called on scroll events
   - Updates `lastKnownMetrics` in the progress state ref

2. **Progress Snapshot Creation**
   - On scroll end, `emitChapterProgress()` is called
   - Uses `getCurrentScrollMetrics()` to get current scroll position:
     - Tries container element first (if scrollable)
     - Falls back to window scroll metrics
   - Creates a `ChapterProgressSnapshot` via `createProgressSnapshot()`:
     ```typescript
     {
       chapterId: string,
       scrollTop: number,        // Current scroll position
       scrollHeight: number,      // Total scrollable height
       clientHeight: number,      // Visible height
       percent: number,           // Progress percentage (0-1)
       activeElementId: string | null,
       activeElementIndex: number | null
     }
     ```

3. **Change Detection**
   - Compares new snapshot with previous using `isProgressUnchanged()`
   - Only proceeds if progress has changed (tolerance: 0.5px scrollTop, 0.001 percent)

4. **Progress Update**
   - Calls `onProgress(snapshot)` callback
   - In `ReaderWrapper`, this calls `onChapterProgress(bookId, snapshot)`
   - In `App.tsx`, this calls `handleChapterProgress()` from `useProgressManagement`

5. **Debounced Backend Sync**
   - `useProgressManagement.updateBookProgress()` updates local state immediately
   - Stores pending update in ref
   - Debounces backend sync (200ms delay) via `createDebounce`
   - On debounce trigger, calls `updateBookProgressBackend()` which:
     - Invokes Tauri command `update_book_progress`
     - Backend updates SQLite database fields:
       - `progress_current_chapter_scroll_top` (REAL)
       - `progress_current_chapter_scroll_height` (REAL)
       - `progress_current_chapter_client_height` (REAL)
       - `progress_chapter_progress_percent` (REAL)
       - Plus chapter metadata (id, href, index, etc.)

6. **Manual Save Triggers**
   - Before chapter change: `saveProgress(chapterId)` is called
   - On navigation away: `saveProgress()` is called
   - On audio sync: Progress is saved when audio position changes

#### Key Implementation Details:

- **Prevents Overwriting During Restoration**: 
  ```typescript
  // In useChapterProgress.saveProgress()
  if (isRestoringRef.current) {
    return; // Skip saving during restoration
  }
  
  // If scrollTop is 0 (likely during restoration), use last known metrics
  if (currentMetrics.scrollTop === 0 && lastKnownMetrics.scrollTop > 0) {
    metricsToUse = lastKnownMetrics; // Preserve valid progress
  }
  ```

- **Container vs Window Scrolling**:
  - System detects if content is in a scrollable container or uses window scroll
  - Prefers container metrics if `maxScroll > 0`
  - Falls back to window metrics if container isn't scrollable

### 2. Progress Restoration (Loading)

#### Components Involved:
- **`useScrollManagement`** (`src/hooks/reader/useScrollManagement.ts`) - Handles restoration
- **`ReaderWrapper`** - Orchestrates restoration timing
- **`scroll-utils.ts`** - `restoreScrollPosition()` function

#### Flow:

1. **Determining if Restoration Should Occur**
   - In `ReaderWrapper.shouldRestoreProgress()`:
     ```typescript
     const hasProgress = activeBook.progress?.currentChapterId === chapterId;
     const shouldRestore = !options?.scrollPosition && 
                          !options?.isManualSelection && 
                          hasProgress;
     ```
   - Restoration is skipped if:
     - User explicitly requested scroll position (e.g., "top", "bottom")
     - User manually selected chapter (e.g., from TOC)
     - Chapter has no saved progress

2. **Restoration State Setup**
   - When chapter change is detected, `scrollManagement.resetRestoration(shouldRestore)` is called
   - Sets `restoreState.shouldRestore = shouldRestore`

3. **Chapter Loading**
   - Chapter content is loaded via `ensureChapterLoaded()`
   - Content is rendered in DOM
   - `onChapterLoaded` callback is triggered after DOM update

4. **Restoration Execution**
   - `onChapterLoaded` checks if restoration should occur
   - Calls `restoreProgress()` which calls `scrollManagement.restoreProgress()`
   - `restoreProgress()` performs:
     - Validates: book has progress, chapter matches, hasn't already restored
     - Sets `isRestoring = true` to prevent saving during restoration
     - Waits for DOM to be ready (retry loop, max 40 attempts = 2 seconds)

5. **Scroll Position Calculation**
   ```typescript
   // In useScrollManagement.restoreProgress()
   const targetScrollTop = progress.currentChapterScrollTop > 0
     ? Math.min(progress.currentChapterScrollTop, metrics.maxScroll)
     : (progress.chapterProgressPercent > 0
       ? Math.round(progress.chapterProgressPercent * metrics.maxScroll)
       : 0);
   ```
   - Prefers exact `scrollTop` if available
   - Falls back to percentage-based calculation
   - Clamps to current `maxScroll` to handle dimension changes

6. **Applying Scroll Position**
   - If container is scrollable: `node.scrollTop = targetScrollTop`
   - If window is scrollable: `window.scrollTo({ top: targetScrollTop, behavior: "auto" })`
   - Marks restoration as complete: `hasRestored = true`, `isRestoring = false`

7. **Post-Restoration**
   - `onComplete` callback is called
   - Handles any pending scroll targets (e.g., fragment navigation)
   - Progress tracking resumes (can now save new scroll positions)

#### Key Implementation Details:

- **Retry Logic**: 
  - Waits for contentRef to be available
  - Waits for scroll metrics to be valid (maxScroll > 0)
  - Retries every 50ms, up to 40 attempts (2 seconds total)
  - Handles cases where content loads asynchronously

- **Dimension Handling**:
  - If saved dimensions match current dimensions closely (within 5% tolerance), uses exact scrollTop
  - Otherwise, calculates position based on percentage ratio
  - Handles cases where content height changes (e.g., font size, window resize)

- **Prevents Double Restoration**:
  ```typescript
   if (restoreStateRef.current.hasRestored) {
     return; // Already restored, don't restore again
   }
   ```

## Data Structure

### Frontend TypeScript Types

```typescript
// ChapterProgressSnapshot (temporary, in-memory)
type ChapterProgressSnapshot = {
  chapterId: string;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  percent: number;
  activeElementId: string | null;
  activeElementIndex: number | null;
};

// Book Progress (persisted)
type BookProgress = {
  currentChapterId: string;
  currentChapterHref: string;
  currentChapterIndex: number;
  currentChapterElementId?: string | null;
  currentChapterElementIndex?: number | null;
  currentChapterScrollTop: number;        // Key field for restoration
  currentChapterScrollHeight: number;    // For dimension matching
  currentChapterClientHeight: number;     // For dimension matching
  chapterProgressPercent: number;        // Fallback for restoration
  bookProgressPercent: number;            // Overall book progress
  updatedAt: string;
};
```

### Backend Database Schema

```sql
-- SQLite table: books
progress_current_chapter_scroll_top REAL,        -- Exact scroll position
progress_current_chapter_scroll_height REAL,     -- Saved content height
progress_current_chapter_client_height REAL,     -- Saved viewport height
progress_chapter_progress_percent REAL,          -- Percentage (0.0-1.0)
progress_current_chapter_id TEXT,                -- Chapter identifier
progress_current_chapter_href TEXT,              -- Chapter href
progress_current_chapter_index INTEGER,         -- Chapter index
progress_updated_at TEXT                         -- ISO timestamp
```

## Special Cases

### 1. Chapter Navigation with "maintain" Position

When navigating to a chapter with `scrollPosition: "maintain"`:
- `App.tsx.handleSelectChapter()` preserves existing progress values
- Prevents resetting progress when user returns to a chapter
- Used when restoring progress automatically

### 2. Manual Chapter Selection

When user manually selects a chapter (e.g., from TOC):
- `isManualSelection: true` is set
- Restoration is skipped
- Chapter loads at top or specified position

### 3. Audio Sync

When audio playback syncs to text:
- May trigger chapter changes
- Progress is saved before changing chapters
- New chapter may scroll to specific element (not restored position)

### 4. Dimension Changes

If content dimensions change (font size, window resize):
- System uses percentage-based restoration
- Calculates: `targetScrollTop = savedPercent * currentMaxScroll`
- Maintains relative position even if absolute dimensions differ

### 5. Rapid Chapter Changes

When changing chapters rapidly:
- Pending progress updates are flushed before new chapter update
- Prevents losing progress from previous chapter
- Ensures each chapter's progress is saved correctly

## Performance Optimizations

1. **Debouncing**: Progress updates are debounced (200ms) to avoid excessive database writes
2. **Change Detection**: Only saves if progress actually changed (tolerance-based comparison)
3. **Immediate Local Updates**: Local state updates immediately, backend sync is async
4. **Caching**: Backend caches book data to avoid re-fetching after progress updates
5. **Lazy Loading**: Chapters are loaded on-demand, not all at once

## Error Handling

- If backend save fails, local state is reverted to previous book state
- If restoration fails (max attempts), logs error but doesn't crash
- If scroll metrics are invalid, restoration is skipped gracefully
- Progress tracking continues even if individual saves fail

## Summary

The scroll progress system uses a multi-layered approach:

1. **Tracking**: Continuously monitors scroll position during reading
2. **Snapshots**: Creates progress snapshots with change detection
3. **Debouncing**: Batches updates to reduce database writes
4. **Persistence**: Saves to SQLite via Tauri backend
5. **Restoration**: Restores position when returning to chapter, with retry logic and dimension handling
6. **Protection**: Prevents saving during restoration to avoid overwriting valid progress

The system handles edge cases like dimension changes, rapid navigation, manual selections, and audio sync scenarios while maintaining good performance through debouncing and change detection.
