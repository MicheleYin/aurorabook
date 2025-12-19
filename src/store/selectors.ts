import { createSelector } from '@reduxjs/toolkit';
import type { RootState } from './index';
import type { Book } from '../types/reader';

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

export const selectCurrentChapter = createSelector(
  [selectCurrentBook, (state: RootState) => state.reader.currentChapterId],
  (book, chapterId) => {
    if (!book || !chapterId) return undefined;
    return book.chapters.find((c) => c.id === chapterId);
  }
);

export const selectCurrentAudioTrack = createSelector(
  [selectCurrentBook, selectCurrentAudioTrackId],
  (book, trackId) => {
    if (!book || !trackId) return undefined;
    return book.audioTracks.find((t) => t.id === trackId);
  }
);

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

// UI selectors
export const selectAutoScrollEnabled = (state: RootState) => state.ui.autoScrollEnabled;
export const selectDeletingBookId = (state: RootState) => state.ui.deletingBookId;

