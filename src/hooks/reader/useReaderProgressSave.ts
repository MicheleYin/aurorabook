/**
 * Hook for managing progress saving logic
 * Extracted from ReaderWrapper for better composition
 */

import { useCallback, useRef, useEffect } from "react";
import { logger } from "../../lib/logger";
import { useAppDispatch } from "../../store/hooks";
import { flushProgressUpdate } from "../../store/thunks/libraryThunks";

type UseReaderProgressSaveParams = {
  activeBookId?: string;
  activeChapterId?: string;
  readerManager: {
    emitChapterProgress: () => void;
    saveProgress: (chapterId: string) => Promise<void>;
  };
};

/**
 * Hook that handles progress saving with proper cleanup on unmount
 */
export function useReaderProgressSave({
  activeBookId,
  activeChapterId,
  readerManager,
}: UseReaderProgressSaveParams) {
  const dispatch = useAppDispatch();
  const dispatchRef = useRef(dispatch);
  const readerManagerRef = useRef(readerManager);
  const savePromiseRef = useRef<Promise<void> | null>(null);
  const activeChapterIdRef = useRef<string | undefined>(activeChapterId);
  const activeBookIdRef = useRef<string | undefined>(activeBookId);

  // Update dispatch ref
  dispatchRef.current = dispatch;

  // Update refs when values change
  readerManagerRef.current = readerManager;
  useEffect(() => {
    if (activeChapterIdRef.current !== activeChapterId || activeBookIdRef.current !== activeBookId) {
      logger.log("[useReaderProgressSave] Chapter or book changed, resetting save state", {
        previousChapterId: activeChapterIdRef.current,
        newChapterId: activeChapterId,
        previousBookId: activeBookIdRef.current,
        newBookId: activeBookId,
      });
      activeChapterIdRef.current = activeChapterId;
      activeBookIdRef.current = activeBookId;
      savePromiseRef.current = null;
    }
  }, [activeChapterId, activeBookId]);

  const performSave = useCallback(async (bookId: string, chapterId: string) => {
    if (savePromiseRef.current) {
      logger.log("[useReaderProgressSave] Save already in progress, waiting for completion", {
        bookId,
        chapterId,
      });
      try {
        await savePromiseRef.current;
        logger.log("[useReaderProgressSave] Previous save completed", { bookId, chapterId });
      } catch (error) {
        logger.warn("[useReaderProgressSave] Previous save failed, continuing with new save", {
          bookId,
          chapterId,
          error,
        });
      }
    }

    logger.log("[useReaderProgressSave] Starting progress save", {
      bookId,
      chapterId,
    });

    try {
      readerManagerRef.current.emitChapterProgress();
      logger.log("[useReaderProgressSave] Emitted current progress before save", { bookId, chapterId });
    } catch (error) {
      logger.warn("[useReaderProgressSave] Failed to emit progress before save", { bookId, chapterId, error });
    }

    const savePromise = readerManagerRef.current
      .saveProgress(chapterId)
      .then(() => {
        logger.log("[useReaderProgressSave] Progress saved via readerManager", { bookId, chapterId });
        savePromiseRef.current = null;
      })
      .catch((error) => {
        logger.error("[useReaderProgressSave] Failed to save or flush progress", {
          bookId,
          chapterId,
          error,
        });
        savePromiseRef.current = null;
        throw error;
      });

    savePromiseRef.current = savePromise;

    // Flush to backend
    try {
      await dispatch(flushProgressUpdate({ bookId })).unwrap();
      logger.log("[useReaderProgressSave] Progress flushed to backend", { bookId, chapterId });
    } catch (error) {
      logger.error("[useReaderProgressSave] Failed to flush progress to backend", {
        bookId,
        chapterId,
        error,
      });
      // Don't throw - save was successful, just backend sync failed
    }

    return savePromise;
  }, [dispatch]);

  // Save progress on unmount
  // Use empty dependency array - we use refs to access current values
  useEffect(() => {
    return () => {
      const bookId = activeBookIdRef.current;
      const chapterId = activeChapterIdRef.current;
      const readerManager = readerManagerRef.current;

      // Only save if we have valid IDs
      if (chapterId && bookId) {
        // If save is already in progress, wait for it (but don't block unmount)
        if (savePromiseRef.current) {
          logger.log("[useReaderProgressSave] Save already in progress, will complete asynchronously", {
            bookId,
            chapterId,
          });
          // Don't await - let it complete in background
          savePromiseRef.current.catch((error) => {
            logger.error("[useReaderProgressSave] Background save failed", {
              bookId,
              chapterId,
              error,
            });
          });
        } else {
          // Start new save (fire and forget - can't await in cleanup)
          logger.log("[useReaderProgressSave] Starting progress save on unmount", {
            bookId,
            chapterId,
          });
          // Call performSave directly using refs to avoid dependency issues
          const performSaveDirectly = async (bId: string, cId: string) => {
            try {
              readerManager.emitChapterProgress();
              await readerManager.saveProgress(cId);
              await dispatchRef.current(flushProgressUpdate({ bookId: bId })).unwrap();
            } catch (error) {
              logger.error("[useReaderProgressSave] Unmount save failed", {
                bookId: bId,
                chapterId: cId,
                error,
              });
            }
          };
          performSaveDirectly(bookId, chapterId).catch((error) => {
            logger.error("[useReaderProgressSave] Unmount save failed", {
              bookId,
              chapterId,
              error,
            });
          });
        }
      } else {
        logger.log("[useReaderProgressSave] Skipping progress save on unmount - missing IDs", {
          hasChapterId: !!chapterId,
          hasBookId: !!bookId,
        });
      }
    };
    // Empty dependency array - we use refs to access current values
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { performSave };
}

