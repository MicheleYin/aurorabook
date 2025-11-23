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
  percent?: number;
  chapterNumber?: number;
  currentChapterTitle?: string;
};

type LegacyProgressFields = {
  currentChapterPageIndex?: number;
  currentChapterPageCount?: number;
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
      percent: 0,
      currentChapterTitle: undefined,
    };
  }

  const fallbackChapter = book.chapters[0];

  if (!book.progress) {
    const defaultChapterLabel =
      total > 0 ? `Chapter 1 of ${total}` : fallbackChapter ? "Chapter 1" : undefined;

    return {
      current: 0,
      currentIndex: -1,
      total,
      isStarted: false,
      isFinished: false,
      label: defaultChapterLabel ?? `0 of ${total} chapters`,
      chapterLabel: defaultChapterLabel,
      percent: 0,
      chapterNumber: 1,
      currentChapterTitle: fallbackChapter?.title,
    };
  }

  const progress = book.progress as Book["progress"] & LegacyProgressFields;
  const byIdIndex =
    progress?.currentChapterId !== undefined
      ? book.chapters.findIndex((chapter) => chapter.id === progress.currentChapterId)
      : -1;
  const rawIndexCandidate =
    typeof progress?.currentChapterIndex === "number" && Number.isFinite(progress.currentChapterIndex)
      ? Math.round(progress.currentChapterIndex)
      : 0;
  const rawIndex = byIdIndex >= 0 ? byIdIndex : rawIndexCandidate;
  const normalizedIndex = clamp(rawIndex, 0, Math.max(total - 1, 0));
  const currentChapter = book.chapters[normalizedIndex];

  const chapterNumber = normalizedIndex + 1;
  const chapterLabel = `Chapter ${chapterNumber} of ${total}`;

  const scrollTop =
    typeof progress?.currentChapterScrollTop === "number" && Number.isFinite(progress.currentChapterScrollTop)
      ? Math.max(progress.currentChapterScrollTop, 0)
      : 0;
  const scrollHeight =
    typeof progress?.currentChapterScrollHeight === "number" &&
    Number.isFinite(progress.currentChapterScrollHeight)
      ? Math.max(progress.currentChapterScrollHeight, 0)
      : 0;
  const clientHeight =
    typeof progress?.currentChapterClientHeight === "number" &&
    Number.isFinite(progress.currentChapterClientHeight)
      ? Math.max(progress.currentChapterClientHeight, 0)
      : 0;

  let percent =
    typeof progress?.chapterProgressPercent === "number" &&
    Number.isFinite(progress.chapterProgressPercent)
      ? clamp(progress.chapterProgressPercent, 0, 1)
      : undefined;

  if (
    (percent === undefined || percent === 0) &&
    scrollHeight > 0 &&
    clientHeight >= 0 &&
    scrollTop > 0
  ) {
    const maxScroll = Math.max(scrollHeight - clientHeight, 0);
    if (maxScroll > 0) {
      percent = clamp(scrollTop / maxScroll, 0, 1);
    }
  }

  if (percent === undefined) {
    if (
      typeof progress?.currentChapterPageIndex === "number" &&
      Number.isFinite(progress.currentChapterPageIndex) &&
      typeof progress?.currentChapterPageCount === "number" &&
      Number.isFinite(progress.currentChapterPageCount) &&
      progress.currentChapterPageCount > 1
    ) {
      percent = clamp(
        Math.round(progress.currentChapterPageIndex) /
          Math.max(Math.round(progress.currentChapterPageCount) - 1, 1),
        0,
        1,
      );
    } else {
      percent = 0;
    }
  }

  const resolvedPercent = Number((percent ?? 0).toFixed(4));

  let percentLabel: string | undefined;
  if (resolvedPercent >= 0.999) {
    percentLabel = "Finished";
  } else if (resolvedPercent > 0) {
    percentLabel = `${Math.round(resolvedPercent * 100)}% read`;
  }

  const labelParts = [chapterLabel, percentLabel].filter(
    (part): part is string => Boolean(part),
  );
  const label =
    labelParts.length > 0
      ? labelParts.join(" · ")
      : `${chapterNumber} of ${total} chapters`;

  const isFinished = normalizedIndex === total - 1 && resolvedPercent >= 0.999;

  return {
    current: chapterNumber,
    currentIndex: normalizedIndex,
    total,
    isStarted: resolvedPercent > 0 || normalizedIndex > 0,
    isFinished,
    label,
    chapterLabel,
    percent: resolvedPercent,
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

