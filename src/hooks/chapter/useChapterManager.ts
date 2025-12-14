/**
 * Unified Chapter Manager Hook
 * 
 * Consolidates all chapter-related operations into a single hook:
 * - Chapter state (chapter index, restoration)
 * - Chapter loading
 * - Progress saving
 * - Chapter changes
 * 
 * All operations go through ReaderCoordinator for proper coordination.
 */

import { useCallback, useMemo } from "react";
import { logger } from "../../lib/logger";
import type { Book, Chapter } from "../../types/reader";
import type { ChapterProgressSnapshot } from "../../components/reader/types";
import { useReaderCoordinator } from "../../contexts/ReaderCoordinatorContext";
import { useLibraryContext } from "../library/LibraryContext";
import { useChapterState } from "./useChapterState";
import { useChapterLoader } from "./useChapterLoader";

type UseChapterManagerParams = {
  bookId?: string;
  chapters: Chapter[];
  activeBook?: Book;
  activeChapter?: Chapter;
  contentRef: React.RefObject<HTMLDivElement | null>;
  onProgress?: (snapshot: ChapterProgressSnapshot) => void;
  onChapterChange?: (chapterId: string, elementId?: string) => void;
  onSaveProgress?: (chapterId: string) => Promise<void>;
};

export function useChapterManager(params: UseChapterManagerParams) {
  const {
    bookId,
    chapters,
    activeBook,
    activeChapter,
    contentRef: _contentRef,
    onProgress,
    onChapterChange: _onChapterChange,
    onSaveProgress,
  } = params;

  const coordinator = useReaderCoordinator();
  const { library } = useLibraryContext();

  // Chapter state (from library hook)
  const chapterState = useChapterState({
    bookId,
    chapters,
    library,
    onProgress: onProgress ? (snapshot) => {
      const progressSnapshot: ChapterProgressSnapshot = {
        chapterId: snapshot.chapterId,
        scrollTop: snapshot.scrollTop ?? 0,
        scrollHeight: 0,
        clientHeight: 0,
        percent: snapshot.percent ?? 0,
        activeElementId: null,
        activeElementIndex: snapshot.elementIndex ?? null,
      };
      onProgress(progressSnapshot);
    } : undefined,
  });

  // Chapter loader
  const chapterLoader = useChapterLoader();

  // Get cached chapters
  const cachedChapters = useMemo(() => {
    if (!activeBook) return [];
    
    return activeBook.chapters.map(chapter => {
      const cached = chapterLoader.loadedChapters.get(chapter.id);
      return cached || chapter;
    });
  }, [activeBook, chapterLoader.loadedChapters]);

  // Get current chapter
  const currentChapter = useMemo(() => {
    const chapter = chapters[chapterState.currentIndex];
    if (!chapter) return undefined;
    const cached = chapterLoader.loadedChapters.get(chapter.id);
    return cached || chapter;
  }, [chapters, chapterState.currentIndex, chapterLoader.loadedChapters]);

  // Handle chapter progress updates
  const handleChapterProgress = useCallback((snapshot: ChapterProgressSnapshot) => {
    logger.log("[Chapter Manager] Progress update", {
      chapterId: snapshot.chapterId,
      scrollTop: snapshot.scrollTop,
      percent: snapshot.percent,
    });
    
    if (onProgress) {
      onProgress(snapshot);
    }
  }, [onProgress]);

  // Change chapter
  const changeChapter = useCallback(async (
    chapterId: string,
    options?: { scrollPosition?: "top" | "bottom" | "maintain"; isManualSelection?: boolean }
  ) => {
    if (!activeBook) return;

    const chapter = activeBook.chapters.find(ch => ch.id === chapterId);
    if (!chapter) return;

    // Use coordinator to change chapter
    await coordinator.changeChapter(activeBook.id, chapterId, options);

    // Check if cancelled
    const currentOp = coordinator.getCurrentOperation("changeChapter");
    if (currentOp?.cancelled) {
      logger.log("[Chapter Manager] Chapter change was cancelled", { chapterId });
      return;
    }

    // Save progress before changing chapters
    if (activeChapter && onSaveProgress) {
      await onSaveProgress(activeChapter.id);
    }

    // Update chapter index
    const chapterIndex = activeBook.chapters.findIndex(ch => ch.id === chapterId);
    if (chapterIndex >= 0) {
      chapterState.setCurrentIndex(chapterIndex);
    }
  }, [
    activeBook,
    activeChapter,
    coordinator,
    onSaveProgress,
    chapterState,
  ]);

  // Load chapter
  const loadChapter = useCallback(async (
    chapterId: string
  ): Promise<Chapter | null> => {
    if (!bookId || !activeBook) return null;
    
    const chapter = activeBook.chapters.find(ch => ch.id === chapterId);
    if (!chapter) return null;
    
    return await chapterLoader.loadChapter(bookId, chapter);
  }, [bookId, activeBook, chapterLoader]);

  // Save chapter progress
  const saveChapterProgress = useCallback(async (
    chapterId: string,
    snapshot: ChapterProgressSnapshot
  ) => {
    if (!bookId) return;
    
    await coordinator.saveChapterProgress(bookId, chapterId, snapshot);
  }, [bookId, coordinator]);

  // Restore chapter progress
  const restoreChapterProgress = useCallback(async (
    chapterId: string
  ) => {
    if (!bookId) return;
    
    await coordinator.restoreChapterProgress(bookId, chapterId);
  }, [bookId, coordinator]);

  return {
    // State from chapterState
    currentIndex: chapterState.currentIndex,
    setCurrentIndex: chapterState.setCurrentIndex,
    restoreScrollTop: chapterState.restoreScrollTop,
    restoreElementIndex: chapterState.restoreElementIndex,
    isRestoring: chapterState.isRestoring,
    onChapterLoaded: chapterState.onChapterLoaded,
    onChapterChanged: chapterState.onChapterChanged,
    emitProgress: chapterState.emitProgress,

    // Chapter loading
    cachedChapters,
    currentChapter,
    loadChapter,
    isChapterLoaded: (chapterId: string) => {
      if (!bookId) return false;
      return chapterLoader.isChapterLoaded(bookId, chapterId);
    },

    // Operations
    changeChapter,
    handleChapterProgress,
    saveChapterProgress,
    restoreChapterProgress,

    // Coordinator access
    coordinator,
  };
}
