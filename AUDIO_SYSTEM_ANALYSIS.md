# Audio System Analysis: Track Loading, Caching, Navigation & Progress

## Overview

The audio system in `src/hooks/audio` is a sophisticated, coordinated architecture that handles:
- **Track Loading & Caching**: Lazy loading with blob URL management
- **Next/Previous Navigation**: Coordinated track changes with chapter synchronization
- **Progress Save & Restoration**: Debounced persistence with state restoration

All operations flow through the `ReaderCoordinator` for proper coordination and cancellation.

---

## 1. Audio Track Loading & Caching

### Architecture

**Core Hook**: `useAudioTrackLoader.ts`
- Built on top of generic `useResourceLoader<T>` hook
- Manages blob URL lifecycle (creation/cleanup)
- Integrates with `ReaderCoordinator` for operation management

### Loading Flow

```
useAudioTrackLoader
  └─> useResourceLoader<AudioTrack>
       └─> coordinator.loadAudioTrack(bookId, trackId)
            └─> onAudioTrackLoad handler (from ReaderCoordinatorProvider)
                 └─> loadEpubAudioBlob (fallback if coordinator unavailable)
```

### Key Components

#### 1.1 Resource Cache (`useResourceLoader.ts`)

```typescript
// Cache structure: Map<"bookId:trackId", ResourceCacheEntry<T>>
cacheRef.current = new Map<string, ResourceCacheEntry<AudioTrack>>()

// Cache key format: `${bookId}:${trackId}`
// Entry contains: { resource: AudioTrack, loadedAt: timestamp }
```

**Cache Operations**:
- `load(bookId, track)`: Checks cache first, loads if missing
- `getCached(bookId, trackId)`: Retrieves cached track
- `isResourceLoaded(bookId, trackId)`: Checks if track is in cache
- `clearCache(bookId?)`: Clears cache (per-book or all)

#### 1.2 Blob URL Management

```typescript
// Track all blob URLs for cleanup
blobUrlsRef.current = new Set<string>()

// When track loads:
if (url.startsWith("blob:")) {
  blobUrlsRef.current.add(url);
}

// On unmount:
blobUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
```

**Why**: Prevents memory leaks by revoking blob URLs when no longer needed.

#### 1.3 Loading Process

1. **Check Cache**: If track already loaded (has `url`), return immediately
2. **Check Coordinator**: Use `coordinator.loadAudioTrack()` if available
3. **Fallback**: Direct `loadEpubAudioBlob()` if coordinator unavailable
4. **Cache Result**: Store loaded track with blob URL
5. **Update State**: Increment `cacheVersion` to trigger `loadedTracks` update

### Cache Access Pattern

```typescript
// Get all loaded tracks as Map
const loadedTracks = useMemo(() => {
  const tracks = loader.getCachedResources();
  return new Map(tracks.map(track => [track.id, track]));
}, [loader, cacheVersion]);

// Usage in components:
const cachedTrack = audioTrackLoader.loadedTracks.get(track.id) || track;
```

### Operation Coordination

All loading goes through `ReaderCoordinator`:
- **Operation ID**: Each load gets unique operation ID
- **Cancellation**: Can cancel in-progress loads
- **Parallel Loading**: Multiple tracks can load simultaneously (not cancelled)
- **State Tracking**: `audioLoading` flag tracks overall loading state

```typescript
// Check for cancellation during load
const currentOp = coordinator.getCurrentOperation("loadAudioTrack");
if (currentOp?.cancelled) {
  throw new Error("Audio track load cancelled");
}
```

---

## 2. Next/Previous Track Navigation

### Architecture

**Entry Point**: `useAudioPlayerManager.changeAudioTrack()`
- Handles track changes with direction support (`"next" | "previous" | "random"`)
- Coordinates with `ReaderCoordinator`
- Manages chapter synchronization

### Navigation Flow

