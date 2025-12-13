/**
 * Unified Audio Player Manager Hook
 * 
 * Consolidates all audio-related operations into a single hook:
 * - Audio player state (track index, restoration)
 * - Audio track loading
 * - Audio-text synchronization
 * - Progress saving
 * - Track changes
 * 
 * All operations go through ReaderCoordinator for proper coordination.
 */

import { useCallback, useMemo } from "react";
import { logger } from "../../lib/logger";
import type { Book, Chapter, AudioTrack } from "../../types/reader";
import type { AudioProgressSnapshot } from "../../components/reader/types";
import { useReaderCoordinator } from "../../contexts/ReaderCoordinatorContext";
import { useLibraryContext } from "../../hooks/library/LibraryContext";
import { useAudioPlayerState } from "../../hooks/library/useAudioPlayerState";
import { useAudioTrackLoader } from "./useAudioTrackLoader";
import { useAudioTextSync } from "./useAudioTextSync";
import { findChaptersForAudioTrack, chapterHrefsMatch } from "../../lib/epub";

type UseAudioPlayerManagerParams = {
  bookId?: string;
  tracks: AudioTrack[];
  activeBook?: Book;
  activeChapter?: Chapter;
  contentRef: React.RefObject<HTMLDivElement | null>;
  autoScrollEnabled: boolean;
  isRestoringScroll: boolean;
  chromeVisible?: boolean;
  audioPlayerVisible?: boolean;
  onProgress?: (snapshot: AudioProgressSnapshot) => void;
  onChapterChange?: (chapterId: string, elementId?: string) => void;
  onChapterReload?: (chapterId: string) => void;
  onTrackChangeChapterChange?: (chapterId: string, options?: { scrollPosition?: "top" | "bottom" | "maintain"; isManualSelection?: boolean }) => Promise<void>;
  onSaveProgress?: (chapterId: string) => Promise<void>;
};

