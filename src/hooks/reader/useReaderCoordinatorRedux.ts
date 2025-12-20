/**
 * Redux-based Reader Coordinator Hook
 * 
 * Replaces ReaderCoordinatorContext with Redux-based implementation.
 * Provides the same interface but uses Redux for state management.
 */

import { useCallback } from 'react';
import { logger } from '../../lib/logger';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import {
  selectOperationLocks,
  selectLoadingStates,
} from '../../store/selectors';
import {
  cancelOperation as cancelOperationAction,
  cancelAllOperations as cancelAllOperationsAction,
} from '../../store/slices/readerCoordinatorSlice';
import {
  changeChapter as changeChapterThunk,
  restoreChapter as restoreChapterThunk,
  saveChapterProgress as saveChapterProgressThunk,
  loadAudioTrack as loadAudioTrackThunk,
  changeAudioTrack as changeAudioTrackThunk,
} from '../../store/thunks/coordinatorThunks';
import type { ChapterProgressSnapshot, ChapterSelectionOptions } from '../../components/reader/types';
import type { OperationType, OperationState } from '../../store/slices/readerCoordinatorSlice';

export function useReaderCoordinator() {
  const dispatch = useAppDispatch();
  const locks = useAppSelector(selectOperationLocks);
  const loading = useAppSelector(selectLoadingStates);

  const cancelOperation = useCallback((operationId: string) => {
    dispatch(cancelOperationAction(operationId));
  }, [dispatch]);

  const cancelAllOperations = useCallback(() => {
    dispatch(cancelAllOperationsAction());
  }, [dispatch]);

  const isOperationInProgress = useCallback((type: OperationType): boolean => {
    switch (type) {
      case 'changeChapter':
      case 'restoreChapter':
        return locks.chapter !== null && !locks.chapter.cancelled;
      case 'restoreChapterProgress':
      case 'saveChapterProgress':
        return locks.progress !== null && !locks.progress.cancelled;
      case 'loadAudioTrack':
      case 'restoreAudioTimestamp':
      case 'saveAudioTrack':
      case 'saveAudioTimestamp':
      case 'changeAudioTrack':
        return locks.audio !== null && !locks.audio.cancelled;
      default:
        return false;
    }
  }, [locks]);

  const getCurrentOperation = useCallback((type: OperationType): OperationState | null => {
    switch (type) {
      case 'changeChapter':
      case 'restoreChapter':
        return locks.chapter;
      case 'restoreChapterProgress':
      case 'saveChapterProgress':
        return locks.progress;
      case 'loadAudioTrack':
      case 'restoreAudioTimestamp':
      case 'saveAudioTrack':
      case 'saveAudioTimestamp':
      case 'changeAudioTrack':
        return locks.audio;
      default:
        return null;
    }
  }, [locks]);

  const changeChapter = useCallback(async (
    bookId: string,
    chapterId: string,
    options?: ChapterSelectionOptions,
    onExecute?: (bookId: string, chapterId: string, options?: ChapterSelectionOptions) => Promise<void>
  ): Promise<void> => {
    if (!onExecute) {
      logger.warn('[useReaderCoordinator] changeChapter called without onExecute');
      return;
    }
    await dispatch(changeChapterThunk({
      bookId,
      chapterId,
      options,
      onExecute,
    })).unwrap();
  }, [dispatch]);

  const restoreChapter = useCallback(async (
    bookId: string,
    chapterId: string
  ): Promise<void> => {
    await dispatch(restoreChapterThunk({
      bookId,
      chapterId,
      onExecute: async () => {
        throw new Error('onExecute must be provided');
      },
    })).unwrap();
  }, [dispatch]);

  const saveChapterProgress = useCallback(async (
    bookId: string,
    chapterId: string,
    snapshot: ChapterProgressSnapshot
  ): Promise<void> => {
    await dispatch(saveChapterProgressThunk({
      bookId,
      chapterId,
      snapshot,
      onExecute: async () => {
        throw new Error('onExecute must be provided');
      },
    })).unwrap();
  }, [dispatch]);

  const loadAudioTrack = useCallback(async (
    bookId: string,
    trackId: string
  ): Promise<string | null> => {
    return await dispatch(loadAudioTrackThunk({
      bookId,
      trackId,
      onExecute: async () => {
        throw new Error('onExecute must be provided');
      },
    })).unwrap();
  }, [dispatch]);

  const changeAudioTrack = useCallback(async (
    bookId: string,
    trackId: string,
    direction?: 'next' | 'previous' | 'random'
  ): Promise<void> => {
    await dispatch(changeAudioTrackThunk({
      bookId,
      trackId,
      direction,
      onExecute: async () => {
        throw new Error('onExecute must be provided');
      },
    })).unwrap();
  }, [dispatch]);

  // Stub implementations for operations not yet migrated
  const restoreChapterProgress = useCallback(async (
    _bookId: string,
    _chapterId: string,
    _withAutoScroll?: boolean
  ): Promise<void> => {
    // TODO: Implement
  }, []);

  const saveChapter = useCallback(async (
    _bookId: string,
    _chapterId: string
  ): Promise<void> => {
    // TODO: Implement
  }, []);

  const restoreAudioTimestamp = useCallback(async (
    _bookId: string,
    _trackId: string,
    _timestamp: number
  ): Promise<void> => {
    // TODO: Implement
  }, []);

  const saveAudioTrack = useCallback(async (
    _bookId: string,
    _trackId: string
  ): Promise<void> => {
    // TODO: Implement
  }, []);

  const saveAudioTimestamp = useCallback(async (
    _bookId: string,
    _trackId: string,
    _timestamp: number
  ): Promise<void> => {
    // TODO: Implement
  }, []);

  return {
    locks,
    loading,
    changeChapter,
    restoreChapter,
    restoreChapterProgress,
    saveChapter,
    saveChapterProgress,
    loadAudioTrack,
    restoreAudioTimestamp,
    saveAudioTrack,
    saveAudioTimestamp,
    changeAudioTrack,
    cancelOperation,
    cancelAllOperations,
    isOperationInProgress,
    getCurrentOperation,
  };
}

