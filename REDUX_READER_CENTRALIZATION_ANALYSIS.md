# Redux Reader Centralization Analysis

## Overview
This document identifies state management opportunities in the reader components that could benefit from Redux centralization.

## High Priority - Reader UI State

### 1. ReaderPanel UI State (`src/components/ReaderPanel.tsx`)
**Current:** Multiple `useState` hooks for drawer and UI states
**State:**
- `isSettingsOpen` - Settings drawer visibility
- `isTocOpen` - Table of contents drawer visibility  
- `isImmersive` - Immersive mode (hides chrome)
- `isAudioReopenVisible` - Audio reopen button visibility
- `shouldRenderAudioReopen` - Audio reopen button render state
- `preserveChromeNextSelection` - Flag to preserve chrome on next chapter selection

**Recommendation:** Move to `readerSlice` as `readerUI` state:
```typescript
readerUI: {
  isSettingsOpen: boolean;
  isTocOpen: boolean;
  isImmersive: boolean;
  isAudioReopenVisible: boolean;
  shouldRenderAudioReopen: boolean;
  preserveChromeNextSelection: boolean;
}
```

**Benefits:**
- State persists across component remounts
- Can be accessed from multiple components
- Easier to debug with Redux DevTools
- Can be saved/restored if needed

---

## High Priority - Chapter Restoration State

### 2. Chapter Restoration State (`src/hooks/chapter/useChapterState.ts`)
**Current:** Local `useState` hooks for restoration
**State:**
- `currentIndex` - Current chapter index
- `restoreScrollTop` - Scroll position to restore
- `restoreElementIndex` - Element index to restore
- `isRestoring` - Restoration in progress flag

**Recommendation:** Move to `readerSlice`:
```typescript
chapterRestoration: {
  currentChapterIndex: number;
  restoreScrollTop: number | null;
  restoreElementIndex: number | null;
  isRestoring: boolean;
}
```

**Benefits:**
- Restoration state persists across component remounts
- Can be accessed from multiple components
- Easier to coordinate restoration operations
- Works better with Redux thunks for async operations

---

## High Priority - Audio Player Restoration State

### 3. Audio Player Restoration State (`src/hooks/audio/useAudioPlayerState.ts`)
**Current:** Local `useState` hooks for restoration
**State:**
- `currentIndex` - Current track index
- `restoreTime` - Audio time to restore
- `isRestoring` - Restoration in progress flag

**Recommendation:** Already partially in Redux (`readerSlice.audioPlayer`), but could be enhanced:
```typescript
audioPlayer: {
  // Existing...
  currentTrackIndex: number; // Already exists
  restoreTime: number | null; // Already exists
  isRestoring: boolean; // Already exists
}
```

**Status:** ✅ Already in Redux! Just need to ensure all components use it.

---

## Medium Priority - Reader Coordinator

### 4. Reader Coordinator Context (`src/contexts/ReaderCoordinatorContext.tsx`)
**Current:** React Context for operation coordination
**State:**
- `locks` - Operation locks (chapter, audio, progress)
- `loading` - Loading states for all operations

**Recommendation:** Already created `readerCoordinatorSlice`! ✅
**Status:** The slice exists but the context is still being used. Should migrate components to use Redux selectors instead of context.

**Migration Path:**
- Replace `useContext(ReaderCoordinatorContext)` with `useAppSelector(selectOperationLocks)`
- Replace coordinator methods with Redux thunks
- Remove ReaderCoordinatorContext once all components migrated

---

## Medium Priority - Chapter Animation State

### 5. Chapter Animation State
**Current:** Local state in multiple places:
- `ReaderWrapper.tsx`: `chapterAnimationState`
- `useReaderManager.ts`: `chapterAnimationState`

**Recommendation:** Move to `readerSlice`:
```typescript
chapterAnimation: {
  state: "entering" | "entered" | null;
  direction: "forward" | "backward" | null;
}
```

**Benefits:**
- Consistent animation state across components
- Can coordinate with chapter transitions
- Easier to debug animation issues

---

## Medium Priority - Audio Player Internal State

