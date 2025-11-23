import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

import type { Book, Chapter } from "../types/reader";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const WORD_MATCH_REGEX = /\S+/g;
const AVERAGE_WORDS_PER_PAGE = 275;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const normalizePositiveInteger = (value?: number) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.max(1, Math.round(value));
};

export const countWords = (text?: string | null) => {
  if (!text) return 0;
  const matches = text.match(WORD_MATCH_REGEX);
  return matches ? matches.length : 0;
};

export const estimatePagesFromWords = (wordCount: number) => {
  if (!Number.isFinite(wordCount) || wordCount <= 0) {
    return undefined;
  }
  const estimated = Math.round(wordCount / AVERAGE_WORDS_PER_PAGE);
  if (!Number.isFinite(estimated) || estimated <= 0) {
    return undefined;
  }
  return Math.max(1, estimated);
};

export const getChapterWordCount = (
  chapter: Pick<Chapter, "wordCount" | "plainText">,
) => {
  if (typeof chapter.wordCount === "number" && Number.isFinite(chapter.wordCount)) {
    return Math.max(0, Math.round(chapter.wordCount));
  }
  return countWords(chapter.plainText);
};

export const getChapterPageCount = (
  chapter: Pick<Chapter, "estimatedPageCount" | "wordCount" | "plainText">,
) => {
  const fromChapter = normalizePositiveInteger(chapter.estimatedPageCount);
  if (fromChapter) {
    return fromChapter;
  }
  const words = getChapterWordCount(chapter);
  return estimatePagesFromWords(words);
};

export type BookProgressSummary = {
  current: number;
  currentIndex: number;
  total: number;
  isStarted: boolean;
  isFinished: boolean;
  label: string;
  chapterLabel?: string;
  pageLabel?: string;
  pageIndex?: number;
  pageNumber?: number;
  pageCount?: number;
  percent?: number;
  chapterNumber?: number;
  currentChapterTitle?: string;
};

export function getBookProgressSummary(
  book: Pick<Book, "chapters" | "progress">,
): BookProgressSummary {
  const total = book.chapters.length;
  if (total === 0) {
    return {
      current: 0,
      currentIndex: -1,
      total,
      isStarted: false,
      isFinished: false,
      label: "No chapters available",
      currentChapterTitle: undefined,
    };
  }

  const fallbackChapter = book.chapters[0];
  const defaultPageCount = fallbackChapter ? getChapterPageCount(fallbackChapter) : undefined;

  if (!book.progress) {
    const defaultChapterLabel =
      total > 0 ? `Chapter 1 of ${total}` : fallbackChapter ? "Chapter 1" : undefined;
    const defaultPageLabel = defaultPageCount ? `Page 1 of ${defaultPageCount}` : undefined;

    const labelParts = [defaultChapterLabel, defaultPageLabel].filter(
      (part): part is string => Boolean(part),
    );

    return {
      current: 0,
      currentIndex: -1,
      total,
      isStarted: false,
      isFinished: false,
      label: labelParts.length ? labelParts.join(" · ") : `0 of ${total} chapters`,
      chapterLabel: defaultChapterLabel,
      pageLabel: defaultPageLabel,
      pageIndex: 0,
      pageNumber: 1,
      pageCount: defaultPageCount,
      chapterNumber: 1,
      currentChapterTitle: fallbackChapter?.title,
    };
  }

  const progress = book.progress;
  const byIdIndex =
    progress.currentChapterId !== undefined
      ? book.chapters.findIndex((chapter) => chapter.id === progress.currentChapterId)
      : -1;
  const rawIndexCandidate = clamp(progress.currentChapterIndex, 0, total - 1);
  const rawIndex = byIdIndex >= 0 ? byIdIndex : rawIndexCandidate;
  const normalizedIndex = clamp(rawIndex, 0, total - 1);
  const currentChapter = book.chapters[normalizedIndex];

  const chapterNumber = normalizedIndex + 1;
  const chapterLabel = `Chapter ${chapterNumber} of ${total}`;

  const resolvedPageCount =
    normalizePositiveInteger(progress.currentChapterPageCount) ??
    (currentChapter ? getChapterPageCount(currentChapter) ?? 1 : 1);
  const pageCount = Math.max(resolvedPageCount ?? 1, 1);

  const pageIndex = clamp(
    typeof progress.currentChapterPageIndex === "number"
      ? Math.round(progress.currentChapterPageIndex)
      : 0,
    0,
    Math.max(pageCount - 1, 0),
  );
  const pageNumber = pageIndex + 1;

  const percent =
    typeof progress.chapterProgressPercent === "number" && Number.isFinite(progress.chapterProgressPercent)
      ? clamp(progress.chapterProgressPercent, 0, 1)
      : pageCount > 1
        ? pageIndex / (pageCount - 1)
        : pageIndex > 0
          ? 1
          : 0;

  const pageLabel = pageCount ? `Page ${pageNumber} of ${pageCount}` : undefined;

  const labelParts = [chapterLabel, pageLabel].filter(
    (part): part is string => Boolean(part),
  );
  const label =
    labelParts.length > 0
      ? labelParts.join(" · ")
      : `${chapterNumber} of ${total} chapters`;

  const isLastChapter = normalizedIndex === total - 1;
  const isLastPage = pageCount <= 1 ? isLastChapter : pageIndex >= pageCount - 1;
  const isFinished = isLastChapter && isLastPage;

  return {
    current: chapterNumber,
    currentIndex: normalizedIndex,
    total,
    isStarted: true,
    isFinished,
    label,
    chapterLabel,
    pageLabel,
    pageIndex,
    pageNumber,
    pageCount,
    percent,
    chapterNumber,
    currentChapterTitle: currentChapter?.title,
  };
}

export function formatPageCount(pageCount?: number) {
  if (typeof pageCount !== "number" || !Number.isFinite(pageCount) || pageCount <= 0) {
    return undefined;
  }
  const rounded = Math.max(1, Math.round(pageCount));
  return `${rounded} page${rounded === 1 ? "" : "s"}`;
}

export type LibraryBookStatus = "new" | "resume" | "finished";

export function getLibraryBookStatusFromSummary(
  summary: BookProgressSummary,
): LibraryBookStatus {
  if (!summary.isStarted) {
    return "new";
  }
  if (summary.isFinished) {
    return "finished";
  }
  return "resume";
}

export function getLibraryBookStatus(
  book: Pick<Book, "chapters" | "progress">,
): LibraryBookStatus {
  const summary = getBookProgressSummary(book);
  return getLibraryBookStatusFromSummary(summary);
}

