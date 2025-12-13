# Hooks Integration Plan with ReaderCoordinator

## Overview
This document outlines how existing hooks should be integrated with the new ReaderCoordinatorContext to ensure all operations are properly coordinated and can be cancelled.

## Hook Analysis

### 1. **useAudioPlayerState** (Library Hook)
**Purpose**: Manages track index and restoration time from library state
**Integration**:
- ✅ Keep as-is (state management only)
- ⚠️ Should check `coordinator.isOperationInProgress("changeAudioTrack")` before allowing track changes
- ⚠️ Should check `coordinator.isOperationInProgress("restoreAudioTimestamp")` during restoration

### 2. **useAudioStatePersistence** (Library Hook)
**Purpose**: Updates audio state with debouncing to backend
**Integration**:
- ✅ Replace direct `updateBookAudioState` calls with `coordinator.saveAudioTimestamp()`
- ✅ Use `coordinator.saveAudioTrack()` for track-level saves
- ✅ Check coordinator loading state before operations

### 3. **useChapterProgress** (Library Hook)
**Purpose**: Tracks scroll metrics and creates progress snapshots
**Integration**:
- ✅ Replace direct `onProgress` calls with `coordinator.saveChapterProgress()`
- ✅ Check `coordinator.isOperationInProgress("saveChapterProgress")` before saving
- ✅ Check `coordinator.isOperationInProgress("restoreChapterProgress")` during restoration

### 4. **useProgressManagement** (Library Hook)
**Purpose**: Updates book progress with debouncing
**Integration**:
- ✅ Replace `updateBookProgress` calls with `coordinator.saveChapterProgress()`
- ✅ Use coordinator's `flushProgressUpdate` equivalent
- ✅ Check coordinator state before operations

### 5. **useAudioPlayerProgress** (Reader Hook)
**Purpose**: Handles progress saving, track changes, and highlighting
**Integration**:
- ✅ Replace `handleAudioTrackChange` with `coordinator.changeAudioTrack()`
- ✅ Use `coordinator.saveChapterProgress()` for chapter saves
- ✅ Check coordinator state before operations

### 6. **useAudioTrackLoader** (Reader Hook)
**Purpose**: Loads and caches audio tracks
**Integration**:
- ✅ Replace direct loading with `coordinator.loadAudioTrack()`
- ✅ Check `coordinator.isOperationInProgress("loadAudioTrack")` before loading
- ✅ Respect cancellation from coordinator

### 7. **useAudioTrackLoading** (Reader Hook)
**Purpose**: Manages audio track URL loading and caching
**Integration**:
- ⚠️ **MERGE with useAudioTrackLoader** - duplicate functionality
- ✅ Use `coordinator.loadAudioTrack()` instead of direct loading
- ✅ Check coordinator state before operations

### 8. **useChapterLoadedCallback** (Reader Hook)
**Purpose**: Calls callback when chapter content is ready in DOM
**Integration**:
- ✅ Check `coordinator.isOperationInProgress("changeChapter")` before calling callback
- ✅ Check if operation was cancelled
- ✅ Keep as-is (DOM observation only)

### 9. **useChapterLoader** (Reader Hook)
**Purpose**: Loads and caches chapters
**Integration**:
- ✅ Replace direct loading with `coordinator.changeChapter()` or `coordinator.restoreChapter()`
- ✅ Check coordinator state before operations
- ✅ Respect cancellation

### 10. **useFragmentNavigation** (Reader Hook)
**Purpose**: Handles fragment navigation
**Integration**:
- ✅ Keep as-is (pure navigation, no async operations)
- ⚠️ Could check coordinator if needed, but probably not necessary

## Consolidation Opportunities

### Merge: useAudioTrackLoader + useAudioTrackLoading
Both hooks do similar things:
- `useAudioTrackLoader`: Uses `useResourceLoader`, loads via `loadEpubAudioBlob`
- `useAudioTrackLoading`: Uses `ensureAudioTrackLoaded`, manages URLs in refs

**Recommendation**: Keep `useAudioTrackLoader` (more robust with resource loader), remove `useAudioTrackLoading`, update `useAudioTrackLoader` to use coordinator.

## Integration Strategy

### Phase 1: Add Coordinator Checks
- All hooks check coordinator state before operations
- Respect cancellation flags
- Use coordinator loading states

### Phase 2: Replace Direct Operations
- Replace direct save/load operations with coordinator methods
- Remove duplicate state management
- Centralize operation coordination

### Phase 3: Consolidate Hooks
- Merge duplicate functionality
- Simplify hook structure
- Ensure single source of truth

## Implementation Order

1. **useChapterProgress** - Simple, just add coordinator checks
2. **useProgressManagement** - Replace with coordinator saves
3. **useAudioStatePersistence** - Replace with coordinator saves
4. **useChapterLoader** - Use coordinator for loads
5. **useAudioTrackLoader** - Use coordinator for loads
6. **useAudioPlayerProgress** - Use coordinator for track changes
7. **useAudioPlayerState** - Add coordinator checks
8. **useChapterLoadedCallback** - Add coordinator checks
9. **Merge useAudioTrackLoading into useAudioTrackLoader**
10. **useFragmentNavigation** - Keep as-is

