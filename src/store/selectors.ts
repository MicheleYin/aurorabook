import { createSelector } from '@reduxjs/toolkit';
import type { RootState } from './index';
import type { Book } from '../types/reader';

// Library selectors
export const selectLibrary = (state: RootState) => state.library.books;
export const selectIsHydrated = (state: RootState) => state.library.isHydrated;
export const selectIsLoading = (state: RootState) => state.library.isLoading;

// Reader selectors
export const selectCurrentBookId = (state: RootState) => state.reader.currentBookId;
export const selectCurrentChapterId = (state: RootState) => state.reader.currentChapterId;
export const selectCurrentChapter = (state: RootState) => state.reader.currentChapter;
export const selectScrollPosition = (state: RootState) => state.reader.scrollPosition;
export const selectReaderIsLoading = (state: RootState) => state.reader.isLoading;

// Computed selectors
export const selectCurrentBook = createSelector(
  [selectLibrary, selectCurrentBookId],
  (books, bookId): Book | null => {
    if (!bookId) return null;
    return books.find((b) => b.id === bookId) || null;
  }
);

// Audio selectors
export const selectCurrentTrackId = (state: RootState) => state.audio.currentTrackId;
export const selectCurrentTrack = (state: RootState) => state.audio.currentTrack;
export const selectTrackUrl = (state: RootState) => state.audio.trackUrl;
export const selectSeekPosition = (state: RootState) => state.audio.seekPosition;
export const selectIsPlaying = (state: RootState) => state.audio.isPlaying;
export const selectAudioIsLoading = (state: RootState) => state.audio.isLoading;

// Settings selectors
export const selectSettings = (state: RootState) => state.settings;
export const selectTheme = (state: RootState) => state.settings.theme;
export const selectFontSize = (state: RootState) => state.settings.fontSize;
export const selectFontFamily = (state: RootState) => state.settings.fontFamily;
export const selectLineHeight = (state: RootState) => state.settings.lineHeight;
export const selectAutoScrollEnabled = (state: RootState) => state.settings.autoScrollEnabled;
