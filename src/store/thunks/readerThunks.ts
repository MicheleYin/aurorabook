import { createAsyncThunk } from '@reduxjs/toolkit';
import { logger } from '../../lib/logger';
import type { Chapter, AudioTrack } from '../../types/reader';
import type { RootState, AppDispatch } from '../index';
import {
  setCurrentChapter,
  setCurrentChapterData,
  setIsLoading,
} from '../slices/readerSlice';
import {
  setCurrentTrack,
  setCurrentTrackData,
  setTrackUrl,
  setIsLoading as setAudioIsLoading,
} from '../slices/audioSlice';
import { updateBook } from '../slices/librarySlice';

/**
 * Load chapter content
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

      const chapter = book.chapters.find((c) => c.id === chapterId);
      if (!chapter) {
        throw new Error(`Chapter ${chapterId} not found in book ${bookId}`);
      }

      // If chapter content is already loaded, use it
      if (chapter.contentHtml) {
        logger.debug('[loadProgressChapter] Chapter already loaded', { bookId, chapterId });
        dispatch(setCurrentChapter(chapterId));
        dispatch(setCurrentChapterData(chapter));
        return { chapter, bookId };
      }

      // Mark as loading
      dispatch(setIsLoading(true));

      // Load chapter content
      logger.debug('[loadProgressChapter] Loading chapter content', { bookId, chapterId });
      const { ensureChapterLoaded } = await import('../../lib/lazy-chapter-loader');
      const loadedChapter = await ensureChapterLoaded(bookId, chapter);
      
      // Update book in library with loaded chapter
      const updatedChapters = book.chapters.map((c) =>
        c.id === chapterId ? loadedChapter : c
      );
      dispatch(updateBook({
        bookId,
        updates: { chapters: updatedChapters },
      }));

      // Set resolved chapter state
      dispatch(setCurrentChapter(chapterId));
      dispatch(setCurrentChapterData(loadedChapter));
      return { chapter: loadedChapter, bookId };
    } catch (error) {
      logger.error('[loadProgressChapter] Error loading chapter', { bookId, chapterId, error });
      const errorMessage = error instanceof Error ? error.message : String(error);
      return rejectWithValue(errorMessage);
    } finally {
      dispatch(setIsLoading(false));
    }
  }
);

/**
 * Load audio track
 */
export const loadProgressAudioTrack = createAsyncThunk<
  { track: AudioTrack; url: string | null },
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

      const track = book.audioTracks.find((t) => t.id === trackId);
      if (!track) {
        throw new Error(`Track ${trackId} not found in book ${bookId}`);
      }

      // If track URL is already loaded, use it
      if (track.url) {
        logger.debug('[loadProgressAudioTrack] Track already loaded', { bookId, trackId });
        dispatch(setCurrentTrack(trackId));
        dispatch(setCurrentTrackData(track));
        dispatch(setTrackUrl(track.url));
        return { track, url: track.url };
      }

      // Mark as loading
      dispatch(setAudioIsLoading(true));

      // Load audio track
      logger.debug('[loadProgressAudioTrack] Loading audio track', { bookId, trackId });
      const { ensureAudioTrackLoaded } = await import('../../lib/lazy-chapter-loader');
      const loadedTrack = await ensureAudioTrackLoaded(bookId, track);
      
      // Update book in library with loaded track
      const updatedTracks = book.audioTracks.map((t) =>
        t.id === trackId ? loadedTrack : t
      );
      dispatch(updateBook({
        bookId,
        updates: { audioTracks: updatedTracks },
      }));

      // Set resolved track state
      dispatch(setCurrentTrack(trackId));
      dispatch(setCurrentTrackData(loadedTrack));
      dispatch(setTrackUrl(loadedTrack.url || null));
      return { track: loadedTrack, url: loadedTrack.url || null };
    } catch (error) {
      logger.error('[loadProgressAudioTrack] Error loading track', { bookId, trackId, error });
      const errorMessage = error instanceof Error ? error.message : String(error);
      return rejectWithValue(errorMessage);
    } finally {
      dispatch(setAudioIsLoading(false));
    }
  }
);

/**
 * Select book (opens it in reader)
 */
export const selectBook = createAsyncThunk<
  void,
  { bookId: string },
  { state: RootState; dispatch: AppDispatch }
>(
  'reader/selectBook',
  async ({ bookId }, { getState, dispatch }) => {
    const state = getState();
    const book = state.library.books.find((b) => b.id === bookId);
    
    if (!book) {
      logger.warn('[selectBook] Book not found', { bookId });
      return;
    }

    // Set current book
    dispatch(setCurrentChapter(null)); // Will be set by loadProgressChapter
    dispatch(setCurrentChapterData(null));
    
    // Load last chapter if progress exists
    if (book.progress?.currentChapterId) {
      await dispatch(loadProgressChapter({
        bookId,
        chapterId: book.progress.currentChapterId,
      })).unwrap();
    }
  }
);
