/**
 * Audio player state hook - simplified version
 * Manages track index and restoration time based on audio state from library
 * No useEffects - initialization is explicit
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { logger } from "../../lib/logger";
import type { UseAudioPlayerStateParams } from "../library/types";
import { useContext } from "react";
import { ReaderCoordinatorContext } from "../../contexts/ReaderCoordinatorContext";

const PROGRESS_ECHO_TOLERANCE_SECONDS = 0.5;

export function useAudioPlayerState(params: UseAudioPlayerStateParams) {
  const { bookId, tracks, library, onProgress } = params;
  // Get coordinator for operation management (optional - may not be available at library level)
  const coordinator = useContext(ReaderCoordinatorContext); // May be null if provider isn't available
  
  // Get audio state from library (single source of truth)
  const book = bookId ? library.find((b) => b.id === bookId) : undefined;
  const initialAudioState = book?.audioState;

  const [currentIndex, setCurrentIndexState] = useState(0);
  const [restoreTime, setRestoreTime] = useState<number | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);

  // Internal tracking refs (kept for performance - don't need to trigger re-renders)
  const restorationAppliedRef = useRef<string | null>(null);
  const lastProgressSnapshotRef = useRef<{
    trackId?: string;
    trackHref?: string;
    trackIndex?: number;
    currentTimeSeconds?: number;
    updatedAt?: string;
    timestamp: number;
  }>({ timestamp: 0 });
  const initializedRef = useRef<string | undefined>(undefined);

  // Find track index from initial audio state
  const findTrackIndex = useCallback((): number => {
    if (!tracks.length || !initialAudioState) {
      return 0;
    }

    if (initialAudioState.currentTrackId) {
      const matchById = tracks.findIndex(
        (track) => track.id === initialAudioState.currentTrackId,
      );
      if (matchById >= 0) return matchById;
    }

    if (initialAudioState.currentTrackHref) {
      const matchByHref = tracks.findIndex(
        (track) => track.href === initialAudioState.currentTrackHref,
      );
      if (matchByHref >= 0) return matchByHref;
    }

    if (
      typeof initialAudioState.currentTrackIndex === "number" &&
      Number.isFinite(initialAudioState.currentTrackIndex) &&
      initialAudioState.currentTrackIndex >= 0 &&
      initialAudioState.currentTrackIndex < tracks.length
    ) {
      return initialAudioState.currentTrackIndex;
    }

    return 0;
  }, [tracks, initialAudioState]);

  // Check if progress is an echo (same as what we just emitted)
  const isProgressEcho = useCallback((): boolean => {
    const state = initialAudioState;
    if (!state) return false;

    const snapshot = lastProgressSnapshotRef.current;
    if (
      !snapshot.trackId &&
      !snapshot.trackHref &&
      typeof snapshot.trackIndex !== "number"
    ) {
      return false;
    }

    const nextTrackIndex =
      typeof state.currentTrackIndex === "number" &&
      Number.isFinite(state.currentTrackIndex)
        ? state.currentTrackIndex
        : undefined;
    const nextTimeSeconds =
      typeof state.currentTimeSeconds === "number" &&
      Number.isFinite(state.currentTimeSeconds)
        ? state.currentTimeSeconds
        : undefined;

    const trackMatches =
      Boolean(snapshot.trackId && snapshot.trackId === state.currentTrackId) ||
      Boolean(
        snapshot.trackHref && snapshot.trackHref === state.currentTrackHref,
      ) ||
      (typeof snapshot.trackIndex === "number" &&
        typeof nextTrackIndex === "number" &&
        snapshot.trackIndex === nextTrackIndex);

    if (!trackMatches) return false;

    const timeMatches =
      (snapshot.updatedAt && snapshot.updatedAt === state.updatedAt) ||
      (typeof snapshot.currentTimeSeconds === "number" &&
        typeof nextTimeSeconds === "number" &&
        Math.abs(snapshot.currentTimeSeconds - nextTimeSeconds) <=
          PROGRESS_ECHO_TOLERANCE_SECONDS);

    return timeMatches;
  }, [initialAudioState]);

  // Initialize from audio state (call explicitly when needed)
  const initialize = useCallback(() => {
    if (!bookId) {
      setRestoreTime(null);
      setIsRestoring(false);
      setCurrentIndexState(0);
      initializedRef.current = undefined;
      return;
    }

    // Create signature to detect changes
    const signature = `${bookId}|${initialAudioState?.currentTrackId}|${initialAudioState?.updatedAt}|${tracks.length}`;
    if (initializedRef.current === signature) {
      return; // Already initialized with this state
    }

    if (isProgressEcho()) {
      initializedRef.current = signature;
      return; // Don't restore if this is just an echo of our own progress
    }

    const nextIndex = findTrackIndex();
    setCurrentIndexState(nextIndex);

    const restoredTime =
      typeof initialAudioState?.currentTimeSeconds === "number" &&
      Number.isFinite(initialAudioState.currentTimeSeconds)
        ? Math.max(initialAudioState.currentTimeSeconds, 0)
        : null;

    setRestoreTime(restoredTime);
    setIsRestoring(restoredTime !== null);
    restorationAppliedRef.current = null;
    lastProgressSnapshotRef.current = { timestamp: 0 };
    initializedRef.current = signature;
  }, [bookId, initialAudioState, tracks.length, findTrackIndex, isProgressEcho]);

  // Initialize when bookId or state changes (moved to useEffect to avoid state updates during render)
  useEffect(() => {
    const currentSignature = bookId && initialAudioState
      ? `${bookId}|${initialAudioState.currentTrackId}|${initialAudioState.updatedAt}|${tracks.length}`
      : undefined;
    
    if (initializedRef.current !== currentSignature) {
      initialize();
    }
  }, [bookId, initialAudioState?.currentTrackId, initialAudioState?.updatedAt, tracks.length, initialize]);

  const onTrackChanged = useCallback((newTrackId: string) => {
    const currentTrack = tracks[currentIndex];
    if (!currentTrack || currentTrack.id === newTrackId) {
      return;
    }

    // Check if track change operation is in progress or cancelled (if coordinator available)
    if (coordinator && coordinator.isOperationInProgress("changeAudioTrack")) {
      const currentOp = coordinator.getCurrentOperation("changeAudioTrack");
      if (currentOp?.cancelled) {
        return;
      }
    }

    if (isRestoring) {
      return;
    }

    setRestoreTime(null);
    restorationAppliedRef.current = null;
  }, [coordinator, tracks, currentIndex, isRestoring]);

  const emitProgress = useCallback((timeSeconds: number) => {
    const track = tracks[currentIndex];
    if (!track || !onProgress) return;

    const normalizedSeconds = Number(Math.max(timeSeconds, 0).toFixed(3));
    const updatedAt = new Date().toISOString();

    lastProgressSnapshotRef.current = {
      trackId: track.id,
      trackHref: track.href,
      trackIndex: currentIndex,
      currentTimeSeconds: normalizedSeconds,
      updatedAt,
      timestamp: Date.now(),
    };

    onProgress({
      trackId: track.id,
      trackHref: track.href,
      trackIndex: currentIndex,
      currentTimeSeconds: normalizedSeconds,
      updatedAt,
    });
  }, [tracks, currentIndex, onProgress]);

  const onTrackLoaded = useCallback((audioElement: HTMLAudioElement) => {
    const currentTrack = tracks[currentIndex];
    if (!currentTrack || !audioElement) return;

    const shouldRestore = isRestoring;
    const timeToRestore = restoreTime;
    const currentTrackId = currentTrack.id;
    const alreadyApplied = restorationAppliedRef.current === currentTrackId;

    if (
      shouldRestore &&
      timeToRestore !== null &&
      Number.isFinite(timeToRestore) &&
      !alreadyApplied
    ) {
      try {
        audioElement.currentTime = timeToRestore;
        const appliedTime = audioElement.currentTime || timeToRestore;
        restorationAppliedRef.current = currentTrackId;
        emitProgress(appliedTime);
        setIsRestoring(false);
        setRestoreTime(null);
      } catch (error) {
        logger.warn("Failed to apply restore time:", error);
        setIsRestoring(false);
        setRestoreTime(null);
      }
    } else if (shouldRestore && timeToRestore === null) {
      setIsRestoring(false);
      setRestoreTime(null);
      restorationAppliedRef.current = currentTrackId;
    } else if (!shouldRestore && timeToRestore === null && !alreadyApplied) {
      audioElement.currentTime = 0;
      restorationAppliedRef.current = null;
    }
  }, [tracks, currentIndex, isRestoring, restoreTime, emitProgress]);

  const setCurrentIndex = useCallback((index: number) => {
    if (index < 0 || index >= tracks.length) return;
    
    const newTrack = tracks[index];
    if (newTrack) {
      onTrackChanged(newTrack.id);
    }
    setCurrentIndexState(index);
  }, [tracks, onTrackChanged]);

  // Ensure index is valid
  if (tracks.length && currentIndex >= tracks.length) {
    setCurrentIndexState(0);
  }

  return {
    currentIndex,
    setCurrentIndex,
    restoreTime,
    isRestoring,
    onTrackLoaded,
    onTrackChanged,
    emitProgress,
  };
}
