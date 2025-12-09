/**
 * Audio state management: update audio state with debouncing
 * Simplified version with explicit debouncer creation
 */

import { useCallback, useRef } from "react";
import { logger } from "../../lib/logger";
import { updateBookAudioState as updateBookAudioStateBackend } from "../../lib/book-service";
import { createDebounce } from "../../lib/debounce-utils";
import type { Book } from "../../types/reader";

export function useAudioStateManagement(
  library: Book[],
  setLibrary: React.Dispatch<React.SetStateAction<Book[]>>,
) {
  // Pending audio update
  const pendingAudioUpdateRef = useRef<{
    bookId: string;
    audioState: Book["audioState"];
    book: Book;
  } | null>(null);

  // Audio update debouncer - created once
  const audioUpdateDebouncerRef = useRef(
    createDebounce(async () => {
      const pending = pendingAudioUpdateRef.current;
      if (!pending) return;
      
      try {
        const updatedBook = await updateBookAudioStateBackend(
          pending.bookId,
          pending.audioState!,
        );
        setLibrary((prev) =>
          prev.map((b) => (b.id === pending.bookId ? updatedBook : b)),
        );
      } catch (error) {
        logger.error("Failed to sync audio state to backend", error);
        setLibrary((prev) =>
          prev.map((b) => (b.id === pending.bookId ? pending.book : b)),
        );
      } finally {
        pendingAudioUpdateRef.current = null;
      }
    }, 150)
  );

  const updateBookAudioState = useCallback(
    async (
      bookId: string,
      snapshot: {
        currentTimeSeconds: number;
        trackId?: string;
        trackHref?: string;
        trackIndex?: number;
        updatedAt?: string;
      },
    ) => {
      if (
        !bookId ||
        typeof snapshot?.currentTimeSeconds !== "number" ||
        !Number.isFinite(snapshot.currentTimeSeconds) ||
        snapshot.currentTimeSeconds < 0
      ) {
        return;
      }

      const book = library.find((b) => b.id === bookId);
      if (!book?.audioTracks.length) return;

      const resolvedTrack =
        book.audioTracks.find((track) => track.id === snapshot.trackId) ??
        book.audioTracks.find((track) => track.href === snapshot.trackHref) ??
        book.audioTracks[snapshot.trackIndex ?? 0];

      if (!resolvedTrack) return;

      const resolvedIndex = book.audioTracks.findIndex(
        (track) => track.id === resolvedTrack.id,
      );
      const normalizedSeconds = Number(snapshot.currentTimeSeconds.toFixed(3));
      const existing = book.audioState;

      // Skip if unchanged (within tolerance)
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

      // Update local state immediately
      setLibrary((prev) =>
        prev.map((b) =>
          b.id === bookId ? { ...b, audioState: nextAudioState } : b
        ),
      );

      // Store pending update and trigger debounced backend sync
      pendingAudioUpdateRef.current = {
        bookId,
        audioState: nextAudioState,
        book,
      };
      
      audioUpdateDebouncerRef.current.call();
    },
    [library, setLibrary],
  );

  return {
    updateBookAudioState,
  };
}
