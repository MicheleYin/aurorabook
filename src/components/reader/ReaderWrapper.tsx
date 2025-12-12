/**
 * ReaderWrapper - Manages all reader logic with explicit callbacks
 * No useEffects - all operations are explicit via callbacks
 */

import { useCallback, useRef, useState, useEffect } from "react";
import { logger } from "../../lib/logger";
import type { ReaderPreferences, Chapter } from "../../types/reader";
import type { ChapterProgressSnapshot, ChapterSelectionOptions, AudioProgressSnapshot } from "./types";
import { ReaderViewport } from "./ReaderViewport";
import { createProgressSnapshot } from "../../lib/progress-utils";
import { findCurrentAudioSegment } from "../../lib/epub";
import { useChapterLoader } from "../../hooks/reader/useChapterLoader";
import { useScrollManagement } from "../../hooks/reader/useScrollManagement";
import { useChapterProgress } from "../../hooks/library/useChapterProgress";
import { useAudioPlayerProgress } from "../../hooks/reader/useAudioPlayerProgress";
import { useLibraryContext } from "../../hooks/library/LibraryContext";

type ReaderWrapperProps = {
  activeBookId?: string;
  activeChapterId?: string;
  preferences: ReaderPreferences;
  onPreferencesChange: (update: Partial<ReaderPreferences>) => void;
  onSelectChapter: (chapterId: string, options?: ChapterSelectionOptions) => void;
  onChapterProgress?: (bookId: string, snapshot: ChapterProgressSnapshot) => void;
  onSaveProgress?: (saveFn: () => void) => void;
  chromeVisible: boolean;
  resolvedTheme: "light" | "dark" ;
  onToggleChrome: () => void;
  audioPlayerVisible?: boolean;
  onCloseAudioPlayer?: () => void;
  autoScrollEnabled?: boolean;
  currentAudioProgress?: AudioProgressSnapshot;
  onTrackChangeHandlerReady?: (handler: (trackHref: string) => Promise<void>) => void;
};

