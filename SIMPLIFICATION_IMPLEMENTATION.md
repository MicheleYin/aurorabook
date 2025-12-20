# Simplification Implementation Plan

## Overview
This document provides step-by-step implementation details for simplifying the codebase.

## Phase 1: Create Simplified Redux Slices

### 1.1 Create `audioSlice.ts` (New)

```typescript
// src/store/slices/audioSlice.ts
import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { AudioTrack } from '../../types/reader';

interface AudioState {
  currentTrackId: string | null;
  seekPosition: number | null;
  isPlaying: boolean;
  currentTrack: AudioTrack | null;
  isLoading: boolean;
}

const initialState: AudioState = {
  currentTrackId: null,
  seekPosition: null,
  isPlaying: false,
  currentTrack: null,
  isLoading: false,
};

const audioSlice = createSlice({
  name: 'audio',
  initialState,
  reducers: {
    setCurrentTrack: (state, action: PayloadAction<string | null>) => {
      state.currentTrackId = action.payload;
    },
    setSeekPosition: (state, action: PayloadAction<number | null>) => {
      state.seekPosition = action.payload;
    },
    setIsPlaying: (state, action: PayloadAction<boolean>) => {
      state.isPlaying = action.payload;
    },
    setCurrentTrackData: (state, action: PayloadAction<AudioTrack | null>) => {
      state.currentTrack = action.payload;
    },
    setIsLoading: (state, action: PayloadAction<boolean>) => {
      state.isLoading = action.payload;
    },
    resetAudio: (state) => {
      return initialState;
    },
  },
});

export const {
  setCurrentTrack,
  setSeekPosition,
  setIsPlaying,
  setCurrentTrackData,
  setIsLoading,
  resetAudio,
} = audioSlice.actions;

export default audioSlice.reducer;
```

### 1.2 Create `settingsSlice.ts` (New)

```typescript
// src/store/slices/settingsSlice.ts
import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface SettingsState {
  theme: 'light' | 'dark' | 'system';
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  autoScrollEnabled: boolean;
}

const initialState: SettingsState = {
  theme: 'system',
  fontSize: 16,
  fontFamily: 'system-ui',
  lineHeight: 1.6,
  autoScrollEnabled: false,
};

const settingsSlice = createSlice({
  name: 'settings',
  initialState,
  reducers: {
    setTheme: (state, action: PayloadAction<'light' | 'dark' | 'system'>) => {
      state.theme = action.payload;
    },
    setFontSize: (state, action: PayloadAction<number>) => {
      state.fontSize = action.payload;
    },
    setFontFamily: (state, action: PayloadAction<string>) => {
      state.fontFamily = action.payload;
    },
    setLineHeight: (state, action: PayloadAction<number>) => {
      state.lineHeight = action.payload;
    },
    setAutoScrollEnabled: (state, action: PayloadAction<boolean>) => {
      state.autoScrollEnabled = action.payload;
    },
    updateSettings: (state, action: PayloadAction<Partial<SettingsState>>) => {
      return { ...state, ...action.payload };
    },
  },
});

export const {
  setTheme,
  setFontSize,
  setFontFamily,
  setLineHeight,
  setAutoScrollEnabled,
  updateSettings,
} = settingsSlice.actions;

export default settingsSlice.reducer;
```

### 1.3 Simplify `readerSlice.ts`

Remove:
- `readerCoordinator` state
- Complex restoration state
- Animation state
- UI state (chrome visibility, etc.)
- Handler storage

Keep:
- `currentBookId`
- `currentChapterId`
- `currentChapter` (data)
- `scrollPosition` (simple number)
- `isLoading`

### 1.4 Simplify `librarySlice.ts`

Remove:
- Filtering logic
- Search state
- Import state (move to local)

Keep:
- `books`
- `isHydrated`
- `isLoading`

## Phase 2: Create Simplified Hooks

### 2.1 Create `useReader.ts`

```typescript
// src/hooks/useReader.ts
import { useCallback } from 'react';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { selectCurrentBook, selectCurrentChapter } from '../store/selectors';
import { setCurrentBook, setCurrentChapter, setScrollPosition } from '../store/slices/readerSlice';
import { loadChapter } from '../store/thunks/readerThunks';

export function useReader() {
  const dispatch = useAppDispatch();
  const currentBook = useAppSelector(selectCurrentBook);
  const currentChapter = useAppSelector(selectCurrentChapter);
  const scrollPosition = useAppSelector((state) => state.reader.scrollPosition);

  const openBook = useCallback(async (bookId: string) => {
    dispatch(setCurrentBook(bookId));
    // Auto-load last chapter
    const book = useAppSelector.getState().library.books.find(b => b.id === bookId);
    if (book?.progress?.currentChapterId) {
      await dispatch(loadChapter({ bookId, chapterId: book.progress.currentChapterId }));
      dispatch(setScrollPosition(book.progress.currentChapterScrollTop || 0));
    }
  }, [dispatch]);

  const openChapter = useCallback(async (chapterId: string) => {
    if (!currentBook) return;
    await dispatch(loadChapter({ bookId: currentBook.id, chapterId }));
  }, [dispatch, currentBook]);

  const saveScrollPosition = useCallback((position: number) => {
    dispatch(setScrollPosition(position));
    // Debounced save to backend (simple debounce)
  }, [dispatch]);

  return {
    currentBook,
    currentChapter,
    scrollPosition,
    openBook,
    openChapter,
    saveScrollPosition,
  };
}
```

