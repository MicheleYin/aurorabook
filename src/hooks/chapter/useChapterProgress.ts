/**
 * Hook for managing chapter progress-related logic
 * Handles progress saving, chapter changes, and scroll updates
 */

import { useCallback, useMemo, useState, useRef } from "react";
import type { Book, Chapter } from "../../types/reader";
import type { ChapterProgressSnapshot } from "../../components/reader/types";
import { useChapterLoader } from "./useChapterLoader";
import { logger } from "../../lib/logger";
import { useReaderCoordinator } from "../../contexts/ReaderCoordinatorContext";
import { computeScrollMetrics, computeWindowScrollMetrics, scrollToElement, type ScrollMetrics, type ScrollMetricsWithSegments } from "../../lib/scroll-utils";
import { createProgressSnapshot } from "../../lib/progress-utils";

type ElementIndexHook = {
  hasElement: (elementId: string) => boolean;
  getElementInfo: (elementId: string) => { elementId: string; approximateScrollTop: number; segmentIndex?: number } | undefined;
  getScrollPositionEstimate: (elementId: string) => number | undefined;
  getSegmentIndex: (elementId: string) => number | undefined;
};

type VirtualizedHandle = {
  getCurrentVisibleSegmentIndex: () => number | undefined;
  getTotalSegments: () => number;
  scrollToSegmentIndex: (segmentIndex: number, behavior?: "smooth" | "auto") => void;
};

type ElementWithVirtualizedHandle = HTMLElement & {
  __virtualizedHandle?: VirtualizedHandle;
};

type UseChapterProgressParams = {
  activeBook?: Book;
  activeChapter?: Chapter;
  contentRef: React.RefObject<HTMLDivElement | null>;
  onSaveProgress: (chapterId: string) => Promise<void>;
  onCloseChapter?: () => void;
  chromeVisible?: boolean;
  onChapterChange?: (chapterId: string, elementId?: string) => void;
  onChapterReload?: (chapterId: string) => void;
  elementIndex?: ElementIndexHook;
  isRestoringScroll?: boolean;
};

/**
 * Find virtualized handle on container or its children
 */
function findVirtualizedHandle(container: HTMLElement | null): VirtualizedHandle | undefined {
  if (!container) return undefined;
  
  let handle = (container as ElementWithVirtualizedHandle)?.__virtualizedHandle;
  
  if (!handle) {
    const virtualizedContentElement = container.querySelector('[data-reader-chapter-content]')?.parentElement as ElementWithVirtualizedHandle | null;
    handle = virtualizedContentElement?.__virtualizedHandle;
  }
  
  return handle;
}

