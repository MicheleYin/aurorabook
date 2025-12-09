/**
 * Hook for managing progress restoration
 * No useEffects - restoration is explicit via callbacks
 */

import { useCallback, useRef } from "react";
import { logger } from "../../lib/logger";
import type { Book, Chapter } from "../../types/reader";
import { computeScrollMetrics, computeWindowScrollMetrics } from "../../lib/scroll-utils";

type RestoreState = {
  hasRestored: boolean;
  isRestoring: boolean;
  restoredChapterId: string | null;
  shouldRestore: boolean;
};

export function useProgressRestoration() {
  const stateRef = useRef<RestoreState>({
    hasRestored: false,
    isRestoring: false,
    restoredChapterId: null,
    shouldRestore: false,
  });

  const restoreProgress = useCallback((
    book: Book,
    chapter: Chapter,
    contentRef: React.RefObject<HTMLDivElement | null>,
    onComplete?: () => void
  ) => {
    logger.log("[useProgressRestoration] restoreProgress called", {
      hasProgress: !!book.progress,
      chapterId: chapter.id,
      hasRestored: stateRef.current.hasRestored,
      shouldRestore: stateRef.current.shouldRestore,
      restoredChapterId: stateRef.current.restoredChapterId,
      currentChapterId: book.progress?.currentChapterId,
    });
    
    if (!book.progress || !chapter) {
      logger.warn("[useProgressRestoration] Early return: no progress or chapter", {
        hasProgress: !!book.progress,
        hasChapter: !!chapter,
      });
      return;
    }
    if (stateRef.current.hasRestored) {
      logger.warn("[useProgressRestoration] Early return: already restored", {
        restoredChapterId: stateRef.current.restoredChapterId,
        currentChapterId: chapter.id,
      });
      return;
    }
    if (!stateRef.current.shouldRestore) {
      logger.warn("[useProgressRestoration] Early return: shouldRestore is false");
      return;
    }

    const progress = book.progress;
    if (progress.currentChapterId !== chapter.id) {
      logger.warn("[useProgressRestoration] Early return: chapter ID mismatch", {
        progressChapterId: progress.currentChapterId,
        chapterId: chapter.id,
      });
      return;
    }

    logger.log("[useProgressRestoration] Starting restoration", {
      chapterId: chapter.id,
      scrollTop: progress.currentChapterScrollTop,
      scrollPercent: progress.chapterProgressPercent,
    });

    stateRef.current.isRestoring = true;

    let attempts = 0;
    const maxAttempts = 40; // 40 * 50ms = 2 seconds max wait

    const attemptRestore = () => {
      attempts++;
      const node = contentRef.current;
      if (!node) {
        if (attempts < maxAttempts) {
          if (attempts === 1 || attempts % 10 === 0) {
            logger.log("[useProgressRestoration] Waiting for contentRef", { attempts });
          }
          setTimeout(attemptRestore, 50);
        } else {
          console.error("[useProgressRestoration] Max attempts reached, contentRef not found");
        }
        return;
      }

      const containerMetrics = computeScrollMetrics(node);
      const windowMetrics = computeWindowScrollMetrics();
      
      const useContainer = containerMetrics && containerMetrics.maxScroll > 0;
      const useWindow = !useContainer && windowMetrics && windowMetrics.maxScroll > 0;
      const metrics = useContainer ? containerMetrics : (useWindow ? windowMetrics : null);

      if (!metrics || metrics.maxScroll === 0) {
        if (attempts < maxAttempts) {
          if (attempts === 1 || attempts % 10 === 0) {
            logger.log("[useProgressRestoration] Waiting for scroll metrics", {
              attempts,
              containerMaxScroll: containerMetrics?.maxScroll,
              windowMaxScroll: windowMetrics?.maxScroll,
            });
          }
          setTimeout(attemptRestore, 50);
        } else {
          console.error("[useProgressRestoration] Max attempts reached, no scroll metrics", {
            containerMetrics,
            windowMetrics,
          });
        }
        return;
      }

      const targetScrollTop = progress.currentChapterScrollTop > 0
        ? Math.min(progress.currentChapterScrollTop, metrics.maxScroll)
        : (progress.chapterProgressPercent > 0
          ? Math.round(progress.chapterProgressPercent * metrics.maxScroll)
          : 0);

      logger.log("[useProgressRestoration] ✓ Restoring scroll position", {
        chapterId: chapter.id,
        targetScrollTop,
        maxScroll: metrics.maxScroll,
        useContainer,
        useWindow,
        savedScrollTop: progress.currentChapterScrollTop,
        savedPercent: progress.chapterProgressPercent,
        attempts,
      });

      if (useContainer && targetScrollTop > 0) {
        node.scrollTop = targetScrollTop;
        logger.log("[useProgressRestoration] Set container scrollTop", {
          scrollTop: node.scrollTop,
          targetScrollTop,
        });
      } else if (useWindow && targetScrollTop > 0) {
        window.scrollTo({ top: targetScrollTop, behavior: "auto" });
        logger.log("[useProgressRestoration] Set window scroll", {
          targetScrollTop,
        });
      } else {
        logger.warn("[useProgressRestoration] No scroll action taken", {
          useContainer,
          useWindow,
          targetScrollTop,
        });
      }

      stateRef.current.hasRestored = true;
      stateRef.current.isRestoring = false;
      stateRef.current.restoredChapterId = chapter.id;
      onComplete?.();
    };

    setTimeout(attemptRestore, 100);
  }, []);

  const reset = useCallback((shouldRestore: boolean = false) => {
    stateRef.current.hasRestored = false;
    stateRef.current.isRestoring = false;
    stateRef.current.restoredChapterId = null;
    stateRef.current.shouldRestore = shouldRestore;
  }, []);

  const markRestored = useCallback((chapterId: string) => {
    stateRef.current.hasRestored = true;
    stateRef.current.isRestoring = false;
    stateRef.current.restoredChapterId = chapterId;
  }, []);

  return {
    restoreProgress,
    reset,
    markRestored,
    getState: () => stateRef.current,
  };
}

