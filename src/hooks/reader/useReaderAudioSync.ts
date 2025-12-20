/**
 * Hook for managing audio sync logic
 * Extracted from ReaderWrapper for better composition
 */

import { useCallback, useRef } from "react";
import { findCurrentAudioSegment } from "../../lib/epub";
import type { Book, Chapter } from "../../types/reader";

type UseReaderAudioSyncParams = {
  activeBook?: Book;
  activeChapter?: Chapter;
  readerManager: {
    scrollToElementId: (elementId: string, behavior?: "smooth" | "auto") => void;
    changeChapter: (chapterId: string, options?: { scrollPosition?: "top" | "bottom" | "maintain"; isManualSelection?: boolean }) => Promise<void>;
  };
  onPendingScrollTarget: (elementId: string) => void;
};

/**
 * Hook that handles audio sync operations
 */
export function useReaderAudioSync({
  activeBook,
  activeChapter,
  readerManager,
  onPendingScrollTarget,
}: UseReaderAudioSyncParams) {
  const readerManagerRef = useRef(readerManager);
  readerManagerRef.current = readerManager;

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
    onPendingScrollTarget(segment.textElementId);
    readerManagerRef.current.changeChapter(chapter.id, { scrollPosition: "top" });
  }, [activeBook, activeChapter, onPendingScrollTarget]);

  const handleAudioSyncChapterChange = useCallback(async (chapterId: string, elementId?: string) => {
    if (elementId) {
      // Store the element ID to scroll to after chapter loads
      onPendingScrollTarget(elementId);
    }

    // Navigate to chapter with scrollPosition: "top" so it loads at the top,
    // then handlePendingScrollTarget will scroll to the element after load
    await readerManagerRef.current.changeChapter(chapterId, { scrollPosition: "top", isManualSelection: false });
  }, [onPendingScrollTarget]);

  return {
    handleSyncToAudio,
    handleAudioSyncChapterChange,
  };
}

