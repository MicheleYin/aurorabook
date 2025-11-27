import { useCallback, useRef } from "react";
import type { Book } from "../types/reader";
import type { ChapterProgressSnapshot } from "../components/reader/types";
import { 
  updateBookProgress as updateBookProgressBackend, 
  updateBookAudioState as updateBookAudioStateBackend,
} from "../lib/book-service";

const PROGRESS_LOG_PREFIX = "[ReaderProgress]";

type ProgressUpdatePayload = {
  chapterId: string;
  scrollTop?: number;
  scrollHeight?: number;
  clientHeight?: number;
  percent?: number;
  elementId?: string | null;
  elementIndex?: number | null;
};

function getNumberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(value, 0) : fallback;
}

function getPercentValue(value: unknown, fallback: number): number {
  const num = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Number(Math.min(Math.max(num, 0), 1).toFixed(4));
}

function getElementId(value: unknown, fallback: string | null): string | null {
  if (value === undefined) return fallback;
  if (value === null) return null;
  if (typeof value === "string" && value.length > 0) return value;
  return null;
}

function getElementIndex(value: unknown, fallback: number | null): number | null {
  if (value === undefined) return fallback;
  if (value === null) return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(Math.round(value), 0);
  }
  return fallback;
}

function isProgressUnchanged(
  existing: Book["progress"],
  next: NonNullable<Book["progress"]>,
): boolean {
  if (!existing) return false;
  
  return (
    existing.currentChapterId === next.currentChapterId &&
    existing.currentChapterIndex === next.currentChapterIndex &&
    Math.abs(getNumberValue(existing.currentChapterScrollTop, 0) - next.currentChapterScrollTop) < 1 &&
    Math.abs(getNumberValue(existing.currentChapterScrollHeight, 0) - next.currentChapterScrollHeight) < 1 &&
    Math.abs(getNumberValue(existing.currentChapterClientHeight, 0) - next.currentChapterClientHeight) < 1 &&
    Math.abs((existing.chapterProgressPercent ?? 0) - next.chapterProgressPercent) < 0.002 &&
    (existing.currentChapterElementId ?? null) === (next.currentChapterElementId ?? null) &&
    (existing.currentChapterElementIndex ?? null) === (next.currentChapterElementIndex ?? null)
  );
}

export function useBookProgress(
  library: Book[],
  setLibrary: React.Dispatch<React.SetStateAction<Book[]>>,
) {
  const updateTimeoutRef = useRef<number | null>(null);

  const updateBookProgress = useCallback(
    async (bookId: string, payload: ProgressUpdatePayload) => {
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

      const nextProgress: NonNullable<Book["progress"]> = {
        currentChapterId: chapter.id,
        currentChapterHref: chapter.href,
        currentChapterIndex: chapterIndex,
        currentChapterElementId: getElementId(
          payload.elementId,
          chapterMatchesExisting ? getElementId(existingProgress?.currentChapterElementId, null) : null
        ),
        currentChapterElementIndex: getElementIndex(
          payload.elementIndex,
          chapterMatchesExisting ? getElementIndex(existingProgress?.currentChapterElementIndex, null) : null
        ),
        currentChapterScrollTop: getNumberValue(
          payload.scrollTop,
          chapterMatchesExisting ? getNumberValue(existingProgress?.currentChapterScrollTop, 0) : 0
        ),
        currentChapterScrollHeight: getNumberValue(
          payload.scrollHeight,
          chapterMatchesExisting ? getNumberValue(existingProgress?.currentChapterScrollHeight, 0) : 0
        ),
        currentChapterClientHeight: getNumberValue(
          payload.clientHeight,
          chapterMatchesExisting ? getNumberValue(existingProgress?.currentChapterClientHeight, 0) : 0
        ),
        chapterProgressPercent: getPercentValue(
          payload.percent,
          chapterMatchesExisting ? getPercentValue(existingProgress?.chapterProgressPercent, 0) : 0
        ),
        updatedAt: new Date().toISOString(),
      };

      if (isProgressUnchanged(existingProgress, nextProgress)) {
        return;
      }

      // Update local state optimistically
      setLibrary((prev) =>
        prev.map((b) => (b.id === bookId ? { ...b, progress: nextProgress } : b))
      );

      // Debounce backend sync
      if (updateTimeoutRef.current !== null) {
        clearTimeout(updateTimeoutRef.current);
      }

      updateTimeoutRef.current = window.setTimeout(async () => {
        updateTimeoutRef.current = null;
        try {
          const updatedBook = await updateBookProgressBackend(bookId, nextProgress);
          setLibrary((prev) =>
            prev.map((b) => (b.id === bookId ? updatedBook : b))
          );
        } catch (error) {
          console.error(`${PROGRESS_LOG_PREFIX} failed to sync progress to backend`, error);
          setLibrary((prev) =>
            prev.map((b) => (b.id === bookId ? book : b))
          );
        }
      }, 150);
    },
    [library, setLibrary],
  );

  const audioUpdateTimeoutRef = useRef<number | null>(null);

  const updateBookAudioState = useCallback(
    async (bookId: string, snapshot: { currentTimeSeconds: number; trackId?: string; trackHref?: string; trackIndex?: number; updatedAt?: string }) => {
      if (!bookId || typeof snapshot?.currentTimeSeconds !== "number" || !Number.isFinite(snapshot.currentTimeSeconds) || snapshot.currentTimeSeconds < 0) {
        return;
      }

      const book = library.find((b) => b.id === bookId);
      if (!book?.audioTracks.length) return;

      const resolvedTrack =
        book.audioTracks.find((track) => track.id === snapshot.trackId) ??
        book.audioTracks.find((track) => track.href === snapshot.trackHref) ??
        book.audioTracks[snapshot.trackIndex ?? 0];

      if (!resolvedTrack) return;

      const resolvedIndex = book.audioTracks.findIndex((track) => track.id === resolvedTrack.id);
      const normalizedSeconds = Number(snapshot.currentTimeSeconds.toFixed(3));
      const existing = book.audioState;

      // Throttle updates
      if (
        existing &&
        existing.currentTrackId === resolvedTrack.id &&
        Math.abs(existing.currentTimeSeconds - normalizedSeconds) < 0.25
      ) {
        return;
      }

      const nextAudioState = {
        currentTrackId: resolvedTrack.id,
        currentTrackHref: resolvedTrack.href,
        currentTrackIndex: resolvedIndex === -1 ? snapshot.trackIndex ?? 0 : resolvedIndex,
        currentTimeSeconds: normalizedSeconds,
        updatedAt: snapshot.updatedAt ?? new Date().toISOString(),
      };

      setLibrary((prev) =>
        prev.map((b) => (b.id === bookId ? { ...b, audioState: nextAudioState } : b))
      );

      // Debounce backend sync
      if (audioUpdateTimeoutRef.current !== null) {
        clearTimeout(audioUpdateTimeoutRef.current);
      }

      audioUpdateTimeoutRef.current = window.setTimeout(async () => {
        audioUpdateTimeoutRef.current = null;
        try {
          const updatedBook = await updateBookAudioStateBackend(bookId, nextAudioState);
          setLibrary((prev) =>
            prev.map((b) => (b.id === bookId ? updatedBook : b))
          );
        } catch (error) {
          console.error("[Audio State] failed to sync audio state to backend", error);
          setLibrary((prev) =>
            prev.map((b) => (b.id === bookId ? book : b))
          );
        }
      }, 150);
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
    updateBookAudioState,
    handleChapterProgress,
  };
}

