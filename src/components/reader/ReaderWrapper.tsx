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
import { useAudioPlayerProgress } from "../../hooks/reader/useAudioPlayerProgress";
import { useLibraryContext } from "../../hooks/library/LibraryContext";
import { useElementIndex } from "../../hooks/reader/useElementIndex";

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
  const { library, setLibrary } = useLibraryContext();
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
  const saveProgress = useCallback(async (chapterId: string) => {
    if (!activeBook) return;
    
    // Use readerManager to save progress (handles coordinator internally)
    await readerManager.saveProgress(chapterId);
  }, [activeBook, readerManager]);

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
    _bookId: string,
    chapter: Chapter
  ): boolean => {
    return !!(chapter.contentHtml || readerManager.loadedChapter?.id === chapter.id);
  }, [readerManager]);

  // Helper to handle pending scroll target (used after restoration or when not restoring)
  const handlePendingScrollTarget = useCallback(() => {
    if (pendingScrollToElementIdRef.current) {
      const elementId = pendingScrollToElementIdRef.current;
      pendingScrollToElementIdRef.current = null;
      requestAnimationFrame(() => {
        readerManager.scrollToElementId(elementId, "smooth");
      });
    }
  }, [readerManager]);

  // Restore progress (called after chapter loads via callback)
  const restoreProgress = useCallback((onComplete?: () => void) => {
    const chapterToRestore = activeChapter;
    if (!activeBook || !chapterToRestore) {
      logger.warn("[ReaderWrapper] restoreProgress: missing activeBook or chapter", {
        hasActiveBook: !!activeBook,
        hasChapter: !!chapterToRestore,
        loadedChapterId: readerManager.loadedChapter?.id,
        activeChapterId: activeChapter?.id,
      });
      onComplete?.();
      handlePendingScrollTarget();
      return;
    }
    
    logger.log("[ReaderWrapper] restoreProgress: calling readerManager.restoreProgress", {
      chapterId: chapterToRestore.id,
      bookId: activeBook.id,
    });
    
    readerManager.restoreProgress(
      activeBook.id,
      chapterToRestore.id,
      () => {
        onComplete?.();
        handlePendingScrollTarget();
      }
    );
  }, [activeBook, activeChapter, readerManager, handlePendingScrollTarget]);

  // Note: Restoration is now always handled by onChapterLoaded callback
  // which fires after the DOM is updated with chapter content
  // This ensures restoration happens at the right time regardless of cache status

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

  // Callback when chapter is loaded and ready (called from ReaderViewport after DOM is updated)
  // This ALWAYS handles restoration after chapter content is in the DOM, regardless of cache status
  // Callback when chapter is loaded and ready (called from ReaderViewport after DOM is updated)
  // This ALWAYS handles restoration after chapter content is in the DOM, regardless of cache status
  // Note: We use activeChapter because that's what's being rendered and what triggered the callback
  const onChapterLoaded = useCallback(() => {
    logger.log("[ReaderWrapper] onChapterLoaded callback called", {
      activeChapterId: activeChapter?.id,
      activeBookId: activeBook?.id,
      loadedChapterId: readerManager.loadedChapter?.id,
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
    
    const restoreState = readerManager.getRestoreState();
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
  }, [activeBook, activeChapter, readerManager, restoreProgress, handlePendingScrollTarget]);

  // Handle chapter change - now uses coordinator
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
    
    // Use readerManager to change chapter (handles coordinator, loading, etc.)
    await readerManager.changeChapter(chapterId, options);
  }, [activeBook, readerManager]);

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
      readerManager.resetRestoration(shouldRestore);
      
      // Check if chapter is already loaded
      const wasAlreadyLoaded = isChapterAlreadyLoaded(activeBook.id, activeChapter);
      
      // Load chapter asynchronously - use readerManager to handle loading
      readerManager.changeChapter(chapterId, shouldRestore ? { scrollPosition: "maintain" } : undefined).then(() => {
        setChapterAnimationState("entering");
        setTimeout(() => {
          setChapterAnimationState("entered");
        }, 50);
        
        // Note: Restoration is handled by onChapterLoaded callback
        // which fires after the DOM is updated with chapter content
        
        logger.log("[ReaderWrapper] Chapter loaded in render-time check, waiting for DOM update", {
          chapterId,
          shouldRestore,
          wasAlreadyLoaded,
        });
      }).catch((error) => {
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
      readerManager.scrollToElementId(segment.textElementId, "smooth");
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

  const loadedChapter = readerManager.loadedChapter;

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
          isLoading: readerManager.isLoading,
          animationState: readerManager.animationState || chapterAnimationState,
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
          onScroll: readerManager.handleScroll,
          onScrollEnd: readerManager.handleScrollEnd,
          isScrolling: readerManager.isScrolling,
        }}
        contentRef={contentRef}
        elementIndex={elementIndex}
      />
    </>
  );
}
