/**
 * Reader Coordinator Context
 * 
 * Centralizes and coordinates all async operations for chapters and audio tracks.
 * Provides locks, loading states, and cancellation for all operations.
 */

import { createContext, useContext, useCallback, useEffect, useRef, useState, useMemo, ReactNode } from "react";
import { logger } from "../lib/logger";
import type { ChapterProgressSnapshot, ChapterSelectionOptions } from "../components/reader/types";

// Operation types
type OperationType =
  | "changeChapter"
  | "restoreChapter"
  | "restoreChapterProgress"
  | "saveChapter"
  | "saveChapterProgress"
  | "loadAudioTrack"
  | "restoreAudioTimestamp"
  | "saveAudioTrack"
  | "saveAudioTimestamp"
  | "changeAudioTrack";

// Operation state
type OperationState = {
  type: OperationType;
  id: string; // Unique ID for this operation
  bookId?: string;
  chapterId?: string;
  trackId?: string;
  timestamp: number;
  cancelled: boolean;
};

// Operation locks - prevent conflicting operations
type OperationLocks = {
  chapter: OperationState | null;
  audio: OperationState | null;
  progress: OperationState | null;
};

// Loading states
type LoadingStates = {
  chapterLoading: boolean;
  chapterRestoring: boolean;
  chapterSaving: boolean;
  audioLoading: boolean;
  audioRestoring: boolean;
  audioSaving: boolean;
  trackChanging: boolean;
};

type ReaderCoordinatorContextValue = {
  // Operation state
  locks: OperationLocks;
  loading: LoadingStates;
  
  // Chapter operations
  changeChapter: (
    bookId: string,
    chapterId: string,
    options?: ChapterSelectionOptions
  ) => Promise<void>;
  restoreChapter: (
    bookId: string,
    chapterId: string
  ) => Promise<void>;
  restoreChapterProgress: (
    bookId: string,
    chapterId: string,
    withAutoScroll?: boolean
  ) => Promise<void>;
  saveChapter: (
    bookId: string,
    chapterId: string
  ) => Promise<void>;
  saveChapterProgress: (
    bookId: string,
    chapterId: string,
    snapshot: ChapterProgressSnapshot
  ) => Promise<void>;
  
  // Audio track operations
  loadAudioTrack: (
    bookId: string,
    trackId: string
  ) => Promise<string | null>; // Returns track URL
  restoreAudioTimestamp: (
    bookId: string,
    trackId: string,
    timestamp: number
  ) => Promise<void>;
  saveAudioTrack: (
    bookId: string,
    trackId: string
  ) => Promise<void>;
  saveAudioTimestamp: (
    bookId: string,
    trackId: string,
    timestamp: number
  ) => Promise<void>;
  changeAudioTrack: (
    bookId: string,
    trackId: string,
    direction?: "next" | "previous" | "random"
  ) => Promise<void>;
  
  // Cancellation
  cancelOperation: (operationId: string) => void;
  cancelAllOperations: () => void;
  
  // Check if operation is in progress
  isOperationInProgress: (type: OperationType) => boolean;
  getCurrentOperation: (type: OperationType) => OperationState | null;
};

export const ReaderCoordinatorContext = createContext<ReaderCoordinatorContextValue | null>(null);

type ReaderCoordinatorProviderProps = {
  children: ReactNode;
  // Operation handlers - these will be provided by the components that use this context
  onChapterChange?: (
    bookId: string,
    chapterId: string,
    options?: ChapterSelectionOptions
  ) => Promise<void>;
  onChapterRestore?: (
    bookId: string,
    chapterId: string
  ) => Promise<void>;
  onChapterProgressRestore?: (
    bookId: string,
    chapterId: string,
    withAutoScroll?: boolean
  ) => Promise<void>;
  onChapterSave?: (
    bookId: string,
    chapterId: string
  ) => Promise<void>;
  onChapterProgressSave?: (
    bookId: string,
    chapterId: string,
    snapshot: ChapterProgressSnapshot
  ) => Promise<void>;
  onAudioTrackLoad?: (
    bookId: string,
    trackId: string
  ) => Promise<string | null>;
  onAudioTimestampRestore?: (
    bookId: string,
    trackId: string,
    timestamp: number
  ) => Promise<void>;
  onAudioTrackSave?: (
    bookId: string,
    trackId: string
  ) => Promise<void>;
  onAudioTimestampSave?: (
    bookId: string,
    trackId: string,
    timestamp: number
  ) => Promise<void>;
  onAudioTrackChange?: (
    bookId: string,
    trackId: string,
    direction?: "next" | "previous" | "random"
  ) => Promise<void>;
};