export function ReaderWrapper(props: ReaderWrapperProps) {
  const {
    activeBookId,
    activeChapterId,
    preferences,
    onPreferencesChange,
    onTrackChangeHandlerReady,
    onSelectChapter,
    onChapterProgress,
    onSaveProgress,
    chromeVisible,
    resolvedTheme,
    onToggleChrome,
    audioPlayerVisible = false,
    onCloseAudioPlayer,
    autoScrollEnabled = true,
    currentAudioProgress,
  } = props;

  // Get book and chapter from library context (single source of truth)
  const { library } = useLibraryContext();
  const activeBook = activeBookId ? library.find(b => b.id === activeBookId) : undefined;
  const activeChapter = activeBook && activeChapterId 
    ? activeBook.chapters.find(ch => ch.id === activeChapterId)
    : undefined;

  // Content ref for scroll operations
  const contentRef = useRef<HTMLDivElement | null>(null);
  const previousChapterIdRef = useRef<string | undefined>(undefined);
  const pendingScrollToElementIdRef = useRef<string | null>(null);
  const [chapterAnimationState, setChapterAnimationState] = useState<"entering" | "entered" | null>(null);

  // Custom hooks
  const chapterLoader = useChapterLoader();
  
  // Progress tracking - create first so we can pass updateScrollState to scrollManagement
  // We'll use a function for isRestoringScroll that will be updated after scrollManagement is created
  const isRestoringRef = useRef(false);
  const progressTracking = useChapterProgress({
    activeChapter: activeChapter || null,
    contentRef: contentRef as React.RefObject<HTMLElement>,
    onProgress: onChapterProgress ? (snapshot) => {
      if (activeBook) {
        onChapterProgress(activeBook.id, snapshot);
      }
    } : undefined,
    onSaveProgress,
    isRestoringScroll: () => isRestoringRef.current, // Use function to get current value
  });
  
  // Create scrollManagement with updateScrollState callback to sync scroll state
  const scrollManagement = useScrollManagement(
    contentRef,
    progressTracking.updateScrollState
  );
  
  // Update isRestoringRef with current restore state
  const restoreState = scrollManagement.getRestoreState();
  isRestoringRef.current = restoreState.isRestoring;

  // Save progress (uses progressTracking.saveProgress which handles all the logic)
  const saveProgress = useCallback(async (chapterId: string) => {
    if (!activeChapter || chapterId !== activeChapter.id) {
      // If saving a different chapter, use the manual save logic
      if (!activeBook || !onChapterProgress) return;
      
      const node = contentRef.current;
      if (!node) return;

      const { computeScrollMetrics, computeWindowScrollMetrics } = await import("../../lib/scroll-utils");
      const containerMetrics = computeScrollMetrics(node);
      const windowMetrics = computeWindowScrollMetrics();
      
      const useContainer = containerMetrics && containerMetrics.maxScroll > 0;
      const useWindow = !useContainer && windowMetrics && windowMetrics.maxScroll > 0;
      const metrics = useContainer ? containerMetrics : (useWindow ? windowMetrics : null);

      if (!metrics) return;

      const snapshot = createProgressSnapshot(chapterId, metrics);
      onChapterProgress(activeBook.id, snapshot);
    } else {
      // Use the progress tracking save function for current chapter
      progressTracking.saveProgress();
    }
  }, [activeBook, activeChapter, onChapterProgress, progressTracking]);

  // Helper to determine if progress should be restored for a chapter
  const shouldRestoreProgress = useCallback((
    chapterId: string,
    options?: ChapterSelectionOptions
  ): boolean => {
    if (!activeBook) return false;
    const hasProgress = activeBook.progress?.currentChapterId === chapterId;
    // Don't restore if explicit scroll position requested or manual selection
    const shouldRestore = !options?.scrollPosition && !options?.isManualSelection && hasProgress;
    return shouldRestore;
  }, [activeBook]);

  // Helper to check if chapter is already loaded (cached or has content)
  const isChapterAlreadyLoaded = useCallback((
    bookId: string,
    chapter: Chapter
  ): boolean => {
    return !!(chapter.contentHtml || chapterLoader.getCachedChapter(bookId, chapter.id));
  }, [chapterLoader]);

  // Helper to handle pending scroll target (used after restoration or when not restoring)
  const handlePendingScrollTarget = useCallback(() => {
    if (pendingScrollToElementIdRef.current) {
      const elementId = pendingScrollToElementIdRef.current;
      pendingScrollToElementIdRef.current = null;
      requestAnimationFrame(() => {
        scrollManagement.scrollToElementId(elementId, "smooth");
      });
    }
  }, [scrollManagement]);

  // Restore progress (called after chapter loads via callback)
  // Uses activeChapter since that's what's being rendered
  // Passes bookId and chapterId - useScrollManagement gets book/chapter from library context
  const restoreProgress = useCallback((onComplete?: () => void) => {
    // Use activeChapter since that's what's actually being rendered
    // (it's loadedChapter || activeChapter from the state passed to ReaderViewport)
    const chapterToRestore = activeChapter;
    if (!activeBook || !chapterToRestore) {
      logger.warn("[ReaderWrapper] restoreProgress: missing activeBook or chapter", {
        hasActiveBook: !!activeBook,
        hasChapter: !!chapterToRestore,
        loadedChapterId: chapterLoader.loadedChapter?.id,
        activeChapterId: activeChapter?.id,
      });
      onComplete?.();
      handlePendingScrollTarget();
      return;
    }
    
    logger.log("[ReaderWrapper] restoreProgress: calling scrollManagement.restoreProgress", {
      chapterId: chapterToRestore.id,
      bookId: activeBook.id,
    });
    
    // Pass bookId and chapterId - useScrollManagement will get book/chapter from library context
    scrollManagement.restoreProgress(
      activeBook.id,
      chapterToRestore.id,
      () => {
        onComplete?.();
        // Always check for pending scroll target after restoration completes
        handlePendingScrollTarget();
      }
    );
  }, [activeBook, activeChapter, scrollManagement, handlePendingScrollTarget, chapterLoader.loadedChapter]);

  // Note: Restoration is now always handled by onChapterLoaded callback
  // which fires after the DOM is updated with chapter content
  // This ensures restoration happens at the right time regardless of cache status

  // Chapter loading helper
  const ensureChapterLoaded = useCallback(async (
    bookId: string,
    chapter: Chapter,
    forceReload: boolean = false
  ): Promise<Chapter | null> => {
    // If forcing reload, clear cache first
    if (forceReload) {
      chapterLoader.clearCache(bookId);
      // Also clear the lazy chapter loader cache
      const { clearBookCache } = await import("../../lib/lazy-chapter-loader");
      clearBookCache(bookId);
    }

    // Always use ensureChapterLoaded from lazy-chapter-loader
    // Backend now handles image resolution, so frontend just loads the content
    const { ensureChapterLoaded: ensureChapterLoadedFromLoader } = await import("../../lib/lazy-chapter-loader");
    const processed = await ensureChapterLoadedFromLoader(bookId, chapter);
    
    if (processed.contentHtml) {
      chapterLoader.setLoadedChapter(processed);
      return processed;
    }
    return null;
  }, [chapterLoader]);

  // Handle chapter reload (for when content is missing spans)
  const handleChapterReload = useCallback(async (chapterId: string) => {
    if (!activeBook || !activeChapter || activeChapter.id !== chapterId) {
      return;
    }

    logger.log("[ReaderWrapper] Reloading chapter due to missing spans", {
      chapterId,
      bookId: activeBook.id,
    });

    // Force reload the chapter
    const reloaded = await ensureChapterLoaded(activeBook.id, activeChapter, true);
    if (reloaded && reloaded.contentHtml) {
      // Update the chapter in state by triggering a re-render
      // The chapter change handler will pick it up
      setChapterAnimationState("entering");
      setTimeout(() => {
        setChapterAnimationState("entered");
      }, 50);
    }
  }, [activeBook, activeChapter, ensureChapterLoaded]);

  // Callback when chapter is loaded and ready (called from ReaderViewport after DOM is updated)
  // This ALWAYS handles restoration after chapter content is in the DOM, regardless of cache status
  // Callback when chapter is loaded and ready (called from ReaderViewport after DOM is updated)
  // This ALWAYS handles restoration after chapter content is in the DOM, regardless of cache status
  // Note: We use activeChapter because that's what's being rendered and what triggered the callback
  const onChapterLoaded = useCallback(() => {
    logger.log("[ReaderWrapper] onChapterLoaded callback called", {
      activeChapterId: activeChapter?.id,
      activeBookId: activeBook?.id,
      loadedChapterId: chapterLoader.loadedChapter?.id,
    });
    
    // Use activeChapter since that's what's being rendered (it's loadedChapter || activeChapter from state)
    const chapterToRestore = activeChapter;
    if (!chapterToRestore || !activeBook) {
      logger.warn("[ReaderWrapper] onChapterLoaded: missing chapter or activeBook", {
        hasChapter: !!chapterToRestore,
        hasActiveBook: !!activeBook,
      });
      handlePendingScrollTarget();
      return;
    }
    
    const restoreState = scrollManagement.getRestoreState();
    const shouldRestore = chapterToRestore.id === activeChapter?.id && restoreState.shouldRestore;
    
    logger.log("[ReaderWrapper] onChapterLoaded: checking restoration", {
      chapterId: chapterToRestore.id,
      activeChapterId: activeChapter?.id,
      shouldRestore,
      restoreStateShouldRestore: restoreState.shouldRestore,
      hasProgress: !!activeBook.progress,
      currentChapterId: activeBook.progress?.currentChapterId,
      scrollTop: activeBook.progress?.currentChapterScrollTop,
      scrollPercent: activeBook.progress?.chapterProgressPercent,
    });
    
    if (shouldRestore) {
      logger.log("[ReaderWrapper] ✓ Chapter loaded in DOM, restoring progress", {
        chapterId: chapterToRestore.id,
        shouldRestore: restoreState.shouldRestore,
        hasProgress: !!activeBook.progress,
        currentChapterId: activeBook.progress?.currentChapterId,
        scrollTop: activeBook.progress?.currentChapterScrollTop,
        scrollPercent: activeBook.progress?.chapterProgressPercent,
      });
      // restoreProgress will handle pending scroll target in its onComplete
      // Pass the chapter that's actually being rendered
      restoreProgress();
    } else {
      logger.debug("[ReaderWrapper] Chapter loaded but not restoring", {
        chapterId: chapterToRestore.id,
        activeChapterId: activeChapter?.id,
        shouldRestore: restoreState.shouldRestore,
        hasProgress: !!activeBook.progress,
        reason: !restoreState.shouldRestore ? "shouldRestore is false" : 
                chapterToRestore.id !== activeChapter?.id ? "chapter ID mismatch" : "unknown",
      });
      // If not restoring, still check for pending scroll target
      handlePendingScrollTarget();
    }
  }, [activeBook, activeChapter, scrollManagement, restoreProgress, handlePendingScrollTarget, chapterLoader.loadedChapter]);

  // Handle chapter change
  const handleChapterChange = useCallback(async (
    chapterId: string,
    options?: ChapterSelectionOptions
  ) => {
    if (!activeBook) return;

    const chapter = activeBook.chapters.find(ch => ch.id === chapterId);
    if (!chapter) {
      logger.warn("[ReaderWrapper] Chapter not found", { chapterId, bookId: activeBook.id });
      return;
    }
    
    // Save progress for previous chapter before changing
    if (activeChapter && activeChapter.id !== chapterId) {
      await saveProgress(activeChapter.id);
    }

    // Determine if we should restore progress BEFORE calling onSelectChapter
    // This is important because onSelectChapter may update progress, which could affect restoration
    const shouldRestore = shouldRestoreProgress(chapterId, options);
    const hasProgress = activeBook.progress?.currentChapterId === chapterId;

    // IMPORTANT: Call parent's onSelectChapter to update App state (activeChapterId)
    // This ensures TOC and other components get the updated chapter ID
    // If we should restore, we need to preserve the existing progress for this chapter
    // by passing scrollPosition: "maintain" which tells App.tsx not to reset progress
    const optionsForParent = shouldRestore 
      ? { ...options, scrollPosition: "maintain" as const }
      : options;
    
    // Call onSelectChapter to update App state (this will update activeChapterId for TOC)
    // Note: This may trigger updateBookProgress, but if scrollPosition is "maintain",
    // it should preserve existing progress values for the chapter
    onSelectChapter(chapterId, optionsForParent);
    
    logger.log("[ReaderWrapper] Chapter change", {
      chapterId,
      shouldRestore,
      hasProgress,
      scrollPosition: options?.scrollPosition,
      isManualSelection: options?.isManualSelection,
      savedChapterId: activeBook.progress?.currentChapterId,
      previousChapterIdBefore: previousChapterIdRef.current,
    });

    // Reset restore state for new chapter
    scrollManagement.resetRestoration(shouldRestore);

    // Check if chapter is already loaded
    const wasAlreadyLoaded = isChapterAlreadyLoaded(activeBook.id, chapter);
    
    // Load chapter
    const loaded = await ensureChapterLoaded(activeBook.id, chapter);
    if (loaded && loaded.contentHtml) {
      // Update previousChapterIdRef AFTER chapter is loaded to prevent render-time check from interfering
      previousChapterIdRef.current = chapterId;
      
      // Update chapterLoader with the loaded chapter
      chapterLoader.setLoadedChapter(loaded);
      
      setChapterAnimationState("entering");
      setTimeout(() => {
        setChapterAnimationState("entered");
      }, 50);

      // Handle scroll position based on options (only if not restoring)
      // Restoration will be handled by onChapterLoaded after DOM is ready
      if (!shouldRestore) {
        if (options?.scrollPosition === "top" || options?.isManualSelection) {
          scrollManagement.scrollToTop();
        } else if (options?.scrollPosition === "bottom") {
          scrollManagement.scrollToBottom();
        }
      }
      
      // Note: Restoration is handled by onChapterLoaded callback
      // which fires after the DOM is updated with chapter content
      // This ensures restoration happens at the right time regardless of cache status
      
      logger.log("[ReaderWrapper] Chapter loaded successfully, waiting for DOM update", {
        chapterId,
        hasContent: !!loaded.contentHtml,
        contentLength: loaded.contentHtml?.length,
        shouldRestore,
        wasAlreadyLoaded,
      });
    } else {
      logger.error("[ReaderWrapper] Failed to load chapter", { chapterId, loaded });
    }
  }, [activeBook, activeChapter, ensureChapterLoaded, saveProgress, scrollManagement, shouldRestoreProgress, isChapterAlreadyLoaded, onSelectChapter]);

  // Load current chapter when activeChapter changes (explicit check via ref, no useEffect)
  // This handles cases where activeChapter changes from outside (e.g., book selection)
  const currentChapterId = activeChapter?.id;
  const loadInitiatedRef = useRef<string | undefined>(undefined);
  
  if (previousChapterIdRef.current !== currentChapterId && activeChapter && activeBook) {
    const chapterId = activeChapter.id;
    if (loadInitiatedRef.current !== chapterId) {
      loadInitiatedRef.current = chapterId;
      previousChapterIdRef.current = currentChapterId;
      
      // Determine if we should restore progress (no options, so restore if has progress)
      const shouldRestore = shouldRestoreProgress(chapterId);
      const hasProgress = activeBook.progress?.currentChapterId === chapterId;
      
      logger.log("[ReaderWrapper] Active chapter changed, loading", {
        chapterId,
        shouldRestore,
        hasProgress,
        savedChapterId: activeBook.progress?.currentChapterId,
      });
      
      // Reset restore state
      scrollManagement.resetRestoration(shouldRestore);
      
      // Check if chapter is already loaded
      const wasAlreadyLoaded = isChapterAlreadyLoaded(activeBook.id, activeChapter);
      
      // Load chapter asynchronously
      ensureChapterLoaded(activeBook.id, activeChapter).then(loaded => {
        if (loaded && loaded.contentHtml) {
          // IMPORTANT: Update chapterLoader state so UI displays the new chapter
          chapterLoader.setLoadedChapter(loaded);
          
          setChapterAnimationState("entering");
          setTimeout(() => {
            setChapterAnimationState("entered");
          }, 50);
          
          // Note: Restoration is handled by onChapterLoaded callback
          // which fires after the DOM is updated with chapter content
          
          logger.log("[ReaderWrapper] Chapter loaded in render-time check, waiting for DOM update", {
            chapterId,
            hasContent: !!loaded.contentHtml,
            contentLength: loaded.contentHtml?.length,
            shouldRestore,
            wasAlreadyLoaded,
          });
        } else {
          logger.error("[ReaderWrapper] Failed to load chapter in render-time check", { chapterId, loaded });
        }
      }).catch(error => {
        logger.error("[ReaderWrapper] Error loading chapter in render-time check", { chapterId, error });
      });
    }
  }

  // Sync button: go to current audio chapter
  const handleSyncToAudio = useCallback(() => {
    if (!activeBook?.audioState || !activeBook?.audioSyncMap) return;
    const audioState = activeBook.audioState;
    const segment = findCurrentAudioSegment(
      activeBook.audioSyncMap,
      audioState.currentTrackHref,
      audioState.currentTimeSeconds
    );

    if (!segment) return;

    // Find chapter by href
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

    // Navigate to chapter (no restore, will scroll to element after load)
    // Store the element ID to scroll to after chapter loads
    pendingScrollToElementIdRef.current = segment.textElementId;
    handleChapterChange(chapter.id, { scrollPosition: "top" });
  }, [activeBook, activeChapter, handleChapterChange, scrollManagement]);

  // Wrapper for chapter change from audio sync
  // Converts the audio sync format (chapterId, elementId) to the chapter change format
  const handleAudioSyncChapterChange = useCallback(async (chapterId: string, elementId?: string) => {
    logger.log("[ReaderWrapper] handleAudioSyncChapterChange called", {
      chapterId,
      elementId,
      currentChapterId: activeChapter?.id,
      currentChapterHref: activeChapter?.href,
      previousChapterIdRef: previousChapterIdRef.current,
    });
    
    if (elementId) {
      // Store the element ID to scroll to after chapter loads
      pendingScrollToElementIdRef.current = elementId;
    }
    
    // Navigate to chapter with scrollPosition: "top" so it loads at the top,
    // then handlePendingScrollTarget will scroll to the element after load
    // Note: handleChapterChange will update previousChapterIdRef AFTER loading
    await handleChapterChange(chapterId, { scrollPosition: "top", isManualSelection: false });
    
    logger.log("[ReaderWrapper] handleAudioSyncChapterChange completed", {
      chapterId,
      activeChapterIdAfter: activeChapter?.id,
      previousChapterIdRefAfter: previousChapterIdRef.current,
    });
  }, [handleChapterChange, activeChapter]);

  // Audio player progress logic
  const audioPlayerProgress = useAudioPlayerProgress({
    activeBook,
    activeChapter,
    contentRef,
    autoScrollEnabled,
    isRestoringScroll: restoreState.isRestoring,
    onSaveProgress: saveProgress,
    onCloseAudioPlayer,
    chromeVisible,
    onChapterChange: handleAudioSyncChapterChange,
    onChapterReload: handleChapterReload,
    audioPlayerVisible,
    onTrackChangeChapterChange: handleChapterChange,
  });

  // Expose handleAudioTrackChange to parent (App.tsx) via callback
  useEffect(() => {
    if (onTrackChangeHandlerReady) {
      onTrackChangeHandlerReady(audioPlayerProgress.handleAudioTrackChange);
    }
  }, [onTrackChangeHandlerReady, audioPlayerProgress.handleAudioTrackChange]);

  // Handle audio progress updates from App.tsx
  // This ensures highlighting and scrolling are updated when audio plays
  // Use refs to avoid recreating the effect callback on every render
  const lastProgressRef = useRef<AudioProgressSnapshot | undefined>(undefined);
  const handleAudioProgressRef = useRef(audioPlayerProgress.handleAudioProgress);
  
  // Update ref when handler changes (but don't recreate effect)
  handleAudioProgressRef.current = audioPlayerProgress.handleAudioProgress;
  
  // Use a more efficient check - only update if values actually changed
  useEffect(() => {
    if (!currentAudioProgress) return;
    
    const lastProgress = lastProgressRef.current;
    // Quick reference check first (most common case - same object)
    if (lastProgress === currentAudioProgress) return;
    
    // Compare by value only if reference changed
    const isNewProgress = 
      !lastProgress ||
      lastProgress.trackHref !== currentAudioProgress.trackHref ||
      Math.abs(lastProgress.currentTimeSeconds - currentAudioProgress.currentTimeSeconds) > 0.1 || // Only update if time changed significantly (>100ms)
      lastProgress.updatedAt !== currentAudioProgress.updatedAt;
    
    if (isNewProgress) {
      lastProgressRef.current = currentAudioProgress;
      handleAudioProgressRef.current(currentAudioProgress);
    }
  }, [currentAudioProgress]);

  const loadedChapter = chapterLoader.loadedChapter;

  return (
    <>
      <ReaderViewport
        config={{
          preferences,
          theme: resolvedTheme,
          chromeVisible,
          audioPlayerVisible,
          autoScrollEnabled,
        }}
        state={{
          book: activeBook,
          chapter: loadedChapter || activeChapter,
          isLoading: chapterLoader.isLoading,
          animationState: chapterAnimationState,
          highlightedElementId: audioPlayerProgress.highlightedElementId,
          pendingFragment: null,
        }}
        callbacks={{
          onSelectChapter: handleChapterChange,
          onChapterLoaded,
          onToggleChrome,
          onSyncToAudio: handleSyncToAudio,
          onChapterProgress: onChapterProgress ? (snapshot) => {
            if (activeBook) {
              onChapterProgress(activeBook.id, snapshot);
            }
          } : undefined,
          onFragmentConsumed: () => {},
          onPreferencesChange,
          onScroll: () => {
            scrollManagement.scrollHandler();
            progressTracking.updateMetricsOnScroll();
          },
          onScrollEnd: progressTracking.emitChapterProgress,
          isScrolling: scrollManagement.isScrolling,
        }}
        contentRef={contentRef}
      />
    </>
  );
}
