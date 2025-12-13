# Hooks Consolidation Implementation Plan

## Summary

After analyzing 30+ hooks, I've identified major consolidation opportunities that can reduce complexity by ~50% while improving coordination.

## Created Unified Hooks

### 1. `useReaderManager` ✅
**Consolidates**:
- `useChapterLoader` - Chapter loading
- `useChapterProgress` - Progress tracking
- `useScrollManagement` - Scroll operations
- `useFragmentNavigation` - Fragment navigation
- `useLinkHandling` - Link handling
- `useChapterTransitions` - Transitions
- `useChapterLoadedCallback` - Loaded callback

**Benefits**:
- Single hook for all chapter operations
- Reduced from 7 hooks to 1
- Better coordination through coordinator
- Simpler ReaderWrapper code

### 2. `useAudioPlayerManager` ✅
**Consolidates**:
- `useAudioPlayerState` - State management
- `useAudioPlayerProgress` - Progress coordination
- `useAudioTextSync` - Text synchronization
- `useAudioTrackLoader` - Track loading

**Benefits**:
- Single hook for all audio operations
- Reduced from 4 hooks to 1
- Better state coordination
- Simpler ReaderAudioPlayer code

## Remaining Consolidation Opportunities

### 3. Remove Duplicates

**`useAudioTrackLoading`** - **REMOVE**
- Duplicate of `useAudioTrackLoader`
- All usages should migrate to `useAudioTrackLoader`
- Status: ⚠️ Needs migration

**`useProgressSaving`** - **EVALUATE**
- Simple wrapper around save function
- Could be merged into `useReaderManager`
- Status: ⚠️ Low priority

**`useHighlighting`** - **EVALUATE**
- Used by `useAudioTextSync` internally?
- Check if can be merged
- Status: ⚠️ Needs investigation

### 4. Progress System Consolidation

**Current**:
- `useChapterProgress` - Tracks scroll, creates snapshots
- `useProgressManagement` - Debounces and syncs to backend
- `useAudioStatePersistence` - Debounces and syncs audio state

**Proposed**:
All progress operations should:
1. Track/create snapshots (in unified hooks)
2. Save via coordinator (coordinator handles debouncing)
3. Coordinator syncs to backend

**Status**: ✅ Partially done - hooks use coordinator, but coordinator still needs backend sync

## Migration Path

### Step 1: Update ReaderWrapper
**Before**:
```tsx
const chapterLoader = useChapterLoader();
const progressTracking = useChapterProgress({...});
const scrollManagement = useScrollManagement(...);
const fragmentNavigation = useFragmentNavigation(...);
const linkHandling = useLinkHandling(...);
// ... 5+ hooks
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
```

### Step 2: Update ReaderAudioPlayer
**Before**:
```tsx
const audioPlayerState = useAudioPlayerState({...});
const audioTrackLoader = useAudioTrackLoader();
const audioTextSync = useAudioTextSync({...});
// ... 3+ hooks
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
```

### Step 3: Remove Duplicate Hooks
1. Remove `useAudioTrackLoading` - replace all usages
2. Evaluate `useProgressSaving` - merge if simple
3. Evaluate `useHighlighting` - merge if not used elsewhere

## Expected Impact

### Code Reduction
- **Hooks**: 30+ → ~20 hooks (33% reduction)
- **ReaderWrapper hooks**: 7 → 1 (86% reduction)
- **ReaderAudioPlayer hooks**: 4 → 1 (75% reduction)

### Complexity Reduction
- **Prop drilling**: Reduced significantly
- **State management**: Centralized in managers
- **Coordination**: All through coordinator

### Benefits
- ✅ Easier to understand
- ✅ Easier to test
- ✅ Better error handling
- ✅ Better cancellation support
- ✅ Single source of truth

## Implementation Checklist

### Phase 1: Create Unified Hooks ✅
- [x] Create `useReaderManager`
- [x] Create `useAudioPlayerManager`
- [x] Document consolidation plan

### Phase 2: Migrate Components
- [ ] Update `ReaderWrapper` to use `useReaderManager`
- [ ] Update `ReaderAudioPlayer` to use `useAudioPlayerManager`
- [ ] Test all functionality
- [ ] Remove old hook imports

### Phase 3: Remove Duplicates
- [ ] Find all usages of `useAudioTrackLoading`
- [ ] Replace with `useAudioTrackLoader`
- [ ] Remove `useAudioTrackLoading` file
- [ ] Evaluate and merge `useProgressSaving`
- [ ] Evaluate and merge `useHighlighting`

### Phase 4: Final Cleanup
- [ ] Update documentation
- [ ] Remove unused imports
- [ ] Clean up any dead code
- [ ] Final testing

## Risk Mitigation

1. **Incremental Migration**: Migrate one component at a time
2. **Keep Old Hooks**: Don't delete until migration complete
3. **Extensive Testing**: Test each migration thoroughly
4. **Rollback Plan**: Keep old code until verified

## Next Steps

1. **Test unified hooks** in isolation
2. **Migrate ReaderWrapper** first (simpler)
3. **Migrate ReaderAudioPlayer** second
4. **Remove duplicates** last

