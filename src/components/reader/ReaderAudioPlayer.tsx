import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MoveVertical, Pause, Play, SkipBack, SkipForward, StepBack, StepForward, X } from "lucide-react";

import type { AudioTrack, BookAudioState } from "../../types/reader";
import type { AudioProgressSnapshot } from "./types";
import { Button } from "../ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Slider } from "../ui/slider";
import { cn } from "../../lib/utils";
// useAudioStateSync is now accessed via useLibrary hook
import { useLibrary } from "../../hooks/useLibrary";
import { animPatterns, enterExit } from "../../lib/animations";

const formatTime = (value: number) => {
  if (!Number.isFinite(value) || value < 0) {
    value = 0;
  }
  const totalSeconds = Math.floor(value);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

const PLAYBACK_RATE_OPTIONS = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;

const formatPlaybackRate = (rate: number) => {
  if (Number.isInteger(rate)) {
    return `${rate.toFixed(0)}x`;
  }
  return `${rate.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}x`;
};

type ReaderAudioPlayerProps = {
  bookId?: string;
  tracks: AudioTrack[];
  bookTitle?: string;
  sourcePath?: string;
  initialAudioState?: BookAudioState;
  onProgress?: (snapshot: AudioProgressSnapshot) => void;
  onRestorationStateChange?: (isRestoring: boolean) => void;
  chromeVisible?: boolean;
  onClose?: () => void;
  autoScrollEnabled?: boolean;
  onAutoScrollToggle?: (enabled: boolean) => void;
};

export function ReaderAudioPlayer({
  bookId,
  tracks,
  bookTitle,
  sourcePath,
  initialAudioState,
  onProgress,
  onRestorationStateChange,
  chromeVisible = true,
  onClose,
  autoScrollEnabled = true,
  onAutoScrollToggle,
}: ReaderAudioPlayerProps) {
  // Use custom hook for state sync and restoration from useLibrary
  const libraryHook = useLibrary();
  const {
    currentIndex,
    setCurrentIndex,
    restoreTime,
    isRestoring,
    onTrackLoaded,
    onTrackChanged,
    emitProgress,
  } = libraryHook.useAudioStateSync({
    bookId,
    tracks,
    initialAudioState,
    onProgress,
  });

  // Notify parent of restoration state changes
  useEffect(() => {
    isRestoringRef.current = isRestoring;
    onRestorationStateChange?.(isRestoring);
  }, [isRestoring, onRestorationStateChange]);

  // Store stable refs for callbacks to avoid effect re-runs
  const onTrackLoadedRef = useRef(onTrackLoaded);
  const emitProgressRef = useRef(emitProgress);
  
  useEffect(() => {
    onTrackLoadedRef.current = onTrackLoaded;
  }, [onTrackLoaded]);
  
  useEffect(() => {
    emitProgressRef.current = emitProgress;
  }, [emitProgress]);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubTime, setScrubTime] = useState<number | null>(null);
  const [isDismissing, setIsDismissing] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const isPlayingRef = useRef(false);
  const userScrubbingRef = useRef(false);
  const currentTimeRef = useRef(0);
  const lastEmitTimestampRef = useRef(0);
  const lastEmittedSecondsRef = useRef(0);
  const lastCurrentTimeUpdateRef = useRef(0);
  const isRestoringRef = useRef(false);
  const hasBeenDismissedRef = useRef(false);

  // Handle enter animation - only run if not dismissing and not previously dismissed
  useEffect(() => {
    // Don't run enter animation if we're dismissing or have been dismissed
    if (isDismissing || hasBeenDismissedRef.current) {
      return;
    }
    
    setIsDismissing(false);
    // Small delay to trigger CSS animation
    const timer = setTimeout(() => {
      // Double-check we're still not dismissing before showing
      if (!isDismissing && !hasBeenDismissedRef.current) {
        setIsVisible(true);
      }
    }, 10);
    return () => clearTimeout(timer);
  }, [bookId, tracks.length, isDismissing]);
  
  // Reset dismissed state when book/tracks change (new player instance)
  useEffect(() => {
    hasBeenDismissedRef.current = false;
    setIsDismissing(false);
    setIsVisible(false);
  }, [bookId, tracks.length]);

  const commitSeek = useCallback(
    (targetSeconds: number) => {
      const audio = audioRef.current;
      if (!audio || typeof targetSeconds !== "number" || !Number.isFinite(targetSeconds)) {
        return;
      }
      const normalized = Math.max(targetSeconds, 0);
      try {
        audio.currentTime = normalized;
        const appliedTime = audio.currentTime || normalized;
        setCurrentTime(appliedTime);
        currentTimeRef.current = appliedTime;
        emitProgressRef.current(appliedTime);
      } catch (error) {
        console.warn("[Audio Player] Failed to seek:", error);
      }
    },
    [],
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
        audio.pause();
        audio.src = "";
      }
      setIsPlaying(false);
      isPlayingRef.current = false;
      setCurrentTime(0);
      setDuration(0);
      return;
    }
  }, [tracks.length]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    const audio = audioRef.current ?? new Audio();
    audioRef.current = audio;

    const handleTimeUpdate = () => {
      const seconds = audio.currentTime || 0;
      // Always update ref immediately (used for internal logic, doesn't cause re-renders)
      currentTimeRef.current = seconds;
      
      // Sync play state with audio element to handle external pause/play
      const audioIsPlaying = !audio.paused;
      if (audioIsPlaying !== isPlayingRef.current) {
        console.log("[Audio Player] Play state mismatch detected in timeupdate", {
          audioIsPlaying,
          isPlayingRef: isPlayingRef.current,
          isPlayingState: isPlaying,
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
      
      // Throttle setCurrentTime state updates to at most once per second
      const timeSinceLastUpdate = now - lastCurrentTimeUpdateRef.current;
      if (timeSinceLastUpdate >= 1000) {
        setCurrentTime(seconds);
        lastCurrentTimeUpdateRef.current = now;
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
      console.log("[Audio Player] loadedmetadata event fired", {
        duration: audio.duration,
        currentTime: audio.currentTime,
        isPlayingRef: isPlayingRef.current,
        audioPaused: audio.paused,
        isRestoring: isRestoring,
        readyState: audio.readyState,
      });
      
      const newDuration = Number.isFinite(audio.duration) ? audio.duration : 0;
      setDuration(newDuration);
      // Hook handles restoration via onTrackLoaded
      onTrackLoadedRef.current(audio);
      
      // Update current time from audio element
      const audioTime = audio.currentTime || 0;
      setCurrentTime(audioTime);
      currentTimeRef.current = audioTime;
      
      // If we should be playing (e.g., track ended and moved to next), try to play
      // This is a fallback in case canplay events don't fire
      if (isPlayingRef.current && audio.paused && !isRestoring) {
        console.log("[Audio Player] Attempting play from loadedmetadata fallback");
        // Small delay to ensure metadata is fully loaded
        setTimeout(() => {
          if (isPlayingRef.current && audio.paused) {
            console.log("[Audio Player] Executing loadedmetadata play attempt");
            audio
              .play()
              .then(() => {
                console.log("[Audio Player] Play succeeded from loadedmetadata");
                setIsPlaying(true);
                isPlayingRef.current = true;
              })
              .catch((error) => {
                console.warn("[Audio Player] Failed to autoplay in loadedmetadata:", error);
                // Don't set to false here - let the canplay handlers try
              });
          } else {
            console.log("[Audio Player] Skipping loadedmetadata play - state changed", {
              isPlayingRef: isPlayingRef.current,
              audioPaused: audio.paused,
            });
          }
        }, 100);
      }
      
        // If we just restored, emit progress to ensure parent state is updated
        // This is important for paused audio where timeupdate might not fire
        if (!isRestoring && audioTime > 0) {
          // Small delay to ensure restoration completed
          setTimeout(() => {
            emitProgressRef.current(audioTime);
          }, 50);
        }
    };
    
    const handleCanPlay = () => {
      console.log("[Audio Player] canplay event fired (main handler)", {
        trackLoadedForRestoration: trackLoadedForRestorationRef.current,
        currentTime: audio.currentTime,
        readyState: audio.readyState,
      });
      
      // Only call onTrackLoaded if we loaded this track for restoration
      // This prevents double restoration (loadedmetadata already calls it)
      if (trackLoadedForRestorationRef.current) {
        // onTrackLoaded will check if restoration is needed and prevent double application
        onTrackLoadedRef.current(audio);
        // Clear the flag after attempting restoration
        trackLoadedForRestorationRef.current = false;
      } else {
        // After restoration completes or for normal playback, ensure progress is emitted
        const audioTime = audio.currentTime || 0;
        if (audioTime > 0) {
          emitProgressRef.current(audioTime);
        }
      }
    };

    const handleEnded = () => {
      console.log("[Audio Player] Track ended", {
        currentIndex,
        currentTrackId: currentTrack?.id,
        totalTracks: tracks.length,
        isPlayingRef: isPlayingRef.current,
        isPlayingState: isPlaying,
      });
      
      const nextIndex = currentIndex + 1;
      if (nextIndex < tracks.length) {
        const nextTrack = tracks[nextIndex];
        console.log("[Audio Player] Moving to next track", {
          nextIndex,
          nextTrackId: nextTrack?.id,
          nextTrackTitle: nextTrack?.title,
        });
        
        // Set playing state BEFORE changing track so the track loading effect sees it
        isPlayingRef.current = true;
        setIsPlaying(true);
        console.log("[Audio Player] Set playing state to true before track change", {
          isPlayingRef: isPlayingRef.current,
        });
        
        // Emit progress before changing track
        emitProgressRef.current(audio.currentTime || 0);
        
        // Change track - the track loading effect will handle autoplay
        setCurrentIndex(nextIndex);
      } else {
        console.log("[Audio Player] Last track ended, stopping playback");
        // Emit final progress
        emitProgressRef.current(audio.currentTime || 0);
        audio.pause();
        audio.currentTime = 0;
        setCurrentTime(0);
        setIsPlaying(false);
        isPlayingRef.current = false;
      }
    };

    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("canplay", handleCanPlay);
    audio.addEventListener("ended", handleEnded);

    return () => {
      audio.pause();
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("canplay", handleCanPlay);
      audio.removeEventListener("ended", handleEnded);
    };
  }, [currentIndex, tracks.length, isRestoring, restoreTime]);

  const currentTrack = tracks[currentIndex];

  // Periodically check audio state to detect external pause/play
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) {
      return;
    }

    const checkAudioState = () => {
      const audioIsPlaying = !audio.paused;
      if (audioIsPlaying !== isPlayingRef.current) {
        setIsPlaying(audioIsPlaying);
        isPlayingRef.current = audioIsPlaying;
        // If paused externally, emit progress to save state
        if (!audioIsPlaying) {
          const audioTime = audio.currentTime || currentTimeRef.current;
          emitProgressRef.current(audioTime);
        }
      }
    };

    // Check immediately
    checkAudioState();

    // Check periodically (every 500ms) to catch external state changes
    const interval = setInterval(checkAudioState, 500);

    return () => {
      clearInterval(interval);
    };
  }, [currentTrack]);

  // Track if we've loaded a track for restoration to prevent resetting time after restoration
  const trackLoadedForRestorationRef = useRef(false);

  // Setup track when currentIndex changes
  // Audio tracks are now preloaded, so they should already have URLs
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) {
      return;
    }

    // Track should already have a URL since it's preloaded
    if (!currentTrack.url) {
      console.warn("[Audio Player] Track missing URL, this should not happen with preloading", {
        trackId: currentTrack.id,
        trackTitle: currentTrack.title,
      });
      return;
    }

    // Setup audio source with preloaded track
    setupAudioSource(audio, currentTrack);

    function setupAudioSource(audio: HTMLAudioElement, track: AudioTrack) {
      // Check if audio was playing BEFORE we change the source
      // When we change audio.src, the browser automatically pauses it,
      // so we need to capture the state before the change
      // Also check isPlaying state in case the ref is stale (e.g., after track ended)
      // When a track ends, audio.paused is true, but we want to continue playing
      const audioWasPlaying = !audio.paused;
      const refSaysPlaying = isPlayingRef.current;
      const stateSaysPlaying = isPlaying;
      const wasPlayingBeforeSourceChange = audioWasPlaying || refSaysPlaying || stateSaysPlaying;
      
      console.log("[Audio Player] Track loading effect triggered", {
        trackId: track.id,
        trackTitle: track.title,
        trackIndex: currentIndex,
        isPlayingRef: isPlayingRef.current,
        isPlayingState: isPlaying,
        audioPaused: audio.paused,
        audioWasPlaying,
        refSaysPlaying,
        stateSaysPlaying,
        wasPlayingBeforeSourceChange,
        isRestoring: isRestoringRef.current,
        audioReadyState: audio.readyState,
      });

      // Notify hook about track change
      onTrackChanged(track.id);

      // Reset the restoration flag when starting a new track load
      trackLoadedForRestorationRef.current = false;

      // Store whether we should autoplay for the canplay handler
      // Use wasPlayingBeforeSourceChange to handle cases where the track changes
      // from chapter switching (the audio element might be paused after src change)
      const shouldAutoPlay = wasPlayingBeforeSourceChange;
      
      // Update the ref to reflect that we want to continue playing if we were playing
      if (shouldAutoPlay) {
        isPlayingRef.current = true;
        setIsPlaying(true);
        console.log("[Audio Player] Preserved playing state for autoplay", {
          wasPlayingBeforeSourceChange,
          shouldAutoPlay,
          isPlayingRef: isPlayingRef.current,
        });
      }

      // Don't pause - just change the source and let it continue playing
      console.log("[Audio Player] Setting new audio source", {
        url: track.url,
        previousSrc: audio.src,
      });
      audio.src = track.url!;
      audio.load();
      audio.playbackRate = playbackRate;
      console.log("[Audio Player] Audio loaded, readyState:", audio.readyState);
      
      // Reset duration while loading (but keep loading state)
      // Don't reset duration if we're just changing tracks and already have duration
      if (!track.url) {
        setDuration(0);
      }
      
      // Only reset time if we're not restoring
      // Restoration will be handled in loadedmetadata/canplay via onTrackLoaded
      // Use ref to avoid re-running effect when isRestoring changes
      if (!isRestoringRef.current) {
        audio.currentTime = 0;
        setCurrentTime(0);
        currentTimeRef.current = 0;
      } else {
        // Mark that we're loading this track for restoration
        trackLoadedForRestorationRef.current = true;
      }
      
      if (shouldAutoPlay) {
        // Keep playing state as true (don't flicker the button)
        // The audio element will be paused when src changes, but we'll resume it when ready
      
      // Check if audio is already ready (cached content)
      const tryPlay = () => {
        const readyState = audio.readyState;
        const isPaused = audio.paused;
        console.log("[Audio Player] tryPlay check", {
          readyState,
          haveFutureData: readyState >= HTMLMediaElement.HAVE_FUTURE_DATA,
          isPaused,
          shouldPlay: readyState >= HTMLMediaElement.HAVE_FUTURE_DATA && isPaused,
        });
        
        if (readyState >= HTMLMediaElement.HAVE_FUTURE_DATA && isPaused) {
          // Audio is ready, try to play immediately
          console.log("[Audio Player] Audio ready, attempting immediate play");
          audio
            .play()
            .then(() => {
              console.log("[Audio Player] Immediate play succeeded");
              setIsPlaying(true);
              isPlayingRef.current = true;
            })
            .catch((error) => {
              console.warn("[Audio Player] Failed to autoplay after track change (immediate):", error);
              setIsPlaying(false);
              isPlayingRef.current = false;
            });
          return true;
        }
        return false;
      };

      // Try immediately in case audio is cached
      if (!tryPlay()) {
        console.log("[Audio Player] Audio not ready yet, setting up event listeners");
        // Audio not ready yet, wait for it
        // Use a one-time canplaythrough event to ensure audio is ready before playing
        const handleCanPlayThrough = () => {
          console.log("[Audio Player] canplaythrough event fired", {
            shouldAutoPlay,
            audioPaused: audio.paused,
            readyState: audio.readyState,
          });
          audio.removeEventListener("canplaythrough", handleCanPlayThrough);
          audio.removeEventListener("canplay", handleCanPlay);
          // Autoplay if we were supposed to and audio is paused (which it will be after src change)
          if (shouldAutoPlay && audio.paused) {
            console.log("[Audio Player] Attempting play from canplaythrough handler");
            audio
              .play()
              .then(() => {
                console.log("[Audio Player] Play succeeded from canplaythrough");
                setIsPlaying(true);
                isPlayingRef.current = true;
              })
              .catch((error) => {
                console.warn("[Audio Player] Failed to autoplay after track change (canplaythrough):", error);
                setIsPlaying(false);
                isPlayingRef.current = false;
              });
          } else {
            console.log("[Audio Player] Skipping autoplay in canplaythrough", {
              shouldAutoPlay,
              audioPaused: audio.paused,
            });
          }
        };
        
        // Fallback: if canplaythrough doesn't fire, try on canplay
        const handleCanPlay = () => {
          console.log("[Audio Player] canplay event fired", {
            shouldAutoPlay,
            audioPaused: audio.paused,
            readyState: audio.readyState,
          });
          audio.removeEventListener("canplaythrough", handleCanPlayThrough);
          audio.removeEventListener("canplay", handleCanPlay);
          // Autoplay if we were supposed to and audio is paused
          if (shouldAutoPlay && audio.paused) {
            console.log("[Audio Player] Attempting play from canplay handler");
            audio
              .play()
              .then(() => {
                console.log("[Audio Player] Play succeeded from canplay");
                setIsPlaying(true);
                isPlayingRef.current = true;
              })
              .catch((error) => {
                console.warn("[Audio Player] Failed to autoplay after track change (canplay fallback):", error);
                setIsPlaying(false);
                isPlayingRef.current = false;
              });
          } else {
            console.log("[Audio Player] Skipping autoplay in canplay", {
              shouldAutoPlay,
              audioPaused: audio.paused,
            });
          }
        };
        
        audio.addEventListener("canplaythrough", handleCanPlayThrough);
        audio.addEventListener("canplay", handleCanPlay);
        
        // Cleanup listeners if effect re-runs before they fire
        return () => {
          audio.removeEventListener("canplaythrough", handleCanPlayThrough);
          audio.removeEventListener("canplay", handleCanPlay);
        };
      }
    } else {
      // If we weren't playing, make sure state is correct
      console.log("[Audio Player] Not autoplaying - was not playing before track change", {
        wasPlayingBeforeSourceChange,
        isPlayingRef: isPlayingRef.current,
        audioPaused: audio.paused,
      });
      setIsPlaying(false);
      isPlayingRef.current = false;
    }
    }
  }, [currentIndex, currentTrack, playbackRate, isPlaying, onTrackChanged]);

  useEffect(() => {
    setIsScrubbing(false);
    setScrubTime(null);
  }, [currentTrack?.id]);
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    audio.playbackRate = playbackRate;
  }, [playbackRate]);


  const togglePlayback = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) {
      return;
    }

    console.log("[Audio Player] togglePlayback called", {
      isPlayingRef: isPlayingRef.current,
      isPlayingState: isPlaying,
      audioPaused: audio.paused,
      trackId: currentTrack.id,
    });

    if (isPlayingRef.current) {
      console.log("[Audio Player] Pausing playback");
      audio.pause();
      emitProgressRef.current(audio.currentTime || currentTimeRef.current);
      setIsPlaying(false);
      isPlayingRef.current = false;
      return;
    }

    console.log("[Audio Player] Starting playback");
    audio
      .play()
      .then(() => {
        console.log("[Audio Player] Playback started successfully");
        setIsPlaying(true);
        isPlayingRef.current = true;
      })
      .catch((error) => {
        console.warn("[Audio Player] Failed to start playback:", error);
        setIsPlaying(false);
        isPlayingRef.current = false;
      });
      }, [currentTrack, isPlaying]);

  const playTrackAt = useCallback(
    (nextIndex: number) => {
      if (!tracks[nextIndex]) return;
      // Just change the track index - the useEffect that loads tracks will handle
      // autoplay based on isPlayingRef.current
      setCurrentIndex(nextIndex);
      // Reset time and duration will be handled by the track loading effect
      setCurrentTime(0);
      setDuration(0);
      // Don't try to play here - let the track loading effect handle it
      // The effect will check isPlayingRef.current and autoplay if needed
    },
    [setCurrentIndex, tracks],
  );

  const handlePrevious = useCallback(() => {
    if (currentIndex <= 0) {
      commitSeek(0);
      return;
    }
    playTrackAt(currentIndex - 1);
  }, [commitSeek, currentIndex, playTrackAt]);

  const handleNext = useCallback(() => {
    if (currentIndex + 1 >= tracks.length) {
      return;
    }
    playTrackAt(currentIndex + 1);
  }, [currentIndex, playTrackAt, tracks.length]);

  const handleSkipBack = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    const newTime = Math.max(0, (audio.currentTime || currentTimeRef.current) - 10);
    commitSeek(newTime);
  }, [commitSeek]);

  const handleSkipForward = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    const currentTime = audio.currentTime || currentTimeRef.current;
    const maxTime = duration > 0 ? duration : currentTime;
    const newTime = Math.min(maxTime, currentTime + 10);
    commitSeek(newTime);
  }, [commitSeek, duration]);

  const displayedCurrentTime = useMemo(() => {
    if (isScrubbing && typeof scrubTime === "number") {
      return scrubTime;
    }
    return currentTime;
  }, [currentTime, isScrubbing, scrubTime]);

  const handleScrubChange = useCallback((value: number[]) => {
    const next = value?.[0];
    if (typeof next !== "number" || !Number.isFinite(next)) {
      return;
    }
    if (!userScrubbingRef.current) {
      return;
    }
    setScrubTime(Math.max(next, 0));
  }, []);

  const handleScrubCommit = useCallback(
    (value: number[]) => {
      const next = value?.[0];
      userScrubbingRef.current = false;
      setIsScrubbing(false);
      setScrubTime(null);
      if (typeof next !== "number" || !Number.isFinite(next)) {
        return;
      }
      commitSeek(next);
    },
    [commitSeek],
  );

  const handleScrubPointerDown = useCallback(() => {
    userScrubbingRef.current = true;
    setIsScrubbing(true);
  }, []);

  const handleScrubPointerUp = useCallback(() => {
    userScrubbingRef.current = false;
  }, []);

  const sliderMax = useMemo(() => {
    if (duration && duration > 0) {
      return duration;
    }
    return Math.max(displayedCurrentTime, 1);
  }, [displayedCurrentTime, duration]);

  const sliderValue = useMemo(() => {
    return Math.min(displayedCurrentTime, sliderMax);
  }, [displayedCurrentTime, sliderMax]);
  const handlePlaybackRateChange = useCallback((value: string) => {
    const nextRate = Number(value);
    if (!Number.isFinite(nextRate)) {
      return;
    }
    setPlaybackRate(nextRate);
  }, []);

  const handleDismiss = useCallback(() => {
    const audio = audioRef.current;
    // Ensure progress is saved before closing
    if (audio && Number.isFinite(audio.currentTime)) {
      emitProgressRef.current(audio.currentTime);
    } else {
      // Even if audio isn't ready, emit current time from ref
      emitProgressRef.current(currentTimeRef.current);
    }
    // Mark as dismissed to prevent re-animation
    hasBeenDismissedRef.current = true;
    // Start exit animation - set both states immediately
    setIsDismissing(true);
    setIsVisible(false);
      // Wait for exit animation to complete before notifying parent
      setTimeout(() => {
        // Parent component will handle unmounting after animation
        onClose?.();
      }, 300); // Match animation duration
  }, [onClose]);

  // Save progress when component becomes hidden (not just on unmount)
  const previousVisibleRef = useRef(isVisible);
  useEffect(() => {
    // When component transitions from visible to hidden, save progress
    if (previousVisibleRef.current && !isVisible && !isDismissing) {
      // Component became hidden - save progress
      const audio = audioRef.current;
      if (audio && Number.isFinite(audio.currentTime)) {
        emitProgressRef.current(audio.currentTime);
      } else if (currentTimeRef.current > 0) {
        emitProgressRef.current(currentTimeRef.current);
      }
    }
    previousVisibleRef.current = isVisible;
  }, [isVisible, isDismissing]);


  if (!currentTrack) {
    return null;
  }

  return (
    <div
      className={cn(
        "fixed inset-x-0 bottom-14 z-50 flex justify-center px-4 pb-6 sm:px-6",
        animPatterns.navBar,
        !chromeVisible && "translate-y-12 ",
        // Only disable pointer events on outer container when dismissing, chrome not visible, or dismissed
        (isDismissing || !chromeVisible || hasBeenDismissedRef.current) && "pointer-events-none",
        // Keep hidden after dismissal
        hasBeenDismissedRef.current && "opacity-0",
      )}
    >
      <div
        className={cn(
          "pointer-events-auto flex w-full max-w-xl flex-col gap-3 rounded-2xl border border-border bg-background/90 p-4 shadow-lg ring-1 ring-black/5 backdrop-blur",
          animPatterns.audioPlayer,
          // Apply exit animation when dismissing, otherwise apply enter animation when visible
          isDismissing || hasBeenDismissedRef.current
            ? enterExit(false, "slideUpFade")
            : enterExit(isVisible, "slideUpFade"),
          // Ensure it stays hidden after dismissal
          hasBeenDismissedRef.current && "opacity-0 pointer-events-none",
        )}
      >
        {/* Mobile: Top row with title, speed, sync, close */}
        <div className="flex sm:hidden flex-row justify-between items-center gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{currentTrack.title}</p>
            {bookTitle ? (
              <p className="truncate text-xs text-muted-foreground">{bookTitle}</p>
            ) : null}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Select value={playbackRate.toString()} onValueChange={handlePlaybackRateChange}>
                <SelectTrigger
                  aria-label="Playback speed"
                  className="h-8 min-w-[48px] rounded-md border border-input bg-background px-2 text-xs font-medium text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end">
                  {PLAYBACK_RATE_OPTIONS.map((rate) => (
                    <SelectItem key={rate} value={rate.toString()} className="text-xs">
                      {formatPlaybackRate(rate)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {onAutoScrollToggle && tracks.length > 0 ? (
              <Button
                variant={autoScrollEnabled ? "secondary" : "ghost"}
                size="icon"
                className={cn(
                  "rounded-full auto-scroll-button-transition",
                  autoScrollEnabled && "ring-1 ring-primary/20"
                )}
                onClick={() => onAutoScrollToggle(!autoScrollEnabled)}
                aria-label={autoScrollEnabled ? "Disable auto-scroll" : "Enable auto-scroll"}
                title={autoScrollEnabled ? "Auto-scroll enabled" : "Auto-scroll disabled"}
              >
                <MoveVertical className={cn(
                  "h-4 w-4 transition-transform duration-200",
                  autoScrollEnabled && "scale-110"
                )} />
              </Button>
            ) : null}
            {onClose ? (
              <Button
                variant="ghost"
                size="icon"
                className="rounded-full flex-shrink-0"
                onClick={handleDismiss}
                aria-label="Dismiss audio player"
              >
                <X className="h-4 w-4" />
              </Button>
            ) : null}
          </div>
        </div>

        {/* Mobile: Bottom row with playback controls */}
        <div className="flex sm:hidden flex-row items-center justify-center gap-2">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full"
              onClick={handlePrevious}
              aria-label="Previous track"
            >
              <SkipBack className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full"
              onClick={handleSkipBack}
              aria-label="Skip back 10 seconds"
              title="Skip back 10 seconds"
            >
              <StepBack className="h-4 w-4" />
            </Button>
            <Button
              variant="secondary"
              size="icon"
              className="h-12 w-12 rounded-full"
              onClick={togglePlayback}
              aria-label={isPlaying ? "Pause audio" : "Play audio"}
            >
              {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full"
              onClick={handleSkipForward}
              aria-label="Skip forward 10 seconds"
              title="Skip forward 10 seconds"
            >
              <StepForward className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full"
              onClick={handleNext}
              aria-label="Next track"
            >
              <SkipForward className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Desktop: Single row with everything */}
        <div className="hidden sm:flex flex-row justify-between items-start gap-3">
          <div className="flex flex-row items-center gap-3 min-w-0 flex-1">
            <div className="min-w-0 flex-1 w-auto">
              <p className="truncate text-sm font-semibold">{currentTrack.title}</p>
              {bookTitle ? (
                <p className="truncate text-xs text-muted-foreground">{bookTitle}</p>
              ) : null}
            </div>
            <div className="flex flex-row items-center gap-2 sm:gap-3">
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  className="rounded-full"
                  onClick={handlePrevious}
                  aria-label="Previous track"
                >
                  <SkipBack className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="rounded-full"
                  onClick={handleSkipBack}
                  aria-label="Skip back 10 seconds"
                  title="Skip back 10 seconds"
                >
                  <StepBack className="h-4 w-4" />
                </Button>
                <Button
                  variant="secondary"
                  size="icon"
                  className="h-12 w-12 rounded-full"
                  onClick={togglePlayback}
                  aria-label={isPlaying ? "Pause audio" : "Play audio"}
                >
                  {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="rounded-full"
                  onClick={handleSkipForward}
                  aria-label="Skip forward 10 seconds"
                  title="Skip forward 10 seconds"
                >
                  <StepForward className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="rounded-full"
                  onClick={handleNext}
                  aria-label="Next track"
                >
                  <SkipForward className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <span className="hidden md:block">Speed</span>
                <Select value={playbackRate.toString()} onValueChange={handlePlaybackRateChange}>
                  <SelectTrigger
                    aria-label="Playback speed"
                    className="h-8 min-w-[48px] rounded-md border border-input bg-background px-2 text-xs font-medium text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="end">
                    {PLAYBACK_RATE_OPTIONS.map((rate) => (
                      <SelectItem key={rate} value={rate.toString()} className="text-xs">
                        {formatPlaybackRate(rate)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {onAutoScrollToggle && tracks.length > 0 ? (
                <Button
                  variant={autoScrollEnabled ? "secondary" : "ghost"}
                  size="icon"
                  className={cn(
                    "rounded-full auto-scroll-button-transition",
                    autoScrollEnabled && "ring-1 ring-primary/20"
                  )}
                  onClick={() => onAutoScrollToggle(!autoScrollEnabled)}
                  aria-label={autoScrollEnabled ? "Disable auto-scroll" : "Enable auto-scroll"}
                  title={autoScrollEnabled ? "Auto-scroll enabled" : "Auto-scroll disabled"}
                >
                  <MoveVertical className={cn(
                    "h-4 w-4 transition-transform duration-200",
                    autoScrollEnabled && "scale-110"
                  )} />
                </Button>
              ) : null}
            </div>
          </div>
          {onClose ? (
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full flex-shrink-0"
              onClick={handleDismiss}
              aria-label="Dismiss audio player"
            >
              <X className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs tabular-nums text-muted-foreground min-w-[3rem] text-right">
            {formatTime(displayedCurrentTime)}
          </span>
          <Slider
            className="flex-1"
            min={0}
            max={sliderMax}
            step={0.01}
            value={[sliderValue]}
            onValueChange={handleScrubChange}
            onValueCommit={handleScrubCommit}
            disabled={!duration}
            onPointerDown={handleScrubPointerDown}
            onPointerUp={handleScrubPointerUp}
            aria-label="Seek audio"
            />
          <span className="text-xs tabular-nums text-muted-foreground min-w-[5rem] relative">
            {duration > 0 ? (
              <span
                key="duration"
                className="inline-block transition-opacity duration-300 ease-in-out animate-in fade-in"
              >
                {formatTime(duration)}
              </span>
            ) : (
              <span
                key="current-only"
                className="inline-block transition-opacity duration-300 ease-in-out animate-in fade-in"
              >
                {formatTime(displayedCurrentTime)}
              </span>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}

