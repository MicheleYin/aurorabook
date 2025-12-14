/**
 * ReaderWrapper - Manages all reader logic with explicit callbacks
 * No useEffects - all operations are explicit via callbacks
 */

import { useCallback, useRef, useState, useEffect } from "react";
import { logger } from "../../lib/logger";
import type { ReaderPreferences, Chapter } from "../../types/reader";
import type { ChapterProgressSnapshot, ChapterSelectionOptions, AudioProgressSnapshot } from "./types";
import { ReaderViewport } from "./ReaderViewport";
import { findCurrentAudioSegment } from "../../lib/epub";
import { useReaderManager } from "../../hooks/reader/useReaderManager";
import { useAudioPlayerProgress } from "../../hooks/audio/useAudioPlayerProgress";
import { useLibraryContext } from "../../hooks/library/LibraryContext";
import { useElementIndex } from "../../hooks/reader/useElementIndex";
import { HighlightQueueProvider } from "../../contexts/HighlightQueueContext";

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
function ReaderWrapperContent(props: ReaderWrapperProps) {
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
  const { library, setLibrary, flushProgressUpdate } = useLibraryContext();
  const activeBook = activeBookId ? library.find(b => b.id === activeBookId) : undefined;
  const activeChapter = activeBook && activeChapterId 
    ? activeBook.chapters.find(ch => ch.id === activeChapterId)
    : undefined;

  // Content ref for scroll operations
  const contentRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollToElementIdRef = useRef<string | null>(null);
  const previousChapterIdRef = useRef<string | undefined>(undefined);
  const [chapterAnimationState, setChapterAnimationState] = useState<"entering" | "entered" | null>(null);

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

  // Save progress - now uses reader manager
  // Use ref to avoid recreating callback when readerManager changes
  const readerManagerRef = useRef(readerManager);
  readerManagerRef.current = readerManager;
  
  const saveProgress = useCallback(async (chapterId: string) => {
    if (!activeBook) {
      logger.warn("[ReaderWrapper] saveProgress: no active book", { chapterId });
      return;
    }
    
    logger.log("[ReaderWrapper] saveProgress called", {
      bookId: activeBook.id,
      chapterId,
    });
    
    // Use readerManager to save progress (handles coordinator internally)
    try {
      await readerManagerRef.current.saveProgress(chapterId);
      logger.log("[ReaderWrapper] saveProgress completed", {
        bookId: activeBook.id,
        chapterId,
      });
    } catch (error) {
      logger.error("[ReaderWrapper] saveProgress failed", {
        bookId: activeBook.id,
        chapterId,
        error,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }, [activeBook]);

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

  // Chapter loading helper - uses readerManager's chapterLoader internally
  const ensureChapterLoaded = useCallback(async (
    bookId: string,
    chapter: Chapter,
    forceReload: boolean = false
  ): Promise<Chapter | null> => {
    // If forcing reload, clear cache first
    if (forceReload) {
      // Access chapterLoader through coordinator or directly
      const { clearBookCache } = await import("../../lib/lazy-chapter-loader");
      clearBookCache(bookId);
    }

    // Use readerManager's changeChapter which handles loading
    // For now, we'll use the lazy chapter loader directly
    const { ensureChapterLoaded: ensureChapterLoadedFromLoader } = await import("../../lib/lazy-chapter-loader");
    const processed = await ensureChapterLoadedFromLoader(bookId, chapter);
    
    if (processed.contentHtml) {
      // Note: readerManager.changeChapter will handle setLoadedChapter
      return processed;
    }
    return null;
  }, []);

  // Handle chapter reload (for when content is missing spans or when chapter is updated during conversion)
  const handleChapterReload = useCallback(async (chapterId: string) => {
    if (!activeBookId || !chapterId) {
      logger.warn("[ReaderWrapper] Cannot reload chapter - missing bookId or chapterId", {
        chapterId,
        activeBookId,
      });
      return;
    }

    // Get fresh book and chapter from library state (not from closure)
    // This ensures we have the latest merged chapter with spans
    const currentBook = library.find((b) => b.id === activeBookId);
    if (!currentBook) {
      logger.warn("[ReaderWrapper] Book not found in library when reloading chapter", {
        bookId: activeBookId,
      });
      return;
    }

    const currentChapter = currentBook.chapters.find((ch) => ch.id === chapterId);
    if (!currentChapter) {
      logger.warn("[ReaderWrapper] Chapter not found in book when reloading", {
        bookId: activeBookId,
        chapterId,
      });
      return;
    }

    logger.log("[ReaderWrapper] 🔄 Starting chapter reload", {
      chapterId,
      bookId: activeBookId,
      chapterHref: currentChapter.href,
      reason: "chapter updated or missing spans",
      currentContentHtmlSize: currentChapter.contentHtml?.length || 0,
      hasSpans: currentChapter.contentHtml?.includes('id="f') || false,
    });

    // Check if chapter already has contentHtml with spans from the merge
    // If so, we can use it directly without reloading from backend
    if (currentChapter.contentHtml && currentChapter.contentHtml.includes('id="f')) {
      logger.log("[ReaderWrapper] ✓ Chapter already has spans, using merged content", {
        chapterId,
        contentHtmlSize: currentChapter.contentHtml.length,
        spanCount: (currentChapter.contentHtml.match(/id="f\d{6}"/g) || []).length,
      });
      
      // Note: readerManager will handle setLoadedChapter when we call changeChapter
      // For now, we need to trigger a re-render - this will be handled by readerManager
      // Trigger re-render by calling changeChapter with forceReload
      await readerManager.changeChapter(chapterId, { scrollPosition: "maintain" });
      
      return; // No backend reload needed, chapter already has spans
    }

    // Chapter doesn't have spans, need to reload from backend
    try {
      // Force reload the chapter (this will clear cache and fetch fresh data)
      const reloaded = await ensureChapterLoaded(activeBookId, currentChapter, true);
      if (reloaded && reloaded.contentHtml) {
        logger.log("[ReaderWrapper] ✓ Chapter reloaded successfully", {
          chapterId,
          bookId: activeBookId,
          newContentHtmlSize: reloaded.contentHtml.length,
          hasSpans: reloaded.contentHtml.includes('id="f'),
        });
        
        // Use readerManager to update the loaded chapter
        await readerManager.changeChapter(chapterId, { scrollPosition: "maintain" });
        
        // Update the library state with the reloaded chapter
        setLibrary((prevLibrary) => {
          const prevBookIndex = prevLibrary.findIndex((b) => b.id === activeBookId);
          if (prevBookIndex === -1) return prevLibrary;
          
          const updatedBook = { ...prevLibrary[prevBookIndex] };
          const prevChapterIndex = updatedBook.chapters.findIndex((ch) => ch.id === chapterId);
          if (prevChapterIndex === -1) return prevLibrary;
          
          updatedBook.chapters = [...updatedBook.chapters];
          updatedBook.chapters[prevChapterIndex] = reloaded;
          
          const updated = [...prevLibrary];
          updated[prevBookIndex] = updatedBook;
          
          logger.log("[ReaderWrapper] ✓ Updated library state with reloaded chapter", {
            bookId: activeBookId,
            chapterId,
            newContentHtmlSize: reloaded.contentHtml?.length || 0,
            hasSpans: reloaded.contentHtml?.includes('id="f') || false,
          });
          
          return updated;
        });
        
        // Trigger re-render
        setChapterAnimationState("entering");
        setTimeout(() => {
          setChapterAnimationState("entered");
        }, 50);
      } else {
        logger.error("[ReaderWrapper] ✗ Failed to reload chapter", {
          chapterId,
          bookId: activeBookId,
          reloaded: !!reloaded,
          hasContent: !!reloaded?.contentHtml,
        });
      }
    } catch (error) {
      logger.error("[ReaderWrapper] ✗ Error reloading chapter", {
        chapterId,
        bookId: activeBookId,
        error,
      });
    }
  }, [activeBookId, library, ensureChapterLoaded, setLibrary, readerManager]);

  // Listen for chapter-updated events to reload chapter if user is viewing it
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
      
      // Get fresh book and chapter from library state (not from closure)
      const currentBook = activeBookId ? library.find(b => b.id === activeBookId) : undefined;
      const currentChapter = currentBook && activeChapterId 
        ? currentBook.chapters.find(ch => ch.id === activeChapterId)
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
        await handleChapterReload(chapterId);
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
  }, [activeBookId, activeChapterId, library, handleChapterReload]);

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
  
  // Reset chapterLoadedRef when chapter changes (explicit check instead of useEffect)
  // Check in render to avoid render-time state updates
  if (chapterLoadedRef.current !== activeChapter?.id && chapterLoadedRef.current !== null) {
    chapterLoadedRef.current = null;
  }

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
          setChapterAnimationState("entering");
          setTimeout(() => {
            setChapterAnimationState("entered");
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
  }, [activeChapter, activeBook, shouldRestoreProgress, isChapterAlreadyLoaded]);
  
  // Call loadChapterIfNeeded when chapter changes (useEffect for async operations triggered by prop changes)
  // Note: This useEffect is necessary because we need to trigger async operations when props change
  // However, the actual logic is now in an explicit callback
  useEffect(() => {
    loadChapterIfNeeded();
  }, [loadChapterIfNeeded]);

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
      readerManagerRef.current.scrollToElementId(segment.textElementId, "smooth");
      return;
    }

    // Navigate to chapter (no restore, will scroll to element after load)
    // Store the element ID to scroll to after chapter loads
    pendingScrollToElementIdRef.current = segment.textElementId;
    handleChapterChange(chapter.id, { scrollPosition: "top" });
  }, [activeBook, activeChapter, handleChapterChange, readerManager]);

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
    elementIndex, // Pass element index for fast lookups
  });

  // Expose handleAudioTrackChange to parent (App.tsx) via callback - explicit check instead of useEffect
  // Use ref to track if we've already exposed to avoid calling on every render
  const trackHandlerExposedRef = useRef(false);
  const trackHandlerRef = useRef(audioPlayerProgress.handleAudioTrackChange);
  trackHandlerRef.current = audioPlayerProgress.handleAudioTrackChange;
  
  if (onTrackChangeHandlerReady && !trackHandlerExposedRef.current) {
    trackHandlerExposedRef.current = true;
    onTrackChangeHandlerReady(trackHandlerRef.current);
  }
  
  // Reset when callback changes
  if (!onTrackChangeHandlerReady && trackHandlerExposedRef.current) {
    trackHandlerExposedRef.current = false;
  }

  // Handle audio progress updates from App.tsx
  // This ensures highlighting and scrolling are updated when audio plays
  // Use explicit check instead of useEffect
  const lastProgressRef = useRef<AudioProgressSnapshot | undefined>(undefined);
  const handleAudioProgressRef = useRef(audioPlayerProgress.handleAudioProgress);
  
  // Update ref when handler changes
  handleAudioProgressRef.current = audioPlayerProgress.handleAudioProgress;
  
  // Explicit check - only update if values actually changed
  if (currentAudioProgress) {
    const lastProgress = lastProgressRef.current;
    // Quick reference check first (most common case - same object)
    if (lastProgress !== currentAudioProgress) {
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
    }
  }

  const loadedChapter = readerManager.loadedChapter;

  // Save progress when component unmounts or when leaving reader view
  // Use refs to track state and prevent duplicate saves
  const savePromiseRef = useRef<Promise<void> | null>(null);
  const activeChapterIdRef = useRef<string | undefined>(activeChapter?.id);
  const activeBookIdRef = useRef<string | undefined>(activeBook?.id);
  const flushProgressUpdateRef = useRef(flushProgressUpdate);
  flushProgressUpdateRef.current = flushProgressUpdate;
  
  // Update refs when chapter/book changes (reset save promise) - explicit check instead of useEffect
  if (activeChapterIdRef.current !== activeChapter?.id || activeBookIdRef.current !== activeBook?.id) {
    logger.log("[ReaderWrapper] Chapter or book changed, resetting save state", {
      previousChapterId: activeChapterIdRef.current,
      newChapterId: activeChapter?.id,
      previousBookId: activeBookIdRef.current,
      newBookId: activeBook?.id,
    });
    activeChapterIdRef.current = activeChapter?.id;
    activeBookIdRef.current = activeBook?.id;
    savePromiseRef.current = null; // Reset save promise when chapter/book changes
  }
  
  // Function to save progress (can be called before unmount or during unmount)
  const performSave = useCallback(async (bookId: string, chapterId: string) => {
    // Check if save is already in progress
    if (savePromiseRef.current) {
      logger.log("[ReaderWrapper] Save already in progress, waiting for completion", {
        bookId,
        chapterId,
      });
      try {
        await savePromiseRef.current;
        logger.log("[ReaderWrapper] Previous save completed", {
          bookId,
          chapterId,
        });
      } catch (error) {
        logger.warn("[ReaderWrapper] Previous save failed, continuing with new save", {
          bookId,
          chapterId,
          error,
        });
      }
    }
    
    logger.log("[ReaderWrapper] Starting progress save", {
      bookId,
      chapterId,
    });
    
    // First, emit current progress to ensure it's captured
    try {
      readerManagerRef.current.emitChapterProgress();
      logger.log("[ReaderWrapper] Emitted current progress before save", {
        bookId,
        chapterId,
      });
    } catch (error) {
      logger.warn("[ReaderWrapper] Failed to emit progress before save", {
        bookId,
        chapterId,
        error,
      });
    }
    
    // Create save promise
    const savePromise = readerManagerRef.current.saveProgress(chapterId)
      .then(() => {
        logger.log("[ReaderWrapper] Progress saved via readerManager, flushing debounced updates", {
          bookId,
          chapterId,
        });
        // Flush any pending debounced progress updates
        return flushProgressUpdateRef.current();
      })
      .then(() => {
        logger.log("[ReaderWrapper] Progress save and flush completed", {
          bookId,
          chapterId,
        });
        savePromiseRef.current = null;
      })
      .catch((error) => {
        logger.error("[ReaderWrapper] Failed to save or flush progress", {
          bookId,
          chapterId,
          error,
          errorMessage: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : undefined,
        });
        savePromiseRef.current = null;
        throw error;
      });
    
    savePromiseRef.current = savePromise;
    return savePromise;
  }, []);
  
  // Expose save function to parent via onSaveProgress callback - explicit check instead of useEffect
  // Use ref to track if we've already exposed to avoid calling on every render
  const saveExposedRef = useRef<string | null>(null);
  const saveKey = activeBook?.id && activeChapter?.id ? `${activeBook.id}-${activeChapter.id}` : null;
  
  if (onSaveProgress && activeBook && activeChapter && saveExposedRef.current !== saveKey) {
    saveExposedRef.current = saveKey;
    onSaveProgress(async () => {
      await performSave(activeBook.id, activeChapter.id);
    });
  }
  
  // Reset when chapter/book changes
  if (saveExposedRef.current && !saveKey) {
    saveExposedRef.current = null;
  }
  
  // Save progress only on actual unmount (not on every render)
  useEffect(() => {
    return () => {
      const bookId = activeBookIdRef.current;
      const chapterId = activeChapterIdRef.current;
      
      logger.log("[ReaderWrapper] Unmount cleanup triggered", {
        bookId,
        chapterId,
        hasSaveInProgress: !!savePromiseRef.current,
      });
      
      // Only save if we have valid IDs
      if (chapterId && bookId) {
        // If save is already in progress, wait for it (but don't block unmount)
        if (savePromiseRef.current) {
          logger.log("[ReaderWrapper] Save already in progress, will complete asynchronously", {
            bookId,
            chapterId,
          });
          // Don't await - let it complete in background
          savePromiseRef.current.catch((error) => {
            logger.error("[ReaderWrapper] Background save failed", {
              bookId,
              chapterId,
              error,
            });
          });
        } else {
          // Start new save (fire and forget - can't await in cleanup)
          logger.log("[ReaderWrapper] Starting progress save on unmount", {
            bookId,
            chapterId,
          });
          performSave(bookId, chapterId).catch((error) => {
            logger.error("[ReaderWrapper] Unmount save failed", {
              bookId,
              chapterId,
              error,
            });
          });
        }
      } else {
        logger.log("[ReaderWrapper] Skipping progress save on unmount - missing IDs", {
          hasChapterId: !!chapterId,
          hasBookId: !!bookId,
        });
      }
    };
    // Empty dependency array - this effect only runs on mount/unmount
    // We use refs to access current values, so we don't need dependencies
  }, [performSave]);

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
        chapter: loadedChapter || activeChapter,
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

// Outer component that provides the context
export function ReaderWrapper(props: ReaderWrapperProps) {
  return (
    <HighlightQueueProvider>
      <ReaderWrapperContent {...props} />
    </HighlightQueueProvider>
  );
}