```
User clicks Next/Previous
  └─> ReaderAudioPlayer.handleNext/handlePrevious
       └─> playTrackAt(nextIndex)
            └─> setCurrentIndex(nextIndex)
                 └─> useAudioPlayerManager.changeAudioTrack
                      └─> coordinator.changeAudioTrack(bookId, trackId, direction)
                           └─> onAudioTrackChange handler
                                └─> Updates track index in component
```

### Key Components

#### 2.1 Track Change Handler (`useAudioPlayerManager.ts`)

```typescript
const changeAudioTrack = useCallback(async (
  trackHref: string,
  direction?: "next" | "previous" | "random"
) => {
  // 1. Find track by href
  const track = activeBook.audioTracks.find(t => t.href === trackHref);
  
  // 2. Use coordinator to change track (with cancellation support)
  await coordinator.changeAudioTrack(activeBook.id, track.id, direction);
  
  // 3. Mark track change in audio sync (prevents chapter changes during transition)
  audioTextSync.markTrackChange(trackHref);
  
  // 4. Save progress before changing tracks
  if (activeChapter && onSaveProgress) {
    await onSaveProgress(activeChapter.id);
  }
  
  // 5. Handle chapter change if auto-scroll enabled
  if (autoScrollEnabled && onTrackChangeChapterChange) {
    const chapterHrefs = findChaptersForAudioTrack(activeBook.audioSyncMap, trackHref);
    // Navigate to matching chapter...
  }
}, [...]);
```

#### 2.2 Coordinator Operation (`ReaderCoordinatorContext.tsx`)

```typescript
const changeAudioTrack = useCallback(async (
  bookId: string,
  trackId: string,
  direction?: "next" | "previous" | "random"
) => {
  // Cancel any existing audio operation
  setLocks(prev => {
    if (prev.audio) {
      return { ...prev, audio: { ...prev.audio, cancelled: true } };
    }
    return prev;
  });
  
  // Create new operation
  const operation: OperationState = {
    type: "changeAudioTrack",
    id: operationId,
    bookId,
    trackId,
    cancelled: false,
  };
  
  // Execute via handler
  await onAudioTrackChange(bookId, trackId, direction);
}, [onAudioTrackChange]);
```

**Features**:
- **Cancellation**: Previous operations are cancelled
- **State Tracking**: `trackChanging` flag tracks operation state
- **Error Handling**: Catches and logs errors, respects cancellation

#### 2.3 Chapter Synchronization

When track changes, system automatically:
1. **Finds Matching Chapter**: Uses `audioSyncMap` to find chapters using the new track
2. **Navigates if Needed**: If chapter differs, navigates to correct chapter
3. **Prevents Conflicts**: Marks track change to prevent audio sync from interfering

```typescript
// Find chapters for track
const chapterHrefs = findChaptersForAudioTrack(activeBook.audioSyncMap, trackHref);

// Find matching chapter
const matchingChapter = activeBook.chapters.find((chapter) => {
  return chapterHrefs.some(segmentChapterHref => {
    return chapterHrefsMatch(segmentChapterHref, chapter.href);
  });
});

// Navigate if different
if (matchingChapter && matchingChapter.id !== activeChapter?.id) {
  await onTrackChangeChapterChange(matchingChapter.id, {
    scrollPosition: "top",
    isManualSelection: false,
  });
}
```

#### 2.4 Preloading (Currently Disabled)

```typescript
// Preload next track disabled for memory optimization
// const trackIndex = activeBook.audioTracks.findIndex(t => t.id === track.id);
// if (trackIndex >= 0 && trackIndex + 1 < activeBook.audioTracks.length) {
//   const nextTrack = activeBook.audioTracks[trackIndex + 1];
//   if (!nextTrack.url && !audioTrackLoader.isTrackLoaded(activeBook.id, nextTrack.id)) {
//     await coordinator.loadAudioTrack(activeBook.id, nextTrack.id);
//   }
// }
```

**Why Disabled**: Memory optimization - only loads tracks when needed.

---

## 3. Progress Save & Restoration

### Architecture

**Two-Level System**:
1. **Immediate State Update**: Local library state updated instantly
2. **Debounced Backend Sync**: Backend sync with 150ms debounce