### 2.2 Create `useAudioPlayer.ts`

```typescript
// src/hooks/useAudioPlayer.ts
import { useCallback } from 'react';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { setCurrentTrack, setSeekPosition, setIsPlaying } from '../store/slices/audioSlice';
import { loadAudioTrack } from '../store/thunks/readerThunks';

export function useAudioPlayer() {
  const dispatch = useAppDispatch();
  const currentTrack = useAppSelector((state) => state.audio.currentTrack);
  const seekPosition = useAppSelector((state) => state.audio.seekPosition);
  const isPlaying = useAppSelector((state) => state.audio.isPlaying);

  const openTrack = useCallback(async (bookId: string, trackId: string) => {
    dispatch(setCurrentTrack(trackId));
    await dispatch(loadAudioTrack({ bookId, trackId }));
    // Restore seek position from book.audioState
    const book = useAppSelector.getState().library.books.find(b => b.id === bookId);
    if (book?.audioState?.currentTimeSeconds) {
      dispatch(setSeekPosition(book.audioState.currentTimeSeconds));
    }
  }, [dispatch]);

  const play = useCallback(() => {
    dispatch(setIsPlaying(true));
  }, [dispatch]);

  const pause = useCallback(() => {
    dispatch(setIsPlaying(false));
  }, [dispatch]);

  const seek = useCallback((position: number) => {
    dispatch(setSeekPosition(position));
    // Debounced save to backend
  }, [dispatch]);

  return {
    currentTrack,
    seekPosition,
    isPlaying,
    openTrack,
    play,
    pause,
    seek,
  };
}
```

### 2.3 Simplify `useLibrary.ts`

```typescript
// src/hooks/useLibrary.ts
import { useCallback } from 'react';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { selectLibrary, selectIsHydrated } from '../store/selectors';
import { refreshLibrary } from '../store/thunks/libraryThunks';

export function useLibrary() {
  const dispatch = useAppDispatch();
  const books = useAppSelector(selectLibrary);
  const isHydrated = useAppSelector(selectIsHydrated);

  const refresh = useCallback(async () => {
    await dispatch(refreshLibrary()).unwrap();
  }, [dispatch]);

  return {
    books,
    isHydrated,
    refresh,
  };
}
```

## Phase 3: Simplify App.tsx

### 3.1 Simplified App Structure

```typescript
// src/App.tsx (Simplified)
import { useEffect } from 'react';
import { useAppDispatch, useAppSelector } from './store/hooks';
import { selectLibrary, selectIsHydrated } from './store/selectors';
import { refreshLibrary } from './store/thunks/libraryThunks';
import { setCurrentBook, setCurrentChapter } from './store/slices/readerSlice';
import { setCurrentTrack } from './store/slices/audioSlice';

import { LibraryView } from './components/app/views/LibraryView';
import { ReaderView } from './components/app/views/ReaderView';
import { SettingsView } from './components/app/views/SettingsView';
import { AudioPlayer } from './components/reader/AudioPlayer';
import { AppNavigation } from './components/app/AppNavigation';

function App() {
  const dispatch = useAppDispatch();
  const library = useAppSelector(selectLibrary);
  const isHydrated = useAppSelector(selectIsHydrated);
  const currentView = useAppSelector((state) => state.navigation.currentTab); // Simple local state

  // Load library on init
  useEffect(() => {
    if (!isHydrated) {
      dispatch(refreshLibrary());
    }
  }, [isHydrated, dispatch]);

  // Auto-open last book/chapter
  useEffect(() => {
    if (isHydrated && library.length > 0) {
      // Find last opened book
      const lastBook = library
        .filter(b => b.lastOpenedTime)
        .sort((a, b) => new Date(b.lastOpenedTime!).getTime() - new Date(a.lastOpenedTime!).getTime())[0]
        || library[0];

      if (lastBook) {
        dispatch(setCurrentBook(lastBook.id));
        if (lastBook.progress?.currentChapterId) {
          dispatch(setCurrentChapter(lastBook.progress.currentChapterId));
        }
        if (lastBook.audioState?.currentTrackId) {
          dispatch(setCurrentTrack(lastBook.audioState.currentTrackId));
        }
      }
    }
  }, [isHydrated, library, dispatch]);

  if (!isHydrated) {
    return <LoadingScreen />;
  }

  return (
    <div className="flex h-screen flex-col">
      <AppNavigation currentView={currentView} />
      <main className="flex-1">
        {currentView === 'library' && <LibraryView />}
        {currentView === 'reader' && <ReaderView />}
        {currentView === 'settings' && <SettingsView />}
      </main>
      <AudioPlayer />
    </div>
  );
}
```

