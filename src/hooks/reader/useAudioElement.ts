/**
 * Hook for managing HTMLAudioElement lifecycle and event handlers
 * Handles all audio element events, state synchronization, and progress emission
 */

import { useEffect, useRef } from "react";
import { logger } from "../../lib/logger";

type UseAudioElementParams = {
  audioRef: React.RefObject<HTMLAudioElement | null>;
  isRestoring: boolean;
  restorationInProgressRef: React.MutableRefObject<string | null>;
  trackChangeInProgressRef: React.MutableRefObject<boolean>;
  isAutoAdvancingRef: React.MutableRefObject<boolean>;
  isPlayingRef: React.MutableRefObject<boolean>;
  setIsPlaying: (playing: boolean) => void;
  setCurrentTime: (time: number) => void;
  setDuration: (duration: number) => void;
  onTrackLoaded: (audio: HTMLAudioElement) => void;
  emitProgress: (time: number) => void;
  flushAudioStateUpdate: () => Promise<void>;
  trackLoadedForRestorationRef: React.MutableRefObject<boolean>;
  currentTrack?: { id: string };
  currentIndex: number;
  tracksLength: number;
  restoreTime: number | null;
};

export function useAudioElement({
  audioRef,
  isRestoring,
  restorationInProgressRef,
  trackChangeInProgressRef,
  isAutoAdvancingRef,
  isPlayingRef,
  setIsPlaying,
  setCurrentTime,
  setDuration,
  onTrackLoaded,
  emitProgress,
  flushAudioStateUpdate,
  trackLoadedForRestorationRef,
  currentTrack,
  currentIndex,
  tracksLength,
  restoreTime,
}: UseAudioElementParams) {
  const onTrackLoadedRef = useRef(onTrackLoaded);
  const emitProgressRef = useRef(emitProgress);
  const isRestoringRef = useRef(isRestoring);
  const lastEmitTimestampRef = useRef(0);
  const lastEmittedSecondsRef = useRef(0);
  const lastCurrentTimeUpdateRef = useRef(0);
  const hasBeenDismissedRef = useRef(false);

  // Update refs when props change
  useEffect(() => {
    onTrackLoadedRef.current = onTrackLoaded;
  }, [onTrackLoaded]);

  useEffect(() => {
    emitProgressRef.current = emitProgress;
  }, [emitProgress]);

  useEffect(() => {
    isRestoringRef.current = isRestoring;
  }, [isRestoring]);

  useEffect(() => {
    const audio = audioRef.current ?? new Audio();
    audioRef.current = audio;

    const handleTimeUpdate = () => {
      // Single source of truth: always read from audio element
      const seconds = audio.currentTime || 0;

      // Don't sync state during restoration to prevent conflicts
      if (isRestoringRef.current || restorationInProgressRef.current) {
        return;
      }

      // Sync play state with audio element to handle external pause/play
      // BUT: Don't sync if we're auto-advancing (track ended and moving to next)
      const audioIsPlaying = !audio.paused;
      if (audioIsPlaying !== isPlayingRef.current && !isAutoAdvancingRef.current) {
        logger.log("[Audio Player] Play state mismatch detected in timeupdate", {
          audioIsPlaying,
          isPlayingRef: isPlayingRef.current,
          currentTime: seconds,
        });
        setIsPlaying(audioIsPlaying);
        isPlayingRef.current = audioIsPlaying;
        // If paused externally, emit progress to save state
        if (!audioIsPlaying) {
          emitProgressRef.current(seconds);
        }
      }

      const now = typeof performance !== "undefined" ? performance.now() : Date.now();

      // Don't update UI state if component is dismissing (reduces re-renders during animation)
      if (!hasBeenDismissedRef.current) {
        // Throttle setCurrentTime state updates to at most once per second
        const timeSinceLastUpdate = now - lastCurrentTimeUpdateRef.current;
        if (timeSinceLastUpdate >= 1000) {
          setCurrentTime(seconds);
          lastCurrentTimeUpdateRef.current = now;
        }
      }

      // Throttle progress emissions to at most once per second
      const timeSinceLastEmit = now - lastEmitTimestampRef.current;
      if (timeSinceLastEmit >= 1000) {
        emitProgressRef.current(seconds);
        lastEmitTimestampRef.current = now;
        lastEmittedSecondsRef.current = seconds;
      }
    };

    const handleLoadedMetadata = () => {
      logger.log("[Audio Player] loadedmetadata event fired", {
        duration: audio.duration,
        currentTime: audio.currentTime,
        isPlayingRef: isPlayingRef.current,
        audioPaused: audio.paused,
        isRestoring: isRestoringRef.current,
        readyState: audio.readyState,
      });

      const newDuration = Number.isFinite(audio.duration) ? audio.duration : 0;
      setDuration(newDuration);

      // Update current time from audio element (single source of truth)
      const audioTime = audio.currentTime || 0;
      setCurrentTime(audioTime);

      // Handle restoration if needed - use lock to prevent concurrent attempts
      if (trackLoadedForRestorationRef.current) {
        const currentTrackId = currentTrack?.id;
        // Only restore if not already in progress for this track
        if (currentTrackId && restorationInProgressRef.current !== currentTrackId) {
          restorationInProgressRef.current = currentTrackId;
          // Set a timeout to clear the lock if restoration doesn't complete (safety measure)
          const lockTimeout = setTimeout(() => {
            if (restorationInProgressRef.current === currentTrackId) {
              logger.warn("[Audio Player] Restoration lock timeout - clearing lock", {
                trackId: currentTrackId,
              });
              restorationInProgressRef.current = null;
            }
          }, 5000); // 5 second timeout

          try {
            onTrackLoadedRef.current(audio);
          } finally {
            // Clear flag after restoration attempt (even if it fails)
            trackLoadedForRestorationRef.current = false;
            // Clear timeout since restoration attempt completed
            clearTimeout(lockTimeout);
            // Keep lock until restoration completes to prevent race conditions
            // The lock will be cleared when isRestoring becomes false
          }
        }
      }

      // Emit progress if needed (for paused audio where timeupdate might not fire)
      // But only if restoration is not in progress
      if (!isRestoringRef.current && !restorationInProgressRef.current && audioTime > 0) {
        setTimeout(() => {
          emitProgressRef.current(audioTime);
        }, 50);
      }
    };

    const handleAudioReady = () => {
      logger.log("[Audio Player] Audio ready event", {
        readyState: audio.readyState,
        isRestoring: trackLoadedForRestorationRef.current,
        currentTime: audio.currentTime,
      });

      // Handle restoration if needed - use lock to prevent concurrent attempts
      // Only handle if loadedmetadata didn't already handle it
      if (trackLoadedForRestorationRef.current) {
        const currentTrackId = currentTrack?.id;
        // Only restore if not already in progress for this track
        if (currentTrackId && restorationInProgressRef.current !== currentTrackId) {
          restorationInProgressRef.current = currentTrackId;
          // Set a timeout to clear the lock if restoration doesn't complete (safety measure)
          const lockTimeout = setTimeout(() => {
            if (restorationInProgressRef.current === currentTrackId) {
              logger.warn("[Audio Player] Restoration lock timeout - clearing lock", {
                trackId: currentTrackId,
              });
              restorationInProgressRef.current = null;
            }
          }, 5000); // 5 second timeout

          try {
            onTrackLoadedRef.current(audio);
          } finally {
            // Clear flag after restoration attempt (even if it fails)
            trackLoadedForRestorationRef.current = false;
            // Clear timeout since restoration attempt completed
            clearTimeout(lockTimeout);
            // Keep lock until restoration completes to prevent race conditions
            // The lock will be cleared when isRestoring becomes false
          }
        }
      } else if (!restorationInProgressRef.current) {
        // Normal playback - emit progress if needed
        // Only if restoration is not in progress
        const audioTime = audio.currentTime || 0;
        if (audioTime > 0) {
          emitProgressRef.current(audioTime);
        }
      }
    };

    const handleEnded = () => {
      logger.log("[Audio Player] Track ended", {
        currentIndex,
        currentTrackId: currentTrack?.id,
        totalTracks: tracksLength,
        isPlayingRef: isPlayingRef.current,
      });

      // Emit final progress for the ended track
      emitProgressRef.current(audio.currentTime || 0);
    };

    const handleSeeked = () => {
      // When a seek completes, sync the position immediately
      // This ensures the UI reflects the actual audio position after seeking
      // Single source of truth: always read from audio element
      const seconds = audio.currentTime || 0;
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();

      // Update state immediately
      setCurrentTime(seconds);

      // Reset throttling timers so timeupdate can continue updating normally
      lastCurrentTimeUpdateRef.current = now;
      lastEmitTimestampRef.current = now;
      lastEmittedSecondsRef.current = seconds;

      // Emit progress to save the new position
      emitProgressRef.current(seconds);
    };

    // Handle play/pause events to keep state in sync (important for iOS background controls)
    const handlePlay = () => {
      // Don't sync state if we're auto-advancing (track ended and moving to next)
      if (isAutoAdvancingRef.current) {
        return;
      }
      // Don't sync state during restoration to prevent conflicts
      if (isRestoringRef.current || restorationInProgressRef.current) {
        return;
      }
      logger.log("[Audio Player] play event fired", {
        audioPaused: audio.paused,
        isPlayingRef: isPlayingRef.current,
      });
      setIsPlaying(true);
      isPlayingRef.current = true;
    };

    const handlePause = () => {
      // Don't sync state if we're auto-advancing (track ended and moving to next)
      if (isAutoAdvancingRef.current) {
        return;
      }
      // Don't sync state during restoration to prevent conflicts
      if (isRestoringRef.current || restorationInProgressRef.current) {
        return;
      }
      logger.log("[Audio Player] pause event fired", {
        audioPaused: audio.paused,
        isPlayingRef: isPlayingRef.current,
      });
      setIsPlaying(false);
      isPlayingRef.current = false;
      // Emit progress to save state when paused
      const audioTime = audio.currentTime || 0;
      emitProgressRef.current(audioTime);
      // Flush audio state update immediately on pause
      flushAudioStateUpdate().catch((error) => {
        logger.warn("Failed to flush audio state on pause", error);
      });
    };

    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("canplay", handleAudioReady);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("seeked", handleSeeked);
    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);

    return () => {
      audio.pause();
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("canplay", handleAudioReady);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("seeked", handleSeeked);
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
    };
  }, [
    audioRef,
    currentIndex,
    tracksLength,
    isRestoring,
    restoreTime,
    flushAudioStateUpdate,
    currentTrack?.id,
    restorationInProgressRef,
    trackChangeInProgressRef,
    isAutoAdvancingRef,
    isPlayingRef,
    setIsPlaying,
    setCurrentTime,
    setDuration,
    trackLoadedForRestorationRef,
  ]);

  return {
    // Expose refs for external use if needed
    lastEmitTimestampRef,
    lastEmittedSecondsRef,
    lastCurrentTimeUpdateRef,
  };
}