export function useChapterProgress({
  activeBook,
  activeChapter,
  contentRef,
  onSaveProgress,
  onCloseChapter,
  chromeVisible: _chromeVisible = true,
  onChapterChange: _onChapterChange,
  onChapterReload: _onChapterReload,
  elementIndex: _elementIndex,
  isRestoringScroll: _isRestoringScroll = false,
}: UseChapterProgressParams) {
  const coordinator = useReaderCoordinator();
  const chapterLoader = useChapterLoader();
  
  // Get cached chapters
  const cachedChapters = useMemo(() => {
    if (!activeBook) return [];
    
    return activeBook.chapters.map(chapter => {
      const cached = chapterLoader.loadedChapters.get(chapter.id);
      return cached || chapter;
    });
  }, [activeBook, chapterLoader.loadedChapters]);

  // Get current scroll metrics (supports virtualized content)
  const getCurrentScrollMetrics = useCallback((): ScrollMetricsWithSegments => {
    if (!contentRef) return computeWindowScrollMetrics();
    const containerElement = contentRef.current ?? null;
    const virtualizedHandle = findVirtualizedHandle(containerElement);
    
    if (virtualizedHandle && typeof virtualizedHandle.getCurrentVisibleSegmentIndex === 'function') {
      const segmentIndex = virtualizedHandle.getCurrentVisibleSegmentIndex();
      const totalSegments = virtualizedHandle.getTotalSegments();
      
      if (totalSegments > 0) {
        let effectiveSegmentIndex = segmentIndex;
        
        // Fallback: calculate from scroll position if segment index not available
        if (effectiveSegmentIndex === undefined && containerElement) {
          const actualScrollTop = containerElement.scrollTop || window.scrollY;
          const actualScrollHeight = containerElement.scrollHeight || document.documentElement.scrollHeight;
          
          if (actualScrollHeight > 0) {
            const scrollPercent = actualScrollTop / (actualScrollHeight - (containerElement.clientHeight || window.innerHeight));
            effectiveSegmentIndex = Math.floor(scrollPercent * totalSegments);
            effectiveSegmentIndex = Math.max(0, Math.min(effectiveSegmentIndex, totalSegments - 1));
          }
        }
        
        if (effectiveSegmentIndex !== undefined && effectiveSegmentIndex >= 0) {
          const percent = effectiveSegmentIndex / totalSegments;
          const estimatedScrollHeight = totalSegments * 50; // ESTIMATED_SEGMENT_HEIGHT
          const estimatedScrollTop = percent * estimatedScrollHeight;
          const estimatedClientHeight = containerElement?.clientHeight || window.innerHeight;
          
          return {
            scrollTop: estimatedScrollTop,
            scrollHeight: estimatedScrollHeight,
            clientHeight: estimatedClientHeight,
            maxScroll: estimatedScrollHeight - estimatedClientHeight,
            segmentIndex: effectiveSegmentIndex,
            totalSegments,
          };
        }
      }
    }
    
    // Non-virtualized content: use actual scroll metrics
    if (containerElement) {
      const containerMetrics = computeScrollMetrics(containerElement);
      if (containerMetrics && containerMetrics.maxScroll > 0) {
        return containerMetrics;
      }
    }
    
    return computeWindowScrollMetrics();
  }, [contentRef]);

  // Get current progress snapshot
  const getCurrentProgressSnapshot = useCallback((): ChapterProgressSnapshot | null => {
    if (!activeChapter) return null;

    const metrics = getCurrentScrollMetrics();
    
    // Extract segment info if available (virtualized content)
    const segmentIndex = metrics.segmentIndex;
    const totalSegments = metrics.totalSegments;
    
    return createProgressSnapshot(
      activeChapter.id,
      metrics,
      segmentIndex,
      totalSegments
    );
  }, [activeChapter, getCurrentScrollMetrics]);

  // Handle chapter progress updates
  const handleChapterProgress = useCallback((snapshot: ChapterProgressSnapshot) => {
    logger.log("[Chapter Progress] handleChapterProgress called", {
      hasActiveBook: !!activeBook,
      chapterId: snapshot.chapterId,
      scrollTop: snapshot.scrollTop,
      percent: snapshot.percent,
      hasActiveChapter: !!activeChapter,
    });
    
    // Progress is handled by the coordinator
    if (activeBook && snapshot.chapterId) {
      // Progress will be saved via coordinator
      logger.log("[Chapter Progress] Progress update", {
        chapterId: snapshot.chapterId,
        scrollTop: snapshot.scrollTop,
        percent: snapshot.percent,
      });
    }
  }, [activeBook, activeChapter]);

  // Handle chapter change - SINGLE HANDLER that coordinates everything
  // NOTE: Progress is NOT saved on chapter change - only saved when quitting reader
  const handleChapterChange = useCallback(async (chapterId: string) => {
    if (!activeBook) return;

    // Find chapter by id
    const chapter = activeBook.chapters.find(ch => ch.id === chapterId);
    if (!chapter) return;

    // Use coordinator to change chapter
    // This ensures proper coordination and cancellation
    await coordinator.changeChapter(activeBook.id, chapterId);

    // IMPORTANT: Mark chapter change FIRST (synchronously) before any async operations
    // This prevents progress updates from interfering during chapter change

    // NOTE: Progress is NOT saved here - only saved when quitting reader
  }, [activeBook, coordinator]);

  // Handle chapter close
  const handleChapterClose = useCallback(async () => {
    if (activeChapter) {
      await onSaveProgress(activeChapter.id);
    }
    onCloseChapter?.();
  }, [activeChapter, onSaveProgress, onCloseChapter]);

  // Scroll operations
  const scrollToTop = useCallback(() => {
    if (!contentRef) return;
    const node = contentRef.current;
    if (!node) return;

    const virtualizedHandle = findVirtualizedHandle(node);
    
    if (virtualizedHandle?.scrollToSegmentIndex) {
      virtualizedHandle.scrollToSegmentIndex(0, "smooth");
      return;
    }

    const containerMetrics = computeScrollMetrics(node);
    const windowMetrics = computeWindowScrollMetrics();
    
    if (containerMetrics && containerMetrics.maxScroll > 0) {
      node.scrollTo({ top: 0, behavior: "smooth" });
    } else if (windowMetrics && windowMetrics.maxScroll > 0) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [contentRef]);

  const scrollToBottom = useCallback(() => {
    if (!contentRef) return;
    const node = contentRef.current;
    if (!node) return;

    const virtualizedHandle = findVirtualizedHandle(node);
    
    if (virtualizedHandle?.scrollToSegmentIndex && virtualizedHandle.getTotalSegments) {
      const totalSegments = virtualizedHandle.getTotalSegments();
      if (totalSegments > 0) {
        virtualizedHandle.scrollToSegmentIndex(totalSegments - 1, "smooth");
        return;
      }
    }

    const containerMetrics = computeScrollMetrics(node);
    const windowMetrics = computeWindowScrollMetrics();
    
    if (containerMetrics && containerMetrics.maxScroll > 0) {
      node.scrollTo({ top: containerMetrics.maxScroll, behavior: "smooth" });
    } else if (windowMetrics && windowMetrics.maxScroll > 0) {
      window.scrollTo({ top: windowMetrics.maxScroll, behavior: "smooth" });
    }
  }, [contentRef]);

  const scrollToElementId = useCallback((elementId: string, behavior: "smooth" | "auto" = "smooth") => {
    scrollToElement(elementId, behavior);
  }, []);

  // Scroll state management
  const [isScrolling, setIsScrolling] = useState(false);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleScroll = useCallback(() => {
    setIsScrolling(true);
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }
    scrollTimeoutRef.current = setTimeout(() => {
      setIsScrolling(false);
    }, 150);
  }, []);

  const handleScrollEnd = useCallback(() => {
    setIsScrolling(false);
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = null;
    }
  }, []);

  // Progress saving
  const saveProgressAsync = useCallback(async (chapterId: string) => {
    if (onSaveProgress) {
      await onSaveProgress(chapterId);
    }
  }, [onSaveProgress]);

  // Emit progress
  const emitProgress = useCallback(() => {
    const snapshot = getCurrentProgressSnapshot();
    if (snapshot) {
      handleChapterProgress(snapshot);
    }
  }, [getCurrentProgressSnapshot, handleChapterProgress]);

  // Update metrics on scroll
  const updateMetricsOnScroll = useCallback(() => {
    // Metrics are computed on-demand via getCurrentScrollMetrics
    // This is a no-op for now, but can be used to trigger updates if needed
  }, []);

  // Progress restoration
  const restoreProgress = useCallback(async (
    _bookId: string,
    _chapterId: string,
    callback?: () => void
  ) => {
    // Restoration is handled by coordinator
    // This is a placeholder for the interface
    if (callback) {
      callback();
    }
  }, []);

  const getRestoreState = useCallback(() => {
    return {
      isRestoring: false,
      restoreScrollTop: null as number | null,
      restoreElementIndex: null as number | null,
    };
  }, []);

  const resetRestoration = useCallback(() => {
    // Reset restoration state
  }, []);

  // Update scroll state (for library-level usage)
  const updateScrollState = useCallback((_chapterId: string, _metrics: ScrollMetrics) => {
    // No-op for now
  }, []);

  return {
    cachedChapters,
    handleChapterProgress,
    handleChapterChange,
    handleChapterClose,
    getCurrentProgressSnapshot,
    scrollToTop,
    scrollToBottom,
    scrollToElementId,
    getCurrentScrollMetrics,
    // Additional methods for useReaderManager
    isScrolling,
    handleScroll,
    handleScrollEnd,
    saveProgressAsync,
    emitProgress,
    updateMetricsOnScroll,
    restoreProgress,
    getRestoreState,
    resetRestoration,
    updateScrollState,
  };
}
