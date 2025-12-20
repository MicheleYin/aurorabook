/**
 * ReaderWrapper - Manages all reader logic with explicit callbacks
 * No useEffects - all operations are explicit via callbacks
 */

import { useCallback, useRef, useEffect, memo } from "react";
import { logger } from "../../lib/logger";
import type { ReaderPreferences, Chapter } from "../../types/reader";
import type { ChapterProgressSnapshot, ChapterSelectionOptions, AudioProgressSnapshot } from "./types";
import { ReaderViewport } from "./ReaderViewport";
import { useReaderManager } from "../../hooks/reader/useReaderManager";
import { useAudioPlayerProgress } from "../../hooks/audio/useAudioPlayerProgress";
import { useElementIndex } from "../../hooks/reader/useElementIndex";
import { useReaderProgressSave } from "../../hooks/reader/useReaderProgressSave";
import { useReaderChapterReload } from "../../hooks/reader/useReaderChapterReload";
import { useReaderAudioSync } from "../../hooks/reader/useReaderAudioSync";
// Handler bridges removed - using Redux directly
import { HighlightQueueProvider } from "../../contexts/HighlightQueueContext";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { selectLibrary, selectChapterAnimationState, selectCurrentBook, selectCurrentChapter } from "../../store/selectors";
import { setChapterAnimationState, setTrackChangeHandler, setSaveProgressHandler, setAudioPlayerProgress } from "../../store/slices/readerSlice";

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

