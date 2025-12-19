import { useCallback, useEffect, useMemo, useRef } from "react";
import { usePrevious } from "../../../hooks/usePrevious";
import { logger } from "../../../lib/logger";
import type { AudioTrack, AudioSyncMap, Chapter } from "../../../types/reader";
import type { AudioProgressSnapshot } from "../types";
import { ensureAudioTrackLoaded } from "../../../lib/lazy-chapter-loader";
import { resourceCacheManager } from "../../../lib/resource-cache-manager";
import { usePersistentSettings } from "../../../hooks/settings/usePersistentSettings";
import { useAppDispatch, useAppSelector } from "../../../store/hooks";
import {
  selectAudioPlayerIsPlaying,
  selectAudioPlayerCurrentTime,
  selectAudioPlayerDuration,
  selectAudioPlayerPlaybackRate,
  selectAudioPlayerIsScrubbing,
  selectAudioPlayerScrubTime,
  selectAudioPlayerIsVisible,
  selectAudioPlayerShowTracksDialog,
  selectAudioPlayerTrackAnimationState,
  selectAudioPlayerTrackAnimationDirection,
  selectAudioPlayerLoadedCount,
  selectAudioPlayerIsTrackLoading,
  selectAudioPlayerIsLocalTrackChanging,
  selectTrackChanging,
  selectOperationLocks,
} from "../../../store/selectors";
import {
  setAudioPlayerIsPlaying,
  setAudioPlayerCurrentTime,
  setAudioPlayerDuration,
  setAudioPlayerPlaybackRate,
  setAudioPlayerIsScrubbing,
  setAudioPlayerScrubTime,
  setAudioPlayerIsVisible,
  setAudioPlayerShowTracksDialog,
  setAudioPlayerTrackAnimationState,
  setAudioPlayerTrackAnimationDirection,
  setAudioPlayerLoadedCount,
  setAudioPlayerIsTrackLoading,
  setAudioPlayerIsLocalTrackChanging,
  setAudioPlayerDismissing,
} from "../../../store/slices/readerSlice";
import { useAudioPlayerState } from "../../../hooks/audio/useAudioPlayerState";

const updateAudioPlaybackRate = (audio: HTMLAudioElement | null, rate: number): void => {
  if (audio) {
    audio.playbackRate = rate;
  }
};