### 6. Audio Player Internal State (`src/components/reader/ReaderAudioPlayer.tsx`)
**Current:** Many `useState` hooks for player state
**State:**
- `isPlaying` - Playback state
- `currentTime` - Current playback time
- `duration` - Track duration
- `playbackRate` - Playback speed
- `isScrubbing` - User is scrubbing
- `scrubTime` - Scrub position
- `isDismissing` - Dismissal animation state
- `isVisible` - Player visibility
- `showTracksDialog` - Tracks dialog visibility
- `trackAnimationState` - Track change animation
- `trackAnimationDirection` - Animation direction
- `loadedCount` - Preloaded tracks count
- `isTrackLoading` - Track loading state
- `isLocalTrackChanging` - Local track change flag

**Recommendation:** Move to `readerSlice.audioPlayer`:
```typescript
audioPlayer: {
  // Existing...
  playback: {
    isPlaying: boolean;
    currentTime: number;
    duration: number;
    playbackRate: number;
  };
  scrubbing: {
    isScrubbing: boolean;
    scrubTime: number | null;
  };
  ui: {
    isDismissing: boolean;
    isVisible: boolean;
    showTracksDialog: boolean;
  };
  animation: {
    trackAnimationState: "entering" | "entered" | null;
    trackAnimationDirection: "left" | "right" | null;
  };
  loading: {
    loadedCount: number;
    isTrackLoading: boolean;
    isLocalTrackChanging: boolean;
  };
}
```

**Benefits:**
- Centralized audio player state
- Can persist playback state if needed
- Easier to debug with Redux DevTools
- Can coordinate with other Redux state

**Note:** Some of this state (like `currentTime`) updates very frequently and might be better kept local. Consider keeping high-frequency updates local and only storing important state in Redux.

---

## Low Priority - Library Context Migration

### 7. Library Context Usage
**Current:** Some components still use `useLibraryContext()`:
- `ReaderWrapper.tsx`: Uses `useLibraryContext()` for library access
- `useReaderManager.ts`: Uses `useLibraryContext()` for library access

**Recommendation:** Replace with Redux selectors:
- Replace `useLibraryContext()` with `useAppSelector(selectLibrary)`
- Replace `setLibrary` with Redux actions
- Replace `flushProgressUpdate` with Redux thunks

**Status:** Library is already in Redux, just need to migrate components.

---

## Low Priority - Settings State

### 8. Persistent Settings
**Current:** `usePersistentSettings()` hook used in:
- `ReaderAudioPlayer.tsx`: For playback speed

**Recommendation:** Could move to Redux, but current implementation is fine since:
- Settings are persisted to localStorage
- Not frequently accessed
- Current hook pattern works well

**Optional:** If we want to centralize, could add to Redux:
```typescript
settings: {
  audioPlaybackSpeed: number;
  // ... other settings
}
```

---

## Implementation Priority

### Phase 1: High Priority (Immediate)
1. ✅ Audio Player Restoration State - Already in Redux, ensure usage
2. ReaderPanel UI State - Move to `readerSlice.readerUI`
3. Chapter Restoration State - Move to `readerSlice.chapterRestoration`

### Phase 2: Medium Priority (Next Sprint)
4. Reader Coordinator - Migrate from Context to Redux (slice already exists)
5. Chapter Animation State - Move to `readerSlice.chapterAnimation`
6. Audio Player Internal State - Move high-level state to Redux (keep frequent updates local)

### Phase 3: Low Priority (Future)
7. Library Context Migration - Replace remaining `useLibraryContext()` calls
8. Settings State - Optional centralization

---

## Considerations

### Performance
- **High-frequency updates** (like `currentTime` in audio player) should remain local
- Use Redux for **state that needs coordination** or **persistence**
- Use selectors with `createSelector` for **computed state**

### State Granularity
- Don't over-centralize - some local state is appropriate
- Centralize state that:
  - Needs to be shared across components
  - Needs to persist across remounts
  - Needs coordination with other state
  - Benefits from Redux DevTools debugging

### Migration Strategy
1. Add new Redux state alongside existing local state
2. Migrate components one at a time
3. Remove old state management once migration complete
4. Test thoroughly at each step

---

## Summary

**Total Opportunities:** 8 areas
- **High Priority:** 3 areas
- **Medium Priority:** 3 areas  
- **Low Priority:** 2 areas

**Estimated Impact:**
- Better state coordination
- Easier debugging with Redux DevTools
- More predictable state management
- Better testability
- Potential for state persistence

**Estimated Effort:**
- Phase 1: 2-3 days
- Phase 2: 3-4 days
- Phase 3: 1-2 days

