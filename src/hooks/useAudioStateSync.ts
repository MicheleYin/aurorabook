import { useCallback, useEffect, useRef, useState } from "react";
import type { AudioTrack, BookAudioState } from "../types/reader";
import type { AudioProgressSnapshot } from "../components/reader/types";

const PROGRESS_ECHO_TOLERANCE_SECONDS = 0.5;

type UseAudioStateSyncParams = {
  bookId?: string;
  tracks: AudioTrack[];
  initialAudioState?: BookAudioState;
  onProgress?: (snapshot: AudioProgressSnapshot) => void;
};

type UseAudioStateSyncReturn = {
  currentIndex: number;
  setCurrentIndex: (index: number) => void;
  restoreTime: number | null;
  isRestoring: boolean;
  onTrackLoaded: (audioElement: HTMLAudioElement) => void;
  onTrackChanged: (newTrackId: string) => void;
  emitProgress: (timeSeconds: number) => void;
};

/**
 * Custom hook to manage audio state synchronization, restoration, and SMIL sync coordination.
 * 
 * This hook centralizes the logic for:
 * - Restoring left-off tracks and playback position
 * - Detecting and handling track changes
 * - Coordinating seek operations without conflicts
 * - Preventing echo detection issues
 */
export function useAudioStateSync({
  bookId,
  tracks,
  initialAudioState,
  onProgress,
}: UseAudioStateSyncParams): UseAudioStateSyncReturn {
  const [currentIndex, setCurrentIndexState] = useState(0);
  const [restoreTime, setRestoreTime] = useState<number | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);

  // Refs to track state without causing re-renders
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
  const lastAppliedAudioStateSignatureRef = useRef<string | undefined>(undefined);
  const onProgressRef = useRef(onProgress);
  const tracksRef = useRef(tracks);
  const isRestoringRef = useRef(false);

  // Keep refs in sync
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

  /**
   * Find the track index from initialAudioState, trying multiple matching strategies
   */
  const findTrackIndex = useCallback((): number => {
    if (!tracks.length || !initialAudioState) {
      return 0;
    }

    // Try matching by ID first (most reliable)
    if (initialAudioState.currentTrackId) {
      const matchById = tracks.findIndex(
        (track) => track.id === initialAudioState.currentTrackId
      );
      if (matchById >= 0) {
        return matchById;
      }
    }

    // Try matching by href
    if (initialAudioState.currentTrackHref) {
      const matchByHref = tracks.findIndex(
        (track) => track.href === initialAudioState.currentTrackHref
      );
      if (matchByHref >= 0) {
        return matchByHref;
      }
    }

    // Fall back to index if valid
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

  /**
   * Check if the initialAudioState is an echo of our own progress emission
   */
  const isProgressEcho = useCallback((): boolean => {
    const state = initialAudioState;
    if (!state) {
      return false;
    }

    const snapshot = lastProgressSnapshotRef.current;
    if (!snapshot.trackId && !snapshot.trackHref && typeof snapshot.trackIndex !== "number") {
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
      Boolean(snapshot.trackHref && snapshot.trackHref === state.currentTrackHref) ||
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
        Math.abs(snapshot.currentTimeSeconds - nextTimeSeconds) <= PROGRESS_ECHO_TOLERANCE_SECONDS);

    return timeMatches;
  }, [initialAudioState]);

  /**
   * Restore audio state from initialAudioState
   */
  useEffect(() => {
    if (!bookId) {
      lastAppliedAudioStateSignatureRef.current = undefined;
      previousTrackIdRef.current = null;
      setRestoreTime(null);
      setIsRestoring(false);
      return;
    }

    // Create signature to detect if we've already applied this state
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

    // Skip if we've already applied this exact state
    if (lastAppliedAudioStateSignatureRef.current === signature) {
      return;
    }

    // Skip if this is an echo of our own progress emission
    if (isProgressEcho()) {
      lastAppliedAudioStateSignatureRef.current = signature;
      return;
    }

    // Mark that we're applying this state
    lastAppliedAudioStateSignatureRef.current = signature;

    // Find the track index to restore
    const nextIndex = findTrackIndex();

    // Reset track change detection to prevent interference
    previousTrackIdRef.current = null;

    // Set the track index
    setCurrentIndexState(nextIndex);
    currentIndexRef.current = nextIndex;

    // Calculate restore time
    const restoredTime =
      typeof initialAudioState?.currentTimeSeconds === "number" &&
      Number.isFinite(initialAudioState.currentTimeSeconds)
        ? Math.max(initialAudioState.currentTimeSeconds, 0)
        : null;

    setRestoreTime(restoredTime);
    setIsRestoring(true);

    // Reset restoration applied flag when starting new restoration
    restorationAppliedRef.current = null;

    // Clear progress snapshot to prevent echo detection issues
    lastProgressSnapshotRef.current = { timestamp: 0 };

    console.log("[Audio State Sync] Restoring audio state:", {
      bookId,
      trackIndex: nextIndex,
      restoredTime,
      trackId: tracks[nextIndex]?.id,
      trackHref: tracks[nextIndex]?.href,
    });
  }, [bookId, initialAudioState, tracks, findTrackIndex, isProgressEcho]);

  /**
   * Handle track changes - reset time when track actually changes (not during restoration)
   */
  const onTrackChanged = useCallback(
    (newTrackId: string) => {
      const currentTrack = tracksRef.current[currentIndexRef.current];
      if (!currentTrack || currentTrack.id === newTrackId) {
        return;
      }

      // If we're restoring, don't reset - let restoration handle it
      if (isRestoringRef.current) {
        previousTrackIdRef.current = newTrackId;
        return;
      }

      // Track actually changed - reset time and restoration flag
      if (previousTrackIdRef.current !== null && previousTrackIdRef.current !== newTrackId) {
        console.log("[Audio State Sync] Track changed, resetting timestamp:", {
          previousTrackId: previousTrackIdRef.current,
          newTrackId,
        });
        setRestoreTime(null);
        restorationAppliedRef.current = null;
        previousTrackIdRef.current = newTrackId;
      } else if (previousTrackIdRef.current === null) {
        // First track load
        previousTrackIdRef.current = newTrackId;
      }
    },
    []
  );

  /**
   * Emit progress snapshot for SMIL sync
   */
  const emitProgress = useCallback(
    (timeSeconds: number) => {
      const track = tracksRef.current[currentIndexRef.current];
      const listener = onProgressRef.current;
      if (!track || !listener) {
        return;
      }

      const normalizedSeconds = Number(Math.max(timeSeconds, 0).toFixed(3));
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      const updatedAt = new Date().toISOString();

      lastProgressSnapshotRef.current = {
        trackId: track.id,
        trackHref: track.href,
        trackIndex: currentIndexRef.current,
        currentTimeSeconds: normalizedSeconds,
        updatedAt,
        timestamp: now,
      };

      listener({
        trackId: track.id,
        trackHref: track.href,
        trackIndex: currentIndexRef.current,
        currentTimeSeconds: normalizedSeconds,
        updatedAt,
      });
    },
    []
  );

  // Store restoreTime in a ref so it's always current in callbacks
  const restoreTimeRef = useRef<number | null>(null);
  useEffect(() => {
    restoreTimeRef.current = restoreTime;
  }, [restoreTime]);

  // Track if restoration was already applied for the current track load
  // This prevents double restoration when both loadedmetadata and canplay fire
  const restorationAppliedRef = useRef<string | null>(null);

  /**
   * Handle when audio track is loaded - apply restore time if needed
   */
  const onTrackLoaded = useCallback(
    (audioElement: HTMLAudioElement) => {
      const currentTrack = tracksRef.current[currentIndexRef.current];
      if (!currentTrack || !audioElement) {
        return;
      }

      // Use refs to get the most current values
      const shouldRestore = isRestoringRef.current;
      const timeToRestore = restoreTimeRef.current;
      const currentTrackId = currentTrack.id;

      // Check if we've already applied restoration for this track
      const alreadyApplied = restorationAppliedRef.current === currentTrackId;

      // If we're restoring and have a restore time, apply it
      if (shouldRestore && timeToRestore !== null && Number.isFinite(timeToRestore) && !alreadyApplied) {
        try {
          // Set the restore time
          audioElement.currentTime = timeToRestore;
          
          // Read back the applied time (browser may clamp it if not enough data loaded)
          const appliedTime = audioElement.currentTime || timeToRestore;
          
          // Mark that we've applied restoration for this track
          restorationAppliedRef.current = currentTrackId;
          
          console.log("[Audio State Sync] Applied restore time:", {
            requestedTime: timeToRestore,
            appliedTime: appliedTime,
            trackId: currentTrackId,
          });
          
          // Emit progress immediately so parent components know the restored time
          // This is critical for scroll sync to work correctly
          emitProgress(appliedTime);
          
          // Mark restoration as complete after applying and emitting
          setIsRestoring(false);
          setRestoreTime(null);
        } catch (error) {
          console.warn("[Audio State Sync] Failed to apply restore time:", error);
          setIsRestoring(false);
          setRestoreTime(null);
        }
      } else if (!shouldRestore && timeToRestore === null && !alreadyApplied) {
        // Normal track load (not restoring) - ensure we start at 0
        if (previousTrackIdRef.current !== null) {
          // This is a track change, not initial load
          audioElement.currentTime = 0;
        }
        // Reset the restoration applied flag for new track loads
        restorationAppliedRef.current = null;
      }
    },
    [emitProgress]
  );

  /**
   * Wrapper for setCurrentIndex that handles track change detection
   */
  const setCurrentIndex = useCallback(
    (index: number) => {
      const newTrack = tracksRef.current[index];
      if (newTrack) {
        onTrackChanged(newTrack.id);
      }
      setCurrentIndexState(index);
      currentIndexRef.current = index;
    },
    [onTrackChanged]
  );

  // Ensure currentIndex is valid
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

