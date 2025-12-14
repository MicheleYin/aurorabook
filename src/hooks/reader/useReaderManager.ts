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

import { useCallback, useMemo, useRef, useState } from "react";
import { logger } from "../../lib/logger";
import type { AudioSyncMap, ReaderPreferences } from "../../types/reader";
import type { ChapterProgressSnapshot, ChapterSelectionOptions } from "../../components/reader/types";
import { findCurrentAudioSegment } from "../../lib/epub";
import { useReaderCoordinator } from "../../contexts/ReaderCoordinatorContext";
import { useLibraryContext } from "../../hooks/library/LibraryContext";
import { useChapterLoader } from "../chapter/useChapterLoader";
import { useChapterProgress } from "../chapter/useChapterProgress";
import { useChapterState } from "../chapter/useChapterState";
import { useFragmentNavigation } from "./useFragmentNavigation";
import { useLinkHandling } from "./useLinkHandling";
import { useChapterTransitions } from "../chapter/useChapterTransitions";

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
  const progressRef = useRef<ReturnType<typeof useChapterProgress> | null>(null);

  // Sub-hooks
  const chapterLoader = useChapterLoader();
  
  // Memoize chapters array to prevent re-initialization loops
  // Use activeBook reference directly - if activeBook changes, chapters will update
  // This prevents creating new arrays on every render
  const chapters = useMemo(() => {
    return activeBook?.chapters ?? [];
  }, [activeBook]);
  
  // Chapter state (for restoration management)
  const chapterState = useChapterState({
    bookId: activeBookId,
    chapters,
    library,
    onProgress: undefined, // Progress is handled by useChapterProgress
  });
  
  // Unified progress management (replaces useScrollManagement and useReaderProgress)
  // NOTE: onChapterProgress is NOT passed here to prevent automatic saves on scroll
  // Progress is only saved explicitly on chapter change or quit
  const progress = useChapterProgress({
    activeBook,
    activeChapter,
    contentRef,
    onSaveProgress: async (chapterId: string) => {
      // Save progress via coordinator
      if (activeBook && progressRef.current) {
        const snapshot = progressRef.current.getCurrentProgressSnapshot();
        if (snapshot) {
          await coordinator.saveChapterProgress(activeBook.id, chapterId, snapshot);
        }
      }
    },
  });
  
  // Store progress in ref for use in callbacks
  progressRef.current = progress;

  // Update isRestoringRef
  const restoreState = progress.getRestoreState();
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

  // Progress operations are now handled by useChapterProgress
  const saveProgress = progress.saveProgressAsync; // Async function that takes chapterId
  const emitChapterProgress = progress.emitProgress;
  const updateMetricsOnScroll = progress.updateMetricsOnScroll;

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

    // NOTE: Progress is NOT saved on chapter change - only saved when quitting reader
    // This prevents progress from being saved during navigation

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
      // Use a small delay to ensure virtualized content is rendered
      if (options?.scrollPosition === "top" || options?.isManualSelection) {
        setTimeout(() => {
          progress.scrollToTop();
        }, 100);
      } else if (options?.scrollPosition === "bottom") {
        setTimeout(() => {
          progress.scrollToBottom();
        }, 100);
      }
    }
  }, [activeBook, coordinator, chapterLoader, progress, onSelectChapter]);

  // Restore chapter progress
  const restoreChapterProgress = useCallback(async (
    bookId: string,
    chapterId: string,
    withAutoScroll?: boolean
  ) => {
    await coordinator.restoreChapterProgress(bookId, chapterId, withAutoScroll);
    
    // The actual restoration is handled by progress hook
    progress.restoreProgress(bookId, chapterId, () => {
      // Handle pending scroll target after restoration
      if (pendingScrollToElementIdRef.current) {
        const elementId = pendingScrollToElementIdRef.current;
        pendingScrollToElementIdRef.current = null;
        requestAnimationFrame(() => {
          progress.scrollToElementId(elementId, "smooth");
        });
      }
    });
  }, [coordinator, progress]);

  // Handle scroll events (delegated to progress hook)
  const handleScroll = progress.handleScroll;
  const handleScrollEnd = progress.handleScrollEnd;

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
      progress.scrollToElementId(segment.textElementId, "smooth");
      return;
    }

    // Navigate to chapter
    pendingScrollToElementIdRef.current = segment.textElementId;
    changeChapter(chapter.id, { scrollPosition: "top" });
  }, [activeBook, activeChapter, progress, changeChapter]);

  return {
    // State
    loadedChapter: chapterLoader.loadedChapter,
    isLoading: chapterLoader.isLoading,
    animationState: chapterAnimationState,
    isScrolling: progress.isScrolling,
    transitionDirection: chapterTransitions.direction,
    
    // Operations
    changeChapter,
    restoreChapterProgress,
    saveProgress,
    syncToAudio,
    
    // Scroll operations
    scrollToTop: progress.scrollToTop,
    scrollToBottom: progress.scrollToBottom,
    scrollToElementId: progress.scrollToElementId,
    
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
    restoreProgress: progress.restoreProgress,
    getRestoreState: progress.getRestoreState,
    resetRestoration: progress.resetRestoration,
    
    // Chapter state (for restoration)
    onChapterLoaded: chapterState.onChapterLoaded,
    isRestoringChapter: chapterState.isRestoring,
    
    // Coordinator access
    coordinator,
  };
}

