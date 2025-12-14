/**
 * Chapter state persistence: update chapter progress with debouncing to backend
 * Simplified version with explicit debouncer creation
 */

import { useCallback, useRef } from "react";
import { logger } from "../../lib/logger";
import { updateBookProgress as updateBookProgressBackend } from "../../lib/book-service";
import { createDebounce } from "../../lib/debounce-utils";
import type { Book } from "../../types/reader";
import type { ChapterProgressSnapshot } from "../../components/reader/types";
import {
  getNumberValue,
  getPercentValue,
  getElementId,
  getElementIndex,
  isProgressUnchanged,
} from "../library/libraryHelpers";
import { useContext } from "react";
import { ReaderCoordinatorContext } from "../../contexts/ReaderCoordinatorContext";

export function useChapterStatePersistence(
  library: Book[],
  setLibrary: React.Dispatch<React.SetStateAction<Book[]>>,
) {
  // Get coordinator for operation management (optional - may not be available at library level)
  const coordinator = useContext(ReaderCoordinatorContext); // May be null if provider isn't available
  // Pending progress update
  const pendingProgressUpdateRef = useRef<{
    bookId: string;
    progress: NonNullable<Book["progress"]>;
    book: Book;
  } | null>(null);

  // Progress update debouncer - created once
  const progressUpdateDebouncerRef = useRef(
    createDebounce(async () => {
      const pending = pendingProgressUpdateRef.current;
      if (!pending) return;
      
      try {
        logger.log("[useChapterStatePersistence] Syncing progress to backend", {
          bookId: pending.bookId,
          chapterId: pending.progress.currentChapterId,
          chapterProgressPercent: pending.progress.chapterProgressPercent,
          bookProgressPercent: pending.progress.bookProgressPercent,
          scrollTop: pending.progress.currentChapterScrollTop,
          elementIndex: pending.progress.currentChapterElementIndex,
        });
        
        const updatedBook = await updateBookProgressBackend(
          pending.bookId,
          pending.progress,
        );
        
        logger.log("[useChapterStatePersistence] Backend sync completed", {
          bookId: pending.bookId,
          returnedChapterProgressPercent: updatedBook.progress?.chapterProgressPercent,
          returnedBookProgressPercent: updatedBook.progress?.bookProgressPercent,
        });
        
        setLibrary((prev) =>
          prev.map((b) => (b.id === pending.bookId ? updatedBook : b)),
        );
      } catch (error) {
        logger.error("[useChapterStatePersistence] Failed to sync progress to backend", {
          bookId: pending.bookId,
          chapterId: pending.progress.currentChapterId,
          chapterProgressPercent: pending.progress.chapterProgressPercent,
          error,
        });
        setLibrary((prev) =>
          prev.map((b) => (b.id === pending.bookId ? pending.book : b)),
        );
      } finally {
        pendingProgressUpdateRef.current = null;
      }
    }, 500)
  );

  const updateBookProgress = useCallback(
    async (
      bookId: string,
      snapshot: {
        chapterId: string;
        scrollTop?: number;
        scrollHeight?: number;
        clientHeight?: number;
        percent?: number;
        elementId?: string | null;
        elementIndex?: number | null;
        updatedAt?: string;
      },
    ) => {
      // NOTE: Do NOT call coordinator.saveChapterProgress here to avoid circular calls
      // The coordinator is used for coordination, but actual saving happens via updateBookProgress
      // which updates local state and triggers debounced backend sync

      if (!snapshot?.chapterId) return;

      const book = library.find((b) => b.id === bookId);
      if (!book) return;

      const chapterIndex = book.chapters.findIndex(
        (chapter) => chapter.id === snapshot.chapterId,
      );
      if (chapterIndex === -1) return;

      const chapter = book.chapters[chapterIndex];
      const existingProgress = book.progress;
      const chapterMatchesExisting =
        existingProgress?.currentChapterId === chapter.id &&
        existingProgress.currentChapterIndex === chapterIndex;

      let chapterProgressPercent = getPercentValue(
        snapshot.percent,
        chapterMatchesExisting
          ? getPercentValue(existingProgress?.chapterProgressPercent, 0)
          : 0,
      );

      logger.log("[useChapterStatePersistence] Calculating chapter progress percent", {
        bookId,
        chapterId: snapshot.chapterId,
        payloadPercent: snapshot.percent,
        calculatedPercent: chapterProgressPercent,
        existingPercent: existingProgress?.chapterProgressPercent,
        chapterMatchesExisting,
      });

      // If we're on the last chapter and near the bottom, treat it as 100% complete
      const totalChapters = book.chapters.length;
      const isLastChapter = chapterIndex === totalChapters - 1;
      if (isLastChapter && chapterProgressPercent >= 0.95) {
        chapterProgressPercent = 1.0;
        logger.log("[useChapterStatePersistence] Last chapter near completion, setting to 100%", {
          bookId,
          chapterId: snapshot.chapterId,
        });
      }

      // Calculate overall book progress
      const bookProgressPercent = totalChapters > 0
        ? Math.min(Math.max((chapterIndex + chapterProgressPercent) / totalChapters, 0), 1)
        : 0;

      const nextProgress: NonNullable<Book["progress"]> = {
        currentChapterId: chapter.id,
        currentChapterHref: chapter.href,
        currentChapterIndex: chapterIndex,
        currentChapterElementId: getElementId(
          snapshot.elementId,
          chapterMatchesExisting
            ? getElementId(existingProgress?.currentChapterElementId, null)
            : null,
        ),
        currentChapterElementIndex: getElementIndex(
          snapshot.elementIndex,
          chapterMatchesExisting
            ? getElementIndex(
                existingProgress?.currentChapterElementIndex,
                null,
              )
            : null,
        ),
        currentChapterScrollTop: getNumberValue(
          snapshot.scrollTop,
          chapterMatchesExisting
            ? getNumberValue(existingProgress?.currentChapterScrollTop, 0)
            : 0,
        ),
        currentChapterScrollHeight: getNumberValue(
          snapshot.scrollHeight,
          chapterMatchesExisting
            ? getNumberValue(existingProgress?.currentChapterScrollHeight, 0)
            : 0,
        ),
        currentChapterClientHeight: getNumberValue(
          snapshot.clientHeight,
          chapterMatchesExisting
            ? getNumberValue(existingProgress?.currentChapterClientHeight, 0)
            : 0,
        ),
        chapterProgressPercent,
        bookProgressPercent,
        updatedAt: snapshot.updatedAt ?? new Date().toISOString(),
      };

      if (isProgressUnchanged(existingProgress, nextProgress)) {
        return;
      }

      // If there's a pending update for a different chapter, flush it first
      // This prevents losing progress when changing chapters rapidly
      const pending = pendingProgressUpdateRef.current;
      if (pending && pending.bookId === bookId && pending.progress.currentChapterId !== chapter.id) {
        // Different chapter - flush the pending update immediately before setting new one
        const debouncer = progressUpdateDebouncerRef.current;
        debouncer.cancel();
        
        try {
          const updatedBook = await updateBookProgressBackend(
            pending.bookId,
            pending.progress,
          );
          setLibrary((prev) =>
            prev.map((b) => (b.id === pending.bookId ? updatedBook : b)),
          );
        } catch (error) {
          console.error("Failed to flush previous chapter progress", {
            bookId: pending.bookId,
            chapterId: pending.progress.currentChapterId,
            error,
          });
          // Continue anyway - update local state with new progress
        } finally {
          pendingProgressUpdateRef.current = null;
        }
      }

      // Update local state immediately (only if progress actually changed)
      // Use functional update to avoid unnecessary re-renders
      setLibrary((prev) => {
        const book = prev.find((b) => b.id === bookId);
        if (!book) return prev;
        
        // Check if progress actually changed to avoid unnecessary updates
        if (isProgressUnchanged(book.progress, nextProgress)) {
          return prev; // No change, return same reference
        }
        
        return prev.map((b) => (b.id === bookId ? { ...b, progress: nextProgress } : b));
      });

      logger.log("[useChapterStatePersistence] Prepared progress update", {
        bookId,
        chapterId: nextProgress.currentChapterId,
        chapterProgressPercent: nextProgress.chapterProgressPercent,
        bookProgressPercent: nextProgress.bookProgressPercent,
        scrollTop: nextProgress.currentChapterScrollTop,
        elementIndex: nextProgress.currentChapterElementIndex,
      });

      // NOTE: Do NOT call coordinator.saveChapterProgress here to avoid circular calls
      // The coordinator.saveChapterProgress will be called separately when needed (e.g., on unmount)
      // This prevents: updateBookProgress -> coordinator.saveChapterProgress -> onChapterProgressSave -> handleChapterProgress -> updateBookProgress (loop!)
      
      // Store pending update and trigger debounced backend sync
      pendingProgressUpdateRef.current = {
        bookId,
        progress: nextProgress,
        book,
      };
      
      progressUpdateDebouncerRef.current.call();
    },
    [library, setLibrary, coordinator],
  );

  // Flush pending progress updates immediately (for navigation)
  const flushProgressUpdate = useCallback(async () => {
    const pending = pendingProgressUpdateRef.current;
    if (!pending) return;

    const debouncer = progressUpdateDebouncerRef.current;
    debouncer.cancel();

    try {
      logger.log("[useChapterStatePersistence] Flushing progress to backend", {
        bookId: pending.bookId,
        chapterId: pending.progress.currentChapterId,
        chapterProgressPercent: pending.progress.chapterProgressPercent,
        bookProgressPercent: pending.progress.bookProgressPercent,
        scrollTop: pending.progress.currentChapterScrollTop,
        elementIndex: pending.progress.currentChapterElementIndex,
      });
      
      const updatedBook = await updateBookProgressBackend(
        pending.bookId,
        pending.progress,
      );
      
      logger.log("[useChapterStatePersistence] Backend flush completed", {
        bookId: pending.bookId,
        returnedChapterProgressPercent: updatedBook.progress?.chapterProgressPercent,
        returnedBookProgressPercent: updatedBook.progress?.bookProgressPercent,
      });
      
      setLibrary((prev) =>
        prev.map((b) => (b.id === pending.bookId ? updatedBook : b)),
      );
    } catch (error) {
      logger.error("[useChapterStatePersistence] Failed to flush progress to backend", {
        bookId: pending.bookId,
        chapterId: pending.progress.currentChapterId,
        chapterProgressPercent: pending.progress.chapterProgressPercent,
        error,
      });
      setLibrary((prev) =>
        prev.map((b) => (b.id === pending.bookId ? pending.book : b)),
      );
    } finally {
      pendingProgressUpdateRef.current = null;
    }
  }, [setLibrary]);

  const handleChapterProgress = useCallback(
    async (bookId: string, snapshot: ChapterProgressSnapshot) => {
      // NOTE: Do NOT call coordinator.saveChapterProgress here to avoid circular calls
      // The coordinator.saveChapterProgress -> onChapterProgressSave -> handleChapterProgress creates a loop
      // Instead, just update local state which will trigger debounced backend sync
      
      logger.log("[useChapterStatePersistence] handleChapterProgress called", {
        bookId,
        chapterId: snapshot.chapterId,
        snapshotPercent: snapshot.percent,
        snapshotScrollTop: snapshot.scrollTop,
        snapshotActiveElementIndex: snapshot.activeElementIndex,
      });
      
      // Update local state via updateBookProgress (this triggers debounced backend sync)
      updateBookProgress(bookId, {
        chapterId: snapshot.chapterId,
        scrollTop: snapshot.scrollTop,
        scrollHeight: snapshot.scrollHeight,
        clientHeight: snapshot.clientHeight,
        percent: snapshot.percent,
        elementId: snapshot.activeElementId,
        elementIndex: snapshot.activeElementIndex,
      });
    },
    [updateBookProgress],
  );

  return {
    updateBookProgress,
    handleChapterProgress,
    flushProgressUpdate,
  };
}
