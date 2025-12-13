/**
 * Hook for managing audio player progress-related logic
 * Handles progress saving, track changes, and highlighting updates
 */

import { useCallback, useMemo } from "react";
import type { Book, Chapter } from "../../types/reader";
import type { AudioProgressSnapshot } from "../../components/reader/types";
import { useAudioTrackLoader } from "./useAudioTrackLoader";
import { useAudioTextSync } from "./useAudioTextSync";
import { findChaptersForAudioTrack, chapterHrefsMatch } from "../../lib/epub";
import { logger } from "../../lib/logger";
import { useReaderCoordinator } from "../../contexts/ReaderCoordinatorContext";

type UseAudioPlayerProgressParams = {
  activeBook?: Book;
  activeChapter?: Chapter;
  contentRef: React.RefObject<HTMLDivElement | null>;
  autoScrollEnabled: boolean;
  isRestoringScroll: boolean;
  onSaveProgress: (chapterId: string) => Promise<void>;
  onCloseAudioPlayer?: () => void;
  chromeVisible?: boolean;
  onChapterChange?: (chapterId: string, elementId?: string) => void;
  onChapterReload?: (chapterId: string) => void;
  audioPlayerVisible?: boolean;
  onTrackChangeChapterChange?: (chapterId: string, options?: { scrollPosition?: "top" | "bottom" | "maintain"; isManualSelection?: boolean }) => Promise<void>;
};

export function useAudioPlayerProgress({
  activeBook,
  activeChapter,
  contentRef,
  autoScrollEnabled,
  isRestoringScroll,
  onSaveProgress,
  onCloseAudioPlayer,
  chromeVisible = true,
  onChapterChange,
  onChapterReload,
  audioPlayerVisible = false,
  onTrackChangeChapterChange,
}: UseAudioPlayerProgressParams) {
  const coordinator = useReaderCoordinator();
  const audioLoader = useAudioTrackLoader();
  
  // Calculate header offset - will be computed dynamically in useAudioTextSync
  // Pass chromeVisible and audioPlayerVisible so it can calculate the offsets when needed
  const audioSync = useAudioTextSync(contentRef, autoScrollEnabled, isRestoringScroll, chromeVisible, onChapterChange, onChapterReload, audioPlayerVisible, activeChapter?.id);

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

  // Handle audio progress updates
  const handleAudioProgress = useCallback((snapshot: AudioProgressSnapshot) => {
    console.log("[Audio Progress] handleAudioProgress called", {
      hasActiveBook: !!activeBook,
      trackHref: snapshot.trackHref,
      currentTime: snapshot.currentTimeSeconds,
      hasActiveChapter: !!activeChapter,
    });
    
    // Update highlighting based on audioSyncMap
    if (activeBook && snapshot.trackHref) {
      audioSync.updateHighlight(
        activeBook,
        activeChapter,
        snapshot.trackHref,
        snapshot.currentTimeSeconds
      );
    } else {
      console.log("[Audio Progress] Skipping update - missing book or trackHref");
    }
  }, [activeBook, activeChapter, audioSync]);

  // Handle audio track change - SINGLE HANDLER that coordinates everything
  const handleAudioTrackChange = useCallback(async (trackHref: string) => {
    if (!activeBook) return;

    // Find track by href
    const track = activeBook.audioTracks.find(t => t.href === trackHref);
    if (!track) return;

    // Use coordinator to change audio track
    // This ensures proper coordination and cancellation
    await coordinator.changeAudioTrack(activeBook.id, track.id);

    // IMPORTANT: Mark track change FIRST (synchronously) before any async operations
    // This prevents updateHighlight from triggering chapter changes during track change
    audioSync.markTrackChange(trackHref);

    // Save progress before changing tracks
    if (activeChapter) {
      await onSaveProgress(activeChapter.id);
    }

    // Handle chapter change if auto-scroll is enabled and onTrackChangeChapterChange is provided
    if (autoScrollEnabled && onTrackChangeChapterChange) {
      // Find chapters that use this audio track
      const chapterHrefs = findChaptersForAudioTrack(activeBook.audioSyncMap, trackHref);
      if (chapterHrefs.length > 0) {
        // Find the first matching chapter by comparing hrefs using flexible matching
        const matchingChapter = activeBook.chapters.find((chapter) => {
          return chapterHrefs.some(segmentChapterHref => {
            return chapterHrefsMatch(segmentChapterHref, chapter.href);
          });
        });

        if (matchingChapter && matchingChapter.id !== activeChapter?.id) {
          logger.log("[Audio Player Progress] Track change - changing chapter", {
            trackHref,
            chapterId: matchingChapter.id,
            chapterTitle: matchingChapter.title,
            currentChapterId: activeChapter?.id,
          });
          
          // Mark chapter change in progress to prevent duplicate changes
          audioSync.markChapterChange(matchingChapter.id);
          
          // Change chapter with explicit loading
          await onTrackChangeChapterChange(matchingChapter.id, {
            scrollPosition: "top",
            isManualSelection: false,
          });
        } else if (matchingChapter) {
          logger.debug("[Audio Player Progress] Track change - chapter already matches", {
            trackHref,
            chapterId: matchingChapter.id,
          });
        }
      }
    }

    // Preload next track
    const trackIndex = activeBook.audioTracks.findIndex(t => t.id === track.id);
    if (trackIndex >= 0) {
      await preloadNextAudioTrack(trackIndex);
    }
  }, [activeBook, activeChapter, onSaveProgress, preloadNextAudioTrack, audioSync, autoScrollEnabled, onTrackChangeChapterChange, coordinator]);

  // Handle audio player close
  const handleAudioPlayerClose = useCallback(async () => {
    if (activeChapter) {
      await onSaveProgress(activeChapter.id);
    }
    onCloseAudioPlayer?.();
  }, [activeChapter, onSaveProgress, onCloseAudioPlayer]);

  return {
    cachedAudioTracks,
    handleAudioProgress,
    handleAudioTrackChange,
    handleAudioPlayerClose,
    highlightedElementId: audioSync.highlightedElementId,
  };
}