**Core Hooks**:
- `useAudioStatePersistence.ts`: Handles backend persistence
- `useAudioPlayerState.ts`: Manages restoration logic

### Progress Saving

#### 3.1 Save Flow

```
Audio progress update
  └─> useAudioStatePersistence.updateBookAudioState
       ├─> Update local library state (immediate)
       ├─> coordinator.saveAudioTimestamp (if available)
       └─> Store pending update
            └─> Debounced backend sync (150ms)
                 └─> updateBookAudioStateBackend
```

#### 3.2 Save Implementation (`useAudioStatePersistence.ts`)

```typescript
const updateBookAudioState = useCallback(async (
  bookId: string,
  snapshot: {
    currentTimeSeconds: number;
    trackId?: string;
    trackHref?: string;
    trackIndex?: number;
    updatedAt?: string;
  },
) => {
  // 1. Use coordinator to save timestamp (if available)
  if (snapshot.trackId && coordinator?.saveAudioTimestamp) {
    await coordinator.saveAudioTimestamp(
      bookId,
      snapshot.trackId,
      snapshot.currentTimeSeconds
    );
  }
  
  // 2. Validate and resolve track
  const resolvedTrack = book.audioTracks.find(t => t.id === snapshot.trackId) 
    ?? book.audioTracks.find(t => t.href === snapshot.trackHref)
    ?? book.audioTracks[snapshot.trackIndex ?? 0];
  
  // 3. Skip if unchanged (within 0.25s tolerance)
  if (existing && 
      existing.currentTrackId === resolvedTrack.id &&
      Math.abs(existing.currentTimeSeconds - normalizedSeconds) < 0.25) {
    return;
  }
  
  // 4. Update local state immediately
  const nextAudioState = {
    currentTrackId: resolvedTrack.id,
    currentTrackHref: resolvedTrack.href,
    currentTrackIndex: resolvedIndex,
    currentTimeSeconds: normalizedSeconds,
    updatedAt: snapshot.updatedAt ?? new Date().toISOString(),
  };
  
  setLibrary(prev => prev.map(b => 
    b.id === bookId ? { ...b, audioState: nextAudioState } : b
  ));
  
  // 5. Store pending update and trigger debounced sync
  pendingAudioUpdateRef.current = { bookId, audioState: nextAudioState, book };
  audioUpdateDebouncerRef.current.call();
}, [library, setLibrary, coordinator]);
```

**Key Features**:
- **Immediate Local Update**: UI updates instantly
- **Debounced Backend**: Reduces backend calls (150ms debounce)
- **Change Detection**: Skips save if change < 0.25s (prevents spam)
- **Coordinator Integration**: Uses coordinator for timestamp saves

#### 3.3 Debounced Sync

```typescript
const audioUpdateDebouncerRef = useRef(
  createDebounce(async () => {
    const pending = pendingAudioUpdateRef.current;
    if (!pending) return;
    
    try {
      const updatedBook = await updateBookAudioStateBackend(
        pending.bookId,
        pending.audioState!,
      );
      setLibrary(prev => prev.map(b => 
        b.id === pending.bookId ? updatedBook : b
      ));
    } catch (error) {
      logger.error("Failed to sync audio state to backend", error);
      // Revert to previous state on error
      setLibrary(prev => prev.map(b => 
        b.id === pending.bookId ? pending.book : b
      ));
    } finally {
      pendingAudioUpdateRef.current = null;
    }
  }, 150)
);
```

#### 3.4 Flush on Pause/Close

```typescript
const flushAudioStateUpdate = useCallback(async () => {
  const pending = pendingAudioUpdateRef.current;
  if (!pending) return;
  
  const debouncer = audioUpdateDebouncerRef.current;
  debouncer.cancel(); // Cancel pending debounced call
  
  // Immediately sync to backend
  await updateBookAudioStateBackend(pending.bookId, pending.audioState!);
}, [setLibrary]);
```

**Usage**: Called when audio player is paused or closed to ensure progress is saved.

### Progress Restoration

#### 3.5 Restoration Flow

