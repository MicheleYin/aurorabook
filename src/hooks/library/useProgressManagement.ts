/**
 * Progress management: update book progress with debouncing
 */

import { useCallback, useEffect, useRef } from "react";
import {
  updateBookProgress as updateBookProgressBackend,
} from "../../lib/book-service";
import { createDebounce } from "../../lib/debounce-utils";
import type { Book } from "../../types/reader";
import type { ChapterProgressSnapshot } from "../../components/reader/types";
import {
  getNumberValue,
  getPercentValue,
  getElementId,
  getElementIndex,
  isProgressUnchanged,
} from "./libraryHelpers";

export function useProgressManagement(
  library: Book[],
  setLibrary: React.Dispatch<React.SetStateAction<Book[]>>,
) {
  // Progress update debouncers - store pending updates
  const pendingProgressUpdateRef = useRef<{
    bookId: string;
    progress: NonNullable<Book["progress"]>;
    book: Book;
  } | null>(null);
  const progressUpdateDebouncerRef = useRef<
    ReturnType<typeof createDebounce> | null
  >(null);

  // Flush pending progress updates immediately (for navigation)
  const flushProgressUpdate = useCallback(async () => {
    const debouncer = progressUpdateDebouncerRef.current;
    if (debouncer && pendingProgressUpdateRef.current) {
      // Cancel the debounce and immediately execute the pending update
      debouncer.cancel();
      const pending = pendingProgressUpdateRef.current;
      if (pending) {
        try {
          const { updateBookProgress } = await import("../../lib/book-service");
          const updatedBook = await updateBookProgress(
            pending.bookId,
            pending.progress,
          );
          setLibrary((prev) =>
            prev.map((b) => (b.id === pending.bookId ? updatedBook : b)),
          );
        } catch (error) {
          console.error("Failed to flush progress to backend", {
            bookId: pending.bookId,
            error,
          });
          setLibrary((prev) =>
            prev.map((b) => (b.id === pending.bookId ? pending.book : b)),
          );
        } finally {
          pendingProgressUpdateRef.current = null;
        }
      }
    }
  }, [setLibrary]);

  // Initialize debouncer
  useEffect(() => {
    const progressDebouncer = createDebounce(async () => {
      const pending = pendingProgressUpdateRef.current;
      if (!pending) return;
      
      try {
        const updatedBook = await updateBookProgressBackend(
          pending.bookId,
          pending.progress,
        );
        setLibrary((prev) =>
          prev.map((b) => (b.id === pending.bookId ? updatedBook : b)),
        );
      } catch (error) {
        console.error("Failed to sync progress to backend", {
          bookId: pending.bookId,
          error,
        });
        setLibrary((prev) =>
          prev.map((b) => (b.id === pending.bookId ? pending.book : b)),
        );
      } finally {
        pendingProgressUpdateRef.current = null;
      }
    }, 200);

    progressUpdateDebouncerRef.current = progressDebouncer;
    
    return () => {
      progressDebouncer.cancel();
    };
  }, [setLibrary]);

  const updateBookProgress = useCallback(
    async (
      bookId: string,
      payload: {
        chapterId: string;
        scrollTop?: number;
        scrollHeight?: number;
        clientHeight?: number;
        percent?: number;
        elementId?: string | null;
        elementIndex?: number | null;
      },
    ) => {
      if (!payload?.chapterId) return;

      const book = library.find((b) => b.id === bookId);
      if (!book) return;

      const chapterIndex = book.chapters.findIndex(
        (chapter) => chapter.id === payload.chapterId,
      );
      if (chapterIndex === -1) return;

      const chapter = book.chapters[chapterIndex];
      const existingProgress = book.progress;
      const chapterMatchesExisting =
        existingProgress?.currentChapterId === chapter.id &&
        existingProgress.currentChapterIndex === chapterIndex;

      let chapterProgressPercent = getPercentValue(
        payload.percent,
        chapterMatchesExisting
          ? getPercentValue(existingProgress?.chapterProgressPercent, 0)
          : 0,
      );

      // If we're on the last chapter and near the bottom, treat it as 100% complete
      const totalChapters = book.chapters.length;
      const isLastChapter = chapterIndex === totalChapters - 1;
      if (isLastChapter && chapterProgressPercent >= 0.95) {
        // If user is at 95%+ of the last chapter, consider it finished
        chapterProgressPercent = 1.0;
      }

      // Calculate overall book progress across all chapters
      // Formula: (completed chapters + current chapter progress) / total chapters
      const bookProgressPercent = totalChapters > 0
        ? Math.min(Math.max((chapterIndex + chapterProgressPercent) / totalChapters, 0), 1)
        : 0;

      const nextProgress: NonNullable<Book["progress"]> = {
        currentChapterId: chapter.id,
        currentChapterHref: chapter.href,
        currentChapterIndex: chapterIndex,
        currentChapterElementId: getElementId(
          payload.elementId,
          chapterMatchesExisting
            ? getElementId(existingProgress?.currentChapterElementId, null)
            : null,
        ),
        currentChapterElementIndex: getElementIndex(
          payload.elementIndex,
          chapterMatchesExisting
            ? getElementIndex(
                existingProgress?.currentChapterElementIndex,
                null,
              )
            : null,
        ),
        currentChapterScrollTop: getNumberValue(
          payload.scrollTop,
          chapterMatchesExisting
            ? getNumberValue(existingProgress?.currentChapterScrollTop, 0)
            : 0,
        ),
        currentChapterScrollHeight: getNumberValue(
          payload.scrollHeight,
          chapterMatchesExisting
            ? getNumberValue(existingProgress?.currentChapterScrollHeight, 0)
            : 0,
        ),
        currentChapterClientHeight: getNumberValue(
          payload.clientHeight,
          chapterMatchesExisting
            ? getNumberValue(existingProgress?.currentChapterClientHeight, 0)
            : 0,
        ),
        chapterProgressPercent,
        bookProgressPercent,
        updatedAt: new Date().toISOString(),
      };

      if (isProgressUnchanged(existingProgress, nextProgress)) {
        return;
      }

      setLibrary((prev) =>
        prev.map((b) => (b.id === bookId ? { ...b, progress: nextProgress } : b)),
      );

      // Store pending update and trigger debounced backend sync
      pendingProgressUpdateRef.current = {
        bookId,
        progress: nextProgress,
        book,
      };
      
      const debouncer = progressUpdateDebouncerRef.current;
      if (debouncer) {
        debouncer.cancel();
        debouncer.call();
      }
    },
    [library, setLibrary],
  );

  const handleChapterProgress = useCallback(
    (bookId: string, snapshot: ChapterProgressSnapshot) => {
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