## Phase 4: Simplify Components

### 4.1 Simplified ReaderView

```typescript
// src/components/app/views/ReaderView.tsx
import { useEffect, useRef } from 'react';
import { useReader } from '../../hooks/useReader';

export function ReaderView() {
  const { currentBook, currentChapter, scrollPosition, saveScrollPosition } = useReader();
  const contentRef = useRef<HTMLDivElement>(null);

  // Restore scroll position
  useEffect(() => {
    if (contentRef.current && scrollPosition !== null) {
      contentRef.current.scrollTop = scrollPosition;
    }
  }, [scrollPosition, currentChapter]);

  // Save scroll position (debounced)
  useEffect(() => {
    const element = contentRef.current;
    if (!element) return;

    let timeout: NodeJS.Timeout;
    const handleScroll = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        saveScrollPosition(element.scrollTop);
      }, 500);
    };

    element.addEventListener('scroll', handleScroll);
    return () => {
      element.removeEventListener('scroll', handleScroll);
      clearTimeout(timeout);
    };
  }, [saveScrollPosition]);

  if (!currentBook || !currentChapter) {
    return <div>No book selected</div>;
  }

  return (
    <div ref={contentRef} className="reader-content">
      <div dangerouslySetInnerHTML={{ __html: currentChapter.contentHtml || '' }} />
    </div>
  );
}
```

### 4.2 Simplified AudioPlayer

```typescript
// src/components/reader/AudioPlayer.tsx
import { useEffect, useRef } from 'react';
import { useAudioPlayer } from '../../hooks/useAudioPlayer';
import { useAppSelector } from '../../store/hooks';
import { selectCurrentBook } from '../../store/selectors';

export function AudioPlayer() {
  const { currentTrack, seekPosition, isPlaying, play, pause, seek } = useAudioPlayer();
  const currentBook = useAppSelector(selectCurrentBook);
  const audioRef = useRef<HTMLAudioElement>(null);

  // Restore seek position
  useEffect(() => {
    if (audioRef.current && seekPosition !== null) {
      audioRef.current.currentTime = seekPosition;
    }
  }, [seekPosition, currentTrack]);

  // Handle play/pause
  useEffect(() => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.play();
    } else {
      audioRef.current.pause();
    }
  }, [isPlaying]);

  // Save seek position (debounced)
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    let timeout: NodeJS.Timeout;
    const handleTimeUpdate = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        seek(audio.currentTime);
      }, 1000);
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      clearTimeout(timeout);
    };
  }, [seek]);

  if (!currentTrack || !currentBook) {
    return null;
  }

  return (
    <div className="audio-player">
      <audio ref={audioRef} src={currentTrack.url} />
      <button onClick={isPlaying ? pause : play}>
        {isPlaying ? 'Pause' : 'Play'}
      </button>
      <span>{currentTrack.title}</span>
    </div>
  );
}
```

## Phase 5: File Deletion Checklist

### Files to Delete

#### Redux
- [ ] `src/store/slices/conversionSlice.ts`
- [ ] `src/store/slices/readerCoordinatorSlice.ts`
- [ ] `src/store/slices/navigationSlice.ts` (or simplify to local state)
- [ ] `src/store/slices/uiSlice.ts`
- [ ] `src/store/thunks/conversionThunks.ts`
- [ ] `src/store/thunks/coordinatorThunks.ts`
- [ ] `src/store/thunks/readerOperationsThunks.ts`
- [ ] `src/store/middleware/progressDebounceMiddleware.ts`