```
Component mounts / Book changes
  └─> useAudioPlayerState.initialize()
       ├─> Read audioState from library
       ├─> Find track index from audioState
       ├─> Extract restore time
       └─> Set restoreTime and isRestoring flags
            └─> onTrackLoaded callback
                 └─> Apply restoreTime to audio element
                      └─> Emit progress update
```

#### 3.6 Restoration Implementation (`useAudioPlayerState.ts`)

```typescript
const initialize = useCallback(() => {
  if (!bookId) {
    // Reset state
    setRestoreTime(null);
    setIsRestoring(false);
    setCurrentIndexState(0);
    return;
  }
  
  // Create signature to detect changes
  const signature = `${bookId}|${initialAudioState?.currentTrackId}|${initialAudioState?.updatedAt}|${tracks.length}`;
  if (initializedRef.current === signature) {
    return; // Already initialized
  }
  
  // Check if progress is an echo (prevent restoration loop)
  if (isProgressEcho()) {
    initializedRef.current = signature;
    return; // Don't restore if this is just an echo
  }
  
  // Find track index from audio state
  const nextIndex = findTrackIndex();
  setCurrentIndexState(nextIndex);
  currentIndexRef.current = nextIndex;
  
  // Extract restore time
  const restoredTime = typeof initialAudioState?.currentTimeSeconds === "number"
    ? Math.max(initialAudioState.currentTimeSeconds, 0)
    : null;
  
  setRestoreTime(restoredTime);
  setIsRestoring(restoredTime !== null);
  restorationAppliedRef.current = null;
  lastProgressSnapshotRef.current = { timestamp: 0 };
  initializedRef.current = signature;
}, [bookId, initialAudioState, tracks.length, findTrackIndex, isProgressEcho]);
```

**Track Index Resolution**:
```typescript
const findTrackIndex = useCallback((): number => {
  if (!tracks.length || !initialAudioState) return 0;
  
  // Try by ID first
  if (initialAudioState.currentTrackId) {
    const matchById = tracks.findIndex(
      t => t.id === initialAudioState.currentTrackId
    );
    if (matchById >= 0) return matchById;
  }
  
  // Try by href
  if (initialAudioState.currentTrackHref) {
    const matchByHref = tracks.findIndex(
      t => t.href === initialAudioState.currentTrackHref
    );
    if (matchByHref >= 0) return matchByHref;
  }
  
  // Try by index
  if (typeof initialAudioState.currentTrackIndex === "number" &&
      initialAudioState.currentTrackIndex >= 0 &&
      initialAudioState.currentTrackIndex < tracks.length) {
    return initialAudioState.currentTrackIndex;
  }
  
  return 0;
}, [tracks, initialAudioState]);
```

#### 3.7 Applying Restoration (`onTrackLoaded`)

```typescript
const onTrackLoaded = useCallback((audioElement: HTMLAudioElement) => {
  const currentTrack = tracksRef.current[currentIndexRef.current];
  if (!currentTrack || !audioElement) return;
  
  const shouldRestore = isRestoringRef.current;
  const timeToRestore = restoreTime;
  const currentTrackId = currentTrack.id;
  const alreadyApplied = restorationAppliedRef.current === currentTrackId;
  
  if (shouldRestore && 
      timeToRestore !== null && 
      Number.isFinite(timeToRestore) && 
      !alreadyApplied) {
    try {
      audioElement.currentTime = timeToRestore;
      const appliedTime = audioElement.currentTime || timeToRestore;
      restorationAppliedRef.current = currentTrackId;
      emitProgress(appliedTime); // Emit progress to update UI
      setIsRestoring(false);
      setRestoreTime(null);
    } catch (error) {
      logger.warn("Failed to apply restore time:", error);
      setIsRestoring(false);
      setRestoreTime(null);
    }
  }
}, [restoreTime, emitProgress]);
```

**Key Features**:
- **Prevents Duplicate Restoration**: Uses `restorationAppliedRef` to track applied tracks
- **Error Handling**: Catches errors and resets restoration state
- **Progress Emission**: Emits progress after restoration to update UI

