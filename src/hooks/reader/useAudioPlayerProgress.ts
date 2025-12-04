/**
 * Hook for managing audio player progress-related logic
 * Handles progress saving, track changes, and highlighting updates
 */

import { useCallback, useMemo } from "react";
import type { Book, Chapter } from "../../types/reader";
import type { AudioProgressSnapshot } from "../../components/reader/types";
import { useAudioTrackLoader } from "./useAudioTrackLoader";
import { useAudioTextSync } from "./useAudioTextSync";

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
}: UseAudioPlayerProgressParams) {
  const audioLoader = useAudioTrackLoader();
  
  // Calculate header offset - will be computed dynamically in useAudioTextSync
  // Pass chromeVisible so it can calculate the offset when needed
  const audioSync = useAudioTextSync(contentRef, autoScrollEnabled, isRestoringScroll, chromeVisible, onChapterChange);

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

  // Handle audio track change
  const handleAudioTrackChange = useCallback(async (trackHref: string) => {
    if (!activeBook) return;

    // Find track by href
    const track = activeBook.audioTracks.find(t => t.href === trackHref);
    if (!track) return;

    // Save progress before changing tracks
    if (activeChapter) {
      await onSaveProgress(activeChapter.id);
    }

    // Preload next track
    const trackIndex = activeBook.audioTracks.findIndex(t => t.id === track.id);
    if (trackIndex >= 0) {
      await preloadNextAudioTrack(trackIndex);
    }
  }, [activeBook, activeChapter, onSaveProgress, preloadNextAudioTrack]);

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

