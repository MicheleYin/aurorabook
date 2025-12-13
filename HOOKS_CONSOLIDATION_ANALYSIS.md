# Hooks Consolidation Analysis

## Executive Summary

After analyzing all 30+ hooks in the codebase, there are significant opportunities for consolidation. Many hooks have overlapping responsibilities and can be merged into unified systems.

## Hook Categories

### 1. **Resource Loading Hooks** (Can be unified)
- `useChapterLoader` - Loads chapters using `useResourceLoader`
- `useAudioTrackLoader` - Loads audio tracks using `useResourceLoader`
- `useAudioTrackLoading` - **DUPLICATE** - Same functionality as `useAudioTrackLoader`
- `useResourceLoader` - Generic loader (used by both above)

**Consolidation**: All resource loading should go through coordinator + unified resource loader

### 2. **Progress Management Hooks** (Can be unified)
- `useChapterProgress` - Tracks scroll, creates snapshots
- `useProgressManagement` - Updates book progress with debouncing
- `useProgressSaving` - **POTENTIAL DUPLICATE** - Need to check
- `useAudioStatePersistence` - Updates audio state with debouncing

**Consolidation**: All progress operations should go through coordinator

### 3. **Audio Player Hooks** (Can be unified)
- `useAudioPlayerState` - Manages track index and restoration
- `useAudioPlayerProgress` - Handles progress saving, track changes, highlighting
- `useAudioTextSync` - Audio-text synchronization and highlighting
- `useAudioTrackLoader` - Loads audio tracks
- `useAudioTrackLoading` - **DUPLICATE** of `useAudioTrackLoader`

**Consolidation**: Create unified `useAudioPlayer` hook

### 4. **Chapter Management Hooks** (Can be unified)
- `useChapterLoader` - Loads chapters
- `useChapterProgress` - Tracks chapter progress
- `useChapterLoadedCallback` - Calls callback when chapter ready
- `useChapterTransitions` - Handles chapter transitions
- `useScrollManagement` - Scroll operations and restoration

**Consolidation**: Create unified `useChapterManager` hook

### 5. **Navigation Hooks** (Can be unified)
- `useFragmentNavigation` - Fragment navigation
- `useLinkHandling` - Link handling
- `useScrollManagement` - Scroll operations

**Consolidation**: Merge into `useChapterManager` or `useNavigation`

### 6. **State Persistence Hooks** (Already unified)
- `usePersistentState` - Generic persistence
- `usePersistentSettings` - Uses `usePersistentState`
- `usePersistentReaderPreferences` - Uses `usePersistentState`

**Status**: ✅ Already well-consolidated

### 7. **Library Hooks** (Already unified)
- `useLibraryOperations` - Library operations
- `useProgressManagement` - Progress management
- `useAudioStatePersistence` - Audio state persistence
- `useLibraryContext` - Context provider

**Status**: ✅ Already unified in LibraryContext

### 8. **Utility Hooks** (Keep separate)
- `useResolvedTheme` - Theme resolution
- `usePrevious` - Previous value tracking
- `useMediaQuery` - Media query hook
- `useAnimatedNumber` - Animation hook
- `useETA` - ETA calculation
- `useAppNavigation` - App navigation state

**Status**: ✅ Keep as-is (utility hooks)

## Major Consolidation Opportunities

### Opportunity 1: Unified Reader Hook
**Merge into**: `useReaderManager`

**Hooks to merge**:
- `useChapterLoader`
- `useChapterProgress`
- `useChapterLoadedCallback`
- `useChapterTransitions`
- `useScrollManagement`
- `useFragmentNavigation`
- `useLinkHandling`

**Benefits**:
- Single hook for all chapter operations
- Reduced prop drilling
- Better coordination
- Simpler component code

### Opportunity 2: Unified Audio Player Hook
**Merge into**: `useAudioPlayerManager`

**Hooks to merge**:
- `useAudioPlayerState`
- `useAudioPlayerProgress`
- `useAudioTextSync`
- `useAudioTrackLoader`
- Remove `useAudioTrackLoading` (duplicate)

**Benefits**:
- Single hook for all audio operations
- Better state coordination
- Reduced complexity

### Opportunity 3: Unified Progress System
**Merge into**: Coordinator + unified progress hook

