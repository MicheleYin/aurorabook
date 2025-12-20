# Codebase Simplification Proposal

## Goal
Simplify the app to only the essential features:
1. **Library** - Loads on init, shows books
2. **Reader** - Opens last chapter, restores scroll position
3. **Audio Player** - Opens last track, restores seek position
4. **Settings** - Basic app settings

## Current Complexity Analysis

### Redux Slices (6 total)
- ✅ **librarySlice** - Keep (simplified)
- ✅ **readerSlice** - Keep (simplified)
- ❌ **conversionSlice** - REMOVE (audiobook conversion)
- ❌ **readerCoordinatorSlice** - REMOVE (complex async coordination)
- ❌ **navigationSlice** - REMOVE (use simple local state)
- ❌ **uiSlice** - REMOVE (use local state)

### Hooks to Remove (Major Cleanup)

#### Reader Hooks (11 hooks → 2 hooks)
- ❌ `useReaderCoordinator.ts` - Complex async coordination
- ❌ `useReaderCoordinatorRedux.ts` - Redux coordinator
- ❌ `useReaderManager.ts` - Complex manager
- ❌ `useReaderAudioSync.ts` - Audio sync complexity
- ❌ `useReaderChapterReload.ts` - Chapter reload logic
- ❌ `useReaderProgressSave.ts` - Complex progress saving
- ❌ `useReaderPanel.ts` - Panel management
- ❌ `useHandlerBridge.ts` - Handler bridging
- ❌ `useFragmentNavigation.ts` - Fragment navigation
- ❌ `useLinkHandling.ts` - Link handling
- ❌ `useHighlighting.ts` - Text highlighting
- ✅ Keep: `useElementIndex.ts` - Simple element indexing
- ✅ Keep: `useChapterProgress.ts` - Simplified progress tracking

#### Audio Hooks (5 hooks → 1 hook)
- ❌ `useAudioPlayerProgress.ts` - Complex progress tracking
- ❌ `useAudioStatePersistence.ts` - Complex persistence
- ❌ `useAudioTextSync.ts` - Text sync complexity
- ❌ `useAudioTrackLoader.ts` - Complex track loading
- ✅ Keep: `useAudioPlayerState.ts` - Simplified state

#### Chapter Hooks (5 hooks → 1 hook)
- ❌ `useChapterLoader.ts` - Complex loading
- ❌ `useChapterStatePersistence.ts` - Complex persistence
- ❌ `useChapterTransitions.ts` - Transition animations
- ✅ Keep: `useChapterState.ts` - Simplified state
- ✅ Keep: `useChapterProgress.ts` - Basic progress

#### Library Hooks (4 hooks → 1 hook)
- ❌ `LibraryContext.tsx` - Context wrapper
- ❌ `useLibraryOperations.ts` - Complex operations
- ❌ `libraryHelpers.ts` - Helper functions
- ✅ Keep: `useLibrary.ts` - Simplified library access

#### Other Hooks to Remove
- ❌ `useAppHandlers.ts` - Complex handler management
- ❌ `useAppNavigation.ts` - Navigation complexity
- ❌ `useBookConversion.ts` - Conversion feature
- ❌ `useResourceLoader.ts` - Complex resource loading
- ❌ `useETA.ts` - ETA calculations
- ❌ `use-animated-number.ts` - Animation complexity

### Components to Remove

#### Conversion Components
- ❌ `ConvertToAudiobookDialog.tsx` - Conversion dialog
- ❌ `AppDialogs.tsx` - Conversion dialogs
- ❌ All conversion-related UI

#### Complex Reader Components
- ❌ `ReaderTocDrawer.tsx` - Table of contents (optional, can add back later)
- ❌ `ReaderSettingsControl.tsx` - Settings in reader (move to main settings)
- ❌ `AudioTracksDialog.tsx` - Track selection dialog (simplify)
- ❌ `ChapterList.tsx` - Chapter navigation (optional)

#### Library Components (Simplify)
- ❌ `BookDetailDialog.tsx` - Book details (optional)
- ❌ `LibraryStatusBadge.tsx` - Status badges
- ❌ `LibrarySearchBar.tsx` - Search (optional, can add back)
- ✅ Keep: `LibraryGrid.tsx` / `LibraryList.tsx` - Basic library display
- ✅ Keep: `LibraryEmpty.tsx` - Empty state

### Redux Thunks to Remove
- ❌ `conversionThunks.ts` - All conversion logic
- ❌ `coordinatorThunks.ts` - Complex coordination
- ❌ `readerOperationsThunks.ts` - Complex operations
- ✅ Keep: `libraryThunks.ts` - Simplified (just load/refresh)
- ✅ Keep: `readerThunks.ts` - Simplified (just load chapter/track)

### Middleware to Remove
- ❌ `progressDebounceMiddleware.ts` - Complex debouncing (use simple debounce in components)

### Contexts to Remove
- ❌ `HighlightQueueContext.tsx` - Text highlighting complexity

## Proposed Simplified Architecture

### New Redux Structure (3 slices)

#### 1. `librarySlice.ts` (Simplified)
```typescript
interface LibraryState {
  books: Book[];
  isHydrated: boolean;
  isLoading: boolean;
}
```
**Actions:**
- `setLibrary(books)`
- `setIsHydrated(bool)`
- `setIsLoading(bool)`

