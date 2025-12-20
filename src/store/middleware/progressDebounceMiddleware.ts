/**
 * Redux middleware for debouncing progress updates
 * 
 * Automatically debounces progress and audio state updates to the backend,
 * ensuring we don't spam the backend with frequent updates.
 */

import { Middleware } from '@reduxjs/toolkit';
import { logger } from '../../lib/logger';
import { createDebounce } from '../../lib/debounce-utils';
import { flushProgressUpdate, flushAudioStateUpdate } from '../thunks/libraryThunks';
import type { RootState, AppDispatch } from '../index';

// Module-level debouncers (one per book)
const progressDebouncers = new Map<string, ReturnType<typeof createDebounce>>();
const audioDebouncers = new Map<string, ReturnType<typeof createDebounce>>();

const DEBOUNCE_DELAY = 500; // 500ms

export const progressDebounceMiddleware: Middleware<
  {},
  RootState,
  AppDispatch
> = (store) => (next) => (action) => {
  const result = next(action);

  // Handle progress updates
  if (action.type === 'library/updateBookProgress/fulfilled') {
    const { bookId } = action.meta.arg;
    
    // Get or create debouncer for this book
    let debouncer = progressDebouncers.get(bookId);
    if (!debouncer) {
      debouncer = createDebounce(async () => {
        try {
          await store.dispatch(flushProgressUpdate({ bookId })).unwrap();
          logger.debug('[progressDebounceMiddleware] Progress synced to backend', { bookId });
        } catch (error) {
          logger.error('[progressDebounceMiddleware] Failed to sync progress', { bookId, error });
        }
      }, DEBOUNCE_DELAY);
      progressDebouncers.set(bookId, debouncer);
    }

    // Trigger debounced sync
    debouncer.call();
  }

  // Handle audio state updates
  if (action.type === 'library/updateBookAudioState/fulfilled') {
    const { bookId } = action.meta.arg;
    
    // Get or create debouncer for this book
    let debouncer = audioDebouncers.get(bookId);
    if (!debouncer) {
      debouncer = createDebounce(async () => {
        try {
          await store.dispatch(flushAudioStateUpdate({ bookId })).unwrap();
          logger.debug('[progressDebounceMiddleware] Audio state synced to backend', { bookId });
        } catch (error) {
          logger.error('[progressDebounceMiddleware] Failed to sync audio state', { bookId, error });
        }
      }, DEBOUNCE_DELAY);
      audioDebouncers.set(bookId, debouncer);
    }

    // Trigger debounced sync
    debouncer.call();
  }

  // Clean up debouncers when book is removed (optional optimization)
  if (action.type === 'library/removeBook') {
    const { bookId } = action.payload;
    progressDebouncers.delete(bookId);
    audioDebouncers.delete(bookId);
  }

  return result;
};