#### Hooks
- [ ] `src/hooks/reader/useReaderCoordinator.ts`
- [ ] `src/hooks/reader/useReaderCoordinatorRedux.ts`
- [ ] `src/hooks/reader/useReaderManager.ts`
- [ ] `src/hooks/reader/useReaderAudioSync.ts`
- [ ] `src/hooks/reader/useReaderChapterReload.ts`
- [ ] `src/hooks/reader/useReaderProgressSave.ts`
- [ ] `src/hooks/reader/useReaderPanel.ts`
- [ ] `src/hooks/reader/useHandlerBridge.ts`
- [ ] `src/hooks/reader/useFragmentNavigation.ts`
- [ ] `src/hooks/reader/useLinkHandling.ts`
- [ ] `src/hooks/reader/useHighlighting.ts`
- [ ] `src/hooks/audio/useAudioPlayerProgress.ts`
- [ ] `src/hooks/audio/useAudioStatePersistence.ts`
- [ ] `src/hooks/audio/useAudioTextSync.ts`
- [ ] `src/hooks/audio/useAudioTrackLoader.ts`
- [ ] `src/hooks/chapter/useChapterLoader.ts`
- [ ] `src/hooks/chapter/useChapterStatePersistence.ts`
- [ ] `src/hooks/chapter/useChapterTransitions.ts`
- [ ] `src/hooks/library/LibraryContext.tsx`
- [ ] `src/hooks/library/useLibraryOperations.ts`
- [ ] `src/hooks/library/libraryHelpers.ts`
- [ ] `src/hooks/useAppHandlers.ts`
- [ ] `src/hooks/useAppNavigation.ts`
- [ ] `src/hooks/useBookConversion.ts`
- [ ] `src/hooks/useResourceLoader.ts`
- [ ] `src/hooks/useETA.ts`
- [ ] `src/hooks/use-animated-number.ts`

#### Components
- [ ] `src/components/library/ConvertToAudiobookDialog.tsx`
- [ ] `src/components/app/AppDialogs.tsx`
- [ ] `src/components/reader/ReaderTocDrawer.tsx` (optional)
- [ ] `src/components/reader/ReaderSettingsControl.tsx`
- [ ] `src/components/reader/AudioTracksDialog.tsx` (or simplify)
- [ ] `src/components/reader/ChapterList.tsx` (optional)
- [ ] `src/components/library/BookDetailDialog.tsx` (optional)
- [ ] `src/components/library/LibraryStatusBadge.tsx`
- [ ] `src/components/library/LibrarySearchBar.tsx` (optional)

#### Contexts
- [ ] `src/contexts/HighlightQueueContext.tsx`

#### Lib
- [ ] `src/lib/audiobook-converter.ts` (or keep for future)

## Phase 6: Update Store Configuration

```typescript
// src/store/index.ts
import { configureStore } from '@reduxjs/toolkit';
import libraryReducer from './slices/librarySlice';
import readerReducer from './slices/readerSlice';
import audioReducer from './slices/audioSlice';
import settingsReducer from './slices/settingsSlice';

export const store = configureStore({
  reducer: {
    library: libraryReducer,
    reader: readerReducer,
    audio: audioReducer,
    settings: settingsReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
```

## Phase 7: Simple Persistence

### 7.1 Settings Persistence (localStorage)

```typescript
// src/hooks/useSettings.ts
import { useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { updateSettings } from '../store/slices/settingsSlice';

export function useSettings() {
  const dispatch = useAppDispatch();
  const settings = useAppSelector((state) => state.settings);

  // Load from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('settings');
    if (saved) {
      dispatch(updateSettings(JSON.parse(saved)));
    }
  }, [dispatch]);

  // Save to localStorage on change
  useEffect(() => {
    localStorage.setItem('settings', JSON.stringify(settings));
  }, [settings]);

  return {
    settings,
    updateSettings: (updates: Partial<typeof settings>) => {
      dispatch(updateSettings(updates));
    },
  };
}
```

### 7.2 Progress Persistence (Backend)

Simple thunks that save directly to backend:

```typescript
// src/store/thunks/libraryThunks.ts (simplified)
export const saveProgress = createAsyncThunk(
  'library/saveProgress',
  async ({ bookId, progress }: { bookId: string; progress: BookProgress }) => {
    await bookService.updateBookProgress(bookId, progress);
  }
);

export const saveAudioState = createAsyncThunk(
  'library/saveAudioState',
  async ({ bookId, audioState }: { bookId: string; audioState: BookAudioState }) => {
    await bookService.updateBookAudioState(bookId, audioState);
  }
);
```

## Testing Strategy

1. **Unit Tests**: Test simplified hooks
2. **Integration Tests**: Test view components
3. **E2E Tests**: Test full flows (open book → read → save progress)

## Migration Order

1. Create new slices (audio, settings)
2. Create new hooks (useReader, useAudioPlayer, useSettings)
3. Update store configuration
4. Migrate LibraryView
5. Migrate ReaderView
6. Migrate AudioPlayer
7. Migrate SettingsView
8. Update App.tsx
9. Delete old files
10. Test everything

## Rollback Plan

Keep old code in a `_deprecated` folder until migration is complete and tested.

