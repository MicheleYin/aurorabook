/**
 * Unified Reader Manager Hook
 * 
 * Consolidates all chapter-related operations into a single hook:
 * - Chapter loading
 * - Chapter progress tracking
 * - Scroll management
 * - Fragment navigation
 * - Link handling
 * - Chapter transitions
 * 
 * All operations go through ReaderCoordinator for proper coordination.
 */

import { useCallback, useRef, useState } from "react";
import { logger } from "../../lib/logger";
import type { AudioSyncMap, ReaderPreferences } from "../../types/reader";
import type { ChapterProgressSnapshot, ChapterSelectionOptions } from "../../components/reader/types";
import { findCurrentAudioSegment } from "../../lib/epub";
import { useReaderCoordinator } from "../../contexts/ReaderCoordinatorContext";
import { useLibraryContext } from "../../hooks/library/LibraryContext";
import { useChapterLoader } from "./useChapterLoader";
import { useScrollManagement } from "./useScrollManagement";
import { useFragmentNavigation } from "./useFragmentNavigation";
import { useLinkHandling } from "./useLinkHandling";
import { useChapterTransitions } from "./useChapterTransitions";
import { createProgressSnapshot } from "../../lib/progress-utils";
import { computeScrollMetrics, computeWindowScrollMetrics, type ScrollMetrics } from "../../lib/scroll-utils";

type UseReaderManagerParams = {
  activeBookId?: string;
  activeChapterId?: string;
  contentRef: React.RefObject<HTMLDivElement | null>;
  preferences: ReaderPreferences;
  onSelectChapter: (chapterId: string, options?: ChapterSelectionOptions) => void;
  onChapterProgress?: (bookId: string, snapshot: ChapterProgressSnapshot) => void;
  onSaveProgress?: (saveFn: () => void) => void;
  isRestoringScroll?: boolean;
};

