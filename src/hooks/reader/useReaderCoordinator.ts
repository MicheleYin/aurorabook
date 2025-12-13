/**
 * Hook to integrate ReaderCoordinator with existing ReaderWrapper operations
 * Provides handlers that connect the coordinator to actual implementation
 */

import { useCallback, useRef } from "react";
import { logger } from "../../lib/logger";
import type { ChapterProgressSnapshot, ChapterSelectionOptions } from "../../components/reader/types";
import { useReaderCoordinator } from "../../contexts/ReaderCoordinatorContext";

type UseReaderCoordinatorParams = {
  // Chapter operation implementations
  onChapterChangeImpl?: (
    bookId: string,
    chapterId: string,
    options?: ChapterSelectionOptions
  ) => Promise<void>;
  onChapterRestoreImpl?: (
    bookId: string,
    chapterId: string
  ) => Promise<void>;
  onChapterProgressRestoreImpl?: (
    bookId: string,
    chapterId: string,
    withAutoScroll?: boolean
  ) => Promise<void>;
  onChapterSaveImpl?: (
    bookId: string,
    chapterId: string
  ) => Promise<void>;
  onChapterProgressSaveImpl?: (
    bookId: string,
    chapterId: string,
    snapshot: ChapterProgressSnapshot
  ) => Promise<void>;
  
  // Audio track operation implementations
  onAudioTrackLoadImpl?: (
    bookId: string,
    trackId: string
  ) => Promise<string | null>;
  onAudioTimestampRestoreImpl?: (
    bookId: string,
    trackId: string,
    timestamp: number
  ) => Promise<void>;
  onAudioTrackSaveImpl?: (
    bookId: string,
    trackId: string
  ) => Promise<void>;
  onAudioTimestampSaveImpl?: (
    bookId: string,
    trackId: string,
    timestamp: number
  ) => Promise<void>;
  onAudioTrackChangeImpl?: (
    bookId: string,
    trackId: string,
    direction?: "next" | "previous" | "random"
  ) => Promise<void>;
};

export function useReaderCoordinatorIntegration(params: UseReaderCoordinatorParams) {
  const coordinator = useReaderCoordinator();
  
  // Store implementations in refs to avoid recreating callbacks
  const implRefs = useRef(params);
  implRefs.current = params;
  
  // Wrapper functions that use the coordinator
  const changeChapter = useCallback(async (
    bookId: string,
    chapterId: string,
    options?: ChapterSelectionOptions
  ) => {
    if (!implRefs.current.onChapterChangeImpl) {
      logger.warn("[Reader Coordinator Integration] onChapterChangeImpl not provided");
      return;
    }
    
    // Use coordinator to manage the operation
    await coordinator.changeChapter(bookId, chapterId, options);
  }, [coordinator]);
  
  const restoreChapter = useCallback(async (
    bookId: string,
    chapterId: string
  ) => {
    if (!implRefs.current.onChapterRestoreImpl) {
      logger.warn("[Reader Coordinator Integration] onChapterRestoreImpl not provided");
      return;
    }
    
    await coordinator.restoreChapter(bookId, chapterId);
  }, [coordinator]);
  
  const restoreChapterProgress = useCallback(async (
    bookId: string,
    chapterId: string,
    withAutoScroll?: boolean
  ) => {
    if (!implRefs.current.onChapterProgressRestoreImpl) {
      logger.warn("[Reader Coordinator Integration] onChapterProgressRestoreImpl not provided");
      return;
    }
    
    await coordinator.restoreChapterProgress(bookId, chapterId, withAutoScroll);
  }, [coordinator]);
  
  const saveChapter = useCallback(async (
    bookId: string,
    chapterId: string
  ) => {
    if (!implRefs.current.onChapterSaveImpl) {
      logger.warn("[Reader Coordinator Integration] onChapterSaveImpl not provided");
      return;
    }
    
    await coordinator.saveChapter(bookId, chapterId);
  }, [coordinator]);
  
  const saveChapterProgress = useCallback(async (
    bookId: string,
    chapterId: string,
    snapshot: ChapterProgressSnapshot
  ) => {
    if (!implRefs.current.onChapterProgressSaveImpl) {
      logger.warn("[Reader Coordinator Integration] onChapterProgressSaveImpl not provided");
      return;
    }
    
    await coordinator.saveChapterProgress(bookId, chapterId, snapshot);
  }, [coordinator]);
  
  const loadAudioTrack = useCallback(async (
    bookId: string,
    trackId: string
  ): Promise<string | null> => {
    if (!implRefs.current.onAudioTrackLoadImpl) {
      logger.warn("[Reader Coordinator Integration] onAudioTrackLoadImpl not provided");
      return null;
    }
    
    return await coordinator.loadAudioTrack(bookId, trackId);
  }, [coordinator]);
  
  const restoreAudioTimestamp = useCallback(async (
    bookId: string,
    trackId: string,
    timestamp: number
  ) => {
    if (!implRefs.current.onAudioTimestampRestoreImpl) {
      logger.warn("[Reader Coordinator Integration] onAudioTimestampRestoreImpl not provided");
      return;
    }
    
    await coordinator.restoreAudioTimestamp(bookId, trackId, timestamp);
  }, [coordinator]);
  
  const saveAudioTrack = useCallback(async (
    bookId: string,
    trackId: string
  ) => {
    if (!implRefs.current.onAudioTrackSaveImpl) {
      logger.warn("[Reader Coordinator Integration] onAudioTrackSaveImpl not provided");
      return;
    }
    
    await coordinator.saveAudioTrack(bookId, trackId);
  }, [coordinator]);
  
  const saveAudioTimestamp = useCallback(async (
    bookId: string,
    trackId: string,
    timestamp: number
  ) => {
    if (!implRefs.current.onAudioTimestampSaveImpl) {
      logger.warn("[Reader Coordinator Integration] onAudioTimestampSaveImpl not provided");
      return;
    }
    
    await coordinator.saveAudioTimestamp(bookId, trackId, timestamp);
  }, [coordinator]);
  
  const changeAudioTrack = useCallback(async (
    bookId: string,
    trackId: string,
    direction?: "next" | "previous" | "random"
  ) => {
    if (!implRefs.current.onAudioTrackChangeImpl) {
      logger.warn("[Reader Coordinator Integration] onAudioTrackChangeImpl not provided");
      return;
    }
    
    await coordinator.changeAudioTrack(bookId, trackId, direction);
  }, [coordinator]);
  
  return {
    // Coordinator state
    coordinator,
    loading: coordinator.loading,
    locks: coordinator.locks,
    
    // Operation checkers
    isOperationInProgress: coordinator.isOperationInProgress,
    getCurrentOperation: coordinator.getCurrentOperation,
    cancelOperation: coordinator.cancelOperation,
    cancelAllOperations: coordinator.cancelAllOperations,
    
    // Chapter operations (wrapped)
    changeChapter,
    restoreChapter,
    restoreChapterProgress,
    saveChapter,
    saveChapterProgress,
    
    // Audio operations (wrapped)
    loadAudioTrack,
    restoreAudioTimestamp,
    saveAudioTrack,
    saveAudioTimestamp,
    changeAudioTrack,
  };
}

