import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { BookProgress, BookAudioState } from '../../types/reader';
import type { AudioProgressSnapshot } from '../../components/reader/types';

interface ReaderState {
  currentBookId: string | null;
  currentChapterId: string | null;
  currentAudioTrackId: string | null;
  currentChapterProgress: BookProgress | null;
  currentAudioTrackProgress: BookAudioState | null;
  // Flags to track if chapter/audio track are loaded
  isChapterLoaded: boolean;
  isAudioTrackLoaded: boolean;
  // UI state
  pendingFragment: string | null;
  isReaderChromeVisible: boolean;
  detailBookId: string | null;
  // Audio player state
  audioPlayer: {
    isOpen: boolean;
    isDismissing: boolean;
    currentTrackHref: string | null;
    currentProgress: AudioProgressSnapshot | null;
    currentTrackIndex: number;
    restoreTime: number | null;
    isRestoring: boolean;
  };
}

const initialState: ReaderState = {
  currentBookId: null,
  currentChapterId: null,
  currentAudioTrackId: null,
  currentChapterProgress: null,
  currentAudioTrackProgress: null,
  isChapterLoaded: false,
  isAudioTrackLoaded: false,
  pendingFragment: null,
  isReaderChromeVisible: true,
  detailBookId: null,
  audioPlayer: {
    isOpen: false,
    isDismissing: false,
    currentTrackHref: null,
    currentProgress: null,
    currentTrackIndex: 0,
    restoreTime: null,
    isRestoring: false,
  },
};

const readerSlice = createSlice({
  name: 'reader',
  initialState,
  reducers: {
    setCurrentBookId: (state, action: PayloadAction<string | null>) => {
      state.currentBookId = action.payload;
      // Reset chapter and audio track when book changes
      if (action.payload !== state.currentBookId) {
        state.currentChapterId = null;
        state.currentAudioTrackId = null;
        state.currentChapterProgress = null;
        state.currentAudioTrackProgress = null;
        state.isChapterLoaded = false;
        state.isAudioTrackLoaded = false;
      }
    },
    setCurrentChapterId: (state, action: PayloadAction<string | null>) => {
      state.currentChapterId = action.payload;
      state.isChapterLoaded = false; // Mark as needing load
    },
    setCurrentAudioTrackId: (state, action: PayloadAction<string | null>) => {
      state.currentAudioTrackId = action.payload;
      state.isAudioTrackLoaded = false; // Mark as needing load
    },
    setCurrentChapterProgress: (state, action: PayloadAction<BookProgress | null>) => {
      state.currentChapterProgress = action.payload;
    },
    setCurrentAudioTrackProgress: (state, action: PayloadAction<BookAudioState | null>) => {
      state.currentAudioTrackProgress = action.payload;
    },
    setChapterLoaded: (state, action: PayloadAction<boolean>) => {
      state.isChapterLoaded = action.payload;
    },
    setAudioTrackLoaded: (state, action: PayloadAction<boolean>) => {
      state.isAudioTrackLoaded = action.payload;
    },
    // UI state
    setPendingFragment: (state, action: PayloadAction<string | null>) => {
      state.pendingFragment = action.payload;
    },
    setIsReaderChromeVisible: (state, action: PayloadAction<boolean>) => {
      state.isReaderChromeVisible = action.payload;
    },
    setDetailBookId: (state, action: PayloadAction<string | null>) => {
      state.detailBookId = action.payload;
    },
    // Audio player state
    setAudioPlayerOpen: (state, action: PayloadAction<boolean>) => {
      state.audioPlayer.isOpen = action.payload;
    },
    setAudioPlayerDismissing: (state, action: PayloadAction<boolean>) => {
      state.audioPlayer.isDismissing = action.payload;
    },
    setAudioPlayerTrackHref: (state, action: PayloadAction<string | null>) => {
      state.audioPlayer.currentTrackHref = action.payload;
    },
    setAudioPlayerProgress: (state, action: PayloadAction<AudioProgressSnapshot | null>) => {
      state.audioPlayer.currentProgress = action.payload;
    },
    setAudioPlayerTrackIndex: (state, action: PayloadAction<number>) => {
      state.audioPlayer.currentTrackIndex = action.payload;
    },
    setAudioPlayerRestoreTime: (state, action: PayloadAction<number | null>) => {
      state.audioPlayer.restoreTime = action.payload;
    },
    setAudioPlayerRestoring: (state, action: PayloadAction<boolean>) => {
      state.audioPlayer.isRestoring = action.payload;
    },
    // Reset reader state
    resetReader: (state) => {
      state.currentBookId = null;
      state.currentChapterId = null;
      state.currentAudioTrackId = null;
      state.currentChapterProgress = null;
      state.currentAudioTrackProgress = null;
      state.isChapterLoaded = false;
      state.isAudioTrackLoaded = false;
      state.pendingFragment = null;
      state.isReaderChromeVisible = true;
      state.detailBookId = null;
      state.audioPlayer = {
        isOpen: false,
        isDismissing: false,
        currentTrackHref: null,
        currentProgress: null,
        currentTrackIndex: 0,
        restoreTime: null,
        isRestoring: false,
      };
    },
  },
});

export const {
  setCurrentBookId,
  setCurrentChapterId,
  setCurrentAudioTrackId,
  setCurrentChapterProgress,
  setCurrentAudioTrackProgress,
  setChapterLoaded,
  setAudioTrackLoaded,
  setPendingFragment,
  setIsReaderChromeVisible,
  setDetailBookId,
  setAudioPlayerOpen,
  setAudioPlayerDismissing,
  setAudioPlayerTrackHref,
  setAudioPlayerProgress,
  setAudioPlayerTrackIndex,
  setAudioPlayerRestoreTime,
  setAudioPlayerRestoring,
  resetReader,
} = readerSlice.actions;

export default readerSlice.reducer;