export function useReaderManager(params: UseReaderManagerParams) {
  const {
    activeBookId,
    activeChapterId,
    contentRef,
    onSelectChapter,
    onChapterProgress,
  } = params;

  const coordinator = useReaderCoordinator();
  const { library } = useLibraryContext();
  
  const activeBook = activeBookId ? library.find(b => b.id === activeBookId) : undefined;
  const activeChapter = activeBook && activeChapterId 
    ? activeBook.chapters.find(ch => ch.id === activeChapterId)
    : undefined;

  // Internal state
  const [chapterAnimationState, setChapterAnimationState] = useState<"entering" | "entered" | null>(null);
  const previousChapterIdRef = useRef<string | undefined>(undefined);
  const pendingScrollToElementIdRef = useRef<string | null>(null);
  const isRestoringRef = useRef(false);

  // Sub-hooks (these will eventually be merged into this hook)
  const chapterLoader = useChapterLoader();
  
  // Progress tracking state
  const scrollStateRef = useRef<{
    chapterId: string | null;
    metrics: ScrollMetrics | null;
  }>({
    chapterId: null,
    metrics: null,
  });

  // Scroll management
  const scrollManagement = useScrollManagement(
    contentRef,
    (chapterId, metrics) => {
      if (chapterId === activeChapter?.id) {
        scrollStateRef.current.chapterId = chapterId;
        scrollStateRef.current.metrics = metrics;
      }
    }
  );

  // Update isRestoringRef
  const restoreState = scrollManagement.getRestoreState();
  isRestoringRef.current = restoreState.isRestoring;

  // Fragment navigation
  const fragmentNavigation = useFragmentNavigation(contentRef);

  // Link handling
  const linkHandling = useLinkHandling(contentRef, activeBook, onSelectChapter);

  // Chapter transitions
  const chapterTransitions = useChapterTransitions();

  // Chapter loaded callback - only set up if we have a chapter
  // Note: This callback is handled by ReaderWrapper's onChapterLoaded
  // We don't need to set it up here since ReaderWrapper manages it

  // Get current scroll metrics
  const getCurrentScrollMetrics = useCallback((): ScrollMetrics => {
    const containerElement = contentRef?.current ?? null;
    
    if (containerElement) {
      const containerMetrics = computeScrollMetrics(containerElement);
      if (containerMetrics && containerMetrics.maxScroll > 0) {
        return containerMetrics;
      }
    }
    
    return computeWindowScrollMetrics();
  }, [contentRef]);

  // Update scroll metrics on scroll
  const updateMetricsOnScroll = useCallback(() => {
    if (isRestoringRef.current) {
      return;
    }

    const metrics = getCurrentScrollMetrics();
    if (metrics && (metrics.maxScroll > 0 || metrics.scrollTop > 0)) {
      scrollStateRef.current.chapterId = activeChapter?.id || null;
      scrollStateRef.current.metrics = metrics;
    }
  }, [getCurrentScrollMetrics, activeChapter]);

  // Emit chapter progress
  const emitChapterProgress = useCallback(() => {
    if (!activeChapter || !onChapterProgress || isRestoringRef.current) {
      return;
    }

    let metrics: ScrollMetrics;
    if (
      scrollStateRef.current.chapterId === activeChapter.id &&
      scrollStateRef.current.metrics &&
      (scrollStateRef.current.metrics.maxScroll > 0 || scrollStateRef.current.metrics.scrollTop > 0)
    ) {
      metrics = scrollStateRef.current.metrics;
    } else {
      metrics = getCurrentScrollMetrics();
      if (metrics.maxScroll > 0 || metrics.scrollTop > 0) {
        scrollStateRef.current.metrics = metrics;
      }
    }

    const snapshot = createProgressSnapshot(activeChapter.id, metrics);
    if (activeBook) {
      onChapterProgress(activeBook.id, snapshot);
    }
  }, [activeChapter, activeBook, onChapterProgress, getCurrentScrollMetrics]);

  // Save progress
  const saveProgress = useCallback(async (chapterId: string) => {
    if (!activeBook || !activeChapter) return;
    
    if (chapterId !== activeChapter.id) {
      // Saving different chapter - compute metrics manually
      const metrics = getCurrentScrollMetrics();
      if (metrics && (metrics.maxScroll > 0 || metrics.scrollTop > 0)) {
        const snapshot = createProgressSnapshot(chapterId, metrics);
        await coordinator.saveChapterProgress(activeBook.id, chapterId, snapshot);
      }
    } else {
      // Saving current chapter - use tracked state
      const metrics = scrollStateRef.current.metrics || getCurrentScrollMetrics();
      if (metrics && (metrics.maxScroll > 0 || metrics.scrollTop > 0)) {
        const snapshot = createProgressSnapshot(chapterId, metrics);
        await coordinator.saveChapterProgress(activeBook.id, chapterId, snapshot);
      }
    }
  }, [activeBook, activeChapter, coordinator, getCurrentScrollMetrics]);

  // Change chapter
  const changeChapter = useCallback(async (
    chapterId: string,
    options?: ChapterSelectionOptions
  ) => {
    if (!activeBook) return;

    const chapter = activeBook.chapters.find(ch => ch.id === chapterId);
    if (!chapter) {
      logger.warn("[Reader Manager] Chapter not found", { chapterId, bookId: activeBook.id });
      return;
    }

    // Use coordinator to manage the operation
    await coordinator.changeChapter(activeBook.id, chapterId, options);

    // Check if cancelled
    const currentOp = coordinator.getCurrentOperation("changeChapter");
    if (currentOp?.cancelled) {
      logger.log("[Reader Manager] Chapter change was cancelled", { chapterId });
      return;
    }

    // Save progress for previous chapter
    if (activeChapter && activeChapter.id !== chapterId) {
      await saveProgress(activeChapter.id);
    }

    // Call parent's onSelectChapter
    onSelectChapter(chapterId, options);

    // Load chapter
    const loaded = await chapterLoader.loadChapter(activeBook.id, chapter);
    
    // Check again if cancelled
    if (coordinator.getCurrentOperation("changeChapter")?.cancelled) {
      return;
    }

    if (loaded && loaded.contentHtml) {
      previousChapterIdRef.current = chapterId;
      chapterLoader.setLoadedChapter(loaded);
      
      setChapterAnimationState("entering");
      setTimeout(() => {
        setChapterAnimationState("entered");
      }, 50);

      // Handle scroll position
      if (options?.scrollPosition === "top" || options?.isManualSelection) {
        scrollManagement.scrollToTop();
      } else if (options?.scrollPosition === "bottom") {
        scrollManagement.scrollToBottom();
      }
    }
  }, [activeBook, activeChapter, coordinator, chapterLoader, scrollManagement, onSelectChapter, saveProgress]);

  // Restore chapter progress
  const restoreChapterProgress = useCallback(async (
    bookId: string,
    chapterId: string,
    withAutoScroll?: boolean
  ) => {
    await coordinator.restoreChapterProgress(bookId, chapterId, withAutoScroll);
    
    // The actual restoration is handled by scrollManagement
    scrollManagement.restoreProgress(bookId, chapterId, () => {
      // Handle pending scroll target after restoration
      if (pendingScrollToElementIdRef.current) {
        const elementId = pendingScrollToElementIdRef.current;
        pendingScrollToElementIdRef.current = null;
        requestAnimationFrame(() => {
          scrollManagement.scrollToElementId(elementId, "smooth");
        });
      }
    });
  }, [coordinator, scrollManagement]);

  // Handle scroll events
  const handleScroll = useCallback(() => {
    scrollManagement.scrollHandler();
    updateMetricsOnScroll();
  }, [scrollManagement, updateMetricsOnScroll]);

  // Handle scroll end
  const handleScrollEnd = useCallback(() => {
    emitChapterProgress();
  }, [emitChapterProgress]);

  // Sync to audio (for audio-text sync)
  const syncToAudio = useCallback((
    trackHref: string,
    currentTimeSeconds: number,
    audioSyncMap?: AudioSyncMap
  ) => {
    if (!activeBook || !audioSyncMap) return;
    
    // Find current segment
    const segment = findCurrentAudioSegment(
      audioSyncMap,
      trackHref,
      currentTimeSeconds
    );

    if (!segment) return;

    // Find chapter
    const chapter = activeBook.chapters.find(ch => {
      const chHref = ch.href.split("#")[0];
      return chHref === segment.chapterHref;
    });

    if (!chapter) return;

    // If already in this chapter, just scroll to the element
    if (activeChapter?.id === chapter.id) {
      scrollManagement.scrollToElementId(segment.textElementId, "smooth");
      return;
    }

    // Navigate to chapter
    pendingScrollToElementIdRef.current = segment.textElementId;
    changeChapter(chapter.id, { scrollPosition: "top" });
  }, [activeBook, activeChapter, scrollManagement, changeChapter]);

  return {
    // State
    loadedChapter: chapterLoader.loadedChapter,
    isLoading: chapterLoader.isLoading,
    animationState: chapterAnimationState,
    isScrolling: scrollManagement.isScrolling,
    transitionDirection: chapterTransitions.direction,
    
    // Operations
    changeChapter,
    restoreChapterProgress,
    saveProgress,
    syncToAudio,
    
    // Scroll operations
    scrollToTop: scrollManagement.scrollToTop,
    scrollToBottom: scrollManagement.scrollToBottom,
    scrollToElementId: scrollManagement.scrollToElementId,
    
    // Event handlers
    handleScroll,
    handleScrollEnd,
    emitChapterProgress,
    updateMetricsOnScroll,
    
    // Navigation
    navigateToFragment: fragmentNavigation.navigateToFragment,
    setupLinkHandler: linkHandling.setupLinkHandler,
    cleanupLinkHandler: linkHandling.cleanup,
    
    // Transitions
    triggerTransition: chapterTransitions.triggerTransition,
    
    // Progress restoration
    restoreProgress: scrollManagement.restoreProgress,
    getRestoreState: scrollManagement.getRestoreState,
    resetRestoration: scrollManagement.resetRestoration,
    
    // Coordinator access
    coordinator,
  };
}