#### 3.8 Echo Detection

Prevents restoration loops by detecting when progress update is an echo of our own save:

```typescript
const isProgressEcho = useCallback((): boolean => {
  const state = initialAudioState;
  if (!state) return false;
  
  const snapshot = lastProgressSnapshotRef.current;
  
  // Check if track matches
  const trackMatches = 
    Boolean(snapshot.trackId && snapshot.trackId === state.currentTrackId) ||
    Boolean(snapshot.trackHref && snapshot.trackHref === state.currentTrackHref) ||
    (typeof snapshot.trackIndex === "number" &&
     typeof state.currentTrackIndex === "number" &&
     snapshot.trackIndex === state.currentTrackIndex);
  
  if (!trackMatches) return false;
  
  // Check if time matches (within 0.5s tolerance)
  const timeMatches =
    (snapshot.updatedAt && snapshot.updatedAt === state.updatedAt) ||
    (typeof snapshot.currentTimeSeconds === "number" &&
     typeof state.currentTimeSeconds === "number" &&
     Math.abs(snapshot.currentTimeSeconds - state.currentTimeSeconds) <= 0.5);
  
  return timeMatches;
}, [initialAudioState]);
```

---

## 4. Integration Points

### 4.1 ReaderCoordinator

All audio operations flow through `ReaderCoordinator`:
- **Operation Management**: Unique IDs, cancellation support
- **State Tracking**: Loading flags (`audioLoading`, `trackChanging`, `audioRestoring`, `audioSaving`)
- **Error Handling**: Centralized error logging
- **Handler Integration**: Connects to parent component handlers

### 4.2 Audio-Text Synchronization

`useAudioTextSync` handles:
- **Highlighting**: Updates highlighted element based on audio time
- **Auto-Scroll**: Scrolls to current audio position
- **Chapter Changes**: Detects when audio moves to different chapter
- **Track Change Coordination**: Prevents conflicts during track changes

### 4.3 Library Context

Audio state is stored in `Book.audioState`:
```typescript
type Book = {
  // ...
  audioState?: {
    currentTrackId: string;
    currentTrackHref: string;
    currentTrackIndex: number;
    currentTimeSeconds: number;
    updatedAt: string;
  };
};
```

---

## 5. Memory Optimization

### 5.1 Blob URL Cleanup
- All blob URLs tracked in `blobUrlsRef`
- Cleaned up on unmount and cache clear
- Prevents memory leaks

### 5.2 Cache Management
- Per-book cache clearing
- Global cache clearing option
- Cache version tracking for efficient updates

### 5.3 Preloading Disabled
- Next track preloading commented out
- Only loads tracks when explicitly requested
- Reduces memory usage

### 5.4 DOM Query Caching
- Header/player offset calculations cached (5s TTL)
- Reduces repeated DOM queries
- Improves scroll performance

---

## 6. Error Handling

### 6.1 Loading Errors
- Catches and logs errors
- Returns `null` on failure
- Continues operation if possible

### 6.2 Restoration Errors
- Catches errors when setting `audioElement.currentTime`
- Resets restoration state on error
- Logs warnings for debugging

### 6.3 Backend Sync Errors
- Catches backend sync failures
- Reverts to previous state on error
- Logs errors for debugging

---

## 7. Summary

### Track Loading
- ✅ Generic resource loader with per-book caching
- ✅ Blob URL lifecycle management
- ✅ Coordinator-based operation management
- ✅ Parallel loading support (not cancelled)

### Navigation
- ✅ Next/previous with direction support
- ✅ Chapter synchronization on track change
- ✅ Progress save before track change
- ✅ Conflict prevention during transitions

### Progress Management
- ✅ Immediate local state updates
- ✅ Debounced backend sync (150ms)
- ✅ Flush on pause/close
- ✅ Multi-level restoration (track index + time)
- ✅ Echo detection to prevent loops

### Architecture
- ✅ Coordinator-based operation management
- ✅ Memory-optimized (blob cleanup, disabled preloading)
- ✅ Error handling throughout
- ✅ Comprehensive logging for debugging
