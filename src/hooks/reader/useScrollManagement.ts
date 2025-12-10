/**
 * Unified hook for scroll management
 * Combines scroll operations, scroll tracking, and progress restoration
 * No useEffects - all operations are explicit via callbacks
 * 
 * Uses library context as single source of truth for book/chapter data
 */

import { useCallback, useRef, useState } from "react";
import { logger } from "../../lib/logger";
import { useLibraryContext } from "../library/LibraryContext";
import { computeScrollMetrics, computeWindowScrollMetrics, scrollToElement, type ScrollMetrics } from "../../lib/scroll-utils";

type RestoreState = {
  hasRestored: boolean;
  isRestoring: boolean;
  restoredChapterId: string | null;
  shouldRestore: boolean;
};

export function useScrollManagement(
  contentRef: React.RefObject<HTMLDivElement | null>,
  updateScrollState?: (chapterId: string, metrics: ScrollMetrics) => void
) {
  const { library } = useLibraryContext();
  // Scroll tracking state
  const [isScrolling, setIsScrolling] = useState(false);
  const scrollTimeoutRef = useRef<number | null>(null);

  // Store updateScrollState in a ref so it can be updated after hook creation
  const updateScrollStateRef = useRef(updateScrollState);
  updateScrollStateRef.current = updateScrollState;

  // Progress restoration state
  const restoreStateRef = useRef<RestoreState>({
    hasRestored: false,
    isRestoring: false,
    restoredChapterId: null,
    shouldRestore: false,
  });

  // Scroll operations
  const scrollToTop = useCallback(() => {
    const node = contentRef.current;
    if (!node) return;

    const containerMetrics = computeScrollMetrics(node);
    const windowMetrics = computeWindowScrollMetrics();
    
    const useContainer = containerMetrics && containerMetrics.maxScroll > 0;
    const useWindow = !useContainer && windowMetrics && windowMetrics.maxScroll > 0;

    if (useContainer) {
      node.scrollTo({ top: 0, behavior: "smooth" });
    } else if (useWindow) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [contentRef]);

  const scrollToBottom = useCallback(() => {
    const node = contentRef.current;
    if (!node) return;

    const containerMetrics = computeScrollMetrics(node);
    const windowMetrics = computeWindowScrollMetrics();
    
    const useContainer = containerMetrics && containerMetrics.maxScroll > 0;
    const useWindow = !useContainer && windowMetrics && windowMetrics.maxScroll > 0;

    if (useContainer && containerMetrics) {
      node.scrollTo({ top: containerMetrics.maxScroll, behavior: "smooth" });
    } else if (useWindow && windowMetrics) {
      window.scrollTo({ top: windowMetrics.maxScroll, behavior: "smooth" });
    }
  }, [contentRef]);

  const scrollToElementId = useCallback((elementId: string, behavior: "smooth" | "auto" = "smooth") => {
    const node = contentRef.current;
    if (!node) return;
    scrollToElement(node, elementId, behavior);
  }, [contentRef]);

  // Scroll tracking
  const handleScroll = useCallback(() => {
    setIsScrolling(true);
    
    if (scrollTimeoutRef.current !== null) {
      clearTimeout(scrollTimeoutRef.current);
    }
    
    scrollTimeoutRef.current = window.setTimeout(() => {
      setIsScrolling(false);
      scrollTimeoutRef.current = null;
    }, 200);
  }, []);

  // Progress restoration - gets book/chapter from library context (single source of truth)
  const restoreProgress = useCallback((
    bookId: string,
    chapterId: string,
    onComplete?: () => void
  ) => {
    // Get book from library context (single source of truth)
    const book = library.find(b => b.id === bookId);
    if (!book) {
      logger.warn("[useScrollManagement] Early return: book not found in library", { bookId });
      return;
    }

    const chapter = book.chapters.find(ch => ch.id === chapterId);
    if (!chapter) {
      logger.warn("[useScrollManagement] Early return: chapter not found", { bookId, chapterId });
      return;
    }

    logger.log("[useScrollManagement] restoreProgress called", {
      hasProgress: !!book.progress,
      chapterId: chapter.id,
      hasRestored: restoreStateRef.current.hasRestored,
      shouldRestore: restoreStateRef.current.shouldRestore,
      restoredChapterId: restoreStateRef.current.restoredChapterId,
      currentChapterId: book.progress?.currentChapterId,
    });
    
    if (!book.progress) {
      logger.warn("[useScrollManagement] Early return: no progress", {
        hasProgress: !!book.progress,
      });
      return;
    }
    if (restoreStateRef.current.hasRestored) {
      logger.warn("[useScrollManagement] Early return: already restored", {
        restoredChapterId: restoreStateRef.current.restoredChapterId,
        currentChapterId: chapter.id,
      });
      return;
    }
    if (!restoreStateRef.current.shouldRestore) {
      logger.warn("[useScrollManagement] Early return: shouldRestore is false");
      return;
    }

    const progress = book.progress;
    if (progress.currentChapterId !== chapter.id) {
      logger.warn("[useScrollManagement] Early return: chapter ID mismatch", {
        progressChapterId: progress.currentChapterId,
        chapterId: chapter.id,
      });
      return;
    }

    logger.log("[useScrollManagement] Starting restoration", {
      chapterId: chapter.id,
      scrollTop: progress.currentChapterScrollTop,
      scrollPercent: progress.chapterProgressPercent,
    });

    restoreStateRef.current.isRestoring = true;

    let attempts = 0;
    const maxAttempts = 40; // 40 * 50ms = 2 seconds max wait

    const attemptRestore = () => {
      attempts++;
      const node = contentRef.current;
      if (!node) {
        if (attempts < maxAttempts) {
          if (attempts === 1 || attempts % 10 === 0) {
            logger.log("[useScrollManagement] Waiting for contentRef", { attempts });
          }
          setTimeout(attemptRestore, 50);
        } else {
          console.error("[useScrollManagement] Max attempts reached, contentRef not found");
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
            logger.log("[useScrollManagement] Waiting for scroll metrics", {
              attempts,
              containerMaxScroll: containerMetrics?.maxScroll,
              windowMaxScroll: windowMetrics?.maxScroll,
            });
          }
          setTimeout(attemptRestore, 50);
        } else {
          console.error("[useScrollManagement] Max attempts reached, no scroll metrics", {
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

      logger.log("[useScrollManagement] ✓ Restoring scroll position", {
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
        logger.log("[useScrollManagement] Set container scrollTop", {
          scrollTop: node.scrollTop,
          targetScrollTop,
        });
      } else if (useWindow && targetScrollTop > 0) {
        window.scrollTo({ top: targetScrollTop, behavior: "auto" });
        logger.log("[useScrollManagement] Set window scroll", {
          targetScrollTop,
        });
      } else {
        logger.warn("[useScrollManagement] No scroll action taken", {
          useContainer,
          useWindow,
          targetScrollTop,
        });
      }

      // Update scroll state in useChapterProgress to keep them in sync
      // Use the metrics we have, but update scrollTop to the restored position
      if (updateScrollStateRef.current && metrics && targetScrollTop > 0) {
        const restoredMetrics: ScrollMetrics = {
          ...metrics,
          scrollTop: targetScrollTop,
        };
        
        updateScrollStateRef.current(chapter.id, restoredMetrics);
        logger.log("[useScrollManagement] Updated scroll state in useChapterProgress", {
          chapterId: chapter.id,
          scrollTop: restoredMetrics.scrollTop,
          maxScroll: restoredMetrics.maxScroll,
        });
      }

      restoreStateRef.current.hasRestored = true;
      restoreStateRef.current.isRestoring = false;
      restoreStateRef.current.restoredChapterId = chapter.id;
      onComplete?.();
    };

    setTimeout(attemptRestore, 100);
  }, [contentRef, library]);

  const resetRestoration = useCallback((shouldRestore: boolean = false) => {
    restoreStateRef.current.hasRestored = false;
    restoreStateRef.current.isRestoring = false;
    restoreStateRef.current.restoredChapterId = null;
    restoreStateRef.current.shouldRestore = shouldRestore;
  }, []);

  const markRestored = useCallback((chapterId: string) => {
    restoreStateRef.current.hasRestored = true;
    restoreStateRef.current.isRestoring = false;
    restoreStateRef.current.restoredChapterId = chapterId;
  }, []);

  const getRestoreState = useCallback(() => restoreStateRef.current, []);

  return {
    // Scroll operations
    scrollToTop,
    scrollToBottom,
    scrollToElementId,
    
    // Scroll tracking
    isScrolling,
    scrollHandler: handleScroll,
    
    // Progress restoration
    restoreProgress,
    resetRestoration,
    markRestored,
    getRestoreState,
  };
}