// Inner component that uses hooks that require HighlightQueueContext
function ReaderWrapperContentInner(props: ReaderWrapperProps) {
  const {
    activeBookId,
    activeChapterId,
    preferences,
    onPreferencesChange,
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

  // Get book and chapter from Redux (single source of truth)
  const dispatch = useAppDispatch();
  const library = useAppSelector(selectLibrary); // Still needed for some operations
  const activeBook = useAppSelector(selectCurrentBook);
  const activeChapter = useAppSelector(selectCurrentChapter);

  // Get chapter animation state from Redux
  const chapterAnimationState = useAppSelector(selectChapterAnimationState);

  // Content ref for scroll operations
  const contentRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollToElementIdRef = useRef<string | null>(null);
  const previousChapterIdRef = useRef<string | undefined>(undefined);

  // Unified reader manager - handles all chapter operations
  const readerManager = useReaderManager({
    activeBookId,
    activeChapterId,
    contentRef,
    preferences,
    onSelectChapter,
    onChapterProgress,
    onSaveProgress,
  });

  // Get restore state from reader manager
  const restoreState = readerManager.getRestoreState();

  // Build element index for fast lookups (Phase 1: Element index integration)
  // Use loadedChapter if available, otherwise use activeChapter
  const chapterForIndex = readerManager.loadedChapter || activeChapter;
  const elementIndex = useElementIndex(chapterForIndex?.contentHtml);

  // Use ref to avoid recreating callback when readerManager changes
  const readerManagerRef = useRef(readerManager);
  readerManagerRef.current = readerManager;
  
  // Extract progress saving logic
  const { performSave } = useReaderProgressSave({
    activeBookId,
    activeChapterId,
    readerManager,
  });
  
  const saveProgress = useCallback(async (chapterId: string) => {
    if (!activeBook) {
      logger.warn("[ReaderWrapper] saveProgress: no active book", { chapterId });
      return;
    }
    await performSave(activeBook.id, chapterId);
  }, [activeBook, performSave]);

  // Helper to determine if progress should be restored for a chapter
  // Manual selections (TOC, nav buttons) should NOT restore progress
  // Use refs to avoid recreating callback when activeBook changes
  const activeBookRef = useRef(activeBook);
  activeBookRef.current = activeBook;
  
  const shouldRestoreProgress = useCallback((
    chapterId: string,
    options?: ChapterSelectionOptions
  ): boolean => {
    const book = activeBookRef.current;
    if (!book) return false;
    const hasProgress = book.progress?.currentChapterId === chapterId;
    
    // Don't restore if:
    // 1. Manual selection (TOC, navigation buttons)
    // 2. Explicit scroll position requested (top/bottom)
    // 3. No progress exists for this chapter
    const shouldRestore = !options?.isManualSelection && 
                          !options?.scrollPosition && 
                          hasProgress;
    
    logger.log("[ReaderWrapper] Determining restore state", {
      chapterId,
      hasProgress,
      isManualSelection: options?.isManualSelection,
      scrollPosition: options?.scrollPosition,
      shouldRestore,
    });
    
    return shouldRestore;
  }, []);

  // Helper to check if chapter is already loaded (cached or has content)
  // Use ref to avoid recreating callback when readerManager changes
  const isChapterAlreadyLoaded = useCallback((
    _bookId: string,
    chapter: Chapter
  ): boolean => {
    return !!(chapter.contentHtml || readerManagerRef.current.loadedChapter?.id === chapter.id);
  }, []);

  // Helper to handle pending scroll target (used after restoration or when not restoring)
  const handlePendingScrollTarget = useCallback(() => {
    if (pendingScrollToElementIdRef.current) {
      const elementId = pendingScrollToElementIdRef.current;
      pendingScrollToElementIdRef.current = null;
      requestAnimationFrame(() => {
        readerManagerRef.current.scrollToElementId(elementId, "smooth");
      });
    }
  }, []);

  // Note: Restoration is now handled by onChapterLoaded callback
  // which fires after the DOM is updated with chapter content
  // It uses useChapterState.onChapterLoaded directly (coordinator pattern, similar to audio)

  // Chapter loading is now handled by readerManager and useReaderChapterReload hook

  // Extract chapter reload logic
  const { handleChapterReload: handleChapterReloadFromHook } = useReaderChapterReload({
    activeBookId,
    activeChapterId,
    onSelectChapter,
  });

  // Wrapper that matches the expected signature
  const handleChapterReload = useCallback(async (_chapterId: string) => {
    await handleChapterReloadFromHook();
  }, [handleChapterReloadFromHook]);

  // Use refs to access current values without causing re-renders
  // Declare refs that will be reused later in the file
  const libraryRef = useRef(library);
  const handleChapterReloadRef = useRef(handleChapterReload);
  const activeBookIdRefForEvent = useRef(activeBookId);
  const activeChapterIdRefForEvent = useRef(activeChapterId);
  
  // Update refs when values change
  useEffect(() => {
    libraryRef.current = library;
  }, [library]);
  
  useEffect(() => {
    handleChapterReloadRef.current = handleChapterReload;
  }, [handleChapterReload]);
  
  useEffect(() => {
    activeBookIdRefForEvent.current = activeBookId;
  }, [activeBookId]);
  
  useEffect(() => {
    activeChapterIdRefForEvent.current = activeChapterId;
  }, [activeChapterId]);

  // Listen for chapter-updated events to reload chapter if user is viewing it
  // Only depend on activeBookId and activeChapterId to avoid unnecessary cleanup/setup
  useEffect(() => {
    const handleChapterUpdated = async (event: Event) => {
      const customEvent = event as CustomEvent<{
        bookId: string;
        sourcePath: string;
        chapterId: string;
        chapterHref: string;
        chapterIndex: number;
      }>;
      
      const { bookId, chapterId, chapterHref, chapterIndex } = customEvent.detail;
      
      // Get fresh book and chapter from library state using refs (not from closure)
      const currentBook = activeBookIdRefForEvent.current 
        ? libraryRef.current.find((b: { id: string }) => b.id === activeBookIdRefForEvent.current) 
        : undefined;
      const currentChapter = currentBook && activeChapterIdRefForEvent.current 
        ? currentBook.chapters.find((ch: { id: string }) => ch.id === activeChapterIdRefForEvent.current)
        : undefined;
      
      logger.log("[ReaderWrapper] 📥 Received chapter-updated event", {
        bookId,
        chapterId,
        chapterHref,
        chapterIndex,
        activeBookId: currentBook?.id,
        activeChapterId: currentChapter?.id,
        isActiveBook: currentBook?.id === bookId,
        isActiveChapter: currentChapter?.id === chapterId,
      });
      
      // Only reload if this is the currently active chapter
      if (currentBook?.id === bookId && currentChapter?.id === chapterId) {
        logger.log("[ReaderWrapper] ✓ Chapter matches active chapter, reloading", {
          bookId,
          chapterId,
          activeBookId: currentBook.id,
          activeChapterId: currentChapter.id,
        });
        
        // Reload the chapter to get the updated HTML with spans
        await handleChapterReloadRef.current(chapterId);
      } else {
        logger.debug("[ReaderWrapper] Chapter updated but not active, skipping reload", {
          bookId,
          chapterId,
          activeBookId: currentBook?.id,
          activeChapterId: currentChapter?.id,
          reason: currentBook?.id !== bookId ? "different book" : "different chapter",
        });
      }
    };

    logger.debug("[ReaderWrapper] Setting up chapter-updated event listener");
    window.addEventListener("chapter-updated", handleChapterUpdated);
    
    return () => {
      logger.debug("[ReaderWrapper] Cleaning up chapter-updated event listener");
      window.removeEventListener("chapter-updated", handleChapterUpdated);
    };
  }, [activeBookId, activeChapterId]); // Only depend on IDs, not objects

  // Track which chapter we've already called onChapterLoaded for to prevent duplicate calls
  const chapterLoadedRef = useRef<string | null>(null);
  
  // Callback when chapter is loaded and ready (called from ReaderViewport after DOM is updated)
  // Uses coordinator pattern similar to audio restoration
  // Calls useChapterState.onChapterLoaded directly with content element
  const onChapterLoaded = useCallback(() => {
    const chapterId = activeChapter?.id;
    
    logger.log("[ReaderWrapper] onChapterLoaded callback called", {
      activeChapterId: chapterId,
      activeBookId: activeBook?.id,
      loadedChapterId: readerManager.loadedChapter?.id,
      alreadyCalled: chapterLoadedRef.current === chapterId,
    });
    
    // Prevent duplicate calls for the same chapter
    if (chapterLoadedRef.current === chapterId) {
      logger.debug("[ReaderWrapper] onChapterLoaded already called for this chapter, skipping", {
        chapterId,
      });
      return;
    }
    
    if (!activeChapter || !activeBook || !contentRef.current) {
      logger.warn("[ReaderWrapper] onChapterLoaded: missing chapter, book, or contentRef", {
        hasChapter: !!activeChapter,
        hasActiveBook: !!activeBook,
        hasContentRef: !!contentRef.current,
      });
      handlePendingScrollTarget();
      return;
    }
    
    // Check if chapter change operation was cancelled
    // Note: If operation is null/undefined, it means it completed successfully
    // Only skip restoration if the operation was explicitly cancelled
    const coordinator = readerManager.coordinator;
    const currentOp = coordinator.getCurrentOperation("changeChapter");
    
    logger.log("[ReaderWrapper] Checking chapter change operation state", {
      chapterId: activeChapter.id,
      hasOperation: !!currentOp,
      operationId: currentOp?.id,
      operationCancelled: currentOp?.cancelled,
      operationChapterId: currentOp?.chapterId,
      operationMatches: currentOp?.chapterId === activeChapter.id,
    });
    
    // Only skip if operation was explicitly cancelled
    // If operation is null/undefined, it completed successfully, so proceed with restoration
    // If operation exists but chapterId doesn't match, it might be a different operation, so proceed
    if (currentOp?.cancelled) {
      logger.log("[ReaderWrapper] Chapter change was cancelled, skipping restoration", {
        chapterId: activeChapter.id,
        operationId: currentOp?.id,
      });
      handlePendingScrollTarget();
      return;
    }
    
    // If operation exists and chapterId matches, or operation is null (completed), proceed
    if (currentOp && currentOp.chapterId !== activeChapter.id) {
      logger.debug("[ReaderWrapper] Chapter change operation for different chapter, but proceeding with restoration", {
        currentChapterId: activeChapter.id,
        operationChapterId: currentOp.chapterId,
        operationId: currentOp.id,
      });
      // Continue anyway - might be a stale operation
    }
    
    // Mark this chapter as loaded
    chapterLoadedRef.current = chapterId ?? null;
    
    // Get content element (the scrollable container)
    const contentElement = contentRef.current;
    
    // Create scrollToElement helper function
    const scrollToElement = (elementId: string) => {
      readerManagerRef.current.scrollToElementId(elementId, "smooth");
    };
    
    // Call useChapterState.onChapterLoaded to restore progress
    // This applies restoration similar to how audio uses onTrackLoaded
    // The coordinator lock will be checked inside onChapterLoaded to ensure proper coordination
    logger.log("[ReaderWrapper] Calling useChapterState.onChapterLoaded for restoration", {
      chapterId: activeChapter.id,
      hasContentElement: !!contentElement,
    });
    
    readerManagerRef.current.onChapterLoaded(contentElement, scrollToElement);
    
    // Handle pending scroll target after restoration
    handlePendingScrollTarget();
  }, [activeBook, activeChapter, contentRef, handlePendingScrollTarget, shouldRestoreProgress]);
  
  // Reset chapterLoadedRef when chapter changes
  // Use useEffect for side effect (ref update when chapter changes)
  useEffect(() => {
    if (chapterLoadedRef.current !== activeChapter?.id && chapterLoadedRef.current !== null) {
      chapterLoadedRef.current = null;
    }
  }, [activeChapter?.id]);

  // Handle chapter change - progress is NOT saved here, only on quit
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
    
    // NOTE: Progress is NOT saved on chapter change - only saved when quitting reader
    // This prevents progress from being saved during navigation
    
    // Use readerManager to change chapter (handles coordinator, loading, etc.)
    await readerManagerRef.current.changeChapter(chapterId, options);
  }, [activeBook]);

  // Load current chapter when activeChapter changes (explicit callback instead of useEffect)
  // This handles cases where activeChapter changes from outside (e.g., book selection)
  const loadInitiatedRef = useRef<string | undefined>(undefined);
  const loadChapterIfNeeded = useCallback(async () => {
    const currentActiveChapterId = activeChapter?.id;
    
    if (previousChapterIdRef.current !== currentActiveChapterId && activeChapter && activeBook) {
      const chapterId = activeChapter.id;
      if (loadInitiatedRef.current !== chapterId) {
        loadInitiatedRef.current = chapterId;
        previousChapterIdRef.current = currentActiveChapterId;
        
        // Determine if we should restore progress
        // When chapter changes from outside (e.g., book selection), it's NOT a manual selection
        // So we should restore if progress exists
        const shouldRestore = shouldRestoreProgress(chapterId);
        const hasProgress = activeBook.progress?.currentChapterId === chapterId;
        
        logger.log("[ReaderWrapper] Active chapter changed, loading", {
          chapterId,
          shouldRestore,
          hasProgress,
          savedChapterId: activeBook.progress?.currentChapterId,
        });
        
        // Reset restore state (if needed)
        if (!shouldRestore) {
          readerManagerRef.current.resetRestoration();
        }
        
        // Check if chapter is already loaded
        const wasAlreadyLoaded = isChapterAlreadyLoaded(activeBook.id, activeChapter);
        
        // Determine options based on restore state
        // If not restoring, don't specify scroll position (will default to top)
        const changeOptions = shouldRestore 
          ? { scrollPosition: "maintain" as const }
          : undefined;
        
        // Load chapter asynchronously - use readerManager to handle loading
        readerManagerRef.current.changeChapter(chapterId, changeOptions).then(() => {
          dispatch(setChapterAnimationState("entering"));
          setTimeout(() => {
            dispatch(setChapterAnimationState("entered"));
          }, 50);
          
          // Note: Restoration is handled by onChapterLoaded callback
          // which fires after the DOM is updated with chapter content
          
          logger.log("[ReaderWrapper] Chapter loaded, waiting for DOM update", {
            chapterId,
            shouldRestore,
            wasAlreadyLoaded,
          });
        }).catch((error) => {
          logger.error("[ReaderWrapper] Error loading chapter", { chapterId, error });
        });
      }
    }
  }, [dispatch, activeChapter, activeBook, shouldRestoreProgress, isChapterAlreadyLoaded]);
  
  // Call loadChapterIfNeeded when chapter changes (useEffect for async operations triggered by prop changes)
  // Note: This useEffect is necessary because we need to trigger async operations when props change
  // However, the actual logic is now in an explicit callback
  useEffect(() => {
    loadChapterIfNeeded();
  }, [loadChapterIfNeeded]);

  // Extract audio sync logic
  const { handleSyncToAudio, handleAudioSyncChapterChange } = useReaderAudioSync({
    activeBook,
    activeChapter,
    readerManager,
    onPendingScrollTarget: (elementId: string) => {
      pendingScrollToElementIdRef.current = elementId;
    },
  });

  // Audio player progress logic
  const audioPlayerProgress = useAudioPlayerProgress({
    activeBook,
    activeChapter: activeChapter ?? undefined,
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
    elementIndex, // Pass element index for fast lookups
  });

  // Store handlers in Redux instead of using callbacks
  useEffect(() => {
    if (audioPlayerProgress.handleAudioTrackChange) {
      dispatch(setTrackChangeHandler(audioPlayerProgress.handleAudioTrackChange));
    }
  }, [audioPlayerProgress.handleAudioTrackChange, dispatch]);

  // Handle audio progress updates - dispatch to Redux
  useEffect(() => {
    if (currentAudioProgress) {
      dispatch(setAudioPlayerProgress(currentAudioProgress));
      // Also call the handler for immediate updates
      audioPlayerProgress.handleAudioProgress(currentAudioProgress);
    }
  }, [currentAudioProgress, dispatch]);

  const loadedChapter = readerManager.loadedChapter;

  // Save progress when component unmounts or when leaving reader view
  // Use refs to track state and prevent duplicate saves
  const savePromiseRef = useRef<Promise<void> | null>(null);
  const activeChapterIdRef = useRef<string | undefined>(activeChapter?.id ?? undefined);
  const activeBookIdRef = useRef<string | undefined>(activeBook?.id ?? undefined);
  
  useEffect(() => {
    if (activeChapterIdRef.current !== activeChapter?.id || activeBookIdRef.current !== activeBook?.id) {
      logger.log("[ReaderWrapper] Chapter or book changed, resetting save state", {
        previousChapterId: activeChapterIdRef.current,
        newChapterId: activeChapter?.id,
        previousBookId: activeBookIdRef.current,
        newBookId: activeBook?.id,
      });
      activeChapterIdRef.current = activeChapter?.id;
      activeBookIdRef.current = activeBook?.id;
      savePromiseRef.current = null;
    }
  }, [activeChapter?.id, activeBook?.id]);
  
  // Store save progress handler in Redux
  useEffect(() => {
    if (onSaveProgress && activeBook?.id && activeChapter?.id) {
      dispatch(setSaveProgressHandler(() => performSave(activeBook.id, activeChapter.id)));
    } else {
      dispatch(setSaveProgressHandler(null));
    }
  }, [activeBook?.id, activeChapter?.id, onSaveProgress, performSave, dispatch]);
  
  // Cleanup DOM refs on unmount (progress save is handled by useReaderProgressSave hook)
  useEffect(() => {
    return () => {
      contentRef.current = null;
      pendingScrollToElementIdRef.current = null;
    };
  }, []);

  return (
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
        chapter: loadedChapter || (activeChapter ?? undefined),
        isLoading: readerManager.isLoading,
        animationState: readerManager.animationState || chapterAnimationState,
        pendingFragment: null,
      }}
      callbacks={{
        onSelectChapter: handleChapterChange,
        onChapterLoaded,
        onToggleChrome,
        onSyncToAudio: handleSyncToAudio,
        // NOTE: onChapterProgress is NOT passed to ReaderViewport
        // Progress is ONLY saved when quitting/leaving the reader (on unmount)
        // Progress is NOT saved on chapter change or scroll
        // This prevents automatic saves during navigation
        onChapterProgress: undefined,
        onFragmentConsumed: () => {},
        onPreferencesChange,
        onScroll: readerManager.handleScroll,
        onScrollEnd: readerManager.handleScrollEnd,
        isScrolling: readerManager.isScrolling,
      }}
      contentRef={contentRef}
      elementIndex={elementIndex}
    />
  );
}

// Memoized inner component to prevent unnecessary re-renders
const ReaderWrapperContent = memo(ReaderWrapperContentInner, (prevProps, nextProps) => {
  // Only re-render if these critical props change
  return (
    prevProps.activeBookId === nextProps.activeBookId &&
    prevProps.activeChapterId === nextProps.activeChapterId &&
    prevProps.preferences === nextProps.preferences &&
    prevProps.chromeVisible === nextProps.chromeVisible &&
    prevProps.resolvedTheme === nextProps.resolvedTheme &&
    prevProps.audioPlayerVisible === nextProps.audioPlayerVisible &&
    prevProps.autoScrollEnabled === nextProps.autoScrollEnabled &&
    prevProps.currentAudioProgress === nextProps.currentAudioProgress
  );
});

// Outer component that provides the context
export function ReaderWrapper(props: ReaderWrapperProps) {
  return (
    <HighlightQueueProvider>
      <ReaderWrapperContent {...props} />
    </HighlightQueueProvider>
  );
}
