/**
 * ReaderWrapper - Manages all reader logic with explicit callbacks
 * No useEffects - all operations are explicit via callbacks
 */

import { useCallback, useMemo, useRef, useState } from "react";
import type { Book, Chapter, ReaderPreferences } from "../../types/reader";
import type { ChapterProgressSnapshot, AudioProgressSnapshot, ChapterSelectionOptions } from "./types";
import { ReaderViewport } from "./ReaderViewport";
import { ReaderAudioPlayer } from "./ReaderAudioPlayer";
import { createProgressSnapshot } from "../../lib/progress-utils";
import { findCurrentAudioSegment } from "../../lib/epub";
import { useChapterLoader } from "../../hooks/reader/useChapterLoader";
import { useAudioTrackLoader } from "../../hooks/reader/useAudioTrackLoader";
import { useProgressRestoration } from "../../hooks/reader/useProgressRestoration";
import { useScrollOperations } from "../../hooks/reader/useScrollOperations";
import { useAudioTextSync } from "../../hooks/reader/useAudioTextSync";
import { useChapterProgress } from "../../hooks/library/useChapterProgress";

type ReaderWrapperProps = {
  activeBook?: Book;
  activeChapter?: Chapter;
  preferences: ReaderPreferences;
  onPreferencesChange: (update: Partial<ReaderPreferences>) => void;
  onSelectChapter: (chapterId: string, options?: ChapterSelectionOptions) => void;
  onChapterProgress?: (bookId: string, snapshot: ChapterProgressSnapshot) => void;
  onSaveProgress?: (saveFn: () => void) => void;
  chromeVisible: boolean;
  resolvedTheme: "light" | "dark" | "sepia";
  onToggleChrome: () => void;
  audioPlayerVisible?: boolean;
  onCloseAudioPlayer?: () => void;
};

