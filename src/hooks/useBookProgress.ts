import { useCallback } from "react";
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

export function useBookProgress(
  library: Book[],
  setLibrary: React.Dispatch<React.SetStateAction<Book[]>>,
) {
  const updateBookProgress = useCallback(
    async (bookId: string, payload: ProgressUpdatePayload) => {
      if (!payload?.chapterId) return;

      console.debug(`${PROGRESS_LOG_PREFIX} update requested`, { bookId, payload });

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

      const previousScrollTop =
        typeof existingProgress?.currentChapterScrollTop === "number" &&
        Number.isFinite(existingProgress.currentChapterScrollTop)
          ? Math.max(existingProgress.currentChapterScrollTop, 0)
          : 0;
      const previousScrollHeight =
        typeof existingProgress?.currentChapterScrollHeight === "number" &&
        Number.isFinite(existingProgress.currentChapterScrollHeight)
          ? Math.max(existingProgress.currentChapterScrollHeight, 0)
          : 0;
      const previousClientHeight =
        typeof existingProgress?.currentChapterClientHeight === "number" &&
        Number.isFinite(existingProgress.currentChapterClientHeight)
          ? Math.max(existingProgress.currentChapterClientHeight, 0)
          : 0;
      const previousPercent =
        typeof existingProgress?.chapterProgressPercent === "number" &&
        Number.isFinite(existingProgress.chapterProgressPercent)
          ? existingProgress.chapterProgressPercent
          : 0;

      const previousElementId =
        typeof existingProgress?.currentChapterElementId === "string" &&
        existingProgress.currentChapterElementId.length > 0
          ? existingProgress.currentChapterElementId
          : null;
      const previousElementIndex =
        typeof existingProgress?.currentChapterElementIndex === "number" &&
        Number.isFinite(existingProgress.currentChapterElementIndex)
          ? Math.max(Math.round(existingProgress.currentChapterElementIndex), 0)
          : null;

      const resolvedScrollTop =
        typeof payload.scrollTop === "number" && Number.isFinite(payload.scrollTop)
          ? Math.max(payload.scrollTop, 0)
          : chapterMatchesExisting
            ? previousScrollTop
            : 0;

      const resolvedScrollHeight =
        typeof payload.scrollHeight === "number" && Number.isFinite(payload.scrollHeight)
          ? Math.max(payload.scrollHeight, 0)
          : chapterMatchesExisting
            ? previousScrollHeight
            : 0;

      const resolvedClientHeight =
        typeof payload.clientHeight === "number" && Number.isFinite(payload.clientHeight)
          ? Math.max(payload.clientHeight, 0)
          : chapterMatchesExisting
            ? previousClientHeight
            : 0;

      const percentSource =
        typeof payload.percent === "number" && Number.isFinite(payload.percent)
          ? payload.percent
          : chapterMatchesExisting
            ? previousPercent
            : 0;

      const percent = Number(Math.min(Math.max(percentSource ?? 0, 0), 1).toFixed(4));

      const resolvedElementId =
        payload.elementId === undefined
          ? (chapterMatchesExisting ? previousElementId : null)
          : payload.elementId && payload.elementId.length > 0
            ? payload.elementId
            : null;

      let resolvedElementIndex: number | null = null;
      if (payload.elementIndex === undefined) {
        resolvedElementIndex = chapterMatchesExisting ? previousElementIndex : null;
      } else if (payload.elementIndex === null) {
        resolvedElementIndex = null;
      } else if (typeof payload.elementIndex === "number" && Number.isFinite(payload.elementIndex)) {
        resolvedElementIndex = Math.max(Math.round(payload.elementIndex), 0);
      } else if (chapterMatchesExisting) {
        resolvedElementIndex = previousElementIndex;
      }

      const nextProgress = {
        currentChapterId: chapter.id,
        currentChapterHref: chapter.href,
        currentChapterIndex: chapterIndex,
        currentChapterElementId: resolvedElementId ?? null,
        currentChapterElementIndex: resolvedElementIndex ?? null,
        currentChapterScrollTop: resolvedScrollTop,
        currentChapterScrollHeight: resolvedScrollHeight,
        currentChapterClientHeight: resolvedClientHeight,
        chapterProgressPercent: percent,
        updatedAt: new Date().toISOString(),
      };

      const isUnchanged =
        existingProgress &&
        existingProgress.currentChapterId === nextProgress.currentChapterId &&
        existingProgress.currentChapterIndex === nextProgress.currentChapterIndex &&
        Math.abs(
          (typeof existingProgress.currentChapterScrollTop === "number"
            ? existingProgress.currentChapterScrollTop
            : 0) - nextProgress.currentChapterScrollTop,
        ) < 1 &&
        Math.abs(
          (typeof existingProgress.currentChapterScrollHeight === "number"
            ? existingProgress.currentChapterScrollHeight
            : 0) - nextProgress.currentChapterScrollHeight,
        ) < 1 &&
        Math.abs(
          (typeof existingProgress.currentChapterClientHeight === "number"
            ? existingProgress.currentChapterClientHeight
            : 0) - nextProgress.currentChapterClientHeight,
        ) < 1 &&
        Math.abs(existingProgress.chapterProgressPercent - nextProgress.chapterProgressPercent) <
          0.002 &&
        ((existingProgress.currentChapterElementId ?? null) ===
          (nextProgress.currentChapterElementId ?? null)) &&
        ((existingProgress.currentChapterElementIndex ?? null) ===
          (nextProgress.currentChapterElementIndex ?? null));

      if (isUnchanged) {
        console.debug(`${PROGRESS_LOG_PREFIX} unchanged progress, skipping persist`, {
          bookId,
          chapterId: chapter.id,
        });
        return;
      }

      // Update local state optimistically
      setLibrary((prev) =>
        prev.map((b) => (b.id === bookId ? { ...b, progress: nextProgress } : b))
      );

      // Sync to backend
      try {
        const updatedBook = await updateBookProgressBackend(bookId, nextProgress);
        // Update local state with backend response
        setLibrary((prev) =>
          prev.map((b) => (b.id === bookId ? updatedBook : b))
        );
        console.debug(`${PROGRESS_LOG_PREFIX} synced progress to backend`, {
          bookId,
          chapterId: chapter.id,
        });
      } catch (error) {
        console.error(`${PROGRESS_LOG_PREFIX} failed to sync progress to backend`, error);
        // Revert optimistic update on error
        setLibrary((prev) =>
          prev.map((b) => (b.id === bookId ? book : b))
        );
      }
    },
    [library, setLibrary],
  );

  const updateBookAudioState = useCallback(
    async (bookId: string, snapshot: { currentTimeSeconds: number; trackId?: string; trackHref?: string; trackIndex?: number; updatedAt?: string }) => {
      if (!bookId) {
        return;
      }
      if (
        typeof snapshot?.currentTimeSeconds !== "number" ||
        !Number.isFinite(snapshot.currentTimeSeconds) ||
        snapshot.currentTimeSeconds < 0
      ) {
        return;
      }

      const book = library.find((b) => b.id === bookId);
      if (!book || !book.audioTracks.length) {
        return;
      }

      const resolvedTrack =
        book.audioTracks.find((track) => track.id === snapshot.trackId) ??
        book.audioTracks.find((track) => track.href === snapshot.trackHref) ??
        book.audioTracks[snapshot.trackIndex ?? 0];

      if (!resolvedTrack) {
        return;
      }

      const resolvedIndex = book.audioTracks.findIndex((track) => track.id === resolvedTrack.id);
      const normalizedSeconds = Number(snapshot.currentTimeSeconds.toFixed(3));
      const existing = book.audioState;

      // Skip if change is too small (throttle updates)
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

      // Update local state optimistically
      setLibrary((prev) =>
        prev.map((b) => (b.id === bookId ? { ...b, audioState: nextAudioState } : b))
      );

      // Sync to backend (debounced/throttled in practice via the 0.25s check above)
      try {
        const updatedBook = await updateBookAudioStateBackend(bookId, nextAudioState);
        // Update local state with backend response
        setLibrary((prev) =>
          prev.map((b) => (b.id === bookId ? updatedBook : b))
        );
      } catch (error) {
        console.error("[Audio State] failed to sync audio state to backend", error);
        // Revert optimistic update on error
        setLibrary((prev) =>
          prev.map((b) => (b.id === bookId ? book : b))
        );
      }
    },
    [library, setLibrary],
  );

  const handleChapterProgress = useCallback(
    (bookId: string, snapshot: ChapterProgressSnapshot) => {
      console.debug(`${PROGRESS_LOG_PREFIX} received progress snapshot`, { bookId, snapshot });
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

