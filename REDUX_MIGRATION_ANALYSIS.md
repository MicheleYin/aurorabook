# Redux Migration Analysis

## Overview
This document identifies hooks and state management patterns that should be migrated to Redux to reduce complexity, centralize state, avoid expensive re-renders, and prevent incorrect state tracking.

## High Priority Migrations

### 1. **Book Conversion State** (`useBookConversion`)
**Location:** `src/hooks/useBookConversion.ts`

**Current State:**
- `showConvertDialog` - boolean
- `pendingBookForConversion` - object
- `isConverting` - boolean
- `conversionProgress` - object
- `bookConversionProgress` - Record<string, ConversionProgress>
- `isCancelling` - boolean
- `cancellingBookId` - string | null

**Why Migrate:**
- Used across multiple components (App.tsx, BookDetailDialog)
- State changes cause re-renders in components that don't need conversion state
- Complex state synchronization with library updates
- Multiple refs used to track state (conversionAbortControllerRef, convertingBookIdRef, etc.)

**Redux Slice:** `conversionSlice`
```typescript
interface ConversionState {
  showDialog: boolean;
  pendingBook: PendingBookForConversion | null;
  isConverting: boolean;
  currentProgress: ConversionProgress | null;
  bookProgress: Record<string, ConversionProgress>;
  isCancelling: boolean;
  cancellingBookId: string | null;
  // Refs can stay as refs (AbortController, etc.)
}
```

**Benefits:**
- Components only subscribe to conversion state they need
- Centralized conversion state management
- Easier to debug conversion flow
- Better testability

---

### 2. **Reader Coordinator State** (`ReaderCoordinatorContext`)
**Location:** `src/contexts/ReaderCoordinatorContext.tsx`

**Current State:**
- `locks` - OperationLocks (chapter, audio, progress)
- `loading` - LoadingStates (7 different loading flags)

**Why Migrate:**
- Context causes all consumers to re-render on any operation change
- Complex state with refs for cancellation checks
- Used across many reader components
- Operation coordination logic could be centralized in Redux middleware

**Redux Slice:** `readerCoordinatorSlice`
```typescript
interface ReaderCoordinatorState {
  locks: {
    chapter: OperationState | null;
    audio: OperationState | null;
    progress: OperationState | null;
  };
  loading: {
    chapterLoading: boolean;
    chapterRestoring: boolean;
    chapterSaving: boolean;
    audioLoading: boolean;
    audioRestoring: boolean;
    audioSaving: boolean;
    trackChanging: boolean;
  };
}
```

**Benefits:**
- Selective subscriptions (components only re-render for relevant operations)
- Redux middleware can handle operation coordination
- Better debugging with Redux DevTools
- Eliminates ref synchronization issues

---

### 3. **Audio Player UI State** (in App.tsx)
**Location:** `src/App.tsx` lines 371-374

**Current State:**
- `isAudioPlayerOpen` - boolean
- `isAudioPlayerDismissing` - boolean
- `currentAudioTrackHref` - string | undefined
- `currentAudioProgress` - AudioProgressSnapshot | undefined

**Why Migrate:**
- Part of App.tsx component state causes unnecessary re-renders
- Used by multiple child components
- Should be part of reader state

**Redux Slice:** Add to `readerSlice`
```typescript
// Add to existing readerSlice
interface ReaderState {
  // ... existing fields
  audioPlayer: {
    isOpen: boolean;
    isDismissing: boolean;
    currentTrackHref: string | null;
    currentProgress: AudioProgressSnapshot | null;
  };
}
```

**Benefits:**
- Centralized audio player state
- Consistent with other reader state
- Better state management

---

### 4. **Audio Player Internal State** (`useAudioPlayerState`)
**Location:** `src/hooks/audio/useAudioPlayerState.ts`

**Current State:**
- `currentIndex` - number (track index)
- `restoreTime` - number | null
- `isRestoring` - boolean

**Why Migrate:**
- State is derived from library but managed separately
- Could cause sync issues between library and player state
- Multiple components need this state

**Redux Slice:** Add to `readerSlice` or create `audioPlayerSlice`
```typescript
interface AudioPlayerState {
  currentTrackIndex: number;
  restoreTime: number | null;
  isRestoring: boolean;
  // Derived from library but managed in Redux
}
```