export function ReaderCoordinatorProvider({
  children,
  onChapterChange,
  onChapterRestore,
  onChapterProgressRestore,
  onChapterSave,
  onChapterProgressSave,
  onAudioTrackLoad,
  onAudioTimestampRestore,
  onAudioTrackSave,
  onAudioTimestampSave,
  onAudioTrackChange,
}: ReaderCoordinatorProviderProps) {
  // Operation locks (as state so components can react to changes)
  const [locks, setLocks] = useState<OperationLocks>({
    chapter: null,
    audio: null,
    progress: null,
  });
  
  // Operation locks refs for reliable cancellation checks (not affected by closures)
  const locksRef = useRef<OperationLocks>({
    chapter: null,
    audio: null,
    progress: null,
  });
  
  // Loading states
  const [loading, setLoading] = useState<LoadingStates>({
    chapterLoading: false,
    chapterRestoring: false,
    chapterSaving: false,
    audioLoading: false,
    audioRestoring: false,
    audioSaving: false,
    trackChanging: false,
  });
  
  // Operation counter for unique IDs
  const operationCounterRef = useRef(0);
  
  // Sync refs with state whenever state changes
  useEffect(() => {
    locksRef.current = locks;
  }, [locks]);
  
  // Generate unique operation ID
  const generateOperationId = useCallback(() => {
    operationCounterRef.current += 1;
    return `op-${Date.now()}-${operationCounterRef.current}`;
  }, []);
  
  // Cancel an operation
  const cancelOperation = useCallback((operationId: string) => {
    setLocks(prev => {
      const updated = { ...prev };
      let cancelled = false;
      
      if (updated.chapter?.id === operationId) {
        updated.chapter = { ...updated.chapter, cancelled: true };
        cancelled = true;
      }
      if (updated.audio?.id === operationId) {
        updated.audio = { ...updated.audio, cancelled: true };
        cancelled = true;
      }
      if (updated.progress?.id === operationId) {
        updated.progress = { ...updated.progress, cancelled: true };
        cancelled = true;
      }
      
      // Sync refs with updated state
      locksRef.current = updated;
      
      if (cancelled) {
        logger.log("[Reader Coordinator] Operation cancelled", { operationId });
      }
      
      return updated;
    });
  }, []);
  
  // Cancel all operations
  const cancelAllOperations = useCallback(() => {
    const clearedLocks: OperationLocks = {
      chapter: null,
      audio: null,
      progress: null,
    };
    
    setLocks(prev => {
      const updated = {
        chapter: prev.chapter ? { ...prev.chapter, cancelled: true } : null,
        audio: prev.audio ? { ...prev.audio, cancelled: true } : null,
        progress: prev.progress ? { ...prev.progress, cancelled: true } : null,
      };
      // Sync refs before clearing
      locksRef.current = updated;
      return updated;
    });
    
    setLocks(clearedLocks);
    locksRef.current = clearedLocks;
    
    setLoading({
      chapterLoading: false,
      chapterRestoring: false,
      chapterSaving: false,
      audioLoading: false,
      audioRestoring: false,
      audioSaving: false,
      trackChanging: false,
    });
    
    logger.log("[Reader Coordinator] All operations cancelled");
  }, []);
  
  // Check if operation is in progress
  const isOperationInProgress = useCallback((type: OperationType): boolean => {
    return (() => {
      switch (type) {
        case "changeChapter":
        case "restoreChapter":
          return locks.chapter !== null && !locks.chapter.cancelled;
        case "restoreChapterProgress":
        case "saveChapterProgress":
          return locks.progress !== null && !locks.progress.cancelled;
        case "saveChapter":
          return locks.chapter !== null && !locks.chapter.cancelled;
        case "loadAudioTrack":
        case "restoreAudioTimestamp":
        case "saveAudioTrack":
        case "saveAudioTimestamp":
        case "changeAudioTrack":
          return locks.audio !== null && !locks.audio.cancelled;
        default:
          return false;
      }
    })();
  }, [locks]);
  
  // Get current operation
  const getCurrentOperation = useCallback((type: OperationType): OperationState | null => {
    switch (type) {
      case "changeChapter":
      case "restoreChapter":
      case "saveChapter":
        return locks.chapter;
      case "restoreChapterProgress":
      case "saveChapterProgress":
        return locks.progress;
      case "loadAudioTrack":
      case "restoreAudioTimestamp":
      case "saveAudioTrack":
      case "saveAudioTimestamp":
      case "changeAudioTrack":
        return locks.audio;
      default:
        return null;
    }
  }, [locks]);
  
  // Chapter operations
  const changeChapter = useCallback(async (
    bookId: string,
    chapterId: string,
    options?: ChapterSelectionOptions
  ): Promise<void> => {
    if (!onChapterChange) {
      logger.warn("[Reader Coordinator] onChapterChange handler not provided");
      return;
    }
    
    // Cancel any existing chapter operation
    setLocks(prev => {
      if (prev.chapter) {
        logger.log("[Reader Coordinator] Cancelling previous chapter operation", {
          previousId: prev.chapter.id,
        });
      }
      return prev;
    });
    
    // Create new operation
    const operationId = generateOperationId();
    const operation: OperationState = {
      type: "changeChapter",
      id: operationId,
      bookId,
      chapterId,
      timestamp: Date.now(),
      cancelled: false,
    };
    
    setLocks(prev => {
      const updated = { ...prev, chapter: operation };
      locksRef.current = updated;
      return updated;
    });
    setLoading(prev => ({ ...prev, chapterLoading: true }));
    
    try {
      // Check if cancelled before starting (check current state, not closure)
      if (locksRef.current.chapter?.id !== operationId || locksRef.current.chapter?.cancelled) {
        logger.log("[Reader Coordinator] Operation cancelled before execution", { operationId });
        return;
      }
      
      // Call the handler
      await onChapterChange(bookId, chapterId, options);
      
      // Check if cancelled during execution (check current state, not closure)
      if (locksRef.current.chapter?.id !== operationId || locksRef.current.chapter?.cancelled) {
        logger.log("[Reader Coordinator] Operation cancelled during execution", { operationId });
        return;
      }
      
      logger.log("[Reader Coordinator] Chapter change completed", { bookId, chapterId });
    } catch (error) {
      // Check current state for cancellation, not closure value
      const currentOp = locksRef.current.chapter;
      if (currentOp?.id !== operationId || !currentOp?.cancelled) {
        logger.error("[Reader Coordinator] Chapter change failed", { bookId, chapterId, error });
        throw error;
      }
    } finally {
      // Only clear if this is still the current operation
      setLocks(prev => {
        if (prev.chapter?.id === operationId) {
          return { ...prev, chapter: null };
        }
        return prev;
      });
      setLoading(prev => ({ ...prev, chapterLoading: false }));
    }
  }, [onChapterChange, generateOperationId]);
  
  const restoreChapter = useCallback(async (
    bookId: string,
    chapterId: string
  ): Promise<void> => {
    if (!onChapterRestore) {
      logger.warn("[Reader Coordinator] onChapterRestore handler not provided");
      return;
    }
    
    // Cancel any existing chapter operation
    setLocks(prev => {
      if (prev.chapter) {
        return { ...prev, chapter: { ...prev.chapter, cancelled: true } };
      }
      return prev;
    });
    
    const operationId = generateOperationId();
    const operation: OperationState = {
      type: "restoreChapter",
      id: operationId,
      bookId,
      chapterId,
      timestamp: Date.now(),
      cancelled: false,
    };
    
    setLocks(prev => {
      const updated = { ...prev, chapter: operation };
      locksRef.current = updated;
      return updated;
    });
    setLoading(prev => ({ ...prev, chapterRestoring: true }));
    
    try {
      // Check current state, not closure value
      if (locksRef.current.chapter?.id !== operationId || locksRef.current.chapter?.cancelled) return;
      await onChapterRestore(bookId, chapterId);
      if (locksRef.current.chapter?.id !== operationId || locksRef.current.chapter?.cancelled) return;
      logger.log("[Reader Coordinator] Chapter restore completed", { bookId, chapterId });
    } catch (error) {
      const currentOp = locksRef.current.chapter;
      if (currentOp?.id !== operationId || !currentOp?.cancelled) {
        logger.error("[Reader Coordinator] Chapter restore failed", { bookId, chapterId, error });
        throw error;
      }
    } finally {
      setLocks(prev => {
        if (prev.chapter?.id === operationId) {
          const updated = { ...prev, chapter: null };
          locksRef.current = updated;
          return updated;
        }
        return prev;
      });
      setLoading(prev => ({ ...prev, chapterRestoring: false }));
    }
  }, [onChapterRestore, generateOperationId]);
  
  const restoreChapterProgress = useCallback(async (
    bookId: string,
    chapterId: string,
    withAutoScroll?: boolean
  ): Promise<void> => {
    if (!onChapterProgressRestore) {
      logger.warn("[Reader Coordinator] onChapterProgressRestore handler not provided");
      return;
    }
    
    // Cancel any existing progress operation
    setLocks(prev => {
      if (prev.progress) {
        return { ...prev, progress: { ...prev.progress, cancelled: true } };
      }
      return prev;
    });
    
    const operationId = generateOperationId();
    const operation: OperationState = {
      type: "restoreChapterProgress",
      id: operationId,
      bookId,
      chapterId,
      timestamp: Date.now(),
      cancelled: false,
    };
    
    setLocks(prev => {
      const updated = { ...prev, progress: operation };
      locksRef.current = updated;
      return updated;
    });
    setLoading(prev => ({ ...prev, chapterRestoring: true }));
    
    try {
      // Check current state, not closure value
      if (locksRef.current.progress?.id !== operationId || locksRef.current.progress?.cancelled) return;
      await onChapterProgressRestore(bookId, chapterId, withAutoScroll);
      if (locksRef.current.progress?.id !== operationId || locksRef.current.progress?.cancelled) return;
      logger.log("[Reader Coordinator] Chapter progress restore completed", { bookId, chapterId });
    } catch (error) {
      const currentOp = locksRef.current.progress;
      if (currentOp?.id !== operationId || !currentOp?.cancelled) {
        logger.error("[Reader Coordinator] Chapter progress restore failed", { bookId, chapterId, error });
        throw error;
      }
    } finally {
      setLocks(prev => {
        if (prev.progress?.id === operationId) {
          const updated = { ...prev, progress: null };
          locksRef.current = updated;
          return updated;
        }
        return prev;
      });
      setLoading(prev => ({ ...prev, chapterRestoring: false }));
    }
  }, [onChapterProgressRestore, generateOperationId]);
  
  const saveChapter = useCallback(async (
    bookId: string,
    chapterId: string
  ): Promise<void> => {
    if (!onChapterSave) {
      logger.warn("[Reader Coordinator] onChapterSave handler not provided");
      return;
    }
    
    const operationId = generateOperationId();
    const operation: OperationState = {
      type: "saveChapter",
      id: operationId,
      bookId,
      chapterId,
      timestamp: Date.now(),
      cancelled: false,
    };
    
    // Don't cancel existing chapter operation for saves - they can run in parallel
    // But we still track them
    setLoading(prev => ({ ...prev, chapterSaving: true }));
    
    try {
      if (operation.cancelled) return;
      await onChapterSave(bookId, chapterId);
      if (operation.cancelled) return;
      logger.log("[Reader Coordinator] Chapter save completed", { bookId, chapterId });
    } catch (error) {
      if (!operation.cancelled) {
        logger.error("[Reader Coordinator] Chapter save failed", { bookId, chapterId, error });
        throw error;
      }
    } finally {
      setLoading(prev => ({ ...prev, chapterSaving: false }));
    }
  }, [onChapterSave, generateOperationId]);
  
  const saveChapterProgress = useCallback(async (
    bookId: string,
    chapterId: string,
    snapshot: ChapterProgressSnapshot
  ): Promise<void> => {
    if (!onChapterProgressSave) {
      logger.warn("[Reader Coordinator] onChapterProgressSave handler not provided");
      return;
    }
    
    const operationId = generateOperationId();
    const operation: OperationState = {
      type: "saveChapterProgress",
      id: operationId,
      bookId,
      chapterId,
      timestamp: Date.now(),
      cancelled: false,
    };
    
    // Cancel any existing progress save
    setLocks(prev => {
      if (prev.progress?.type === "saveChapterProgress") {
        return { ...prev, progress: { ...prev.progress, cancelled: true } };
      }
      return prev;
    });
    
    setLocks(prev => ({ ...prev, progress: operation }));
    setLoading(prev => ({ ...prev, chapterSaving: true }));
    
    try {
      if (operation.cancelled) return;
      await onChapterProgressSave(bookId, chapterId, snapshot);
      if (operation.cancelled) return;
      logger.log("[Reader Coordinator] Chapter progress save completed", { bookId, chapterId });
    } catch (error) {
      if (!operation.cancelled) {
        logger.error("[Reader Coordinator] Chapter progress save failed", { bookId, chapterId, error });
        throw error;
      }
    } finally {
      setLocks(prev => {
        if (prev.progress?.id === operationId) {
          return { ...prev, progress: null };
        }
        return prev;
      });
      setLoading(prev => ({ ...prev, chapterSaving: false }));
    }
  }, [onChapterProgressSave, generateOperationId]);
  
  // Audio track operations
  const loadAudioTrack = useCallback(async (
    bookId: string,
    trackId: string
  ): Promise<string | null> => {
    if (!onAudioTrackLoad) {
      logger.warn("[Reader Coordinator] onAudioTrackLoad handler not provided");
      return null;
    }
    
    const operationId = generateOperationId();
    const operation: OperationState = {
      type: "loadAudioTrack",
      id: operationId,
      bookId,
      trackId,
      timestamp: Date.now(),
      cancelled: false,
    };
    
    // Don't cancel existing audio operation - multiple tracks can load in parallel
    setLoading(prev => ({ ...prev, audioLoading: true }));
    
    try {
      if (operation.cancelled) return null;
      const url = await onAudioTrackLoad(bookId, trackId);
      if (operation.cancelled) return null;
      logger.log("[Reader Coordinator] Audio track load completed", { bookId, trackId });
      return url;
    } catch (error) {
      if (!operation.cancelled) {
        logger.error("[Reader Coordinator] Audio track load failed", { bookId, trackId, error });
        throw error;
      }
      return null;
    } finally {
      setLoading(prev => ({ ...prev, audioLoading: false }));
    }
  }, [onAudioTrackLoad, generateOperationId]);
  
  const restoreAudioTimestamp = useCallback(async (
    bookId: string,
    trackId: string,
    timestamp: number
  ): Promise<void> => {
    if (!onAudioTimestampRestore) {
      logger.warn("[Reader Coordinator] onAudioTimestampRestore handler not provided");
      return;
    }
    
    // Cancel any existing audio operation
    setLocks(prev => {
      if (prev.audio) {
        return { ...prev, audio: { ...prev.audio, cancelled: true } };
      }
      return prev;
    });
    
    const operationId = generateOperationId();
    const operation: OperationState = {
      type: "restoreAudioTimestamp",
      id: operationId,
      bookId,
      trackId,
      timestamp: Date.now(),
      cancelled: false,
    };
    
    setLocks(prev => ({ ...prev, audio: operation }));
    setLoading(prev => ({ ...prev, audioRestoring: true }));
    
    try {
      if (operation.cancelled) return;
      await onAudioTimestampRestore(bookId, trackId, timestamp);
      if (operation.cancelled) return;
      logger.log("[Reader Coordinator] Audio timestamp restore completed", { bookId, trackId, timestamp });
    } catch (error) {
      if (!operation.cancelled) {
        logger.error("[Reader Coordinator] Audio timestamp restore failed", { bookId, trackId, error });
        throw error;
      }
    } finally {
      setLocks(prev => {
        if (prev.audio?.id === operationId) {
          return { ...prev, audio: null };
        }
        return prev;
      });
      setLoading(prev => ({ ...prev, audioRestoring: false }));
    }
  }, [onAudioTimestampRestore, generateOperationId]);
  
  const saveAudioTrack = useCallback(async (
    bookId: string,
    trackId: string
  ): Promise<void> => {
    if (!onAudioTrackSave) {
      logger.warn("[Reader Coordinator] onAudioTrackSave handler not provided");
      return;
    }
    
    const operationId = generateOperationId();
    const operation: OperationState = {
      type: "saveAudioTrack",
      id: operationId,
      bookId,
      trackId,
      timestamp: Date.now(),
      cancelled: false,
    };
    
    setLoading(prev => ({ ...prev, audioSaving: true }));
    
    try {
      if (operation.cancelled) return;
      await onAudioTrackSave(bookId, trackId);
      if (operation.cancelled) return;
      logger.log("[Reader Coordinator] Audio track save completed", { bookId, trackId });
    } catch (error) {
      if (!operation.cancelled) {
        logger.error("[Reader Coordinator] Audio track save failed", { bookId, trackId, error });
        throw error;
      }
    } finally {
      setLoading(prev => ({ ...prev, audioSaving: false }));
    }
  }, [onAudioTrackSave, generateOperationId]);
  
  const saveAudioTimestamp = useCallback(async (
    bookId: string,
    trackId: string,
    timestamp: number
  ): Promise<void> => {
    if (!onAudioTimestampSave) {
      logger.warn("[Reader Coordinator] onAudioTimestampSave handler not provided");
      return;
    }
    
    const operationId = generateOperationId();
    const operation: OperationState = {
      type: "saveAudioTimestamp",
      id: operationId,
      bookId,
      trackId,
      timestamp: Date.now(),
      cancelled: false,
    };
    
    // Don't cancel existing saves - they can be batched
    setLoading(prev => ({ ...prev, audioSaving: true }));
    
    try {
      if (operation.cancelled) return;
      await onAudioTimestampSave(bookId, trackId, timestamp);
      if (operation.cancelled) return;
      logger.log("[Reader Coordinator] Audio timestamp save completed", { bookId, trackId, timestamp });
    } catch (error) {
      if (!operation.cancelled) {
        logger.error("[Reader Coordinator] Audio timestamp save failed", { bookId, trackId, error });
        throw error;
      }
    } finally {
      setLoading(prev => ({ ...prev, audioSaving: false }));
    }
  }, [onAudioTimestampSave, generateOperationId]);
  
  const changeAudioTrack = useCallback(async (
    bookId: string,
    trackId: string,
    direction?: "next" | "previous" | "random"
  ): Promise<void> => {
    if (!onAudioTrackChange) {
      logger.warn("[Reader Coordinator] onAudioTrackChange handler not provided");
      return;
    }
    
    // Cancel any existing audio operation
    setLocks(prev => {
      if (prev.audio) {
        logger.log("[Reader Coordinator] Cancelling previous audio operation", {
          previousId: prev.audio.id,
          previousType: prev.audio.type,
        });
        return { ...prev, audio: { ...prev.audio, cancelled: true } };
      }
      return prev;
    });
    
    const operationId = generateOperationId();
    const operation: OperationState = {
      type: "changeAudioTrack",
      id: operationId,
      bookId,
      trackId,
      timestamp: Date.now(),
      cancelled: false,
    };
    
    setLocks(prev => {
      const updated = { ...prev, audio: operation };
      locksRef.current = updated;
      return updated;
    });
    setLoading(prev => ({ ...prev, trackChanging: true }));
    
    try {
      // Check current state, not closure value
      if (locksRef.current.audio?.id !== operationId || locksRef.current.audio?.cancelled) {
        logger.log("[Reader Coordinator] Operation cancelled before execution", { operationId });
        return;
      }
      
      await onAudioTrackChange(bookId, trackId, direction);
      
      if (locksRef.current.audio?.id !== operationId || locksRef.current.audio?.cancelled) {
        logger.log("[Reader Coordinator] Operation cancelled during execution", { operationId });
        return;
      }
      
      logger.log("[Reader Coordinator] Audio track change completed", { bookId, trackId, direction });
    } catch (error) {
      const currentOp = locksRef.current.audio;
      if (currentOp?.id !== operationId || !currentOp?.cancelled) {
        logger.error("[Reader Coordinator] Audio track change failed", { bookId, trackId, error });
        throw error;
      }
    } finally {
      setLocks(prev => {
        if (prev.audio?.id === operationId) {
          const updated = { ...prev, audio: null };
          locksRef.current = updated;
          return updated;
        }
        return prev;
      });
      setLoading(prev => ({ ...prev, trackChanging: false }));
    }
  }, [onAudioTrackChange, generateOperationId]);
  
  // Memoize context value
  const contextValue = useMemo<ReaderCoordinatorContextValue>(
    () => ({
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
    }),
    [
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
    ],
  );
  
  return (
    <ReaderCoordinatorContext.Provider value={contextValue}>
      {children}
    </ReaderCoordinatorContext.Provider>
  );
}

export function useReaderCoordinator(): ReaderCoordinatorContextValue {
  const context = useContext(ReaderCoordinatorContext);
  if (!context) {
    throw new Error("useReaderCoordinator must be used within a ReaderCoordinatorProvider");
  }
  return context;
}

