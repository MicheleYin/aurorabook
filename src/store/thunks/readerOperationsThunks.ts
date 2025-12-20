/**
 * Unified Reader Operations Thunks
 * 
 * Consolidates all reader operations (chapter changes, progress saving, etc.)
 * into Redux thunks for centralized state management and better DevTools visibility.
 */

import { createAsyncThunk } from '@reduxjs/toolkit';
import { logger } from '../../lib/logger';
import type { RootState, AppDispatch } from '../index';
import type { ChapterSelectionOptions, ChapterProgressSnapshot } from '../../components/reader/types';
import {
  setCurrentChapterId,
  setCurrentChapterData,
  setCurrentChapterLoading,
  setCurrentChapterError,
  setCurrentChapterLoadAttempt,
} from '../slices/readerSlice';
import { updateBook } from '../slices/librarySlice';
import { changeChapter as changeChapterCoordinator } from './coordinatorThunks';

/**
 * Change chapter - unified operation that handles loading, state updates, and coordination
 */
export const changeChapter = createAsyncThunk<
  void,
  {
    bookId: string;
    chapterId: string;
    options?: ChapterSelectionOptions;
  },
  { state: RootState; dispatch: AppDispatch }
>(
  'reader/changeChapter',
  async ({ bookId, chapterId, options }, { getState, dispatch, rejectWithValue }) => {
    try {
      const state = getState();
      const book = state.library.books.find((b) => b.id === bookId);
      
      if (!book) {
        return rejectWithValue(`Book ${bookId} not found`);
      }

      const chapter = book.chapters.find((c) => c.id === chapterId);
      if (!chapter) {
        return rejectWithValue(`Chapter ${chapterId} not found`);
      }

      // Set chapter ID
      dispatch(setCurrentChapterId(chapterId));

      // Use coordinator to manage the operation
      await dispatch(changeChapterCoordinator({
        bookId,
        chapterId,
        options,
        onExecute: async (bId, cId, opts) => {
          // Load chapter if not already loaded
          const currentState = getState();
          const currentBook = currentState.library.books.find((b) => b.id === bId);
          if (!currentBook) return;

          const chapterToLoad = currentBook.chapters.find((ch) => ch.id === cId);
          if (!chapterToLoad) return;

          // If chapter is already loaded, just set it
          if (chapterToLoad.contentHtml) {
            dispatch(setCurrentChapterData(chapterToLoad));
            return;
          }

          // Load chapter
          const loadKey = `${bId}-${cId}`;
          dispatch(setCurrentChapterLoading(true));
          dispatch(setCurrentChapterLoadAttempt(loadKey));

          try {
            const { ensureChapterLoaded } = await import('../../lib/lazy-chapter-loader');
            const loadedChapter = await ensureChapterLoaded(currentBook.sourcePath, chapterToLoad);

            // Update library
            dispatch(updateBook({
              bookId: bId,
              updates: {
                chapters: currentBook.chapters.map((ch) => ch.id === cId ? loadedChapter : ch),
              },
            }));

            // Set resolved chapter
            dispatch(setCurrentChapterData(loadedChapter));
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            dispatch(setCurrentChapterError(errorMessage));
            throw error;
          } finally {
            dispatch(setCurrentChapterLoading(false));
          }
        },
      })).unwrap();
    } catch (error) {
      logger.error('[changeChapter] Error changing chapter', { bookId, chapterId, error });
      const errorMessage = error instanceof Error ? error.message : String(error);
      return rejectWithValue(errorMessage);
    }
  }
);

/**
 * Save chapter progress - unified operation
 */
export const saveChapterProgress = createAsyncThunk<
  void,
  {
    bookId: string;
    chapterId: string;
    snapshot: ChapterProgressSnapshot;
  },
  { state: RootState; dispatch: AppDispatch }
>(
  'reader/saveChapterProgress',
  async ({ bookId, chapterId, snapshot }, { getState, dispatch, rejectWithValue }) => {
    try {
      const { updateBookProgress } = await import('./libraryThunks');
      await dispatch(updateBookProgress({
        bookId,
        progress: {
          chapterId,
          scrollTop: snapshot.scrollTop,
          scrollHeight: snapshot.scrollHeight,
          clientHeight: snapshot.clientHeight,
          percent: snapshot.chapterProgressPercent,
          elementId: snapshot.elementId,
          elementIndex: snapshot.elementIndex,
          updatedAt: snapshot.updatedAt,
        },
      })).unwrap();
    } catch (error) {
      logger.error('[saveChapterProgress] Error saving progress', { bookId, chapterId, error });
      const errorMessage = error instanceof Error ? error.message : String(error);
      return rejectWithValue(errorMessage);
    }
  }
);

