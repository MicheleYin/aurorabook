/**
 * Helper functions for library operations
 */

import type { Book, BookProgress } from "../../types/reader";
import {
  estimatePagesFromWords,
  getChapterPageCount,
  getChapterWordCount,
} from "../../lib/utils";

export function getNumberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(value, 0)
    : fallback;
}

export function getPercentValue(value: unknown, fallback: number): number {
  const num =
    typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Number(Math.min(Math.max(num, 0), 1).toFixed(4));
}

export function getElementId(value: unknown, fallback: string | null): string | null {
  if (value === undefined) return fallback;
  if (value === null) return null;
  if (typeof value === "string" && value.length > 0) return value;
  return null;
}

export function getElementIndex(value: unknown, fallback: number | null): number | null {
  if (value === undefined) return fallback;
  if (value === null) return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(Math.round(value), 0);
  }
  return fallback;
}

export function isProgressUnchanged(
  existing: Book["progress"],
  next: NonNullable<Book["progress"]>,
): boolean {
  if (!existing) return false;

  if (existing.currentChapterId !== next.currentChapterId) return false;
  if (existing.currentChapterIndex !== next.currentChapterIndex) return false;

  return (
    Math.abs(
      getNumberValue(existing.currentChapterScrollTop, 0) -
        next.currentChapterScrollTop,
    ) < 1 &&
    Math.abs(
      getNumberValue(existing.currentChapterScrollHeight, 0) -
        next.currentChapterScrollHeight,
    ) < 1 &&
    Math.abs(
      getNumberValue(existing.currentChapterClientHeight, 0) -
        next.currentChapterClientHeight,
    ) < 1 &&
    Math.abs((existing.chapterProgressPercent ?? 0) - next.chapterProgressPercent) <
      0.002 &&
    (existing.currentChapterElementId ?? null) ===
      (next.currentChapterElementId ?? null) &&
    (existing.currentChapterElementIndex ?? null) ===
      (next.currentChapterElementIndex ?? null)
  );
}

export const applyDerivedFields = (book: Book): Book => {
  let chaptersChanged = false;

  const normalizedChapters = book.chapters.map((chapter) => {
    const normalizedWordCount = getChapterWordCount(chapter);
    const normalizedPageCount = getChapterPageCount({
      ...chapter,
      wordCount: normalizedWordCount,
    });

    const needsWordCountUpdate =
      typeof chapter.wordCount !== "number" ||
      chapter.wordCount !== normalizedWordCount;
    const needsPageCountUpdate =
      normalizedPageCount !== undefined &&
      chapter.estimatedPageCount !== normalizedPageCount;

    if (!needsWordCountUpdate && !needsPageCountUpdate) {
      return chapter;
    }

    chaptersChanged = true;
    return {
      ...chapter,
      wordCount: normalizedWordCount,
      estimatedPageCount:
        normalizedPageCount ?? chapter.estimatedPageCount,
    };
  });

  const totalWords = normalizedChapters.reduce(
    (sum, chapter) => sum + getChapterWordCount(chapter),
    0,
  );
  const derivedPageCount = estimatePagesFromWords(totalWords);
  const normalizedPageCount =
    derivedPageCount !== undefined
      ? Math.max(1, Math.round(derivedPageCount))
      : undefined;

  const existingPageCount =
    typeof book.pageCount === "number" && Number.isFinite(book.pageCount)
      ? Math.max(1, Math.round(book.pageCount))
      : undefined;
  const needsBookPageUpdate =
    normalizedPageCount !== undefined &&
    normalizedPageCount !== existingPageCount;

  if (!chaptersChanged && !needsBookPageUpdate) {
    return book;
  }

  const nextBook: Book = {
    ...book,
    chapters: chaptersChanged ? normalizedChapters : book.chapters,
  };

  if (normalizedPageCount !== undefined) {
    nextBook.pageCount = normalizedPageCount;
  }

  return nextBook;
};

type LegacyProgressFields = {
  currentChapterPageIndex?: number;
  currentChapterPageCount?: number;
};

export const normalizeBookProgressShape = (book: Book): Book => {
  if (!book.progress) return book;

  const progress = book.progress as BookProgress & LegacyProgressFields;

  const normalizedIndex =
    typeof progress.currentChapterIndex === "number" &&
    Number.isFinite(progress.currentChapterIndex)
      ? Math.max(Math.round(progress.currentChapterIndex), 0)
      : 0;

  const elementId = getElementId(progress.currentChapterElementId, null);
  const elementIndex = getElementIndex(
    progress.currentChapterElementIndex,
    null,
  );

  const scrollTop = getNumberValue(progress.currentChapterScrollTop, 0);
  const scrollHeight = getNumberValue(
    progress.currentChapterScrollHeight,
    0,
  );
  const clientHeight = getNumberValue(
    progress.currentChapterClientHeight,
    0,
  );

  let percent =
    typeof progress.chapterProgressPercent === "number" &&
    Number.isFinite(progress.chapterProgressPercent)
      ? progress.chapterProgressPercent
      : undefined;

  if (
    (percent === undefined || percent === 0) &&
    scrollHeight > 0 &&
    clientHeight >= 0 &&
    scrollTop > 0
  ) {
    const maxScroll = Math.max(scrollHeight - clientHeight, 0);
    if (maxScroll > 0) {
      percent = Math.min(Math.max(scrollTop / maxScroll, 0), 1);
    }
  }

  if (percent === undefined) {
    if (
      typeof progress.currentChapterPageIndex === "number" &&
      Number.isFinite(progress.currentChapterPageIndex) &&
      typeof progress.currentChapterPageCount === "number" &&
      Number.isFinite(progress.currentChapterPageCount) &&
      progress.currentChapterPageCount > 1
    ) {
      percent = Math.min(
        Math.max(
          Math.round(progress.currentChapterPageIndex) /
            Math.max(Math.round(progress.currentChapterPageCount) - 1, 1),
          0,
        ),
        1,
      );
    } else {
      percent = 0;
    }
  }

  let normalizedPercent = Number(Math.min(Math.max(percent ?? 0, 0), 1).toFixed(4));

  // If we're on the last chapter and near the bottom, treat it as 100% complete
  const totalChapters = book.chapters.length;
  const isLastChapter = normalizedIndex === totalChapters - 1;
  if (isLastChapter && normalizedPercent >= 0.95) {
    // If user is at 95%+ of the last chapter, consider it finished
    normalizedPercent = 1.0;
  }

  // Calculate overall book progress across all chapters
  // Use existing bookProgressPercent if available, otherwise calculate it
  const bookProgressPercent = typeof progress.bookProgressPercent === "number" &&
    Number.isFinite(progress.bookProgressPercent)
    ? Math.min(Math.max(progress.bookProgressPercent, 0), 1)
    : totalChapters > 0
    ? Math.min(Math.max((normalizedIndex + normalizedPercent) / totalChapters, 0), 1)
    : 0;

  return {
    ...book,
    progress: {
      currentChapterId: progress.currentChapterId,
      currentChapterHref: progress.currentChapterHref,
      currentChapterIndex: normalizedIndex,
      currentChapterElementId: elementId,
      currentChapterElementIndex: elementIndex,
      currentChapterScrollTop: scrollTop,
      currentChapterScrollHeight: scrollHeight,
      currentChapterClientHeight: clientHeight,
      chapterProgressPercent: normalizedPercent,
      bookProgressPercent,
      updatedAt: progress.updatedAt ?? new Date().toISOString(),
    },
  };
};

