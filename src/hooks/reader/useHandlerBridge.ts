import { useEffect, useRef } from "react";
import type { AudioProgressSnapshot } from "../../components/reader/types";

type HandlerReady<T> = (handler: T) => void;

/**
 * Keeps track of the latest handler reference and only fires the supplied ready
 * callback when the handler identity actually changes. This replaces repetitive
 * `useEffect` blocks sprinkled throughout reader components.
 */
export function useHandlerBridge<T extends Function>(
  handler: T | null | undefined,
  onReady?: HandlerReady<T>,
) {
  const handlerRef = useRef<T | null | undefined>(handler);
  const lastReadyRef = useRef<T | null>(null);

  handlerRef.current = handler;

  useEffect(() => {
    const currentHandler = handlerRef.current;
    if (onReady && currentHandler && currentHandler !== lastReadyRef.current) {
      lastReadyRef.current = currentHandler;
      onReady(currentHandler);
    }
  }, [onReady]);
}

type AudioProgressCallback = (snapshot: AudioProgressSnapshot) => void;

/**
 * Only forwards meaningful progress snapshots (change in track or 100ms delta)
 * so consumers (typically highlighting + scroll) don't do work on the same data.
 */
export function useAudioProgressUpdater(
  currentSnapshot: AudioProgressSnapshot | undefined,
  onUpdate: AudioProgressCallback,
) {
  const lastSnapshotRef = useRef<AudioProgressSnapshot | undefined>(undefined);

  useEffect(() => {
    if (!currentSnapshot) return;

    const lastSnapshot = lastSnapshotRef.current;
    const unchanged =
      lastSnapshot &&
      lastSnapshot.trackHref === currentSnapshot.trackHref &&
      Math.abs(lastSnapshot.currentTimeSeconds - currentSnapshot.currentTimeSeconds) <= 0.1 &&
      lastSnapshot.updatedAt === currentSnapshot.updatedAt;

    if (!unchanged) {
      lastSnapshotRef.current = currentSnapshot;
      onUpdate(currentSnapshot);
    }
  }, [currentSnapshot, onUpdate]);
}

type SaveProgressParams = {
  activeBookId?: string;
  activeChapterId?: string;
  performSave: (bookId: string, chapterId: string) => Promise<void>;
  onSaveProgress?: (saveFn: () => void) => void;
};

/**
 * Exposes the progress save callback only when both book and chapter are available,
 * preventing repeated effect-based registrations elsewhere.
 */
export function useSaveProgressBridge({
  activeBookId,
  activeChapterId,
  performSave,
  onSaveProgress,
}: SaveProgressParams) {
  useEffect(() => {
    if (!onSaveProgress || !activeBookId || !activeChapterId) {
      return;
    }

    onSaveProgress(() => performSave(activeBookId, activeChapterId));
  }, [activeBookId, activeChapterId, onSaveProgress, performSave]);
}

