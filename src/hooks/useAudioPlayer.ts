import { useCallback, useEffect, useRef, useState } from "react";
import type { Book } from "../types/reader";
import type { AudioProgressSnapshot } from "../components/reader/types";
import { findChaptersForAudioTrack } from "../lib/epub";
import type { ChapterSelectionOptions } from "../components/reader/types";

export function useAudioPlayer(
  activeBook: Book | undefined,
  activeChapterId: string | undefined,
  autoScrollEnabled: boolean,
  setAutoScrollEnabled: (enabled: boolean) => void,
  updateSettings: (settings: { autoScrollEnabled: boolean }) => void,
  handleSelectChapterBase: (chapterId: string, options?: ChapterSelectionOptions) => void,
  ingestEpub: (params: {
    filePath: string;
    sourcePath: string;
    fallbackTitle?: string;
    progress?: Book["progress"];
    pageCountHint?: number;
    audioState?: Book["audioState"];
  }) => Promise<Book | null>,
  activeView: "library" | "reader" | "settings",
) {
  const [isAudioPlayerOpen, setIsAudioPlayerOpen] = useState(false);
  const [isAudioPlayerDismissing, setIsAudioPlayerDismissing] = useState(false);
  const [currentAudioTime, setCurrentAudioTime] = useState<number | undefined>(undefined);
  const [currentAudioTrackHref, setCurrentAudioTrackHref] = useState<string | undefined>(undefined);
  const [isAudioRestoring, setIsAudioRestoring] = useState(false);
  const manualSelectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const manualChapterSelectionRef = useRef<{ chapterId: string; timestamp: number } | null>(null);
  const previousAutoScrollEnabledRef = useRef<boolean | null>(null);
  const explicitlyDisabledRef = useRef<boolean>(false);
  const lastAudioBookIdRef = useRef<string | null>(null);
  const rebuildingSyncMapRef = useRef<Set<string>>(new Set());
  const previousViewRef = useRef<"library" | "reader" | "settings">(activeView);

  // Wrap handleSelectChapter to track manual selections
  const handleSelectChapter = useCallback((chapterId: string, options?: ChapterSelectionOptions) => {
    // If this is a manual selection, track it
    if (options?.isManualSelection) {
      manualChapterSelectionRef.current = {
        chapterId,
        timestamp: Date.now(),
      };
    }
    // Call the base handler
    handleSelectChapterBase(chapterId, options);
  }, [handleSelectChapterBase]);

  const audioTrackCount = activeBook?.audioTracks?.length ?? 0;
  const hasAudioTracks = audioTrackCount > 0;

  useEffect(() => {
    if (!activeBook?.id || audioTrackCount === 0) {
      setIsAudioPlayerOpen(false);
      setCurrentAudioTime(undefined);
      setCurrentAudioTrackHref(undefined);
      lastAudioBookIdRef.current = null;
      return;
    }

    // Update lastAudioBookIdRef but don't automatically open audio player
    if (lastAudioBookIdRef.current !== activeBook.id) {
      lastAudioBookIdRef.current = activeBook.id;
      // Don't automatically open audio player - let user open it manually
    }
  }, [activeBook?.id, audioTrackCount]);

  // Rebuild audio sync map if missing when audio player opens
  useEffect(() => {
    if (!activeBook || !hasAudioTracks || activeBook.audioSyncMap) {
      // Clear rebuild flag if sync map is now present
      if (activeBook?.audioSyncMap && rebuildingSyncMapRef.current.has(activeBook.id)) {
        rebuildingSyncMapRef.current.delete(activeBook.id);
      }
      return;
    }

    // Prevent multiple rebuilds for the same book
    if (rebuildingSyncMapRef.current.has(activeBook.id)) {
      return;
    }

    // Book has audio tracks but no sync map - rebuild it
    const rebuildSyncMap = async () => {
      rebuildingSyncMapRef.current.add(activeBook.id);
      try {
        console.log("[App] Rebuilding missing audio sync map for book:", activeBook.id);
        
        // Re-ingest to rebuild sync map (backend will read from sourcePath)
        await ingestEpub({
          filePath: activeBook.sourcePath,
          sourcePath: activeBook.sourcePath,
          fallbackTitle: activeBook.title,
          progress: activeBook.progress,
          pageCountHint: activeBook.pageCount,
          audioState: activeBook.audioState,
        });
        
        console.log("[App] Successfully rebuilt audio sync map");
        // Don't delete from ref here - let the effect cleanup handle it when sync map is detected
      } catch (error) {
        console.error("[App] Failed to rebuild audio sync map:", error);
        rebuildingSyncMapRef.current.delete(activeBook.id);
      }
    };

    rebuildSyncMap();
  }, [activeBook?.id, hasAudioTracks, activeBook?.audioSyncMap, ingestEpub, activeBook]);

  useEffect(() => {
    const previousView = previousViewRef.current;
    // Auto-open audio player when switching to reader view if book has audio tracks
    if (activeView === "reader" && previousView !== "reader" && hasAudioTracks) {
      setIsAudioPlayerOpen(true);
    }
    previousViewRef.current = activeView;
  }, [activeView, hasAudioTracks]);

  // Auto-switch chapter when audio track changes
  useEffect(() => {
    if (!activeBook || !currentAudioTrackHref || !activeBook.audioSyncMap) {
      return;
    }

    // Don't auto-switch if auto-scroll is disabled
    if (!autoScrollEnabled) {
      console.log("[Auto-Chapter] Skipping auto-switch because auto-scroll is disabled");
      return;
    }

    // Don't auto-switch if there was a recent manual chapter selection
    if (manualChapterSelectionRef.current) {
      const timeSinceManualSelection = Date.now() - manualChapterSelectionRef.current.timestamp;
      const isRecentManualSelection = timeSinceManualSelection < 10000; // Increased to 10 seconds
      const isCurrentChapterManuallySelected = 
        manualChapterSelectionRef.current.chapterId === activeChapterId;
      
      // Prevent auto-switch if:
      // 1. Manual selection was recent (within 10 seconds), OR
      // 2. Current chapter is the one that was manually selected (regardless of time)
      if (isRecentManualSelection || isCurrentChapterManuallySelected) {
        console.log("[Auto-Chapter] Skipping auto-switch due to manual selection:", {
          manualChapterId: manualChapterSelectionRef.current.chapterId,
          currentChapterId: activeChapterId,
          timeSinceSelection: timeSinceManualSelection,
          isRecentManualSelection,
          isCurrentChapterManuallySelected,
        });
        return;
      }
      
      // If manual selection was older than 10 seconds and current chapter doesn't match,
      // clear the ref to allow auto-switch again
      if (!isRecentManualSelection && !isCurrentChapterManuallySelected) {
        console.log("[Auto-Chapter] Clearing old manual selection ref, allowing auto-switch");
        manualChapterSelectionRef.current = null;
      }
    }

    const chaptersForTrack = findChaptersForAudioTrack(
      activeBook.audioSyncMap,
      currentAudioTrackHref,
    );

    if (chaptersForTrack.length === 0) {
      return;
    }

    // Find the first chapter that matches one of the chapter hrefs for this track
    const matchingChapter = activeBook.chapters.find((chapter) => {
      const chapterHref = chapter.href.split("#")[0];
      return chaptersForTrack.includes(chapterHref);
    });

    if (matchingChapter && matchingChapter.id !== activeChapterId) {
      console.log("[Auto-Chapter] Switching to chapter for audio track:", {
        trackHref: currentAudioTrackHref,
        chapterId: matchingChapter.id,
        chapterTitle: matchingChapter.title,
        chapterHref: matchingChapter.href,
      });
      // Note: isManualSelection is NOT set here, so auto-scroll remains enabled
      handleSelectChapter(matchingChapter.id, {
        scrollPosition: "top",
      });
    }
  }, [activeBook, currentAudioTrackHref, activeChapterId, autoScrollEnabled, handleSelectChapter]);

  // Helper function to find and switch to chapter matching current audio track
  const switchToMatchingChapter = useCallback(() => {
    if (!activeBook || !currentAudioTrackHref || !activeBook.audioSyncMap) {
      return;
    }

    const chaptersForTrack = findChaptersForAudioTrack(
      activeBook.audioSyncMap,
      currentAudioTrackHref,
    );

    if (chaptersForTrack.length === 0) {
      return;
    }

    // Find the first chapter that matches one of the chapter hrefs for this track
    const matchingChapter = activeBook.chapters.find((chapter) => {
      const chapterHref = chapter.href.split("#")[0];
      return chaptersForTrack.includes(chapterHref);
    });

    if (matchingChapter && matchingChapter.id !== activeChapterId) {
      console.log("[Auto-Scroll] Re-enabling auto-scroll, switching to matching chapter:", {
        trackHref: currentAudioTrackHref,
        chapterId: matchingChapter.id,
        chapterTitle: matchingChapter.title,
        currentChapterId: activeChapterId,
      });
      handleSelectChapter(matchingChapter.id, {
        scrollPosition: "top",
      });
    }
  }, [activeBook, currentAudioTrackHref, activeChapterId, handleSelectChapter]);

  // Wrapper function to handle explicit user toggles
  const handleAutoScrollToggle = useCallback((enabled: boolean) => {
    setAutoScrollEnabled(enabled);
    
    // Persist the setting
    updateSettings({ autoScrollEnabled: enabled });
    
    // Track if user explicitly disabled it
    if (!enabled) {
      explicitlyDisabledRef.current = true;
      // Clear any pending re-enable timeout from manual selection
      if (manualSelectionTimeoutRef.current) {
        clearTimeout(manualSelectionTimeoutRef.current);
        manualSelectionTimeoutRef.current = null;
      }
    } else {
      // User explicitly enabled it, clear the explicit disable flag
      explicitlyDisabledRef.current = false;
      
      // Clear manual selection ref to allow auto-switch again
      if (manualChapterSelectionRef.current) {
        console.log("[Auto-Scroll] Clearing manual selection ref, allowing auto-switch");
        manualChapterSelectionRef.current = null;
      }
      
      // If current chapter doesn't match audio track, switch to matching chapter
      // Use setTimeout to ensure state update has completed
      setTimeout(() => {
        switchToMatchingChapter();
      }, 0);
    }
  }, [switchToMatchingChapter, updateSettings, setAutoScrollEnabled]);

  const handleAudioPlayerClose = useCallback(() => {
    setIsAudioPlayerDismissing(true);
    // Wait for exit animation to complete before hiding
    // Audio progress is saved in handleDismiss, scroll progress is saved in ReaderViewport effect
    setTimeout(() => {
      setIsAudioPlayerOpen(false);
      setIsAudioPlayerDismissing(false);
    }, 300);
  }, []);

  const handleProgress = useCallback((snapshot: AudioProgressSnapshot) => {
    setCurrentAudioTime(snapshot.currentTimeSeconds);
    setCurrentAudioTrackHref(snapshot.trackHref);
  }, []);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (manualSelectionTimeoutRef.current) {
        clearTimeout(manualSelectionTimeoutRef.current);
      }
    };
  }, []);

  return {
    isAudioPlayerOpen,
    setIsAudioPlayerOpen,
    isAudioPlayerDismissing,
    currentAudioTime,
    currentAudioTrackHref,
    isAudioRestoring,
    setIsAudioRestoring,
    hasAudioTracks,
    showAudioPlayer: hasAudioTracks && (isAudioPlayerOpen || isAudioPlayerDismissing),
    handleAudioPlayerClose,
    handleProgress,
    handleAutoScrollToggle,
    manualChapterSelectionRef,
  };
}

