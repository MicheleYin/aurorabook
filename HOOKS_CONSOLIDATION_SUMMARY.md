# Hooks Consolidation Summary

## Analysis Complete ✅

After analyzing all 30+ hooks in the codebase, I've created a comprehensive consolidation plan and implemented unified hook managers.

## Key Findings

### Duplicate Hooks Identified
1. **`useAudioTrackLoading`** - Duplicate of `useAudioTrackLoader`
   - Used in: `ReaderAudioPlayer.tsx` (can be replaced)
   - Action: ⚠️ Remove after migration

2. **`useProgressSaving`** - Simple wrapper
   - Used in: `App.tsx` (can be merged into coordinator)
   - Action: ⚠️ Low priority, can merge later

3. **`useHighlighting`** - Used internally
   - Used in: `ReaderViewport.tsx` (check if can merge)
   - Action: ⚠️ Needs investigation

### Major Consolidation Opportunities

#### 1. Reader Operations → `useReaderManager` ✅ CREATED
**Consolidates 7 hooks into 1**:
- `useChapterLoader`
- `useChapterProgress`
- `useScrollManagement`
- `useFragmentNavigation`
- `useLinkHandling`
- `useChapterTransitions`
- `useChapterLoadedCallback`

**Impact**: ReaderWrapper goes from 7+ hooks to 1 hook

#### 2. Audio Operations → `useAudioPlayerManager` ✅ CREATED
**Consolidates 4 hooks into 1**:
- `useAudioPlayerState`
- `useAudioPlayerProgress`
- `useAudioTextSync`
- `useAudioTrackLoader`

**Impact**: ReaderAudioPlayer goes from 4+ hooks to 1 hook

#### 3. Progress System → Coordinator ✅ PARTIALLY DONE
**All progress operations**:
- `useChapterProgress` (tracking)
- `useProgressManagement` (backend sync)
- `useAudioStatePersistence` (backend sync)

**Status**: Hooks use coordinator, but coordinator needs to handle backend sync directly

## Implementation Status

### ✅ Completed
1. Created `useReaderManager` - Unified chapter operations
2. Created `useAudioPlayerManager` - Unified audio operations
3. All hooks integrated with coordinator
4. Documentation created

### ⚠️ Pending Migration
1. Update `ReaderWrapper` to use `useReaderManager`
2. Update `ReaderAudioPlayer` to use `useAudioPlayerManager`
3. Remove `useAudioTrackLoading` after migration
4. Test all functionality

## Expected Benefits

### Code Reduction
- **Total Hooks**: 30+ → ~20 (33% reduction)
- **ReaderWrapper**: 7 hooks → 1 hook (86% reduction)
- **ReaderAudioPlayer**: 4 hooks → 1 hook (75% reduction)

### Complexity Reduction
- **Prop Drilling**: Eliminated
- **State Management**: Centralized
- **Operation Coordination**: All through coordinator
- **Error Handling**: Unified
- **Cancellation**: Automatic

### Maintainability
- **Single Source of Truth**: Coordinator
- **Clearer Responsibilities**: Each manager has one job
- **Easier Testing**: Fewer hooks to test
- **Better Debugging**: All operations logged in one place

## Migration Guide

### Step 1: ReaderWrapper Migration

**Before**:
```tsx
const chapterLoader = useChapterLoader();
const progressTracking = useChapterProgress({...});
const scrollManagement = useScrollManagement(...);
// ... 5+ more hooks
```

**After**:
```tsx
const readerManager = useReaderManager({
  activeBookId,
  activeChapterId,
  contentRef,
  preferences,
  onSelectChapter,
  onChapterProgress,
  onSaveProgress,
  isRestoringScroll: restoreState.isRestoring,
});

// Use readerManager.changeChapter, readerManager.saveProgress, etc.
```

### Step 2: ReaderAudioPlayer Migration

**Before**:
```tsx
const audioPlayerState = useAudioPlayerState({...});
const audioTrackLoader = useAudioTrackLoader();
const audioTextSync = useAudioTextSync({...});
// ... more hooks
```

**After**:
```tsx
const audioPlayerManager = useAudioPlayerManager({
  bookId,
  tracks,
  activeBook,
  activeChapter,
  contentRef,
  autoScrollEnabled,
  isRestoringScroll,
  chromeVisible,
  audioPlayerVisible,
  onProgress,
  onChapterChange,
  onChapterReload,
  onTrackChangeChapterChange,
  onSaveProgress,
});

// Use audioPlayerManager.currentIndex, audioPlayerManager.changeAudioTrack, etc.
```

## Hook Dependency Graph

### Current (Before Consolidation)
```
ReaderWrapper
├─ useChapterLoader
├─ useChapterProgress
├─ useScrollManagement
├─ useFragmentNavigation
├─ useLinkHandling
├─ useChapterTransitions
├─ useChapterLoadedCallback
└─ useAudioPlayerProgress
    ├─ useAudioTrackLoader
    └─ useAudioTextSync
        └─ useHighlighting (internal)

ReaderAudioPlayer
├─ useAudioPlayerState
├─ useAudioTrackLoader
├─ useAudioTrackLoading (DUPLICATE)
└─ useAudioTextSync
```

### Proposed (After Consolidation)
```
ReaderWrapper
└─ useReaderManager
    ├─ useChapterLoader (internal)
    ├─ useScrollManagement (internal)
    ├─ useFragmentNavigation (internal)
    ├─ useLinkHandling (internal)
    ├─ useChapterTransitions (internal)
    └─ useChapterLoadedCallback (internal)

ReaderAudioPlayer
└─ useAudioPlayerManager
    ├─ useAudioPlayerState (internal)
    ├─ useAudioTrackLoader (internal)
    └─ useAudioTextSync (internal)
```

## Remaining Work

### High Priority
1. ✅ Create unified hooks (DONE)
2. ⚠️ Migrate ReaderWrapper to useReaderManager
3. ⚠️ Migrate ReaderAudioPlayer to useAudioPlayerManager
4. ⚠️ Remove useAudioTrackLoading

### Medium Priority
5. ⚠️ Merge useProgressSaving into coordinator
6. ⚠️ Investigate useHighlighting usage
7. ⚠️ Update all documentation

### Low Priority
8. ⚠️ Further consolidate utility hooks (if needed)
9. ⚠️ Performance optimization
10. ⚠️ Final cleanup

## Risk Assessment

### Low Risk ✅
- Creating unified hooks (additive, doesn't break existing code)
- Coordinator integration (already done)

### Medium Risk ⚠️
- Migrating ReaderWrapper (core functionality)
- Migrating ReaderAudioPlayer (complex state)

### Mitigation
- Keep old hooks until migration verified
- Test thoroughly after each migration
- Incremental approach
- Rollback plan ready

## Conclusion

The codebase has **significant consolidation opportunities** that can:
- Reduce hooks by ~33%
- Reduce component complexity by ~75%
- Improve coordination and error handling
- Make codebase more maintainable

**Unified hooks are ready** - next step is to migrate components to use them.