**Benefits:**
- Single source of truth for audio player state
- Eliminates sync issues
- Better integration with library state

---

### 5. **UI State in App.tsx**
**Location:** `src/App.tsx`

**Current State:**
- `autoScrollEnabled` - boolean (line 106)
- `deletingBookId` - string | null (line 619)

**Why Migrate:**
- `autoScrollEnabled` is synced with settings but also has local state
- `deletingBookId` is UI state that could be in Redux
- Causes unnecessary re-renders of App component

**Redux Slice:** Add to `uiSlice` or `readerSlice`
```typescript
interface UIState {
  autoScrollEnabled: boolean;
  deletingBookId: string | null;
  // Other UI flags
}
```

**Benefits:**
- Centralized UI state
- Better state management
- Reduced re-renders

---

## Medium Priority Migrations

### 6. **Library Context Operations**
**Location:** `src/hooks/library/LibraryContext.tsx`

**Current State:**
- Library state is already in Redux, but operations are still in context
- `isImporting` - boolean
- Operations: `importFromDialog`, `ingestEpub`, `refreshLibrary`, etc.

**Why Migrate:**
- Operations could be Redux thunks
- `isImporting` state should be in Redux
- Better error handling with Redux

**Redux Slice:** Already have `librarySlice`, add operations as thunks
```typescript
// Add to librarySlice
interface LibraryState {
  // ... existing
  isImporting: boolean;
}

// Create thunks
export const importFromDialog = createAsyncThunk(...);
export const ingestEpub = createAsyncThunk(...);
export const refreshLibrary = createAsyncThunk(...);
```

**Benefits:**
- Consistent with Redux patterns
- Better error handling
- Loading states in Redux

---

### 7. **Chapter State** (`useChapterState`)
**Location:** `src/hooks/chapter/useChapterState.ts`

**Current State:**
- Complex state management for chapter restoration
- Multiple refs for tracking state

**Why Migrate:**
- State is related to reader state
- Could be simplified with Redux
- Better integration with chapter progress

**Note:** This might be better as a hook that uses Redux selectors rather than moving all state to Redux, as it's very component-specific.

---

## Low Priority / Keep as Hooks

### 8. **Settings Hooks** (`usePersistentSettings`, `usePersistentReaderPreferences`)
**Location:** `src/hooks/settings/`

**Recommendation:** Keep as hooks
- These persist to storage and have hydration logic
- Settings are not frequently updated
- Current implementation is fine

### 9. **Resource Loaders** (`useChapterLoader`, `useAudioTrackLoader`)
**Location:** `src/hooks/chapter/useChapterLoader.ts`, `src/hooks/audio/useAudioTrackLoader.ts`

**Recommendation:** Keep as hooks
- These manage caching and resource loading
- Not global state, more like component utilities
- Current implementation is appropriate

---

## Migration Priority Order

1. **Book Conversion State** - High impact, used across components
2. **Reader Coordinator State** - High impact, causes many re-renders
3. **Audio Player UI State** - Medium impact, easy migration
4. **UI State in App.tsx** - Medium impact, quick win
5. **Audio Player Internal State** - Medium impact, better state sync
6. **Library Operations** - Low impact, already mostly done

---

## Implementation Strategy

### Phase 1: High Priority
1. Create `conversionSlice` for book conversion state
2. Create `readerCoordinatorSlice` for operation coordination
3. Update components to use Redux selectors

### Phase 2: Medium Priority
1. Add audio player UI state to `readerSlice`
2. Add UI state to new `uiSlice` or `readerSlice`
3. Migrate audio player internal state

### Phase 3: Cleanup
1. Remove old contexts/hooks
2. Update tests
3. Document Redux patterns

---

## Expected Benefits

1. **Reduced Re-renders:** Components only subscribe to state they need
2. **Better Debugging:** Redux DevTools for all state changes
3. **Centralized State:** Single source of truth for application state
4. **Easier Testing:** Redux state is easier to test
5. **Better Performance:** Memoized selectors prevent unnecessary re-renders
6. **Type Safety:** Better TypeScript support with Redux Toolkit

---

## Notes

- Keep refs for things that shouldn't trigger re-renders (AbortController, timers, etc.)
- Use Redux middleware for async operation coordination
- Create selectors for computed/derived state
- Use thunks for async operations
- Consider Redux Toolkit Query for server state if needed in future