export function useAudioPlayerLogic({
  bookId,
  tracks,
  onProgress,
  onRestorationStateChange,
  onTrackChange,
}: {
  bookId?: string;
  tracks: AudioTrack[];
  onProgress?: (snapshot: AudioProgressSnapshot) => void;
  onRestorationStateChange?: (isRestoring: boolean) => void;
  onTrackChange?: (trackHref: string) => void;
}) {
  const dispatch = useAppDispatch();

  // Get audio player state from Redux
  const isPlaying = useAppSelector(selectAudioPlayerIsPlaying);
  const currentTime = useAppSelector(selectAudioPlayerCurrentTime);
  const duration = useAppSelector(selectAudioPlayerDuration);
  const playbackRate = useAppSelector(selectAudioPlayerPlaybackRate);
  const isScrubbing = useAppSelector(selectAudioPlayerIsScrubbing);
  const scrubTime = useAppSelector(selectAudioPlayerScrubTime);
  const isVisible = useAppSelector(selectAudioPlayerIsVisible);
  const showTracksDialog = useAppSelector(selectAudioPlayerShowTracksDialog);
  const trackAnimationState = useAppSelector(selectAudioPlayerTrackAnimationState);
  const trackAnimationDirection = useAppSelector(selectAudioPlayerTrackAnimationDirection);
  const loadedCount = useAppSelector(selectAudioPlayerLoadedCount);
  const isTrackLoading = useAppSelector(selectAudioPlayerIsTrackLoading);
  const isLocalTrackChanging = useAppSelector(selectAudioPlayerIsLocalTrackChanging);

  // Get coordinator state from Redux
  const trackChanging = useAppSelector(selectTrackChanging);
  const locks = useAppSelector(selectOperationLocks);
  const isTrackChangeInProgress = trackChanging || (locks.audio?.type === "changeAudioTrack");

  // Get audio player restoration state from Redux
  const currentIndex = useAppSelector((state) => state.reader.audioPlayer.currentTrackIndex);
  const restoreTime = useAppSelector((state) => state.reader.audioPlayer.restoreTime);
  const isRestoring = useAppSelector((state) => state.reader.audioPlayer.isRestoring);
  const isDismissing = useAppSelector((state) => state.reader.audioPlayer.isDismissing);

  // Use audio player state hook for restoration logic
  const library = useAppSelector((state) => state.library.books);
  const {
    setCurrentIndex,
    onTrackLoaded,
    onTrackChanged,
    emitProgress,
  } = useAudioPlayerState({
    bookId,
    tracks,
    library,
    onProgress,
  });

  const flushAudioStateUpdate = useCallback(async () => {
    return Promise.resolve();
  }, []);

  // Get settings for playback speed
  const { settings, updateSettings, isHydrated: settingsHydrated } = usePersistentSettings();

  // Refs
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const isPlayingRef = useRef(false);
  const userScrubbingRef = useRef(false);
  const lastEmitTimestampRef = useRef(0);
  const lastEmittedSecondsRef = useRef(0);
  const lastCurrentTimeUpdateRef = useRef(0);
  const hasBeenDismissedRef = useRef(false);
  const isAutoAdvancingRef = useRef(false);
  const trackLoadedForRestorationRef = useRef(false);
  const restorationInProgressRef = useRef<string | null>(null);
  const emitProgressTimeoutRef = useRef<number | null>(null);
  const dismissTimeoutRef = useRef<number | null>(null);
  const trackAnimationTimeoutRef = useRef<number | null>(null);
  const trackAnimationResetTimeoutRef = useRef<number | null>(null);
  const loadingTracksRef = useRef<Set<string>>(new Set());
  const trackChangeInProgressRef = useRef(false);
  const lastNotifiedTrackHrefRef = useRef<string | null>(null);
  const lastSetupTrackIdRef = useRef<string | null>(null);
  const onTrackLoadedRef = useRef(onTrackLoaded);
  const emitProgressRef = useRef(emitProgress);
  const restorationTimeoutRef = useRef<number | null>(null);
  const loadedCountRef = useRef(0);

  // Track previous track index for animation
  const previousTrackIndex = usePrevious(currentIndex);

  // Update refs when callbacks change
  useEffect(() => {
    onTrackLoadedRef.current = onTrackLoaded;
    emitProgressRef.current = emitProgress;
  }, [onTrackLoaded, emitProgress]);

  // Notify parent of restoration state changes
  useEffect(() => {
    if (!restorationInProgressRef.current) {
      trackLoadedForRestorationRef.current = isRestoring;
    }
    onRestorationStateChange?.(isRestoring);

    if (!isRestoring && restorationInProgressRef.current) {
      restorationInProgressRef.current = null;
    }
  }, [isRestoring, onRestorationStateChange]);

  // Update playback rate when settings change
  useEffect(() => {
    if (settingsHydrated && settings.audioPlaybackSpeed !== undefined) {
      const newRate = settings.audioPlaybackSpeed;
      dispatch(setAudioPlayerPlaybackRate(newRate));
      updateAudioPlaybackRate(audioRef.current, newRate);
    }
  }, [dispatch, settings.audioPlaybackSpeed, settingsHydrated]);

  // Handle enter animation
  useEffect(() => {
    if (isDismissing || hasBeenDismissedRef.current) {
      return;
    }

    dispatch(setAudioPlayerDismissing(false));
    const timer = setTimeout(() => {
      if (!isDismissing && !hasBeenDismissedRef.current) {
        dispatch(setAudioPlayerIsVisible(true));
      }
    }, 10);
    return () => clearTimeout(timer);
  }, [dispatch, bookId, tracks.length, isDismissing]);

  // Reset dismissed state when book/tracks change
  useEffect(() => {
    hasBeenDismissedRef.current = false;
    dispatch(setAudioPlayerDismissing(false));
    dispatch(setAudioPlayerIsVisible(false));
  }, [dispatch, bookId, tracks.length]);

  // Track animation
  useEffect(() => {
    if (trackAnimationTimeoutRef.current !== null) {
      clearTimeout(trackAnimationTimeoutRef.current);
      trackAnimationTimeoutRef.current = null;
    }
    if (trackAnimationResetTimeoutRef.current !== null) {
      clearTimeout(trackAnimationResetTimeoutRef.current);
      trackAnimationResetTimeoutRef.current = null;
    }

    if (previousTrackIndex !== undefined && previousTrackIndex !== currentIndex) {
      const direction = currentIndex > previousTrackIndex ? "left" : "right";

      dispatch(setAudioPlayerTrackAnimationState(null));
      dispatch(setAudioPlayerTrackAnimationDirection(null));

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          dispatch(setAudioPlayerTrackAnimationDirection(direction));
          dispatch(setAudioPlayerTrackAnimationState("entering"));

          trackAnimationTimeoutRef.current = window.setTimeout(() => {
            dispatch(setAudioPlayerTrackAnimationState("entered"));

            trackAnimationResetTimeoutRef.current = window.setTimeout(() => {
              dispatch(setAudioPlayerTrackAnimationState(null));
              dispatch(setAudioPlayerTrackAnimationDirection(null));
            }, 300);
          }, 50);
        });
      });
    } else if (previousTrackIndex === undefined) {
      dispatch(setAudioPlayerTrackAnimationDirection(null));
      dispatch(setAudioPlayerTrackAnimationState(null));
    }

    return () => {
      if (trackAnimationTimeoutRef.current !== null) {
        clearTimeout(trackAnimationTimeoutRef.current);
        trackAnimationTimeoutRef.current = null;
      }
      if (trackAnimationResetTimeoutRef.current !== null) {
        clearTimeout(trackAnimationResetTimeoutRef.current);
        trackAnimationResetTimeoutRef.current = null;
      }
    };
  }, [dispatch, currentIndex, previousTrackIndex]);

  // Determine track animation class
  const trackAnimationClass = useMemo(() => {
    if (trackAnimationState === "entering" || trackAnimationState === "entered") {
      if (trackAnimationDirection === "left") {
        return "animate-in slide-in-from-right-8 fade-in-0 duration-300 ease-in-out";
      } else if (trackAnimationDirection === "right") {
        return "animate-in slide-in-from-left-8 fade-in-0 duration-300 ease-in-out";
      }
      return "animate-in slide-in-from-right-8 fade-in-0 duration-300 ease-in-out";
    }
    return null;
  }, [trackAnimationState, trackAnimationDirection]);

  // Get current track with URL if loaded
  const currentTrack = useMemo(() => {
    const track = tracks[currentIndex];
    if (!track) return undefined;

    if (track.url) {
      return track;
    }

    if (bookId) {
      const cached = resourceCacheManager.getAudioTrack(bookId, track.href);
      if (cached?.url) {
        logger.log("[Audio Player] Found track URL in resourceCacheManager", {
          trackId: track.id,
          trackHref: track.href,
          hasUrl: !!cached.url,
        });
        return { ...track, url: cached.url };
      }
    }

    return track;
  }, [tracks, currentIndex, bookId, loadedCount]);

  const currentTrackId = useMemo(() => currentTrack?.id, [currentTrack]);

  // Combine loading states
  const isLoadingOrChanging = isTrackLoading || isTrackChangeInProgress || isLocalTrackChanging;

  // Reset scrubbing state when track changes
  const resetScrubbingState = useCallback(() => {
    dispatch(setAudioPlayerIsScrubbing(false));
    dispatch(setAudioPlayerScrubTime(null));
  }, [dispatch]);

  // Handle commit seek
  const handleCommitSeek = useCallback(
    (targetSeconds: number) => {
      const audio = audioRef.current;
      if (!audio || typeof targetSeconds !== "number" || !Number.isFinite(targetSeconds)) {
        return;
      }
      const normalized = Math.max(targetSeconds, 0);
      try {
        audio.currentTime = normalized;
        const appliedTime = audio.currentTime || normalized;
        const now = typeof performance !== "undefined" ? performance.now() : Date.now();

        dispatch(setAudioPlayerCurrentTime(appliedTime));

        lastCurrentTimeUpdateRef.current = now;
        lastEmitTimestampRef.current = now;
        lastEmittedSecondsRef.current = appliedTime;

        emitProgressRef.current(appliedTime);
      } catch (error) {
        logger.warn("[Audio Player] Failed to seek:", error);
      }
    },
    [dispatch],
  );

  // Emit progress on unmount
  useEffect(() => {
    return () => {
      const audio = audioRef.current;
      if (audio && Number.isFinite(audio.currentTime)) {
        emitProgressRef.current(audio.currentTime);
      }
    };
  }, []);

  // Handle empty tracks
  useEffect(() => {
    if (!tracks.length) {
      const audio = audioRef.current;
      if (audio) {
        if (audio.src && audio.src.startsWith("blob:")) {
          import("../../../lib/blob-url-manager").then(({ blobURLManager }) => {
            blobURLManager.markAudioUrlInactive(audio.src);
          });
        }
        audio.pause();
        audio.src = "";
      }
      dispatch(setAudioPlayerIsPlaying(false));
      isPlayingRef.current = false;
      dispatch(setAudioPlayerCurrentTime(0));
      dispatch(setAudioPlayerDuration(0));
      return;
    }
  }, [tracks.length, dispatch]);

  // Update isPlayingRef
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  // Audio element setup and event handlers
  useEffect(() => {
    const audio = audioRef.current ?? new Audio();
    audioRef.current = audio;

    const handleTimeUpdate = () => {
      const seconds = audio.currentTime || 0;

      const isRestorationBlocking = isRestoring || restorationInProgressRef.current;
      const audioIsPlaying = !audio.paused;

      if (!isRestorationBlocking) {
        if (audioIsPlaying !== isPlayingRef.current && !isAutoAdvancingRef.current) {
          logger.log("[Audio Player] Play state mismatch detected in timeupdate", {
            audioIsPlaying,
            isPlayingRef: isPlayingRef.current,
            isPlayingState: isPlaying,
            currentTime: seconds,
          });
          dispatch(setAudioPlayerIsPlaying(audioIsPlaying));
          isPlayingRef.current = audioIsPlaying;
          if (!audioIsPlaying) {
            emitProgressRef.current(seconds);
          }
        }
      }

      const now = typeof performance !== "undefined" ? performance.now() : Date.now();

      if (!hasBeenDismissedRef.current && !isDismissing) {
        const timeSinceLastUpdate = now - lastCurrentTimeUpdateRef.current;
        if (timeSinceLastUpdate >= 1000) {
          dispatch(setAudioPlayerCurrentTime(seconds));
          lastCurrentTimeUpdateRef.current = now;
        }
      }

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
        isRestoring: isRestoring,
        readyState: audio.readyState,
      });

      const newDuration = Number.isFinite(audio.duration) ? audio.duration : 0;
      dispatch(setAudioPlayerDuration(newDuration));

      const audioTime = audio.currentTime || 0;
      dispatch(setAudioPlayerCurrentTime(audioTime));

      if (trackLoadedForRestorationRef.current) {
        const currentTrackId = currentTrack?.id;
        if (currentTrackId && restorationInProgressRef.current !== currentTrackId) {
          restorationInProgressRef.current = currentTrackId;
          const lockTimeout = setTimeout(() => {
            if (restorationInProgressRef.current === currentTrackId) {
              logger.warn("[Audio Player] Restoration lock timeout - clearing lock", {
                trackId: currentTrackId,
              });
              restorationInProgressRef.current = null;
            }
          }, 5000);

          try {
            onTrackLoadedRef.current(audio);
          } finally {
            trackLoadedForRestorationRef.current = false;
            clearTimeout(lockTimeout);
            if (restorationInProgressRef.current === currentTrackId) {
              restorationInProgressRef.current = null;
            }
          }
        }
      }

      if (!isRestoring && !restorationInProgressRef.current && audioTime > 0) {
        if (emitProgressTimeoutRef.current) {
          clearTimeout(emitProgressTimeoutRef.current);
        }
        emitProgressTimeoutRef.current = window.setTimeout(() => {
          emitProgressRef.current(audioTime);
          emitProgressTimeoutRef.current = null;
        }, 50);
      }
    };

    const handleAudioReady = () => {
      logger.log("[Audio Player] Audio ready event", {
        readyState: audio.readyState,
        isRestoring: trackLoadedForRestorationRef.current,
        currentTime: audio.currentTime,
      });

      if (trackLoadedForRestorationRef.current) {
        const currentTrackId = currentTrack?.id;
        if (currentTrackId && restorationInProgressRef.current !== currentTrackId) {
          restorationInProgressRef.current = currentTrackId;
          const lockTimeout = setTimeout(() => {
            if (restorationInProgressRef.current === currentTrackId) {
              logger.warn("[Audio Player] Restoration lock timeout - clearing lock", {
                trackId: currentTrackId,
              });
              restorationInProgressRef.current = null;
            }
          }, 5000);

          try {
            onTrackLoadedRef.current(audio);
          } finally {
            trackLoadedForRestorationRef.current = false;
            clearTimeout(lockTimeout);
            if (restorationInProgressRef.current === currentTrackId) {
              restorationInProgressRef.current = null;
            }
          }
        }
      } else if (!restorationInProgressRef.current) {
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
        totalTracks: tracks.length,
        isPlayingRef: isPlayingRef.current,
        isPlayingState: isPlaying,
      });

      emitProgressRef.current(audio.currentTime || 0);

      const nextIndex = currentIndex + 1;
      if (nextIndex < tracks.length) {
        const nextTrack = tracks[nextIndex];
        logger.log("[Audio Player] Auto-advancing to next track", {
          nextIndex,
          nextTrackId: nextTrack?.id,
          nextTrackTitle: nextTrack?.title,
        });

        trackChangeInProgressRef.current = true;
        isAutoAdvancingRef.current = true;

        isPlayingRef.current = true;
        dispatch(setAudioPlayerIsPlaying(true));

        setCurrentIndex(nextIndex);
      } else {
        logger.log("[Audio Player] Last track ended, setting to paused state for replay");
        audio.pause();
        audio.currentTime = 0;
        dispatch(setAudioPlayerCurrentTime(0));
        dispatch(setAudioPlayerIsPlaying(false));
        isPlayingRef.current = false;
        emitProgressRef.current(0);
        flushAudioStateUpdate().catch((error) => {
          logger.warn("Failed to flush audio state on track end", error);
        });
      }
    };

    const handleSeeked = () => {
      const seconds = audio.currentTime || 0;
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();

      dispatch(setAudioPlayerCurrentTime(seconds));

      lastCurrentTimeUpdateRef.current = now;
      lastEmitTimestampRef.current = now;
      lastEmittedSecondsRef.current = seconds;

      emitProgressRef.current(seconds);
    };

    const handlePlay = () => {
      if (isAutoAdvancingRef.current) {
        return;
      }
      if (isRestoring || restorationInProgressRef.current) {
        return;
      }
      logger.log("[Audio Player] play event fired", {
        audioPaused: audio.paused,
        isPlayingRef: isPlayingRef.current,
      });
      dispatch(setAudioPlayerIsPlaying(true));
      isPlayingRef.current = true;
    };

    const handlePause = () => {
      if (isAutoAdvancingRef.current) {
        return;
      }
      if (isRestoring || restorationInProgressRef.current) {
        return;
      }
      logger.log("[Audio Player] pause event fired", {
        audioPaused: audio.paused,
        isPlayingRef: isPlayingRef.current,
      });
      dispatch(setAudioPlayerIsPlaying(false));
      isPlayingRef.current = false;
      const audioTime = audio.currentTime || 0;
      emitProgressRef.current(audioTime);
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
      if (emitProgressTimeoutRef.current) {
        clearTimeout(emitProgressTimeoutRef.current);
      }
    };
  }, [dispatch, currentIndex, tracks.length, isRestoring, restoreTime, flushAudioStateUpdate, currentTrack, isPlaying]);

  // Clear local track changing state when coordinator's state clears
  useEffect(() => {
    if (!isTrackChangeInProgress && isLocalTrackChanging) {
      const timeoutId = setTimeout(() => {
        dispatch(setAudioPlayerIsLocalTrackChanging(false));
      }, 100);
      return () => clearTimeout(timeoutId);
    }
  }, [isTrackChangeInProgress, isLocalTrackChanging, dispatch]);

  // Pre-load track URL only when needed
  useEffect(() => {
    if (!currentTrack || !bookId || currentIndex === undefined || currentIndex === null) {
      dispatch(setAudioPlayerIsTrackLoading(false));
      return;
    }

    const trackId = currentTrack.id;

    if (currentTrack.url) {
      dispatch(setAudioPlayerIsTrackLoading(false));
      return;
    }

    if (loadingTracksRef.current.has(trackId)) {
      dispatch(setAudioPlayerIsTrackLoading(true));
      return;
    }

    loadingTracksRef.current.add(trackId);
    dispatch(setAudioPlayerIsTrackLoading(true));
    let cancelled = false;

    logger.log("[Audio Player] Loading track URL", {
      trackId: currentTrack.id,
      trackTitle: currentTrack.title,
      trackHref: currentTrack.href,
      hasUrl: !!currentTrack.url,
    });

    ensureAudioTrackLoaded(bookId, currentTrack)
      .then((loadedTrack) => {
        if (!cancelled && loadedTrack.url) {
          loadingTracksRef.current.delete(trackId);
          dispatch(setAudioPlayerIsTrackLoading(false));
          loadedCountRef.current += 1;
          dispatch(setAudioPlayerLoadedCount(loadedCountRef.current));

          logger.log("[Audio Player] ✓ Track URL loaded successfully", {
            trackId: loadedTrack.id,
            trackTitle: loadedTrack.title,
            urlLength: loadedTrack.url.length,
          });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          loadingTracksRef.current.delete(trackId);
          dispatch(setAudioPlayerIsTrackLoading(false));
          logger.error("[Audio Player] ✗ Failed to load audio track", {
            trackId,
            trackHref: currentTrack.href,
            trackTitle: currentTrack.title,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });

    return () => {
      cancelled = true;
      loadingTracksRef.current.delete(trackId);
      dispatch(setAudioPlayerIsTrackLoading(false));
    };
  }, [dispatch, currentIndex, currentTrack?.id, bookId, currentTrack]);

  // Helper functions for autoplay
  const attemptAutoplay = useCallback(
    async (audio: HTMLAudioElement, shouldPlay: boolean): Promise<boolean> => {
      if (isRestoring || trackChangeInProgressRef.current) {
        logger.log("[Audio Player] Autoplay blocked - restoration or track change in progress", {
          isRestoring: isRestoring,
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
        dispatch(setAudioPlayerIsPlaying(true));
        isPlayingRef.current = true;
        logger.log("[Audio Player] Autoplay succeeded");
        return true;
      } catch (error) {
        logger.warn("[Audio Player] Autoplay failed:", error);
        dispatch(setAudioPlayerIsPlaying(false));
        isPlayingRef.current = false;
        return false;
      }
    },
    [dispatch, isRestoring],
  );

  const tryPlayIfReady = useCallback(
    (audio: HTMLAudioElement, shouldAutoplay: boolean): boolean => {
      if (isRestoring || restorationInProgressRef.current || trackChangeInProgressRef.current) {
        return false;
      }

      if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA && audio.paused) {
        attemptAutoplay(audio, shouldAutoplay);
        return true;
      }
      return false;
    },
    [attemptAutoplay, isRestoring],
  );

  // Setup audio source
  const setupAudioSource = useCallback(
    (audio: HTMLAudioElement, track: AudioTrack) => {
      if (lastSetupTrackIdRef.current === track.id && audio.src === track.url) {
        logger.log("[Audio Player] Skipping duplicate setup for track", {
          trackId: track.id,
        });
        return;
      }

      lastSetupTrackIdRef.current = track.id;

      const shouldAutoplay = !isRestoring && (isPlayingRef.current || isAutoAdvancingRef.current);

      logger.log("[Audio Player] Setting up audio source", {
        trackId: track.id,
        trackTitle: track.title,
        isPlayingRef: isPlayingRef.current,
        audioPaused: audio.paused,
        isAutoAdvancing: isAutoAdvancingRef.current,
        shouldAutoplay,
        isRestoring: isRestoring,
      });

      onTrackChanged(track.id);

      if (onTrackChange && !isRestoring && lastNotifiedTrackHrefRef.current !== track.href) {
        logger.log("[Audio Player] Notifying parent of track change (via effect)", {
          trackHref: track.href,
        });
        lastNotifiedTrackHrefRef.current = track.href;
        dispatch(setAudioPlayerIsLocalTrackChanging(true));
        onTrackChange(track.href);
      }

      if (!restorationInProgressRef.current) {
        trackLoadedForRestorationRef.current = isRestoring;
      }

      if (shouldAutoplay) {
        if (!isPlayingRef.current) {
          isPlayingRef.current = true;
          dispatch(setAudioPlayerIsPlaying(true));
        }
      } else {
        if (isPlayingRef.current) {
          dispatch(setAudioPlayerIsPlaying(false));
          isPlayingRef.current = false;
        }
      }

      if (audio.src && audio.src.startsWith("blob:")) {
        import("../../../lib/blob-url-manager").then(({ blobURLManager }) => {
          blobURLManager.markAudioUrlInactive(audio.src);
        });
      }

      if (track.url && track.url.startsWith("blob:")) {
        import("../../../lib/blob-url-manager").then(({ blobURLManager }) => {
          blobURLManager.markAudioUrlActive(track.url!);
        });
      }

      const isSameTrack = audio.src === track.url;
      const isAlreadyLoaded =
        isSameTrack &&
        audio.readyState >= HTMLMediaElement.HAVE_METADATA &&
        !audio.paused;

      if (!isSameTrack) {
        audio.src = track.url!;
        audio.load();
        audio.playbackRate = playbackRate;

        if (!isRestoring) {
          audio.currentTime = 0;
          dispatch(setAudioPlayerCurrentTime(0));
        }
      } else if (!isAlreadyLoaded) {
        audio.load();
        audio.playbackRate = playbackRate;
      } else {
        logger.log("[Audio Player] Audio already loaded and playing, skipping reload", {
          trackId: track.id,
          currentTime: audio.currentTime,
        });
        audio.playbackRate = playbackRate;
      }

      if (tryPlayIfReady(audio, shouldAutoplay)) {
        if (shouldAutoplay && !audio.paused) {
          isAutoAdvancingRef.current = false;
          trackChangeInProgressRef.current = false;
          dispatch(setAudioPlayerIsLocalTrackChanging(false));
        }
        return;
      }

      let cleanupCalled = false;

      const handleAudioReadyForTrackChange = () => {
        if (!cleanupCalled && trackChangeInProgressRef.current) {
          logger.log("[Audio Player] Audio ready - clearing track change flag", {
            trackId: track.id,
          });
          trackChangeInProgressRef.current = false;
          dispatch(setAudioPlayerIsLocalTrackChanging(false));
        }
      };

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
              isAutoAdvancingRef.current = false;
              trackChangeInProgressRef.current = false;
              dispatch(setAudioPlayerIsLocalTrackChanging(false));
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
              isAutoAdvancingRef.current = false;
              trackChangeInProgressRef.current = false;
              dispatch(setAudioPlayerIsLocalTrackChanging(false));
            }
          });
        }
      };

      const handleLoadedData = () => {
        if (cleanupCalled) return;
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
              isAutoAdvancingRef.current = false;
              trackChangeInProgressRef.current = false;
              dispatch(setAudioPlayerIsLocalTrackChanging(false));
            }
          });
        }
      };

      const handlePlaying = () => {
        if (isAutoAdvancingRef.current) {
          logger.log("[Audio Player] Playback started - clearing auto-advancing flag", {
            trackId: track.id,
          });
          isAutoAdvancingRef.current = false;
        }
        if (trackChangeInProgressRef.current) {
          logger.log("[Audio Player] Playback started - clearing track change flag", {
            trackId: track.id,
          });
          trackChangeInProgressRef.current = false;
          dispatch(setAudioPlayerIsLocalTrackChanging(false));
        }
      };

      audio.addEventListener("canplay", handleCanPlay);
      audio.addEventListener("canplaythrough", handleCanPlayThrough);
      audio.addEventListener("loadeddata", handleLoadedData);
      audio.addEventListener("playing", handlePlaying);

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
              isAutoAdvancingRef.current = false;
              trackChangeInProgressRef.current = false;
              dispatch(setAudioPlayerIsLocalTrackChanging(false));
            }
          });
        }
      }, 100);

      return () => {
        cleanupCalled = true;
        clearTimeout(fallbackTimeout);
        audio.removeEventListener("canplay", handleCanPlay);
        audio.removeEventListener("canplaythrough", handleCanPlayThrough);
        audio.removeEventListener("loadeddata", handleLoadedData);
        audio.removeEventListener("playing", handlePlaying);
        trackChangeInProgressRef.current = false;
        dispatch(setAudioPlayerIsLocalTrackChanging(false));
      };
    },
    [playbackRate, onTrackChanged, onTrackChange, tryPlayIfReady, attemptAutoplay, dispatch, isRestoring],
  );

  // Main track loading effect
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack || !bookId) {
      return;
    }

    if (!currentTrack.url) {
      return;
    }

    const trackWithUrl = currentTrack;
    const trackUrl = currentTrack.url;

    const trackChanged = lastSetupTrackIdRef.current !== trackWithUrl.id;

    if (trackChanged) {
      lastSetupTrackIdRef.current = null;
      resetScrubbingState();
    }

    if (lastSetupTrackIdRef.current === trackWithUrl.id && audio.src === trackUrl) {
      if (isPlayingRef.current && audio.paused) {
        logger.log("[Audio Player] Track already set up but paused, attempting autoplay");
        attemptAutoplay(audio, true);
      }
      return;
    }

    const cleanup = setupAudioSource(audio, trackWithUrl);

    return cleanup;
  }, [currentIndex, currentTrack?.id, bookId, setupAudioSource, attemptAutoplay, resetScrubbingState, currentTrack]);

  // Handlers
  const handleTogglePlayback = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || !currentTrack || !bookId) {
      return;
    }

    const audioIsReady =
      audio.readyState >= HTMLMediaElement.HAVE_METADATA && audio.src === currentTrack.url;
    const shouldBlock =
      (isRestoring || restorationInProgressRef.current || trackChangeInProgressRef.current) &&
      !audioIsReady;

    if (shouldBlock) {
      logger.log("[Audio Player] Deferring playback toggle - restoration or track change in progress", {
        isRestoring: isRestoring,
        restorationInProgress: restorationInProgressRef.current,
        trackChangeInProgress: trackChangeInProgressRef.current,
        audioIsReady,
      });
      return;
    }

    if (audioIsReady && isRestoring) {
      logger.log("[Audio Player] Audio ready but restoration flag still set - attempting to clear", {
        currentTrackId: currentTrack.id,
      });
      try {
        onTrackLoadedRef.current(audio);
      } catch (error) {
        logger.warn("[Audio Player] Failed to clear restoration flag", error);
      }
    }

    logger.log("[Audio Player] togglePlayback called", {
      isPlayingRef: isPlayingRef.current,
      isPlayingState: isPlaying,
      audioPaused: audio.paused,
      trackId: currentTrack.id,
    });

    if (!audio.paused) {
      logger.log("[Audio Player] Pausing playback");
      audio.pause();
      emitProgressRef.current(audio.currentTime || 0);
      dispatch(setAudioPlayerIsPlaying(false));
      isPlayingRef.current = false;
      return;
    }

    if (audio.ended) {
      logger.log("[Audio Player] Audio ended, resetting for replay");
      audio.currentTime = 0;
      dispatch(setAudioPlayerCurrentTime(0));
    }

    let trackUrl = currentTrack.url;

    if (!trackUrl) {
      logger.log("[Audio Player] Track URL not loaded, loading first", {
        trackId: currentTrack.id,
      });

      if (loadingTracksRef.current.has(currentTrack.id)) {
        logger.log("[Audio Player] Track already loading, waiting...");
        let attempts = 0;
        while (!trackUrl && attempts < 50) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          const updatedTrack = await ensureAudioTrackLoaded(bookId, currentTrack).catch(() => null);
          trackUrl = updatedTrack?.url;
          attempts++;
        }
        if (!trackUrl) {
          logger.warn("[Audio Player] Track URL loading timeout");
          return;
        }
      } else {
        try {
          loadingTracksRef.current.add(currentTrack.id);
          const loadedTrack = await ensureAudioTrackLoaded(bookId, currentTrack);
          loadingTracksRef.current.delete(currentTrack.id);

          if (loadedTrack.url) {
            trackUrl = loadedTrack.url;
            loadedCountRef.current += 1;
            dispatch(setAudioPlayerLoadedCount(loadedCountRef.current));
          } else {
            logger.warn("[Audio Player] Failed to load track URL");
            return;
          }
        } catch (error) {
          loadingTracksRef.current.delete(currentTrack.id);
          logger.error("[Audio Player] Failed to load track URL:", error);
          return;
        }
      }
    }

    if (audio.src !== trackUrl) {
      if (audio.src && audio.src.startsWith("blob:")) {
        import("../../../lib/blob-url-manager").then(({ blobURLManager }) => {
          blobURLManager.markAudioUrlInactive(audio.src);
        });
      }

      if (trackUrl && trackUrl.startsWith("blob:")) {
        import("../../../lib/blob-url-manager").then(({ blobURLManager }) => {
          blobURLManager.markAudioUrlActive(trackUrl);
        });
      }

      audio.src = trackUrl;
      audio.load();
      audio.playbackRate = playbackRate;
      await new Promise<void>((resolve) => {
        if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
          resolve();
        } else {
          const handleCanPlay = () => {
            audio.removeEventListener("canplay", handleCanPlay);
            resolve();
          };
          audio.addEventListener("canplay", handleCanPlay);
        }
      });
    }

    if (isRestoring || restorationInProgressRef.current || trackChangeInProgressRef.current) {
      logger.log("[Audio Player] Playback blocked - restoration or track change in progress", {
        isRestoring: isRestoring,
        restorationInProgress: restorationInProgressRef.current,
        trackChangeInProgress: trackChangeInProgressRef.current,
      });
      return;
    }

    logger.log("[Audio Player] Starting playback");
    try {
      await audio.play();
      logger.log("[Audio Player] Playback started successfully");
      dispatch(setAudioPlayerIsPlaying(true));
      isPlayingRef.current = true;
    } catch (error) {
      logger.warn("[Audio Player] Failed to start playback:", error);
      dispatch(setAudioPlayerIsPlaying(false));
      isPlayingRef.current = false;
    }
  }, [currentTrack, isPlaying, bookId, playbackRate, dispatch, isRestoring]);

  const handlePlayTrackAt = useCallback(
    (nextIndex: number) => {
      if (!tracks[nextIndex]) return;

      if (isRestoring || restorationInProgressRef.current) {
        logger.log("[Audio Player] Deferring track change - restoration in progress", {
          nextIndex,
          isRestoring: isRestoring,
          restorationInProgress: restorationInProgressRef.current,
        });
        setTimeout(() => {
          if (!isRestoring && !restorationInProgressRef.current) {
            handlePlayTrackAt(nextIndex);
          }
        }, 100);
        return;
      }

      const nextTrack = tracks[nextIndex];
      if (!nextTrack) return;

      dispatch(setAudioPlayerIsLocalTrackChanging(true));
      dispatch(setAudioPlayerCurrentTime(0));
      const audio = audioRef.current;
      if (audio) {
        audio.currentTime = 0;
      }

      if (onTrackChange && !isRestoring && lastNotifiedTrackHrefRef.current !== nextTrack.href) {
        logger.log("[Audio Player] Notifying parent of track change (via handlePlayTrackAt)", {
          nextIndex,
          trackHref: nextTrack.href,
        });
        lastNotifiedTrackHrefRef.current = nextTrack.href;
        dispatch(setAudioPlayerIsLocalTrackChanging(true));
        onTrackChange(nextTrack.href);
      }

      trackChangeInProgressRef.current = true;
      const wasPlaying = isPlayingRef.current || (audio && !audio.paused);

      if (wasPlaying) {
        isAutoAdvancingRef.current = true;
        isPlayingRef.current = true;
        dispatch(setAudioPlayerIsPlaying(true));
        logger.log("[Audio Player] Preserving playing state for manual track change", {
          nextIndex,
          wasPlaying,
        });
      } else {
        isPlayingRef.current = false;
        dispatch(setAudioPlayerIsPlaying(false));
      }

      if (audio && Number.isFinite(audio.currentTime)) {
        emitProgressRef.current(audio.currentTime);
      }

      setCurrentIndex(nextIndex);
      dispatch(setAudioPlayerCurrentTime(0));
      dispatch(setAudioPlayerDuration(0));
    },
    [setCurrentIndex, tracks, onTrackChange, dispatch, isRestoring],
  );

  const handlePrevious = useCallback(() => {
    if (currentIndex <= 0) {
      handleCommitSeek(0);
      return;
    }
    handlePlayTrackAt(currentIndex - 1);
  }, [currentIndex, handlePlayTrackAt, handleCommitSeek]);

  const handleNext = useCallback(() => {
    if (currentIndex + 1 >= tracks.length) {
      return;
    }
    handlePlayTrackAt(currentIndex + 1);
  }, [currentIndex, handlePlayTrackAt, tracks.length]);

  const handleSkipBack = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    const newTime = Math.max(0, (audio.currentTime || 0) - 10);
    handleCommitSeek(newTime);
  }, [handleCommitSeek]);

  const handleSkipForward = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    const currentTime = audio.currentTime || 0;
    const maxTime = duration > 0 ? duration : currentTime;
    const newTime = Math.min(maxTime, currentTime + 10);
    handleCommitSeek(newTime);
  }, [duration, handleCommitSeek]);

  const handleScrubChange = useCallback(
    (value: number[]) => {
      const next = value?.[0];
      if (typeof next !== "number" || !Number.isFinite(next)) {
        return;
      }
      if (!userScrubbingRef.current) {
        return;
      }
      dispatch(setAudioPlayerScrubTime(Math.max(next, 0)));
    },
    [dispatch],
  );

  const handleScrubCommit = useCallback(
    (value: number[]) => {
      const next = value?.[0];
      userScrubbingRef.current = false;
      dispatch(setAudioPlayerIsScrubbing(false));
      dispatch(setAudioPlayerScrubTime(null));
      if (typeof next !== "number" || !Number.isFinite(next)) {
        return;
      }
      handleCommitSeek(next);
    },
    [dispatch, handleCommitSeek],
  );

  const handleScrubPointerDown = useCallback(() => {
    userScrubbingRef.current = true;
    dispatch(setAudioPlayerIsScrubbing(true));
  }, [dispatch]);

  const handleScrubPointerUp = useCallback(() => {
    userScrubbingRef.current = false;
  }, []);

  const handlePlaybackRateChange = useCallback(
    (value: string) => {
      const nextRate = Number(value);
      if (!Number.isFinite(nextRate)) {
        return;
      }
      dispatch(setAudioPlayerPlaybackRate(nextRate));
      updateAudioPlaybackRate(audioRef.current, nextRate);
      updateSettings({ audioPlaybackSpeed: nextRate });
    },
    [dispatch, updateSettings],
  );

  const handleTrackSelect = useCallback(
    (trackIndex: number) => {
      logger.log("[Audio Player] handleTrackSelect called", {
        trackIndex,
        tracksLength: tracks.length,
      });
      if (trackIndex >= 0 && trackIndex < tracks.length) {
        handlePlayTrackAt(trackIndex);
      }
    },
    [tracks, handlePlayTrackAt],
  );

  const handleDismiss = useCallback(() => {
    if (hasBeenDismissedRef.current || isDismissing) {
      return;
    }

    hasBeenDismissedRef.current = true;
    dispatch(setAudioPlayerDismissing(true));
    dispatch(setAudioPlayerIsVisible(false));

    Promise.resolve().then(async () => {
      const audio = audioRef.current;
      if (audio && Number.isFinite(audio.currentTime)) {
        emitProgressRef.current(audio.currentTime);
      } else {
        emitProgressRef.current(0);
      }
      await flushAudioStateUpdate();
    });

    if (dismissTimeoutRef.current) {
      clearTimeout(dismissTimeoutRef.current);
    }
    dismissTimeoutRef.current = window.setTimeout(() => {
      // Parent will handle unmounting
      dismissTimeoutRef.current = null;
    }, 350);
  }, [dispatch, isDismissing, flushAudioStateUpdate]);

  // Cleanup dismiss timeout on unmount
  useEffect(() => {
    return () => {
      if (dismissTimeoutRef.current) {
        clearTimeout(dismissTimeoutRef.current);
      }
    };
  }, []);

  // Save progress when component becomes hidden
  const previousVisibleRef = useRef(isVisible);
  useEffect(() => {
    if (
      previousVisibleRef.current &&
      !isVisible &&
      !isDismissing &&
      !hasBeenDismissedRef.current
    ) {
      const audio = audioRef.current;
      if (audio && Number.isFinite(audio.currentTime)) {
        emitProgressRef.current(audio.currentTime);
      } else {
        emitProgressRef.current(0);
      }
      flushAudioStateUpdate().catch((error) => {
        logger.warn("Failed to flush audio state on visibility change", error);
      });
    }
    previousVisibleRef.current = isVisible;
  }, [isVisible, isDismissing, flushAudioStateUpdate]);

  // If isRestoring is true, ensure onTrackLoaded is called even if audio is already loaded
  useEffect(() => {
    if (isRestoring && currentTrack) {
      const audio = audioRef.current;
      if (
        audio &&
        audio.readyState >= HTMLMediaElement.HAVE_METADATA &&
        audio.src === currentTrack.url
      ) {
        const trackId = currentTrack.id;
        if (restorationInProgressRef.current !== trackId) {
          restorationInProgressRef.current = trackId;
          try {
            onTrackLoadedRef.current(audio);
          } finally {
            if (restorationInProgressRef.current === trackId) {
              restorationInProgressRef.current = null;
            }
          }
        }
      }
    }
  }, [isRestoring, currentTrack]);

  // Add timeout to clear isRestoring if it stays true too long
  useEffect(() => {
    if (isRestoring) {
      if (restorationTimeoutRef.current) {
        clearTimeout(restorationTimeoutRef.current);
      }

      restorationTimeoutRef.current = window.setTimeout(() => {
        logger.warn("[Audio Player] Restoration flag timeout - forcing clear", {
          isRestoring,
          currentTrackId: currentTrack?.id,
        });
        const audio = audioRef.current;
        if (audio && currentTrack && audio.src === currentTrack.url) {
          onTrackLoadedRef.current(audio);
        }
        restorationTimeoutRef.current = null;
      }, 3000);
    } else {
      if (restorationTimeoutRef.current) {
        clearTimeout(restorationTimeoutRef.current);
        restorationTimeoutRef.current = null;
      }
    }

    return () => {
      if (restorationTimeoutRef.current) {
        clearTimeout(restorationTimeoutRef.current);
        restorationTimeoutRef.current = null;
      }
    };
  }, [isRestoring, currentTrack]);

  // Periodically check audio state to detect external pause/play
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrackId) {
      return;
    }

    const checkAudioState = () => {
      if (isAutoAdvancingRef.current) {
        return;
      }
      if (isRestoring || restorationInProgressRef.current) {
        return;
      }

      const audioIsPlaying = !audio.paused;
      if (audioIsPlaying !== isPlayingRef.current) {
        dispatch(setAudioPlayerIsPlaying(audioIsPlaying));
        isPlayingRef.current = audioIsPlaying;
        if (!audioIsPlaying) {
          const audioTime = audio.currentTime || 0;
          emitProgressRef.current(audioTime);
          flushAudioStateUpdate().catch((error) => {
            logger.warn("Failed to flush audio state on pause", error);
          });
        }
      }
    };

    checkAudioState();

    const interval = setInterval(checkAudioState, 500);

    return () => {
      clearInterval(interval);
    };
  }, [currentTrackId, dispatch, isRestoring, flushAudioStateUpdate]);

  return {
    // State
    isPlaying,
    currentTime,
    duration,
    playbackRate,
    isScrubbing,
    scrubTime,
    isVisible,
    showTracksDialog,
    trackAnimationClass,
    isLoadingOrChanging,
    currentTrack,
    currentIndex,
    isDismissing,
    // Refs
    audioRef,
    // Handlers
    handleTogglePlayback,
    handlePrevious,
    handleNext,
    handleSkipBack,
    handleSkipForward,
    handleScrubChange,
    handleScrubCommit,
    handleScrubPointerDown,
    handleScrubPointerUp,
    handlePlaybackRateChange,
    handleTrackSelect,
    handleDismiss,
  };
}

