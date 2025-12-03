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

  // Restore progress (called after chapter loads via callback)
  const restoreProgress = useCallback(() => {
    const loadedChapter = chapterLoader.loadedChapter;
    if (!activeBook || !loadedChapter) return;
    
    progressRestoration.restoreProgress(
      activeBook,
      loadedChapter,
      contentRef,
      () => {
        // Restoration complete
      }
    );
  }, [activeBook, chapterLoader.loadedChapter, progressRestoration]);

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
  const onChapterLoaded = useCallback(() => {
    const loadedChapter = chapterLoader.loadedChapter;
    if (!loadedChapter || !activeBook) return;
    
    const restoreState = progressRestoration.getState();
    // Only restore if shouldRestore is true and chapter matches
    if (loadedChapter.id === activeChapter?.id && restoreState.shouldRestore) {
      console.log("[ReaderWrapper] Chapter loaded, restoring progress", {
        chapterId: loadedChapter.id,
        shouldRestore: restoreState.shouldRestore,
        hasProgress: !!activeBook.progress,
        currentChapterId: activeBook.progress?.currentChapterId,
      });
      restoreProgress();
    } else {
      console.debug("[ReaderWrapper] Chapter loaded but not restoring", {
        chapterId: loadedChapter.id,
        activeChapterId: activeChapter?.id,
        shouldRestore: restoreState.shouldRestore,
        hasProgress: !!activeBook.progress,
      });
    }
  }, [chapterLoader.loadedChapter, activeBook, activeChapter, progressRestoration, restoreProgress]);

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
      // Always save progress, not just if restored
      await saveProgress(activeChapter.id);
    }

    // Determine if we should restore progress
    // Restore if: no explicit scroll position requested AND not a manual selection
    // Also check if this chapter has saved progress
    const hasProgress = activeBook.progress?.currentChapterId === chapterId;
    const shouldRestore = !options?.scrollPosition && !options?.isManualSelection && hasProgress;

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

    // Check if chapter is already cached or has content
    const wasAlreadyLoaded = chapter.contentHtml || chapterLoader.getCachedChapter(activeBook.id, chapter.id);
    
    // Load chapter
    const loaded = await ensureChapterLoaded(activeBook.id, chapter);
    if (loaded && loaded.contentHtml) {
      setChapterAnimationState("entering");
      setTimeout(() => {
        setChapterAnimationState("entered");
      }, 50);

      // Handle scroll position based on options
      if (options?.scrollPosition === "top" || options?.isManualSelection) {
        setTimeout(() => scrollOps.scrollToTop(), 100);
      } else if (options?.scrollPosition === "bottom") {
        setTimeout(() => scrollOps.scrollToBottom(), 100);
      }
      // else: will restore via onChapterLoaded callback
      
      // If chapter was already loaded (cached or had contentHtml), trigger restoration
      // since onChapterLoaded might not fire reliably for cached chapters
      if (shouldRestore && wasAlreadyLoaded) {
        // Wait a bit for DOM to be ready, then restore
        setTimeout(() => {
          const currentRestoreState = progressRestoration.getState();
          if (currentRestoreState.shouldRestore && loaded.id === chapterId) {
            console.log("[ReaderWrapper] Triggering restoration for cached chapter", {
              chapterId: loaded.id,
              shouldRestore: currentRestoreState.shouldRestore,
            });
            restoreProgress();
          }
        }, 250);
      }
    } else {
      console.error("[ReaderWrapper] Failed to load chapter", { chapterId, loaded });
    }
  }, [activeBook, activeChapter, ensureChapterLoaded, saveProgress, scrollOps, progressRestoration]);

  // Load current chapter when activeChapter changes (explicit check via ref, no useEffect)
  // This handles cases where activeChapter changes from outside (e.g., book selection)
  const currentChapterId = activeChapter?.id;
  const loadInitiatedRef = useRef<string | undefined>(undefined);
  
  if (previousChapterIdRef.current !== currentChapterId && activeChapter && activeBook) {
    const chapterId = activeChapter.id;
    if (loadInitiatedRef.current !== chapterId) {
      loadInitiatedRef.current = chapterId;
      previousChapterIdRef.current = currentChapterId;
      
      // Determine if we should restore progress for this chapter
      const hasProgress = activeBook.progress?.currentChapterId === chapterId;
      const shouldRestore = hasProgress; // Restore if there's saved progress
      
      console.log("[ReaderWrapper] Active chapter changed, loading", {
        chapterId,
        shouldRestore,
        hasProgress,
        savedChapterId: activeBook.progress?.currentChapterId,
      });
      
      // Reset restore state
      progressRestoration.reset(shouldRestore);
      
      // Check if chapter is already loaded
      const wasAlreadyLoaded = activeChapter.contentHtml || chapterLoader.getCachedChapter(activeBook.id, chapterId);
      
      // Load chapter asynchronously
      ensureChapterLoaded(activeBook.id, activeChapter).then(loaded => {
        if (loaded && loaded.contentHtml) {
          setChapterAnimationState("entering");
          setTimeout(() => {
            setChapterAnimationState("entered");
          }, 50);
          
          // If chapter was already loaded, trigger restoration
          if (shouldRestore && wasAlreadyLoaded) {
            setTimeout(() => {
              const currentRestoreState = progressRestoration.getState();
              if (currentRestoreState.shouldRestore && loaded.id === chapterId) {
                console.log("[ReaderWrapper] Triggering restoration for pre-loaded chapter", {
                  chapterId: loaded.id,
                  shouldRestore: currentRestoreState.shouldRestore,
                });
                // Call restoreProgress directly with current state
                const currentLoadedChapter = chapterLoader.loadedChapter;
                if (currentLoadedChapter && activeBook) {
                  progressRestoration.restoreProgress(
                    activeBook,
                    currentLoadedChapter,
                    contentRef,
                    () => {
                      // Restoration complete
                    }
                  );
                }
              }
            }, 250);
          }
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
    handleChapterChange(chapter.id, { scrollPosition: "top" });
    
    // After chapter loads, scroll to element
    setTimeout(() => {
      scrollOps.scrollToElementId(segment.textElementId, "smooth");
    }, 500);
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
