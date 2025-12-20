import { createAsyncThunk } from '@reduxjs/toolkit';
import { logger } from '../../lib/logger';
import type { RootState, AppDispatch } from '../index';
import type { ChapterProgressSnapshot, ChapterSelectionOptions } from '../../components/reader/types';
import type { OperationType, OperationState } from '../slices/readerCoordinatorSlice';
import {
  setChapterLock,
  setAudioLock,
  setProgressLock,
  cancelOperation as cancelOperationAction,
  cancelAllOperations as cancelAllOperationsAction,
  setChapterLoading,
  setChapterRestoring,
  setChapterSaving,
  setAudioLoading,
  setAudioRestoring,
  setAudioSaving,
  setTrackChanging,
} from '../slices/readerCoordinatorSlice';

/**
 * Generate unique operation ID
 */
function generateOperationId(): string {
  return `op-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Create operation state
 */
function createOperationState(
  type: OperationType,
  bookId?: string,
  chapterId?: string,
  trackId?: string
): OperationState {
  return {
    type,
    id: generateOperationId(),
    bookId,
    chapterId,
    trackId,
    timestamp: Date.now(),
    cancelled: false,
  };
}

/**
 * Change chapter with coordination
 */
export const changeChapter = createAsyncThunk<
  void,
  {
    bookId: string;
    chapterId: string;
    options?: ChapterSelectionOptions;
    onExecute: (bookId: string, chapterId: string, options?: ChapterSelectionOptions) => Promise<void>;
  },
  { state: RootState; dispatch: AppDispatch }
>(
  'coordinator/changeChapter',
  async ({ bookId, chapterId, options, onExecute }, { getState, dispatch, rejectWithValue }) => {
    const state = getState();
    
    // Cancel any existing chapter operation
    if (state.readerCoordinator.locks.chapter) {
      dispatch(cancelOperationAction(state.readerCoordinator.locks.chapter.id));
    }

    // Create new operation
    const operation = createOperationState('changeChapter', bookId, chapterId);
    dispatch(setChapterLock(operation));
    dispatch(setChapterLoading(true));

    try {
      // Check if cancelled before execution
      const currentState = getState();
      if (currentState.readerCoordinator.locks.chapter?.id !== operation.id || 
          currentState.readerCoordinator.locks.chapter?.cancelled) {
        logger.log('[coordinator] Operation cancelled before execution', { operationId: operation.id });
        return;
      }

      // Execute the operation
      await onExecute(bookId, chapterId, options);

      // Check if cancelled during execution
      const finalState = getState();
      if (finalState.readerCoordinator.locks.chapter?.id !== operation.id || 
          finalState.readerCoordinator.locks.chapter?.cancelled) {
        logger.log('[coordinator] Operation cancelled during execution', { operationId: operation.id });
        return;
      }

      logger.log('[coordinator] Chapter change completed', { bookId, chapterId });
    } catch (error) {
      const currentState = getState();
      const currentOp = currentState.readerCoordinator.locks.chapter;
      if (currentOp?.id !== operation.id || !currentOp?.cancelled) {
        logger.error('[coordinator] Chapter change failed', { bookId, chapterId, error });
        throw error;
      }
    } finally {
      // Only clear if this is still the current operation
      const finalState = getState();
      if (finalState.readerCoordinator.locks.chapter?.id === operation.id) {
        dispatch(setChapterLock(null));
        dispatch(setChapterLoading(false));
      }
    }
  }
);

/**
 * Restore chapter with coordination
 */
export const restoreChapter = createAsyncThunk<
  void,
  {
    bookId: string;
    chapterId: string;
    onExecute: (bookId: string, chapterId: string) => Promise<void>;
  },
  { state: RootState; dispatch: AppDispatch }
>(
  'coordinator/restoreChapter',
  async ({ bookId, chapterId, onExecute }, { getState, dispatch }) => {
    const state = getState();
    
    if (state.readerCoordinator.locks.chapter) {
      dispatch(cancelOperationAction(state.readerCoordinator.locks.chapter.id));
    }

    const operation = createOperationState('restoreChapter', bookId, chapterId);
    dispatch(setChapterLock(operation));
    dispatch(setChapterRestoring(true));

    try {
      const currentState = getState();
      if (currentState.readerCoordinator.locks.chapter?.id !== operation.id || 
          currentState.readerCoordinator.locks.chapter?.cancelled) {
        return;
      }

      await onExecute(bookId, chapterId);

      const finalState = getState();
      if (finalState.readerCoordinator.locks.chapter?.id !== operation.id || 
          finalState.readerCoordinator.locks.chapter?.cancelled) {
        return;
      }
    } catch (error) {
      const currentState = getState();
      const currentOp = currentState.readerCoordinator.locks.chapter;
      if (currentOp?.id !== operation.id || !currentOp?.cancelled) {
        logger.error('[coordinator] Chapter restore failed', { bookId, chapterId, error });
        throw error;
      }
    } finally {
      const finalState = getState();
      if (finalState.readerCoordinator.locks.chapter?.id === operation.id) {
        dispatch(setChapterLock(null));
        dispatch(setChapterRestoring(false));
      }
    }
  }
);

/**
 * Save chapter progress with coordination
 */
export const saveChapterProgress = createAsyncThunk<
  void,
  {
    bookId: string;
    chapterId: string;
    snapshot: ChapterProgressSnapshot;
    onExecute: (bookId: string, chapterId: string, snapshot: ChapterProgressSnapshot) => Promise<void>;
  },
  { state: RootState; dispatch: AppDispatch }
>(
  'coordinator/saveChapterProgress',
  async ({ bookId, chapterId, snapshot, onExecute }, { getState, dispatch }) => {
    const state = getState();
    
    if (state.readerCoordinator.locks.progress) {
      dispatch(cancelOperationAction(state.readerCoordinator.locks.progress.id));
    }

    const operation = createOperationState('saveChapterProgress', bookId, chapterId);
    dispatch(setProgressLock(operation));
    dispatch(setChapterSaving(true));

    try {
      const currentState = getState();
      if (currentState.readerCoordinator.locks.progress?.id !== operation.id || 
          currentState.readerCoordinator.locks.progress?.cancelled) {
        return;
      }

      await onExecute(bookId, chapterId, snapshot);

      const finalState = getState();
      if (finalState.readerCoordinator.locks.progress?.id !== operation.id || 
          finalState.readerCoordinator.locks.progress?.cancelled) {
        return;
      }
    } catch (error) {
      const currentState = getState();
      const currentOp = currentState.readerCoordinator.locks.progress;
      if (currentOp?.id !== operation.id || !currentOp?.cancelled) {
        logger.error('[coordinator] Save chapter progress failed', { bookId, chapterId, error });
        throw error;
      }
    } finally {
      const finalState = getState();
      if (finalState.readerCoordinator.locks.progress?.id === operation.id) {
        dispatch(setProgressLock(null));
        dispatch(setChapterSaving(false));
      }
    }
  }
);

/**
 * Load audio track with coordination
 */
export const loadAudioTrack = createAsyncThunk<
  string | null,
  {
    bookId: string;
    trackId: string;
    onExecute: (bookId: string, trackId: string) => Promise<string | null>;
  },
  { state: RootState; dispatch: AppDispatch }
>(
  'coordinator/loadAudioTrack',
  async ({ bookId, trackId, onExecute }, { getState, dispatch }) => {
    const state = getState();
    
    if (state.readerCoordinator.locks.audio) {
      dispatch(cancelOperationAction(state.readerCoordinator.locks.audio.id));
    }

    const operation = createOperationState('loadAudioTrack', bookId, undefined, trackId);
    dispatch(setAudioLock(operation));
    dispatch(setAudioLoading(true));

    try {
      const currentState = getState();
      if (currentState.readerCoordinator.locks.audio?.id !== operation.id || 
          currentState.readerCoordinator.locks.audio?.cancelled) {
        return null;
      }

      const result = await onExecute(bookId, trackId);

      const finalState = getState();
      if (finalState.readerCoordinator.locks.audio?.id !== operation.id || 
          finalState.readerCoordinator.locks.audio?.cancelled) {
        return null;
      }

      return result;
    } catch (error) {
      const currentState = getState();
      const currentOp = currentState.readerCoordinator.locks.audio;
      if (currentOp?.id !== operation.id || !currentOp?.cancelled) {
        logger.error('[coordinator] Load audio track failed', { bookId, trackId, error });
        throw error;
      }
      return null;
    } finally {
      const finalState = getState();
      if (finalState.readerCoordinator.locks.audio?.id === operation.id) {
        dispatch(setAudioLock(null));
        dispatch(setAudioLoading(false));
      }
    }
  }
);

/**
 * Change audio track with coordination
 */
export const changeAudioTrack = createAsyncThunk<
  void,
  {
    bookId: string;
    trackId: string;
    direction?: 'next' | 'previous' | 'random';
    onExecute: (bookId: string, trackId: string, direction?: 'next' | 'previous' | 'random') => Promise<void>;
  },
  { state: RootState; dispatch: AppDispatch }
>(
  'coordinator/changeAudioTrack',
  async ({ bookId, trackId, direction, onExecute }, { getState, dispatch }) => {
    const state = getState();
    
    if (state.readerCoordinator.locks.audio) {
      dispatch(cancelOperationAction(state.readerCoordinator.locks.audio.id));
    }

    const operation = createOperationState('changeAudioTrack', bookId, undefined, trackId);
    dispatch(setAudioLock(operation));
    dispatch(setTrackChanging(true));

    try {
      const currentState = getState();
      if (currentState.readerCoordinator.locks.audio?.id !== operation.id || 
          currentState.readerCoordinator.locks.audio?.cancelled) {
        return;
      }

      await onExecute(bookId, trackId, direction);

      const finalState = getState();
      if (finalState.readerCoordinator.locks.audio?.id !== operation.id || 
          finalState.readerCoordinator.locks.audio?.cancelled) {
        return;
      }
    } catch (error) {
      const currentState = getState();
      const currentOp = currentState.readerCoordinator.locks.audio;
      if (currentOp?.id !== operation.id || !currentOp?.cancelled) {
        logger.error('[coordinator] Change audio track failed', { bookId, trackId, error });
        throw error;
      }
    } finally {
      const finalState = getState();
      if (finalState.readerCoordinator.locks.audio?.id === operation.id) {
        dispatch(setAudioLock(null));
        dispatch(setTrackChanging(false));
      }
    }
  }
);

