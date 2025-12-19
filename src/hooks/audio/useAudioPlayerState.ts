/**
 * Audio player state hook - simplified version
 * Manages track index and restoration time based on audio state from library
 * No useEffects - initialization is explicit
 */

import { useCallback, useRef } from "react";
import { logger } from "../../lib/logger";
import type { UseAudioPlayerStateParams } from "../library/types";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import {
  selectAudioPlayerTrackIndex,
  selectAudioPlayerRestoreTime,
  selectAudioPlayerRestoring,
  selectOperationLocks,
} from "../../store/selectors";
import {
  setAudioPlayerTrackIndex,
  setAudioPlayerRestoreTime,
  setAudioPlayerRestoring,
} from "../../store/slices/readerSlice";

const PROGRESS_ECHO_TOLERANCE_SECONDS = 0.5;

export function useAudioPlayerState(params: UseAudioPlayerStateParams) {
  const { bookId, tracks, library, onProgress } = params;
  const dispatch = useAppDispatch();
  
  // Get restoration state from Redux
  const currentIndex = useAppSelector(selectAudioPlayerTrackIndex);
  const restoreTime = useAppSelector(selectAudioPlayerRestoreTime);
  const isRestoring = useAppSelector(selectAudioPlayerRestoring);
  
  // Get coordinator locks from Redux
  const locks = useAppSelector(selectOperationLocks);
  
  // Get audio state from library (single source of truth)
  const book = bookId ? library.find((b) => b.id === bookId) : undefined;
  const initialAudioState = book?.audioState;

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
      dispatch(setAudioPlayerRestoreTime(null));
      dispatch(setAudioPlayerRestoring(false));
      dispatch(setAudioPlayerTrackIndex(0));
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
    dispatch(setAudioPlayerTrackIndex(nextIndex));

    const restoredTime =
      typeof initialAudioState?.currentTimeSeconds === "number" &&
      Number.isFinite(initialAudioState.currentTimeSeconds)
        ? Math.max(initialAudioState.currentTimeSeconds, 0)
        : null;

    dispatch(setAudioPlayerRestoreTime(restoredTime));
    dispatch(setAudioPlayerRestoring(restoredTime !== null));
    restorationAppliedRef.current = null;
    lastProgressSnapshotRef.current = { timestamp: 0 };
    initializedRef.current = signature;
  }, [dispatch, bookId, initialAudioState, tracks.length, findTrackIndex, isProgressEcho]);

  // Initialize when bookId or state changes
  // Note: This is now handled explicitly by callers, but keeping for compatibility
  const currentSignature = bookId && initialAudioState
    ? `${bookId}|${initialAudioState.currentTrackId}|${initialAudioState.updatedAt}|${tracks.length}`
    : undefined;
  
  if (initializedRef.current !== currentSignature) {
    initialize();
  }

  const onTrackChanged = useCallback((newTrackId: string) => {
    const currentTrack = tracks[currentIndex];
    if (!currentTrack || currentTrack.id === newTrackId) {
      return;
    }

    // Check if track change operation is in progress or cancelled
    const audioLock = locks.audio;
    if (audioLock && audioLock.type === "changeAudioTrack" && audioLock.cancelled) {
      return;
    }

    if (isRestoring) {
      return;
    }

    dispatch(setAudioPlayerRestoreTime(null));
    restorationAppliedRef.current = null;
  }, [dispatch, locks, tracks, currentIndex, isRestoring]);

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
        dispatch(setAudioPlayerRestoring(false));
        dispatch(setAudioPlayerRestoreTime(null));
      } catch (error) {
        logger.warn("Failed to apply restore time:", error);
        dispatch(setAudioPlayerRestoring(false));
        dispatch(setAudioPlayerRestoreTime(null));
      }
    } else if (shouldRestore && timeToRestore === null) {
      dispatch(setAudioPlayerRestoring(false));
      dispatch(setAudioPlayerRestoreTime(null));
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
    dispatch(setAudioPlayerTrackIndex(index));
  }, [dispatch, tracks, onTrackChanged]);

  // Ensure index is valid
  if (tracks.length && currentIndex >= tracks.length) {
    dispatch(setAudioPlayerTrackIndex(0));
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
