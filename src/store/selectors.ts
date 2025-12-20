import { createSelector } from '@reduxjs/toolkit';
import type { RootState } from './index';
import type { Book } from '../types/reader';
import { LibraryFilterOption } from '@/components/library/types';
import { filterLibrary } from '@/hooks/library/libraryHelpers';

// Library selectors
export const selectLibrary = (state: RootState) => state.library.books;
export const selectLibraryHydrated = (state: RootState) => state.library.isHydrated;
export const selectLibraryImporting = (state: RootState) => state.library.isImporting;
export const selectIsHydrated = selectLibraryHydrated;
export const selectIsImporting = selectLibraryImporting;

// Navigation selectors
export const selectCurrentTab = (state: RootState) => state.navigation.currentTab;
export const selectLibrarySearchTerm = (state: RootState) => state.navigation.librarySearchTerm;
export const selectLibraryFilter = (state: RootState) => state.navigation.libraryFilter;
export const selectLibraryViewMode = (state: RootState) => state.navigation.libraryViewMode;

// Reader selectors
export const selectCurrentBookId = (state: RootState) => state.reader.currentBookId;
export const selectCurrentChapterId = (state: RootState) => state.reader.currentChapterId;
export const selectCurrentAudioTrackId = (state: RootState) => state.reader.currentAudioTrackId;
export const selectCurrentChapterProgress = (state: RootState) => state.reader.currentChapterProgress;
export const selectCurrentAudioTrackProgress = (state: RootState) => state.reader.currentAudioTrackProgress;
export const selectIsChapterLoaded = (state: RootState) => state.reader.isChapterLoaded;
export const selectIsAudioTrackLoaded = (state: RootState) => state.reader.isAudioTrackLoaded;
export const selectPendingFragment = (state: RootState) => state.reader.pendingFragment;
export const selectIsReaderChromeVisible = (state: RootState) => state.reader.isReaderChromeVisible;
export const selectDetailBookId = (state: RootState) => state.reader.detailBookId;

// Computed selectors
export const selectCurrentBook = createSelector(
  [selectLibrary, selectCurrentBookId],
  (books, bookId): Book | undefined => {
    if (!bookId) return undefined;
    return books.find((b) => b.id === bookId);
  }
);

// Use resolved chapter from Redux (preferred)
export const selectCurrentChapter = (state: RootState) => state.reader.currentChapter.data;

// Fallback selector that finds chapter manually (for backward compatibility)
export const selectCurrentChapterManual = createSelector(
  [selectCurrentBook, (state: RootState) => state.reader.currentChapterId],
  (book, chapterId) => {
    if (!book || !chapterId) return undefined;
    return book.chapters.find((c) => c.id === chapterId);
  }
);

// Use resolved audio track from Redux (preferred)
export const selectCurrentAudioTrack = (state: RootState) => state.reader.currentAudioTrack.data;
export const selectCurrentAudioTrackUrl = (state: RootState) => state.reader.currentAudioTrack.url;

// Fallback selector that finds track manually (for backward compatibility)
export const selectCurrentAudioTrackManual = createSelector(
  [selectCurrentBook, selectCurrentAudioTrackId],
  (book, trackId) => {
    if (!book || !trackId) return undefined;
    return book.audioTracks.find((t) => t.id === trackId);
  }
);

// Chapter loading state
export const selectCurrentChapterLoading = (state: RootState) => state.reader.currentChapter.loading;
export const selectCurrentChapterError = (state: RootState) => state.reader.currentChapter.error;

// Audio track loading state
export const selectCurrentAudioTrackLoading = (state: RootState) => state.reader.currentAudioTrack.loading;
export const selectCurrentAudioTrackError = (state: RootState) => state.reader.currentAudioTrack.error;

// Audio player selectors
export const selectAudioPlayer = (state: RootState) => state.reader.audioPlayer;
export const selectAudioPlayerOpen = (state: RootState) => state.reader.audioPlayer.isOpen;
export const selectAudioPlayerDismissing = (state: RootState) => state.reader.audioPlayer.isDismissing;
export const selectAudioPlayerTrackHref = (state: RootState) => state.reader.audioPlayer.currentTrackHref;
export const selectAudioPlayerProgress = (state: RootState) => state.reader.audioPlayer.currentProgress;
export const selectAudioPlayerTrackIndex = (state: RootState) => state.reader.audioPlayer.currentTrackIndex;
export const selectAudioPlayerRestoreTime = (state: RootState) => state.reader.audioPlayer.restoreTime;
export const selectAudioPlayerRestoring = (state: RootState) => state.reader.audioPlayer.isRestoring;

// Conversion selectors
export const selectConversion = (state: RootState) => state.conversion;
export const selectShowConvertDialog = (state: RootState) => state.conversion.showDialog;
export const selectPendingBookForConversion = (state: RootState) => state.conversion.pendingBook;
export const selectIsConverting = (state: RootState) => state.conversion.isConverting;
export const selectConversionProgress = (state: RootState) => state.conversion.currentProgress;
export const selectBookConversionProgress = (state: RootState) => state.conversion.bookProgress;
export const selectIsCancelling = (state: RootState) => state.conversion.isCancelling;
export const selectCancellingBookId = (state: RootState) => state.conversion.cancellingBookId;
export const selectConvertingBookId = (state: RootState) => state.conversion.convertingBookId;
export const selectConversionStartTime = (state: RootState) => state.conversion.conversionStartTime;

