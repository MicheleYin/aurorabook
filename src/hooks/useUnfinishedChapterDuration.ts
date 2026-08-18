import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import { useConversionState } from "../context/ConversionStateContext";
import { resolveUnfinishedChapterIndex } from "../lib/book-audio-duration";
import { logger } from "../lib/logger";
import type { Book } from "../types/book";

const LIVE_DURATION_POLL_MS = 1000;

function hasUnfinishedAudio(book: Book, isLive: boolean): boolean {
  if (isLive) {
    return true;
  }

  const completedCount = book.completedChapters?.length ?? 0;
  return (
    book.conversionStatus === "started" ||
    (completedCount > 0 && completedCount < book.chapters.length)
  );
}

export function useUnfinishedChapterDuration(
  book: Book | null,
  enabled: boolean
): number {
  const {
    convertingBookId,
    getCurrentConvertingChapter,
    refreshCurrentConvertingChapter,
  } = useConversionState();
  const [durationSeconds, setDurationSeconds] = useState(0);

  const bookId = book?.id ?? null;
  const isLive = Boolean(bookId && convertingBookId === bookId);
  const shouldLoad = Boolean(
    enabled && book && hasUnfinishedAudio(book, isLive)
  );

  useEffect(() => {
    if (!shouldLoad || !book || !bookId) {
      setDurationSeconds(0);
      return;
    }

    let cancelled = false;

    const loadDuration = async (refreshChapter: boolean) => {
      let convertingChapter = getCurrentConvertingChapter(bookId);
      if (refreshChapter) {
        const refreshed = await refreshCurrentConvertingChapter(bookId);
        if (refreshed !== null) {
          convertingChapter = refreshed;
        }
      }

      const chapterIndex = resolveUnfinishedChapterIndex(
        book,
        convertingChapter
      );
      if (chapterIndex === null) {
        if (!cancelled) {
          setDurationSeconds(0);
        }
        return;
      }

      try {
        const nextDuration = await invoke<number>("get_live_chapter_duration", {
          bookId,
          chapterIndex,
        });
        if (
          cancelled ||
          typeof nextDuration !== "number" ||
          !Number.isFinite(nextDuration) ||
          nextDuration < 0
        ) {
          return;
        }

        setDurationSeconds((previous) => {
          if (!isLive || nextDuration > 0) {
            return nextDuration;
          }
          return previous;
        });
      } catch (err) {
        if (!cancelled) {
          logger.warn("Failed to load unfinished chapter duration:", err);
        }
      }
    };

    void loadDuration(true);

    if (!isLive) {
      return () => {
        cancelled = true;
      };
    }

    const interval = window.setInterval(() => {
      void loadDuration(false);
    }, LIVE_DURATION_POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [
    book,
    bookId,
    getCurrentConvertingChapter,
    isLive,
    refreshCurrentConvertingChapter,
    shouldLoad,
  ]);

  return durationSeconds;
}