export function useAudioPlayerManager(params: UseAudioPlayerManagerParams) {
  const {
    bookId,
    tracks,
    activeBook,
    activeChapter,
    contentRef,
    autoScrollEnabled,
    isRestoringScroll,
    chromeVisible = true,
    audioPlayerVisible = false,
    onProgress,
    onChapterChange,
    onChapterReload,
    onTrackChangeChapterChange,
    onSaveProgress,
  } = params;

  const coordinator = useReaderCoordinator();
  const { library } = useLibraryContext();

  // Audio player state (from library hook)
  const audioPlayerState = useAudioPlayerState({
    bookId,
    tracks,
    library,
    onProgress,
  });

  // Track loader
  const audioTrackLoader = useAudioTrackLoader();

  // Audio-text sync
  const audioTextSync = useAudioTextSync(
    contentRef,
    autoScrollEnabled,
    isRestoringScroll,
    chromeVisible,
    onChapterChange,
    onChapterReload,
    audioPlayerVisible,
    activeChapter?.id
  );

  // Get cached tracks
  const cachedTracks = useMemo(() => {
    if (!activeBook) return [];
    
    return activeBook.audioTracks.map(track => {
      const cached = audioTrackLoader.loadedTracks.get(track.id);
      return cached || track;
    });
  }, [activeBook, audioTrackLoader.loadedTracks]);

  // Get current track
  const currentTrack = useMemo(() => {
    const track = tracks[audioPlayerState.currentIndex];
    if (!track) return undefined;
    const cached = audioTrackLoader.loadedTracks.get(track.id);
    return cached || track;
  }, [tracks, audioPlayerState.currentIndex, audioTrackLoader.loadedTracks]);

  // Handle audio progress updates
  const handleAudioProgress = useCallback((snapshot: AudioProgressSnapshot) => {
    logger.log("[Audio Player Manager] Progress update", {
      trackHref: snapshot.trackHref,
      currentTime: snapshot.currentTimeSeconds,
    });
    
    // Update highlighting
    if (activeBook && snapshot.trackHref) {
      audioTextSync.updateHighlight(
        activeBook,
        activeChapter,
        snapshot.trackHref,
        snapshot.currentTimeSeconds
      );
    }
  }, [activeBook, activeChapter, audioTextSync]);

  // Change audio track
  const changeAudioTrack = useCallback(async (
    trackHref: string,
    direction?: "next" | "previous" | "random"
  ) => {
    if (!activeBook) return;

    const track = activeBook.audioTracks.find(t => t.href === trackHref);
    if (!track) return;

    // Use coordinator to change track
    await coordinator.changeAudioTrack(activeBook.id, track.id, direction);

    // Check if cancelled
    const currentOp = coordinator.getCurrentOperation("changeAudioTrack");
    if (currentOp?.cancelled) {
      logger.log("[Audio Player Manager] Track change was cancelled", { trackHref });
      return;
    }

    // Mark track change in audio sync
    audioTextSync.markTrackChange(trackHref);

    // Save progress before changing tracks
    if (activeChapter && onSaveProgress) {
      await onSaveProgress(activeChapter.id);
    }

    // Handle chapter change if auto-scroll is enabled
    if (autoScrollEnabled && onTrackChangeChapterChange) {
      const chapterHrefs = findChaptersForAudioTrack(activeBook.audioSyncMap, trackHref);
      if (chapterHrefs.length > 0) {
        const matchingChapter = activeBook.chapters.find((chapter) => {
          return chapterHrefs.some(segmentChapterHref => {
            return chapterHrefsMatch(segmentChapterHref, chapter.href);
          });
        });

        if (matchingChapter && matchingChapter.id !== activeChapter?.id) {
          audioTextSync.markChapterChange(matchingChapter.id);
          await onTrackChangeChapterChange(matchingChapter.id, {
            scrollPosition: "top",
            isManualSelection: false,
          });
        }
      }
    }

    // Preload next track
    const trackIndex = activeBook.audioTracks.findIndex(t => t.id === track.id);
    if (trackIndex >= 0 && trackIndex + 1 < activeBook.audioTracks.length) {
      const nextTrack = activeBook.audioTracks[trackIndex + 1];
      if (!nextTrack.url && !audioTrackLoader.isTrackLoaded(activeBook.id, nextTrack.id)) {
        await coordinator.loadAudioTrack(activeBook.id, nextTrack.id);
      }
    }
  }, [
    activeBook,
    activeChapter,
    coordinator,
    audioTextSync,
    autoScrollEnabled,
    onTrackChangeChapterChange,
    onSaveProgress,
    audioTrackLoader,
  ]);

  // Load audio track
  const loadAudioTrack = useCallback(async (
    trackId: string
  ): Promise<string | null> => {
    if (!bookId) return null;
    
    return await coordinator.loadAudioTrack(bookId, trackId);
  }, [bookId, coordinator]);

  // Save audio timestamp
  const saveAudioTimestamp = useCallback(async (
    trackId: string,
    timestamp: number
  ) => {
    if (!bookId) return;
    
    await coordinator.saveAudioTimestamp(bookId, trackId, timestamp);
  }, [bookId, coordinator]);

  // Restore audio timestamp
  const restoreAudioTimestamp = useCallback(async (
    trackId: string,
    timestamp: number
  ) => {
    if (!bookId) return;
    
    await coordinator.restoreAudioTimestamp(bookId, trackId, timestamp);
  }, [bookId, coordinator]);

  return {
    // State from audioPlayerState
    currentIndex: audioPlayerState.currentIndex,
    setCurrentIndex: audioPlayerState.setCurrentIndex,
    restoreTime: audioPlayerState.restoreTime,
    isRestoring: audioPlayerState.isRestoring,
    onTrackLoaded: audioPlayerState.onTrackLoaded,
    onTrackChanged: audioPlayerState.onTrackChanged,
    emitProgress: audioPlayerState.emitProgress,

    // Track loading
    cachedTracks,
    currentTrack,
    loadAudioTrack,
    isTrackLoaded: (trackId: string) => {
      if (!bookId) return false;
      return audioTrackLoader.isTrackLoaded(bookId, trackId);
    },

    // Audio-text sync
    highlightedElementId: audioTextSync.highlightedElementId,
    updateHighlight: audioTextSync.updateHighlight,
    clearHighlight: audioTextSync.clearHighlight,
    markTrackChange: audioTextSync.markTrackChange,
    markChapterChange: audioTextSync.markChapterChange,

    // Operations
    changeAudioTrack,
    handleAudioProgress,
    saveAudioTimestamp,
    restoreAudioTimestamp,

    // Coordinator access
    coordinator,
  };
}