#### 2. `readerSlice.ts` (Simplified)
```typescript
interface ReaderState {
  currentBookId: string | null;
  currentChapterId: string | null;
  scrollPosition: number | null; // Simple scroll position
  currentChapter: Chapter | null;
  isLoading: boolean;
}
```
**Actions:**
- `setCurrentBook(bookId)`
- `setCurrentChapter(chapterId)`
- `setScrollPosition(position)`
- `setCurrentChapterData(chapter)`
- `setIsLoading(bool)`

#### 3. `audioSlice.ts` (New, Simplified)
```typescript
interface AudioState {
  currentTrackId: string | null;
  seekPosition: number | null; // Simple seek position
  isPlaying: boolean;
  currentTrack: AudioTrack | null;
  isLoading: boolean;
}
```
**Actions:**
- `setCurrentTrack(trackId)`
- `setSeekPosition(position)`
- `setIsPlaying(bool)`
- `setCurrentTrackData(track)`
- `setIsLoading(bool)`

#### 4. `settingsSlice.ts` (New, Simplified)
```typescript
interface SettingsState {
  theme: 'light' | 'dark' | 'system';
  fontSize: number;
  fontFamily: string;
  // ... other simple settings
}
```

### Simplified Component Structure

```
App.tsx (Main orchestrator)
├── LibraryView (Simple book list)
├── ReaderView (Simple reader with scroll restoration)
│   └── ReaderContent (Chapter display)
├── AudioPlayer (Simple player with seek restoration)
└── SettingsView (Simple settings)
```

### Simplified Hook Structure

#### Core Hooks (4 total)
1. **`useLibrary.ts`** - Simple library access
   ```typescript
   {
     books: Book[];
     isLoading: boolean;
     refreshLibrary: () => Promise<void>;
   }
   ```

2. **`useReader.ts`** - Simple reader state
   ```typescript
   {
     currentBook: Book | null;
     currentChapter: Chapter | null;
     scrollPosition: number | null;
     loadChapter: (chapterId: string) => Promise<void>;
     saveScrollPosition: (position: number) => void;
   }
   ```

3. **`useAudioPlayer.ts`** - Simple audio player
   ```typescript
   {
     currentTrack: AudioTrack | null;
     seekPosition: number | null;
     isPlaying: boolean;
     loadTrack: (trackId: string) => Promise<void>;
     saveSeekPosition: (position: number) => void;
     play: () => void;
     pause: () => void;
   }
   ```

4. **`useSettings.ts`** - Simple settings
   ```typescript
   {
     settings: Settings;
     updateSettings: (updates: Partial<Settings>) => void;
   }
   ```

### Simplified Flow

#### App Initialization
1. Load library from backend
2. Find last opened book (from progress)
3. Auto-open reader with last chapter
4. Restore scroll position
5. If audio track exists, auto-open audio player
6. Restore seek position

#### Reader Flow
1. User opens book → Load last chapter
2. Restore scroll position from progress
3. User scrolls → Save position (debounced, simple)
4. User changes chapter → Save old position, load new chapter

#### Audio Player Flow
1. User opens audio → Load last track
2. Restore seek position from progress
3. User plays → Update isPlaying
4. User seeks → Save position (debounced, simple)
5. Track ends → Auto-advance to next track (optional)

## Implementation Steps

### Phase 1: Remove Conversion Features
1. Delete `conversionSlice.ts`
2. Delete `conversionThunks.ts`
3. Delete conversion components
4. Remove conversion from `App.tsx`

### Phase 2: Remove Coordinator System
1. Delete `readerCoordinatorSlice.ts`
2. Delete `coordinatorThunks.ts`
3. Delete coordinator hooks
4. Simplify reader operations to direct thunks

### Phase 3: Simplify Redux Slices
1. Simplify `readerSlice.ts` (remove complex state)
2. Create `audioSlice.ts` (new, simple)
3. Create `settingsSlice.ts` (new, simple)
4. Remove `navigationSlice.ts` (use local state)
5. Remove `uiSlice.ts` (use local state)

### Phase 4: Simplify Hooks
1. Delete complex hooks (see list above)
2. Create simplified hooks (`useReader.ts`, `useAudioPlayer.ts`, `useSettings.ts`)
3. Update components to use simplified hooks

### Phase 5: Simplify Components
1. Remove complex reader components
2. Simplify `ReaderView.tsx` (direct chapter loading)
3. Simplify `ReaderAudioPlayer.tsx` (direct track loading)
4. Simplify `LibraryView.tsx` (remove search, filters)

### Phase 6: Simplify Persistence
1. Remove complex persistence hooks
2. Use simple localStorage for settings
3. Use backend for progress (simple save/load)

### Phase 7: Remove Middleware
1. Remove `progressDebounceMiddleware.ts`
2. Use simple debounce in components if needed

## Benefits

1. **Reduced Complexity**: ~50% fewer files
2. **Easier Debugging**: Simple state flow
3. **Faster Development**: Less code to understand
4. **Better Performance**: Less overhead
5. **Easier Maintenance**: Clear, simple patterns

## Migration Strategy

1. Create new simplified slices alongside old ones
2. Create new simplified hooks alongside old ones
3. Migrate one view at a time (Library → Reader → Audio → Settings)
4. Test each migration step
5. Remove old code after migration complete

## Estimated File Reduction

- **Current**: ~150 files
- **After**: ~80 files
- **Reduction**: ~47%

## Estimated Code Reduction

- **Current**: ~15,000 lines
- **After**: ~8,000 lines
- **Reduction**: ~47%

