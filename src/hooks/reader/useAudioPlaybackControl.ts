/**
 * Hook for managing audio playback control logic
 * Handles autoplay, track setup, restoration coordination, and track change coordination
 */

import { useCallback, useRef } from "react";
import { logger } from "../../lib/logger";
import type { AudioTrack } from "../../types/reader";

type UseAudioPlaybackControlParams = {
  isRestoringRef: React.MutableRefObject<boolean>;
  restorationInProgressRef: React.MutableRefObject<string | null>;
  trackChangeInProgressRef: React.MutableRefObject<boolean>;
  isAutoAdvancingRef: React.MutableRefObject<boolean>;
  isPlayingRef: React.MutableRefObject<boolean>;
  setIsPlaying: (playing: boolean) => void;
  setCurrentTime: (time: number) => void;
  playbackRate: number;
  onTrackChanged: (trackId: string) => void;
  onTrackChange?: (trackHref: string) => void;
  trackLoadedForRestorationRef: React.MutableRefObject<boolean>;
};

export function useAudioPlaybackControl({
  isRestoringRef,
  restorationInProgressRef,
  trackChangeInProgressRef,
  isAutoAdvancingRef,
  isPlayingRef,
  setIsPlaying,
  setCurrentTime,
  playbackRate,
  onTrackChanged,
  onTrackChange,
  trackLoadedForRestorationRef,
}: UseAudioPlaybackControlParams) {
  const lastSetupTrackIdRef = useRef<string | null>(null);

  const attemptAutoplay = useCallback(
    async (audio: HTMLAudioElement, shouldPlay: boolean): Promise<boolean> => {
      // Prevent autoplay during restoration or track changes
      if (
        isRestoringRef.current ||
        restorationInProgressRef.current ||
        trackChangeInProgressRef.current
      ) {
        logger.log("[Audio Player] Autoplay blocked - restoration or track change in progress", {
          isRestoring: isRestoringRef.current,
          restorationInProgress: restorationInProgressRef.current,
          trackChangeInProgress: trackChangeInProgressRef.current,
        });
        return false;
      }

      if (!shouldPlay || !audio.paused) {
        return false;
      }

      try {
        await audio.play();
        setIsPlaying(true);
        isPlayingRef.current = true;
        logger.log("[Audio Player] Autoplay succeeded");
        return true;
      } catch (error) {
        logger.warn("[Audio Player] Autoplay failed:", error);
        setIsPlaying(false);
        isPlayingRef.current = false;
        return false;
      }
    },
    [isRestoringRef, restorationInProgressRef, trackChangeInProgressRef, setIsPlaying]
  );

  const tryPlayIfReady = useCallback(
    (audio: HTMLAudioElement, shouldAutoplay: boolean): boolean => {
      // Prevent play if restoration or track change is in progress
      if (
        isRestoringRef.current ||
        restorationInProgressRef.current ||
        trackChangeInProgressRef.current
      ) {
        return false;
      }

      if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA && audio.paused) {
        attemptAutoplay(audio, shouldAutoplay);
        return true;
      }
      return false;
    },
    [attemptAutoplay, isRestoringRef, restorationInProgressRef, trackChangeInProgressRef]
  );

  const setupAudioSource = useCallback(
    (
      audio: HTMLAudioElement,
      track: AudioTrack
    ): (() => void) | undefined => {
      // Prevent duplicate setup for the same track
      if (lastSetupTrackIdRef.current === track.id && audio.src === track.url) {
        logger.log("[Audio Player] Skipping duplicate setup for track", {
          trackId: track.id,
        });
        return;
      }

      lastSetupTrackIdRef.current = track.id;

      // Determine if we should autoplay after loading
      // Check isPlayingRef first (most reliable) - this is set before track changes
      // Also check if we're auto-advancing (track ended and moving to next) or manually changing tracks
      // IMPORTANT: Don't autoplay during restoration to prevent conflicts
      const shouldAutoplay =
        !isRestoringRef.current && (isPlayingRef.current || isAutoAdvancingRef.current);

      logger.log("[Audio Player] Setting up audio source", {
        trackId: track.id,
        trackTitle: track.title,
        isPlayingRef: isPlayingRef.current,
        audioPaused: audio.paused,
        isAutoAdvancing: isAutoAdvancingRef.current,
        shouldAutoplay,
        isRestoring: isRestoringRef.current,
      });

      // Notify hook about track change
      onTrackChanged(track.id);

      // Notify parent about track change (for chapter sync)
      // BUT: Don't trigger chapter changes during audio restoration
      // This prevents resetting chapter progress when restoring audio state
      if (onTrackChange && !isRestoringRef.current) {
        onTrackChange(track.href);
      }

      // Reset restoration flag - but only if restoration is not already in progress
      // This prevents clearing the flag if restoration is happening concurrently
      if (!restorationInProgressRef.current) {
        trackLoadedForRestorationRef.current = isRestoringRef.current;
      }

      // Update playing state to match shouldAutoplay
      // Only update if state doesn't match (avoid unnecessary re-renders)
      if (shouldAutoplay) {
        if (!isPlayingRef.current) {
          isPlayingRef.current = true;
          setIsPlaying(true);
        }
      } else {
        if (isPlayingRef.current) {
          setIsPlaying(false);
          isPlayingRef.current = false;
        }
      }

      // Set audio source
      audio.src = track.url!;
      audio.load();
      audio.playbackRate = playbackRate;

      // Reset time if not restoring
      if (!isRestoringRef.current) {
        audio.currentTime = 0;
        setCurrentTime(0);
      }

      // Try immediate play if audio is already ready (cached)
      if (tryPlayIfReady(audio, shouldAutoplay)) {
        // Clear auto-advancing flag once playback actually starts
        if (shouldAutoplay && !audio.paused) {
          isAutoAdvancingRef.current = false;
          trackChangeInProgressRef.current = false;
        }
        return; // Already playing, no need for event listener
      }

      // Set up event listeners for when audio becomes ready
      // Use multiple events to ensure we catch when audio is ready
      let cleanupCalled = false;

      // Clear track change flag when audio is ready (even if not playing yet)
      // This allows autoplay to proceed once audio is ready
      const handleAudioReadyForTrackChange = () => {
        if (!cleanupCalled && trackChangeInProgressRef.current) {
          logger.log("[Audio Player] Audio ready - clearing track change flag", {
            trackId: track.id,
          });
          trackChangeInProgressRef.current = false;
        }
      };

      // Listen for when audio becomes ready to clear track change flag
      audio.addEventListener("canplay", handleAudioReadyForTrackChange, { once: true });
      audio.addEventListener("canplaythrough", handleAudioReadyForTrackChange, { once: true });

      const handleCanPlay = () => {
        if (cleanupCalled) return;
        if (shouldAutoplay && audio.paused) {
          logger.log("[Audio Player] canplay event - attempting autoplay", {
            trackId: track.id,
            shouldAutoplay,
            audioPaused: audio.paused,
          });
          attemptAutoplay(audio, true).then((success) => {
            if (success) {
              // Clear auto-advancing flag once playback actually starts
              isAutoAdvancingRef.current = false;
              // Clear track change flag when playback starts
              trackChangeInProgressRef.current = false;
            }
          });
        }
      };

      const handleCanPlayThrough = () => {
        if (cleanupCalled) return;
        if (shouldAutoplay && audio.paused) {
          logger.log("[Audio Player] canplaythrough event - attempting autoplay", {
            trackId: track.id,
            shouldAutoplay,
            audioPaused: audio.paused,
          });
          attemptAutoplay(audio, true).then((success) => {
            if (success) {
              // Clear auto-advancing flag once playback actually starts
              isAutoAdvancingRef.current = false;
              // Clear track change flag when playback starts
              trackChangeInProgressRef.current = false;
            }
          });
        }
      };

      const handleLoadedData = () => {
        if (cleanupCalled) return;
        // Only try autoplay on loadeddata if canplay hasn't fired yet
        // This is a fallback for very fast loads
        if (
          shouldAutoplay &&
          audio.paused &&
          audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA
        ) {
          logger.log("[Audio Player] loadeddata event - attempting autoplay", {
            trackId: track.id,
            shouldAutoplay,
            audioPaused: audio.paused,
            readyState: audio.readyState,
          });
          attemptAutoplay(audio, true).then((success) => {
            if (success) {
              // Clear auto-advancing flag once playback actually starts
              isAutoAdvancingRef.current = false;
              // Clear track change flag when playback starts
              trackChangeInProgressRef.current = false;
            }
          });
        }
      };

      // Listen for when playback actually starts to clear the auto-advancing flag
      const handlePlaying = () => {
        if (isAutoAdvancingRef.current) {
          logger.log("[Audio Player] Playback started - clearing auto-advancing flag", {
            trackId: track.id,
          });
          isAutoAdvancingRef.current = false;
        }
        // Clear track change flag when playback actually starts
        if (trackChangeInProgressRef.current) {
          logger.log("[Audio Player] Playback started - clearing track change flag", {
            trackId: track.id,
          });
          trackChangeInProgressRef.current = false;
        }
      };

      audio.addEventListener("canplay", handleCanPlay);
      audio.addEventListener("canplaythrough", handleCanPlayThrough);
      audio.addEventListener("loadeddata", handleLoadedData);
      audio.addEventListener("playing", handlePlaying);

      // Also try to play after a short delay as a fallback
      // This handles cases where events don't fire reliably
      const fallbackTimeout = setTimeout(() => {
        if (
          !cleanupCalled &&
          shouldAutoplay &&
          audio.paused &&
          audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA
        ) {
          logger.log("[Audio Player] Fallback timeout - attempting autoplay", {
            trackId: track.id,
            shouldAutoplay,
            audioPaused: audio.paused,
            readyState: audio.readyState,
          });
          attemptAutoplay(audio, true).then((success) => {
            if (success) {
              // Clear auto-advancing flag once playback actually starts
              isAutoAdvancingRef.current = false;
              // Clear track change flag when playback starts
              trackChangeInProgressRef.current = false;
            }
          });
        }
      }, 100);

      // Return cleanup function
      return () => {
        cleanupCalled = true;
        clearTimeout(fallbackTimeout);
        audio.removeEventListener("canplay", handleCanPlay);
        audio.removeEventListener("canplaythrough", handleCanPlayThrough);
        audio.removeEventListener("loadeddata", handleLoadedData);
        audio.removeEventListener("playing", handlePlaying);
        // Note: handleAudioReadyForTrackChange uses { once: true }, so it auto-removes
        // Clear track change flag on cleanup as a safety measure
        trackChangeInProgressRef.current = false;
      };
    },
    [
      playbackRate,
      onTrackChanged,
      onTrackChange,
      tryPlayIfReady,
      attemptAutoplay,
      isRestoringRef,
      restorationInProgressRef,
      trackChangeInProgressRef,
      isAutoAdvancingRef,
      isPlayingRef,
      setIsPlaying,
      setCurrentTime,
      trackLoadedForRestorationRef,
    ]
  );

  return {
    attemptAutoplay,
    tryPlayIfReady,
    setupAudioSource,
    lastSetupTrackIdRef,
  };
}

