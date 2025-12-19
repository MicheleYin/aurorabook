import { createAsyncThunk } from '@reduxjs/toolkit';
import { logger } from '../../lib/logger';
import { readOneBook } from '../../lib/book-service';
import type { Chapter, AudioTrack } from '../../types/reader';
import type { RootState, AppDispatch } from '../index';
import { setCurrentBookId, setCurrentChapterId, setCurrentAudioTrackId, setCurrentChapterProgress, setCurrentAudioTrackProgress, setChapterLoaded, setAudioTrackLoaded } from '../slices/readerSlice';
import { addBook, updateBook } from '../slices/librarySlice';

/**
 * Load chapter content when opening the reader
 * Only loads the chapter that matches the current progress
 */
export const loadProgressChapter = createAsyncThunk<
  { chapter: Chapter; bookId: string },
  { bookId: string; chapterId: string },
  { state: RootState; dispatch: AppDispatch }
>(
  'reader/loadProgressChapter',
  async ({ bookId, chapterId }, { getState, dispatch, rejectWithValue }) => {
    try {
      const state = getState();
      const book = state.library.books.find((b) => b.id === bookId);
      
      if (!book) {
        throw new Error(`Book ${bookId} not found in library`);
      }

      // Check if chapter is already loaded
      const chapter = book.chapters.find((c) => c.id === chapterId);
      if (!chapter) {
        throw new Error(`Chapter ${chapterId} not found in book ${bookId}`);
      }

      // If chapter content is already loaded, return it
      if (chapter.contentHtml) {
        logger.debug('[loadProgressChapter] Chapter already loaded', { bookId, chapterId });
        dispatch(setChapterLoaded(true));
        return { chapter, bookId };
      }

      // Load chapter content
      logger.debug('[loadProgressChapter] Loading chapter content', { bookId, chapterId });
      const { ensureChapterLoaded } = await import('../../lib/lazy-chapter-loader');
      const loadedChapter = await ensureChapterLoaded(book.sourcePath, chapter);
      
      // Update book in library with loaded chapter
      const updatedChapters = book.chapters.map((c) =>
        c.id === chapterId ? loadedChapter : c
      );
      dispatch(updateBook({
        bookId,
        updates: { chapters: updatedChapters },
      }));

      dispatch(setChapterLoaded(true));
      return { chapter: loadedChapter, bookId };
    } catch (error) {
      logger.error('[loadProgressChapter] Error loading chapter', { bookId, chapterId, error });
      dispatch(setChapterLoaded(false));
      return rejectWithValue(error);
    }
  }
);

/**
 * Load audio track when opening the reader
 * Only loads the audio track that matches the current progress
 */
export const loadProgressAudioTrack = createAsyncThunk<
  { audioTrack: AudioTrack; bookId: string },
  { bookId: string; trackId: string },
  { state: RootState; dispatch: AppDispatch }
>(
  'reader/loadProgressAudioTrack',
  async ({ bookId, trackId }, { getState, dispatch, rejectWithValue }) => {
    try {
      const state = getState();
      const book = state.library.books.find((b) => b.id === bookId);
      
      if (!book) {
        throw new Error(`Book ${bookId} not found in library`);
      }

      // Check if audio track is already loaded
      const audioTrack = book.audioTracks.find((t) => t.id === trackId);
      if (!audioTrack) {
        throw new Error(`Audio track ${trackId} not found in book ${bookId}`);
      }

      // If audio track URL is already loaded, return it
      if (audioTrack.url) {
        logger.debug('[loadProgressAudioTrack] Audio track already loaded', { bookId, trackId });
        dispatch(setAudioTrackLoaded(true));
        return { audioTrack, bookId };
      }

      // Load audio track
      logger.debug('[loadProgressAudioTrack] Loading audio track', { bookId, trackId });
      const { loadAudioTrackUrl } = await import('../../lib/lazy-chapter-loader');
      const trackUrl = await loadAudioTrackUrl(book.sourcePath, audioTrack);
      
      const loadedTrack: AudioTrack = {
        ...audioTrack,
        url: trackUrl,
      };

      // Update book in library with loaded audio track
      const updatedTracks = book.audioTracks.map((t) =>
        t.id === trackId ? loadedTrack : t
      );
      dispatch(updateBook({
        bookId,
        updates: { audioTracks: updatedTracks },
      }));

      dispatch(setAudioTrackLoaded(true));
      return { audioTrack: loadedTrack, bookId };
    } catch (error) {
      logger.error('[loadProgressAudioTrack] Error loading audio track', { bookId, trackId, error });
      dispatch(setAudioTrackLoaded(false));
      return rejectWithValue(error);
    }
  }
);

/**
 * Select a book and load its progress chapter/audio track
 */
export const selectBook = createAsyncThunk<
  void,
  { bookId: string },
  { state: RootState; dispatch: AppDispatch }
>(
  'reader/selectBook',
  async ({ bookId }, { getState, dispatch, rejectWithValue }) => {
    try {
      const state = getState();
      let book = state.library.books.find((b) => b.id === bookId);
      
      if (!book) {
        // Try to fetch from backend
        logger.debug('[selectBook] Book not in library, fetching from backend', { bookId });
        const fetchedBook = await readOneBook(bookId);
        if (!fetchedBook) {
          throw new Error(`Book ${bookId} not found`);
        }
        // Add to library
        dispatch(addBook(fetchedBook));
        book = fetchedBook;
      }

      // Set current book
      dispatch(setCurrentBookId(bookId));

      // Set current chapter from progress
      if (book.progress?.currentChapterId) {
        const chapterId = book.progress.currentChapterId;
        dispatch(setCurrentChapterId(chapterId));
        dispatch(setCurrentChapterProgress(book.progress));
        
        // Load chapter content
        await dispatch(loadProgressChapter({ bookId, chapterId }));
      }

      // Set current audio track from progress
      if (book.audioState?.currentTrackId) {
        const trackId = book.audioState.currentTrackId;
        dispatch(setCurrentAudioTrackId(trackId));
        dispatch(setCurrentAudioTrackProgress(book.audioState));
        
        // Load audio track
        await dispatch(loadProgressAudioTrack({ bookId, trackId }));
      }

      // Update last opened time
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('update_book_last_opened_time', { bookId });
        // Update local state
        dispatch(updateBook({
          bookId,
          updates: { lastOpenedTime: new Date().toISOString() },
        }));
      } catch (error) {
        logger.warn('[selectBook] Failed to update last opened time:', error);
      }
    } catch (error) {
      logger.error('[selectBook] Error selecting book', { bookId, error });
      return rejectWithValue(error);
    }
  }
);