// Reader coordinator selectors
export const selectReaderCoordinator = (state: RootState) => state.readerCoordinator;
export const selectOperationLocks = (state: RootState) => state.readerCoordinator.locks;
export const selectLoadingStates = (state: RootState) => state.readerCoordinator.loading;
export const selectChapterLoading = (state: RootState) => state.readerCoordinator.loading.chapterLoading;
export const selectTrackChanging = (state: RootState) => state.readerCoordinator.loading.trackChanging;
export const selectChapterRestoring = (state: RootState) => state.readerCoordinator.loading.chapterRestoring;
export const selectChapterSaving = (state: RootState) => state.readerCoordinator.loading.chapterSaving;
export const selectAudioLoading = (state: RootState) => state.readerCoordinator.loading.audioLoading;
export const selectAudioRestoring = (state: RootState) => state.readerCoordinator.loading.audioRestoring;
export const selectAudioSaving = (state: RootState) => state.readerCoordinator.loading.audioSaving;

// ReaderPanel UI selectors
export const selectReaderUI = (state: RootState) => state.reader.readerUI;
export const selectReaderUISettingsOpen = (state: RootState) => state.reader.readerUI.isSettingsOpen;
export const selectReaderUITocOpen = (state: RootState) => state.reader.readerUI.isTocOpen;
export const selectReaderUIImmersive = (state: RootState) => state.reader.readerUI.isImmersive;
export const selectReaderUIAudioReopenVisible = (state: RootState) => state.reader.readerUI.isAudioReopenVisible;
export const selectReaderUIShouldRenderAudioReopen = (state: RootState) => state.reader.readerUI.shouldRenderAudioReopen;
export const selectReaderUIPreserveChromeNextSelection = (state: RootState) => state.reader.readerUI.preserveChromeNextSelection;

// Chapter restoration selectors
export const selectChapterRestoration = (state: RootState) => state.reader.chapterRestoration;
export const selectChapterRestorationIndex = (state: RootState) => state.reader.chapterRestoration.currentChapterIndex;
export const selectChapterRestorationScrollTop = (state: RootState) => state.reader.chapterRestoration.restoreScrollTop;
export const selectChapterRestorationElementIndex = (state: RootState) => state.reader.chapterRestoration.restoreElementIndex;
export const selectChapterRestorationIsRestoring = (state: RootState) => state.reader.chapterRestoration.isRestoring;

// Chapter animation selectors
export const selectChapterAnimation = (state: RootState) => state.reader.chapterAnimation;
export const selectChapterAnimationState = (state: RootState) => state.reader.chapterAnimation.state;
export const selectChapterAnimationDirection = (state: RootState) => state.reader.chapterAnimation.direction;

// Audio player playback selectors
export const selectAudioPlayerPlayback = (state: RootState) => state.reader.audioPlayer.playback;
export const selectAudioPlayerIsPlaying = (state: RootState) => state.reader.audioPlayer.playback.isPlaying;
export const selectAudioPlayerCurrentTime = (state: RootState) => state.reader.audioPlayer.playback.currentTime;
export const selectAudioPlayerDuration = (state: RootState) => state.reader.audioPlayer.playback.duration;
export const selectAudioPlayerPlaybackRate = (state: RootState) => state.reader.audioPlayer.playback.playbackRate;

// Audio player scrubbing selectors
export const selectAudioPlayerScrubbing = (state: RootState) => state.reader.audioPlayer.scrubbing;
export const selectAudioPlayerIsScrubbing = (state: RootState) => state.reader.audioPlayer.scrubbing.isScrubbing;
export const selectAudioPlayerScrubTime = (state: RootState) => state.reader.audioPlayer.scrubbing.scrubTime;

// Audio player UI selectors
export const selectAudioPlayerUI = (state: RootState) => state.reader.audioPlayer.ui;
export const selectAudioPlayerIsVisible = (state: RootState) => state.reader.audioPlayer.ui.isVisible;
export const selectAudioPlayerShowTracksDialog = (state: RootState) => state.reader.audioPlayer.ui.showTracksDialog;

// Audio player animation selectors
export const selectAudioPlayerAnimation = (state: RootState) => state.reader.audioPlayer.animation;
export const selectAudioPlayerTrackAnimationState = (state: RootState) => state.reader.audioPlayer.animation.trackAnimationState;
export const selectAudioPlayerTrackAnimationDirection = (state: RootState) => state.reader.audioPlayer.animation.trackAnimationDirection;

// Audio player loading selectors
export const selectAudioPlayerLoading = (state: RootState) => state.reader.audioPlayer.loading;
export const selectAudioPlayerLoadedCount = (state: RootState) => state.reader.audioPlayer.loading.loadedCount;
export const selectAudioPlayerIsTrackLoading = (state: RootState) => state.reader.audioPlayer.loading.isTrackLoading;
export const selectAudioPlayerIsLocalTrackChanging = (state: RootState) => state.reader.audioPlayer.loading.isLocalTrackChanging;

// Handler selectors
export const selectTrackChangeHandler = (state: RootState) => state.reader.handlers.trackChangeHandler;
export const selectSaveProgressHandler = (state: RootState) => state.reader.handlers.saveProgressHandler;

// UI selectors
export const selectAutoScrollEnabled = (state: RootState) => state.ui.autoScrollEnabled;
export const selectDeletingBookId = (state: RootState) => state.ui.deletingBookId;

// Memoized filtered library selector
// This prevents re-filtering when library/search/filter haven't changed
export const selectFilteredLibrary = createSelector(
  [selectLibrary, selectLibrarySearchTerm, selectLibraryFilter],
  (books, searchTerm, filter: LibraryFilterOption) => {
    return filterLibrary(books, filter, searchTerm);
  }
);