**Hooks to merge**:
- `useChapterProgress` (tracking only)
- `useProgressManagement` (backend sync)
- `useAudioStatePersistence` (backend sync)
- `useProgressSaving` (if duplicate)

**Benefits**:
- Single progress system
- All saves go through coordinator
- Better debouncing coordination

## Detailed Analysis

### Resource Loading Consolidation

**Current State**:
```
useChapterLoader
  └─ useResourceLoader<Chapter>
  
useAudioTrackLoader
  └─ useResourceLoader<AudioTrack>
  
useAudioTrackLoading (DUPLICATE)
  └─ Direct loading with refs
```

**Proposed**:
```
useResourceManager
  ├─ loadChapter(bookId, chapterId) → coordinator.loadChapter()
  ├─ loadAudioTrack(bookId, trackId) → coordinator.loadAudioTrack()
  └─ Unified caching and loading state
```

### Progress Management Consolidation

**Current State**:
```
useChapterProgress
  ├─ Tracks scroll metrics
  ├─ Creates snapshots
  └─ Calls onProgress

useProgressManagement
  ├─ Receives snapshots
  ├─ Debounces updates
  └─ Syncs to backend

useAudioStatePersistence
  ├─ Receives audio state
  ├─ Debounces updates
  └─ Syncs to backend
```

**Proposed**:
```
useProgressManager
  ├─ Track scroll (from useChapterProgress)
  ├─ Create snapshots (from useChapterProgress)
  └─ Save via coordinator (coordinator handles debouncing)
```

### Audio Player Consolidation

**Current State**:
```
useAudioPlayerState
  ├─ Track index management
  ├─ Restoration time
  └─ Progress emission

useAudioPlayerProgress
  ├─ Track changes
  ├─ Chapter sync
  └─ Highlighting coordination

useAudioTextSync
  ├─ Highlighting
  ├─ Auto-scroll
  └─ Chapter changes

useAudioTrackLoader
  └─ Track loading
```

**Proposed**:
```
useAudioPlayerManager
  ├─ State (from useAudioPlayerState)
  ├─ Progress (from useAudioPlayerProgress)
  ├─ Sync (from useAudioTextSync)
  └─ Loading (from useAudioTrackLoader)
  └─ All operations via coordinator
```

## Implementation Plan

### Phase 1: Remove Duplicates
1. ✅ Remove `useAudioTrackLoading` - replace with `useAudioTrackLoader`
2. ⚠️ Check `useProgressSaving` - determine if duplicate

### Phase 2: Create Unified Hooks
1. Create `useReaderManager` - unifies chapter operations
2. Create `useAudioPlayerManager` - unifies audio operations
3. Create `useProgressManager` - unifies progress tracking

### Phase 3: Integrate with Coordinator
1. All operations go through coordinator
2. Remove direct backend calls from hooks
3. Coordinator handles all debouncing and state sync

### Phase 4: Simplify Components
1. ReaderWrapper uses `useReaderManager` instead of 5+ hooks
2. ReaderAudioPlayer uses `useAudioPlayerManager` instead of 4+ hooks
3. Reduced prop drilling and complexity

## Expected Benefits

### Code Reduction
- **Before**: 30+ hooks, many with overlapping functionality
- **After**: ~15 hooks (utility + unified managers)
- **Reduction**: ~50% fewer hooks

### Complexity Reduction
- **Before**: ReaderWrapper uses 5+ hooks
- **After**: ReaderWrapper uses 1-2 hooks
- **Reduction**: ~70% less hook complexity

### Better Coordination
- All operations go through coordinator
- Single source of truth for state
- Better cancellation and error handling

### Easier Testing
- Fewer hooks to test
- Clearer responsibilities
- Better isolation

## Risk Assessment

### Low Risk
- Removing `useAudioTrackLoading` (clear duplicate)
- Consolidating utility hooks

### Medium Risk
- Merging progress hooks (need careful testing)
- Merging audio player hooks (complex state)

### High Risk
- Merging chapter management hooks (core functionality)
- Need extensive testing

## Recommendation

**Start with Phase 1** (remove duplicates), then **Phase 2** (create unified hooks), then **Phase 3** (integrate with coordinator). This incremental approach minimizes risk while maximizing benefits.

