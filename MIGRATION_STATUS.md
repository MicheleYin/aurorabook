# ReaderWrapper Migration Status

## Current Status: ⚠️ IN PROGRESS

The migration to `useReaderManager` is partially complete. There are still references to old hooks that need to be replaced.

## Remaining Work

### References to Replace:
1. `chapterLoader` → `readerManager.loadedChapter`, `readerManager.isLoading`
2. `scrollManagement` → `readerManager.scrollToTop()`, `readerManager.scrollToElementId()`, etc.
3. `progressTracking` → `readerManager.emitChapterProgress()`, `readerManager.updateMetricsOnScroll()`
4. `coordinator` → `readerManager.coordinator`
5. `setChapterAnimationState` → Keep local state (not in readerManager yet)

### Issues Found:
- Line 100-107: `saveProgress` still uses old `coordinator` and `progressTracking`
- Line 287, 289: `setChapterAnimationState` - keep local
- Line 378: `chapterLoader` reference
- Line 392: `scrollManagement` reference  
- Line 454, 458: `previousChapterIdRef` - keep local
- Line 472: `scrollManagement.resetRestoration()`
- Line 475: `isChapterAlreadyLoaded` - needs update
- Line 481: `chapterLoader.setLoadedChapter()` - needs readerManager method
- Line 529, 537: `scrollManagement` references
- Line 620, 635: `chapterLoader` references
- Line 636: `chapterAnimationState` - keep local
- Line 653-657: `scrollManagement` and `progressTracking` references

## Next Steps

1. Replace all `scrollManagement.*` with `readerManager.*`
2. Replace all `chapterLoader.*` with `readerManager.*`  
3. Replace all `progressTracking.*` with `readerManager.*`
4. Replace all `coordinator.*` with `readerManager.coordinator.*`
5. Keep local state: `chapterAnimationState`, `previousChapterIdRef`

## Notes

- `useReaderManager` doesn't expose `setLoadedChapter` yet - may need to add this
- Some custom logic in ReaderWrapper may need to stay (chapter reloading, event handling)
- Consider moving more logic into `useReaderManager` in future iterations

