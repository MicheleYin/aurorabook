/**
 * Audio state sync hook
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { UseAudioStateSyncParams } from "./types";

const PROGRESS_ECHO_TOLERANCE_SECONDS = 0.5;

export function useAudioStateSync(params: UseAudioStateSyncParams) {
  const { bookId, tracks, initialAudioState, onProgress } = params;

  const [currentIndex, setCurrentIndexState] = useState(0);
  const [restoreTime, setRestoreTime] = useState<number | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);

  const currentIndexRef = useRef(0);
  const previousTrackIdRef = useRef<string | null>(null);
  const lastProgressSnapshotRef = useRef<{
    trackId?: string;
    trackHref?: string;
    trackIndex?: number;
    currentTimeSeconds?: number;
    updatedAt?: string;
    timestamp: number;
  }>({ timestamp: 0 });
  const lastAppliedAudioStateSignatureRef = useRef<string | undefined>(
    undefined,
  );
  const onProgressRef = useRef(onProgress);
  const tracksRef = useRef(tracks);
  const isRestoringRef = useRef(false);
  const restorationAppliedRef = useRef<string | null>(null);
  const restoreTimeRef = useRef<number | null>(null);

  useEffect(() => {
    onProgressRef.current = onProgress;
  }, [onProgress]);

  useEffect(() => {
    tracksRef.current = tracks;
  }, [tracks]);

  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

  useEffect(() => {
    isRestoringRef.current = isRestoring;
  }, [isRestoring]);

  useEffect(() => {
    restoreTimeRef.current = restoreTime;
  }, [restoreTime]);

  const findTrackIndex = useCallback((): number => {
    if (!tracks.length || !initialAudioState) {
      return 0;
    }

    if (initialAudioState.currentTrackId) {
      const matchById = tracks.findIndex(
        (track) => track.id === initialAudioState.currentTrackId,
      );
      if (matchById >= 0) {
        return matchById;
      }
    }

    if (initialAudioState.currentTrackHref) {
      const matchByHref = tracks.findIndex(
        (track) => track.href === initialAudioState.currentTrackHref,
      );
      if (matchByHref >= 0) {
        return matchByHref;
      }
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

  const isProgressEcho = useCallback((): boolean => {
    const state = initialAudioState;
    if (!state) {
      return false;
    }

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

    if (!trackMatches) {
      return false;
    }

    const timeMatches =
      (snapshot.updatedAt && snapshot.updatedAt === state.updatedAt) ||
      (typeof snapshot.currentTimeSeconds === "number" &&
        typeof nextTimeSeconds === "number" &&
        Math.abs(snapshot.currentTimeSeconds - nextTimeSeconds) <=
          PROGRESS_ECHO_TOLERANCE_SECONDS);

    return timeMatches;
  }, [initialAudioState]);

  useEffect(() => {
    if (!bookId) {
      lastAppliedAudioStateSignatureRef.current = undefined;
      previousTrackIdRef.current = null;
      setRestoreTime(null);
      setIsRestoring(false);
      return;
    }

    const state = initialAudioState;
    const signatureComponents = [
      bookId,
      state?.currentTrackId ?? "no-track",
      state?.updatedAt ?? "no-updated-at",
      Number.isFinite(state?.currentTimeSeconds)
        ? String(state?.currentTimeSeconds)
        : "0",
      String(tracks.length),
    ];
    const signature = signatureComponents.join("|");

    if (lastAppliedAudioStateSignatureRef.current === signature) {
      return;
    }

    if (isProgressEcho()) {
      lastAppliedAudioStateSignatureRef.current = signature;
      return;
    }

    lastAppliedAudioStateSignatureRef.current = signature;

    const nextIndex = findTrackIndex();
    previousTrackIdRef.current = null;
    setCurrentIndexState(nextIndex);
    currentIndexRef.current = nextIndex;

    const restoredTime =
      typeof initialAudioState?.currentTimeSeconds === "number" &&
      Number.isFinite(initialAudioState.currentTimeSeconds)
        ? Math.max(initialAudioState.currentTimeSeconds, 0)
        : null;

    setRestoreTime(restoredTime);
    setIsRestoring(true);
    restorationAppliedRef.current = null;
    lastProgressSnapshotRef.current = { timestamp: 0 };
  }, [bookId, initialAudioState, tracks, findTrackIndex, isProgressEcho]);

  const onTrackChanged = useCallback(
    (newTrackId: string) => {
      const currentTrack = tracksRef.current[currentIndexRef.current];
      if (!currentTrack || currentTrack.id === newTrackId) {
        return;
      }

      if (isRestoringRef.current) {
        previousTrackIdRef.current = newTrackId;
        return;
      }

      if (
        previousTrackIdRef.current !== null &&
        previousTrackIdRef.current !== newTrackId
      ) {
        setRestoreTime(null);
        restorationAppliedRef.current = null;
        previousTrackIdRef.current = newTrackId;
      } else if (previousTrackIdRef.current === null) {
        previousTrackIdRef.current = newTrackId;
      }
    },
    [],
  );

  const emitProgress = useCallback(
    (timeSeconds: number) => {
      const track = tracksRef.current[currentIndexRef.current];
      const listener = onProgressRef.current;
      if (!track || !listener) {
        return;
      }

      const normalizedSeconds = Number(Math.max(timeSeconds, 0).toFixed(3));
      const updatedAt = new Date().toISOString();

      lastProgressSnapshotRef.current = {
        trackId: track.id,
        trackHref: track.href,
        trackIndex: currentIndexRef.current,
        currentTimeSeconds: normalizedSeconds,
        updatedAt,
        timestamp: Date.now(),
      };

      listener({
        trackId: track.id,
        trackHref: track.href,
        trackIndex: currentIndexRef.current,
        currentTimeSeconds: normalizedSeconds,
        updatedAt,
      });
    },
    [],
  );

  const onTrackLoaded = useCallback(
    (audioElement: HTMLAudioElement) => {
      const currentTrack = tracksRef.current[currentIndexRef.current];
      if (!currentTrack || !audioElement) {
        return;
      }

      const shouldRestore = isRestoringRef.current;
      const timeToRestore = restoreTimeRef.current;
      const currentTrackId = currentTrack.id;
      const alreadyApplied =
        restorationAppliedRef.current === currentTrackId;

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
          console.warn("Failed to apply restore time:", error);
          setIsRestoring(false);
          setRestoreTime(null);
        }
      } else if (shouldRestore && timeToRestore === null) {
        setIsRestoring(false);
        setRestoreTime(null);
        restorationAppliedRef.current = currentTrackId;
      } else if (!shouldRestore && timeToRestore === null && !alreadyApplied) {
        if (previousTrackIdRef.current !== null) {
          audioElement.currentTime = 0;
        }
        restorationAppliedRef.current = null;
      }
    },
    [emitProgress],
  );

  const setCurrentIndex = useCallback(
    (index: number) => {
      const newTrack = tracksRef.current[index];
      if (newTrack) {
        onTrackChanged(newTrack.id);
      }
      setCurrentIndexState(index);
      currentIndexRef.current = index;
    },
    [onTrackChanged],
  );

  useEffect(() => {
    if (tracks.length && currentIndex >= tracks.length) {
      setCurrentIndexState(0);
      currentIndexRef.current = 0;
    }
  }, [tracks.length, currentIndex]);

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