export function ReaderWrapper(props: ReaderWrapperProps) {
  const {
    activeBook,
    activeChapter,
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
  } = props;

  // Content ref for scroll operations
  const contentRef = useRef<HTMLDivElement | null>(null);
  const previousChapterIdRef = useRef<string | undefined>(undefined);
  const pendingScrollToElementIdRef = useRef<string | null>(null);
  const [chapterAnimationState, setChapterAnimationState] = useState<"entering" | "entered" | null>(null);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);

  // Custom hooks
  const chapterLoader = useChapterLoader();
  const audioLoader = useAudioTrackLoader();
  const progressRestoration = useProgressRestoration();
  const scrollOps = useScrollOperations(contentRef);
  
  // Progress tracking
  const restoreState = progressRestoration.getState();
  const audioSync = useAudioTextSync(contentRef, autoScrollEnabled, restoreState.isRestoring);
  const progressTracking = useChapterProgress({
    activeChapter: activeChapter || null,
    contentRef: contentRef as React.RefObject<HTMLElement>,
    onProgress: onChapterProgress ? (snapshot) => {
      if (activeBook) {
        onChapterProgress(activeBook.id, snapshot);
      }
    } : undefined,
    onSaveProgress,
    isRestoringScroll: restoreState.isRestoring,
  });

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
        scrollOps.scrollToElementId(elementId, "smooth");
      });
    }
  }, [scrollOps]);

  // Restore progress (called after chapter loads via callback)
  const restoreProgress = useCallback((onComplete?: () => void) => {
    const loadedChapter = chapterLoader.loadedChapter;
    if (!activeBook || !loadedChapter) {
      onComplete?.();
      handlePendingScrollTarget();
      return;
    }
    
    progressRestoration.restoreProgress(
      activeBook,
      loadedChapter,
      contentRef,
      () => {
        onComplete?.();
        // Always check for pending scroll target after restoration completes
        handlePendingScrollTarget();
      }
    );
  }, [activeBook, chapterLoader.loadedChapter, progressRestoration, handlePendingScrollTarget]);

  // Unified restoration trigger - handles both cached and newly loaded chapters
  const triggerRestorationIfNeeded = useCallback((
    loadedChapter: Chapter,
    wasAlreadyLoaded: boolean,
    shouldRestore: boolean
  ) => {
    if (!shouldRestore) return;
    
    // For cached/pre-loaded chapters, restore immediately
    // For newly loaded chapters, onChapterLoaded will handle it
    if (wasAlreadyLoaded) {
      console.log("[ReaderWrapper] Triggering restoration for cached/pre-loaded chapter", {
        chapterId: loadedChapter.id,
        shouldRestore: progressRestoration.getState().shouldRestore,
      });
      restoreProgress();
    }
    // else: onChapterLoaded callback will handle restoration
  }, [progressRestoration, restoreProgress]);

  // Chapter loading helper
  const ensureChapterLoaded = useCallback(async (
    bookId: string,
    chapter: Chapter
  ): Promise<Chapter | null> => {
    // Check if already has content
    if (chapter.contentHtml) {
      chapterLoader.setLoadedChapter(chapter);
      chapterLoader.setIsLoading(false);
      return chapter;
    }

    // Check cache
    const cached = chapterLoader.getCachedChapter(bookId, chapter.id);
    if (cached && cached.contentHtml) {
      chapterLoader.setLoadedChapter(cached);
      chapterLoader.setIsLoading(false);
      return cached;
    }

    // Load from backend (this will set isLoading to true, then false when done)
    const loaded = await chapterLoader.loadChapter(bookId, chapter);
    if (loaded) {
      chapterLoader.setLoadedChapter(loaded);
      chapterLoader.setIsLoading(false);
      return loaded;
    }
    chapterLoader.setIsLoading(false);
    return null;
  }, [chapterLoader]);

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

  // Callback when chapter is loaded and ready (called from ReaderViewport)
  // This handles restoration for newly loaded chapters (not cached/pre-loaded)
  const onChapterLoaded = useCallback(() => {
    const loadedChapter = chapterLoader.loadedChapter;
    if (!loadedChapter || !activeBook) return;
    
    const restoreState = progressRestoration.getState();
    const shouldRestore = loadedChapter.id === activeChapter?.id && restoreState.shouldRestore;
    
    if (shouldRestore) {
      console.log("[ReaderWrapper] Chapter loaded, restoring progress", {
        chapterId: loadedChapter.id,
        shouldRestore: restoreState.shouldRestore,
        hasProgress: !!activeBook.progress,
        currentChapterId: activeBook.progress?.currentChapterId,
      });
      // restoreProgress will handle pending scroll target in its onComplete
      restoreProgress();
    } else {
      console.debug("[ReaderWrapper] Chapter loaded but not restoring", {
        chapterId: loadedChapter.id,
        activeChapterId: activeChapter?.id,
        shouldRestore: restoreState.shouldRestore,
        hasProgress: !!activeBook.progress,
      });
      // If not restoring, still check for pending scroll target
      handlePendingScrollTarget();
    }
  }, [chapterLoader.loadedChapter, activeBook, activeChapter, progressRestoration, restoreProgress, handlePendingScrollTarget]);

  // Handle chapter change
  const handleChapterChange = useCallback(async (
    chapterId: string,
    options?: ChapterSelectionOptions
  ) => {
    if (!activeBook) return;

    const chapter = activeBook.chapters.find(ch => ch.id === chapterId);
    if (!chapter) {
      console.warn("[ReaderWrapper] Chapter not found", { chapterId, bookId: activeBook.id });
      return;
    }
    
    // Update previousChapterIdRef
    previousChapterIdRef.current = chapterId;

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
    
    console.log("[ReaderWrapper] Chapter change", {
      chapterId,
      shouldRestore,
      hasProgress,
      scrollPosition: options?.scrollPosition,
      isManualSelection: options?.isManualSelection,
      savedChapterId: activeBook.progress?.currentChapterId,
    });

    // Reset restore state for new chapter
    progressRestoration.reset(shouldRestore);

    // Check if chapter is already loaded
    const wasAlreadyLoaded = isChapterAlreadyLoaded(activeBook.id, chapter);
    
    // Load chapter
    const loaded = await ensureChapterLoaded(activeBook.id, chapter);
    if (loaded && loaded.contentHtml) {
      setChapterAnimationState("entering");
      setTimeout(() => {
        setChapterAnimationState("entered");
      }, 50);

      // Handle scroll position based on options
      if (options?.scrollPosition === "top" || options?.isManualSelection) {
        scrollOps.scrollToTop();
      } else if (options?.scrollPosition === "bottom") {
        scrollOps.scrollToBottom();
      }
      
      // Trigger restoration if needed (for cached chapters, restore immediately)
      triggerRestorationIfNeeded(loaded, wasAlreadyLoaded, shouldRestore);
    } else {
      console.error("[ReaderWrapper] Failed to load chapter", { chapterId, loaded });
    }
  }, [activeBook, activeChapter, ensureChapterLoaded, saveProgress, scrollOps, progressRestoration, shouldRestoreProgress, isChapterAlreadyLoaded, triggerRestorationIfNeeded, onSelectChapter]);

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
      
      console.log("[ReaderWrapper] Active chapter changed, loading", {
        chapterId,
        shouldRestore,
        hasProgress,
        savedChapterId: activeBook.progress?.currentChapterId,
      });
      
      // Reset restore state
      progressRestoration.reset(shouldRestore);
      
      // Check if chapter is already loaded
      const wasAlreadyLoaded = isChapterAlreadyLoaded(activeBook.id, activeChapter);
      
      // Load chapter asynchronously
      ensureChapterLoaded(activeBook.id, activeChapter).then(loaded => {
        if (loaded && loaded.contentHtml) {
          setChapterAnimationState("entering");
          setTimeout(() => {
            setChapterAnimationState("entered");
          }, 50);
          
          // Trigger restoration if needed (for cached chapters, restore immediately)
          triggerRestorationIfNeeded(loaded, wasAlreadyLoaded, shouldRestore);
        } else {
          console.error("[ReaderWrapper] Failed to load chapter in render-time check", { chapterId, loaded });
        }
      }).catch(error => {
        console.error("[ReaderWrapper] Error loading chapter in render-time check", { chapterId, error });
        chapterLoader.setIsLoading(false);
      });
    }
  }

  // Handle audio progress
  const handleAudioProgress = useCallback((snapshot: AudioProgressSnapshot) => {
    // Update highlighting based on audioSyncMap
    if (activeBook && snapshot.trackHref) {
      audioSync.updateHighlight(
        activeBook,
        activeChapter,
        snapshot.trackHref,
        snapshot.currentTimeSeconds
      );
    }
  }, [activeBook, activeChapter, audioSync]);

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
      scrollOps.scrollToElementId(segment.textElementId, "smooth");
      return;
    }

    // Navigate to chapter (no restore, will scroll to element after load)
    // Store the element ID to scroll to after chapter loads
    pendingScrollToElementIdRef.current = segment.textElementId;
    handleChapterChange(chapter.id, { scrollPosition: "top" });
  }, [activeBook, activeChapter, handleChapterChange, scrollOps]);

  // Get cached audio tracks
  const cachedAudioTracks = useMemo(() => {
    if (!activeBook) return [];
    
    return activeBook.audioTracks.map(track => {
      const cached = audioLoader.loadedTracks.get(track.id);
      return cached || track;
    });
  }, [activeBook, audioLoader.loadedTracks]);

  // Preload next audio track
  const preloadNextAudioTrack = useCallback(async (currentIndex: number) => {
    if (!activeBook || currentIndex + 1 >= activeBook.audioTracks.length) return;
    
    const nextTrack = activeBook.audioTracks[currentIndex + 1];
    if (!nextTrack.url && !audioLoader.isTrackLoaded(activeBook.id, nextTrack.id)) {
      await audioLoader.loadTrack(activeBook.id, nextTrack);
    }
  }, [activeBook, audioLoader]);

  // Handle audio track change
  const handleAudioTrackChange = useCallback(async (trackId: string) => {
    if (!activeBook) return;

    // Save progress before changing tracks
    if (activeChapter) {
      await saveProgress(activeChapter.id);
    }

    // Preload next track
    const trackIndex = activeBook.audioTracks.findIndex(t => t.id === trackId);
    if (trackIndex >= 0) {
      await preloadNextAudioTrack(trackIndex);
    }
  }, [activeBook, activeChapter, saveProgress, preloadNextAudioTrack, progressRestoration]);

  // Handle audio player close
  const handleAudioPlayerClose = useCallback(async () => {
    if (activeChapter) {
      await saveProgress(activeChapter.id);
    }
    onCloseAudioPlayer?.();
  }, [activeChapter, saveProgress, onCloseAudioPlayer]);

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
          highlightedElementId: audioSync.highlightedElementId,
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
          onScroll: progressTracking.updateMetricsOnScroll,
          onScrollEnd: progressTracking.emitChapterProgress,
        }}
        contentRef={contentRef}
      />
      {audioPlayerVisible && activeBook && (
        <ReaderAudioPlayer
          bookId={activeBook.id}
          tracks={cachedAudioTracks}
          bookTitle={activeBook.title}
          sourcePath={activeBook.sourcePath}
          initialAudioState={activeBook.audioState}
          onProgress={handleAudioProgress}
          onRestorationStateChange={() => {}}
          chromeVisible={chromeVisible}
          onClose={handleAudioPlayerClose}
          autoScrollEnabled={autoScrollEnabled}
          onAutoScrollToggle={setAutoScrollEnabled}
          onTrackChange={handleAudioTrackChange}
        />
      )}
    </>
  );
}
