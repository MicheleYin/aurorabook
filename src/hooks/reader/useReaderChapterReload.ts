/**
 * Hook for managing chapter reload logic
 * Extracted from ReaderWrapper for better composition
 */

import { useCallback, useRef } from "react";
import { logger } from "../../lib/logger";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { selectLibrary } from "../../store/selectors";
import { updateBook } from "../../store/slices/librarySlice";

type UseReaderChapterReloadParams = {
  activeBookId?: string;
  activeChapterId?: string;
  onSelectChapter: (chapterId: string, options?: { scrollPosition?: "top" | "bottom" | "maintain"; isManualSelection?: boolean }) => void;
};

/**
 * Hook that handles chapter reloading
 */
export function useReaderChapterReload({
  activeBookId,
  activeChapterId,
  onSelectChapter,
}: UseReaderChapterReloadParams) {
  const dispatch = useAppDispatch();
  const library = useAppSelector(selectLibrary);
  const reloadingRef = useRef(false);

  const handleChapterReload = useCallback(async () => {
    if (!activeBookId || !activeChapterId || reloadingRef.current) {
      return;
    }

    reloadingRef.current = true;

    try {
      // Get fresh book and chapter from library state
      const currentBook = library.find((b) => b.id === activeBookId);
      if (!currentBook) {
        logger.warn("[useReaderChapterReload] Book not found in library when reloading chapter", {
          bookId: activeBookId,
        });
        return;
      }

      const currentChapter = currentBook.chapters.find((ch) => ch.id === activeChapterId);
      if (!currentChapter) {
        logger.warn("[useReaderChapterReload] Chapter not found in book when reloading", {
          bookId: activeBookId,
          chapterId: activeChapterId,
        });
        return;
      }

      logger.log("[useReaderChapterReload] Starting chapter reload", {
        chapterId: activeChapterId,
        bookId: activeBookId,
      });

      // Load chapter content
      const { ensureChapterLoaded } = await import("../../lib/lazy-chapter-loader");
      const reloadedChapter = await ensureChapterLoaded(currentBook.sourcePath, currentChapter);

      // Update the library state with the reloaded chapter
      dispatch(updateBook({
        bookId: activeBookId,
        updates: {
          chapters: currentBook.chapters.map((ch) =>
            ch.id === activeChapterId ? reloadedChapter : ch
          ),
        },
      }));

      // Re-select the chapter to trigger re-render with new content
      onSelectChapter(activeChapterId, {
        scrollPosition: "maintain",
        isManualSelection: false,
      });

      logger.log("[useReaderChapterReload] Chapter reload completed", {
        chapterId: activeChapterId,
        bookId: activeBookId,
      });
    } catch (error) {
      logger.error("[useReaderChapterReload] Failed to reload chapter", {
        bookId: activeBookId,
        chapterId: activeChapterId,
        error,
      });
    } finally {
      reloadingRef.current = false;
    }
  }, [activeBookId, activeChapterId, library, dispatch, onSelectChapter]);

  return { handleChapterReload };
}

