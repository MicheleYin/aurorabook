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
  // ReaderPanel UI state
  readerUI: {
    isSettingsOpen: boolean;
    isTocOpen: boolean;
    isImmersive: boolean;
    isAudioReopenVisible: boolean;
    shouldRenderAudioReopen: boolean;
    preserveChromeNextSelection: boolean;
  };
  // Chapter restoration state
  chapterRestoration: {
    currentChapterIndex: number;
    restoreScrollTop: number | null;
    restoreElementIndex: number | null;
    isRestoring: boolean;
  };
  // Chapter animation state
  chapterAnimation: {
    state: 'entering' | 'entered' | null;
    direction: 'forward' | 'backward' | null;
  };
  // Audio player state
  audioPlayer: {
    isOpen: boolean;
    isDismissing: boolean;
    currentTrackHref: string | null;
    currentProgress: AudioProgressSnapshot | null;
    currentTrackIndex: number;
    restoreTime: number | null;
    isRestoring: boolean;
    // Playback state
    playback: {
      isPlaying: boolean;
      currentTime: number;
      duration: number;
      playbackRate: number;
    };
    // Scrubbing state
    scrubbing: {
      isScrubbing: boolean;
      scrubTime: number | null;
    };
    // UI state
    ui: {
      isVisible: boolean;
      showTracksDialog: boolean;
    };
    // Animation state
    animation: {
      trackAnimationState: 'entering' | 'entered' | null;
      trackAnimationDirection: 'left' | 'right' | null;
    };
    // Loading state
    loading: {
      loadedCount: number;
      isTrackLoading: boolean;
      isLocalTrackChanging: boolean;
    };
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
  readerUI: {
    isSettingsOpen: false,
    isTocOpen: false,
    isImmersive: false,
    isAudioReopenVisible: false,
    shouldRenderAudioReopen: false,
    preserveChromeNextSelection: false,
  },
  chapterRestoration: {
    currentChapterIndex: 0,
    restoreScrollTop: null,
    restoreElementIndex: null,
    isRestoring: false,
  },
  chapterAnimation: {
    state: null,
    direction: null,
  },
  audioPlayer: {
    isOpen: false,
    isDismissing: false,
    currentTrackHref: null,
    currentProgress: null,
    currentTrackIndex: 0,
    restoreTime: null,
    isRestoring: false,
    playback: {
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      playbackRate: 1.0,
    },
    scrubbing: {
      isScrubbing: false,
      scrubTime: null,
    },
    ui: {
      isVisible: false,
      showTracksDialog: false,
    },
    animation: {
      trackAnimationState: null,
      trackAnimationDirection: null,
    },
    loading: {
      loadedCount: 0,
      isTrackLoading: false,
      isLocalTrackChanging: false,
    },
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
    // ReaderPanel UI state
    setReaderUISettingsOpen: (state, action: PayloadAction<boolean>) => {
      state.readerUI.isSettingsOpen = action.payload;
    },
    setReaderUITocOpen: (state, action: PayloadAction<boolean>) => {
      state.readerUI.isTocOpen = action.payload;
    },
    setReaderUIImmersive: (state, action: PayloadAction<boolean>) => {
      state.readerUI.isImmersive = action.payload;
    },
    setReaderUIAudioReopenVisible: (state, action: PayloadAction<boolean>) => {
      state.readerUI.isAudioReopenVisible = action.payload;
    },
    setReaderUIShouldRenderAudioReopen: (state, action: PayloadAction<boolean>) => {
      state.readerUI.shouldRenderAudioReopen = action.payload;
    },
    setReaderUIPreserveChromeNextSelection: (state, action: PayloadAction<boolean>) => {
      state.readerUI.preserveChromeNextSelection = action.payload;
    },
    // Chapter restoration state
    setChapterRestorationIndex: (state, action: PayloadAction<number>) => {
      state.chapterRestoration.currentChapterIndex = action.payload;
    },
    setChapterRestorationScrollTop: (state, action: PayloadAction<number | null>) => {
      state.chapterRestoration.restoreScrollTop = action.payload;
    },
    setChapterRestorationElementIndex: (state, action: PayloadAction<number | null>) => {
      state.chapterRestoration.restoreElementIndex = action.payload;
    },
    setChapterRestorationIsRestoring: (state, action: PayloadAction<boolean>) => {
      state.chapterRestoration.isRestoring = action.payload;
    },
    // Chapter animation state
    setChapterAnimationState: (state, action: PayloadAction<'entering' | 'entered' | null>) => {
      state.chapterAnimation.state = action.payload;
    },
    setChapterAnimationDirection: (state, action: PayloadAction<'forward' | 'backward' | null>) => {
      state.chapterAnimation.direction = action.payload;
    },
    // Audio player playback state
    setAudioPlayerIsPlaying: (state, action: PayloadAction<boolean>) => {
      state.audioPlayer.playback.isPlaying = action.payload;
    },
    setAudioPlayerCurrentTime: (state, action: PayloadAction<number>) => {
      state.audioPlayer.playback.currentTime = action.payload;
    },
    setAudioPlayerDuration: (state, action: PayloadAction<number>) => {
      state.audioPlayer.playback.duration = action.payload;
    },
    setAudioPlayerPlaybackRate: (state, action: PayloadAction<number>) => {
      state.audioPlayer.playback.playbackRate = action.payload;
    },
    // Audio player scrubbing state
    setAudioPlayerIsScrubbing: (state, action: PayloadAction<boolean>) => {
      state.audioPlayer.scrubbing.isScrubbing = action.payload;
    },
    setAudioPlayerScrubTime: (state, action: PayloadAction<number | null>) => {
      state.audioPlayer.scrubbing.scrubTime = action.payload;
    },
    // Audio player UI state
    setAudioPlayerIsVisible: (state, action: PayloadAction<boolean>) => {
      state.audioPlayer.ui.isVisible = action.payload;
    },
    setAudioPlayerShowTracksDialog: (state, action: PayloadAction<boolean>) => {
      state.audioPlayer.ui.showTracksDialog = action.payload;
    },
    // Audio player animation state
    setAudioPlayerTrackAnimationState: (state, action: PayloadAction<'entering' | 'entered' | null>) => {
      state.audioPlayer.animation.trackAnimationState = action.payload;
    },
    setAudioPlayerTrackAnimationDirection: (state, action: PayloadAction<'left' | 'right' | null>) => {
      state.audioPlayer.animation.trackAnimationDirection = action.payload;
    },
    // Audio player loading state
    setAudioPlayerLoadedCount: (state, action: PayloadAction<number>) => {
      state.audioPlayer.loading.loadedCount = action.payload;
    },
    setAudioPlayerIsTrackLoading: (state, action: PayloadAction<boolean>) => {
      state.audioPlayer.loading.isTrackLoading = action.payload;
    },
    setAudioPlayerIsLocalTrackChanging: (state, action: PayloadAction<boolean>) => {
      state.audioPlayer.loading.isLocalTrackChanging = action.payload;
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
      state.readerUI = {
        isSettingsOpen: false,
        isTocOpen: false,
        isImmersive: false,
        isAudioReopenVisible: false,
        shouldRenderAudioReopen: false,
        preserveChromeNextSelection: false,
      };
      state.chapterRestoration = {
        currentChapterIndex: 0,
        restoreScrollTop: null,
        restoreElementIndex: null,
        isRestoring: false,
      };
      state.chapterAnimation = {
        state: null,
        direction: null,
      };
      state.audioPlayer = {
        isOpen: false,
        isDismissing: false,
        currentTrackHref: null,
        currentProgress: null,
        currentTrackIndex: 0,
        restoreTime: null,
        isRestoring: false,
        playback: {
          isPlaying: false,
          currentTime: 0,
          duration: 0,
          playbackRate: 1.0,
        },
        scrubbing: {
          isScrubbing: false,
          scrubTime: null,
        },
        ui: {
          isVisible: false,
          showTracksDialog: false,
        },
        animation: {
          trackAnimationState: null,
          trackAnimationDirection: null,
        },
        loading: {
          loadedCount: 0,
          isTrackLoading: false,
          isLocalTrackChanging: false,
        },
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
  setReaderUISettingsOpen,
  setReaderUITocOpen,
  setReaderUIImmersive,
  setReaderUIAudioReopenVisible,
  setReaderUIShouldRenderAudioReopen,
  setReaderUIPreserveChromeNextSelection,
  setChapterRestorationIndex,
  setChapterRestorationScrollTop,
  setChapterRestorationElementIndex,
  setChapterRestorationIsRestoring,
  setChapterAnimationState,
  setChapterAnimationDirection,
  setAudioPlayerIsPlaying,
  setAudioPlayerCurrentTime,
  setAudioPlayerDuration,
  setAudioPlayerPlaybackRate,
  setAudioPlayerIsScrubbing,
  setAudioPlayerScrubTime,
  setAudioPlayerIsVisible,
  setAudioPlayerShowTracksDialog,
  setAudioPlayerTrackAnimationState,
  setAudioPlayerTrackAnimationDirection,
  setAudioPlayerLoadedCount,
  setAudioPlayerIsTrackLoading,
  setAudioPlayerIsLocalTrackChanging,
  resetReader,
} = readerSlice.actions;

export default readerSlice.reducer;

