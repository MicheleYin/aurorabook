import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { List, Loader2, MoveVertical, Pause, Play, SkipBack, SkipForward, StepBack, StepForward, X } from "lucide-react";

import { logger } from "../../lib/logger";
import type { AudioTrack, AudioSyncMap, Chapter } from "../../types/reader";
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
import { AudioTracksDialog } from "./AudioTracksDialog";
import { cn } from "../../lib/utils";
// useAudioPlayerState is now accessed via useLibrary hook
import { useLibrary } from "../../hooks/useLibrary";
import { animPatterns, enterExit } from "../../lib/animations";
import { ensureAudioTrackLoaded } from "../../lib/lazy-chapter-loader";
import { usePersistentSettings } from "../../hooks/settings/usePersistentSettings";
import { useContext } from "react";
import { ReaderCoordinatorContext } from "../../contexts/ReaderCoordinatorContext";

import { formatTime } from "../../lib/format-time";
import { findChaptersForAudioTrack, chapterHrefsMatch } from "../../lib/epub";

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
  bookAuthor?: string;
  coverUrl?: string;
  sourcePath?: string;
  onProgress?: (snapshot: AudioProgressSnapshot) => void;
  onRestorationStateChange?: (isRestoring: boolean) => void;
  chromeVisible?: boolean;
  onClose?: () => void;
  autoScrollEnabled?: boolean;
  onAutoScrollToggle?: (enabled: boolean) => void;
  onTrackChange?: (trackHref: string) => void;
  audioSyncMap?: AudioSyncMap;
  chapters?: Chapter[];
};

export function ReaderAudioPlayer({
  bookId,
  tracks,
  bookTitle,
  bookAuthor,
  coverUrl,
  sourcePath,
  onProgress,
  onRestorationStateChange,
  chromeVisible = true,
  onClose,
  autoScrollEnabled = true,
  onAutoScrollToggle,
  onTrackChange,
  audioSyncMap,
  chapters,
}: ReaderAudioPlayerProps) {
  // sourcePath is part of the interface but not currently used
  void sourcePath;
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
  } = libraryHook.useAudioPlayerState({
    bookId,
    tracks,
    library: libraryHook.library,
    onProgress,
  });
  
  const flushAudioStateUpdate = libraryHook.flushAudioStateUpdate;

  // Get coordinator to check if track change operation is in progress
  const coordinator = useContext(ReaderCoordinatorContext);
  const isTrackChangeInProgress = coordinator 
    ? (coordinator.loading.trackChanging || coordinator.isOperationInProgress("changeAudioTrack"))
    : false;

  // Get settings for playback speed
  const { settings, updateSettings, isHydrated: settingsHydrated } = usePersistentSettings();

  // Notify parent of restoration state changes
  useEffect(() => {
    isRestoringRef.current = isRestoring;
    onRestorationStateChange?.(isRestoring);
    
    // Clear restoration lock when restoration completes
    if (!isRestoring && restorationInProgressRef.current) {
      restorationInProgressRef.current = null;
    }
  }, [isRestoring, onRestorationStateChange]);

  // Store stable refs for callbacks to avoid effect re-runs
  const onTrackLoadedRef = useRef(onTrackLoaded);
  const emitProgressRef = useRef(emitProgress);
  
  // Update refs directly (no useEffect needed - these are just ref assignments)
  onTrackLoadedRef.current = onTrackLoaded;
  emitProgressRef.current = emitProgress;

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  // Initialize playback rate from settings, default to 1.0 if not available
  const [playbackRate, setPlaybackRate] = useState<number>(settings.audioPlaybackSpeed ?? 1.0);

  // Update playback rate on audio element (explicit callback instead of useEffect)
  const updatePlaybackRate = useCallback((audio: HTMLAudioElement, rate: number) => {
    if (audio) {
      audio.playbackRate = rate;
    }
  }, []);

  // Reset scrubbing state when track changes (explicit callback)
  const resetScrubbingState = useCallback(() => {
    setIsScrubbing(false);
    setScrubTime(null);
  }, []);

  // Update playback rate when settings are hydrated or change (use useEffect but call explicit callback)
  useEffect(() => {
    if (settingsHydrated && settings.audioPlaybackSpeed !== undefined) {
      const newRate = settings.audioPlaybackSpeed;
      setPlaybackRate(newRate);
      // Update audio element immediately if it exists (explicit callback)
      const audio = audioRef.current;
      if (audio) {
        updatePlaybackRate(audio, newRate);
      }
    }
  }, [settings.audioPlaybackSpeed, settingsHydrated, updatePlaybackRate]);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubTime, setScrubTime] = useState<number | null>(null);
  const [isDismissing, setIsDismissing] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [showTracksDialog, setShowTracksDialog] = useState(false);
  // Track animation state for title/subtitle transitions
  const [trackAnimationState, setTrackAnimationState] = useState<"entering" | "entered" | null>(null);
  const [trackAnimationDirection, setTrackAnimationDirection] = useState<"left" | "right" | null>(null);
  const previousTrackIndexRef = useRef<number | undefined>(undefined);
  // Simplified: Use ref to track loaded URLs instead of state to avoid re-render loops
  const loadedTrackUrlsRef = useRef<Map<string, string>>(new Map());

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const isPlayingRef = useRef(false);
  const userScrubbingRef = useRef(false);
  // Note: audio.currentTime is the single source of truth - always read from audioRef.current.currentTime
  const lastEmitTimestampRef = useRef(0);
  const lastEmittedSecondsRef = useRef(0);
  const lastCurrentTimeUpdateRef = useRef(0);
  const isRestoringRef = useRef(false);
  const hasBeenDismissedRef = useRef(false);
  const isAutoAdvancingRef = useRef(false);

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

  // Track animation timeout refs for cleanup
  const trackAnimationTimeoutRef = useRef<number | null>(null);
  const trackAnimationResetTimeoutRef = useRef<number | null>(null);

  // Trigger track animation when track index changes
  useEffect(() => {
    const previousIndex = previousTrackIndexRef.current;
    
    // Clear any pending timeouts
    if (trackAnimationTimeoutRef.current !== null) {
      clearTimeout(trackAnimationTimeoutRef.current);
      trackAnimationTimeoutRef.current = null;
    }
    if (trackAnimationResetTimeoutRef.current !== null) {
      clearTimeout(trackAnimationResetTimeoutRef.current);
      trackAnimationResetTimeoutRef.current = null;
    }
    
    if (previousIndex !== undefined && previousIndex !== currentIndex) {
      // Determine direction based on previous vs current index
      const direction = currentIndex > previousIndex ? "left" : "right";
      
      // Reset animation state first to ensure CSS classes re-trigger
      setTrackAnimationState(null);
      setTrackAnimationDirection(null);
      
      // Use double requestAnimationFrame to ensure DOM has fully updated before applying animation
      // This is a common pattern to ensure the browser has painted the reset state
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setTrackAnimationDirection(direction);
          setTrackAnimationState("entering");
          
          // After animation starts, mark as entered
          trackAnimationTimeoutRef.current = window.setTimeout(() => {
            setTrackAnimationState("entered");
            
            // Reset animation state after animation completes (300ms for duration)
            trackAnimationResetTimeoutRef.current = window.setTimeout(() => {
              setTrackAnimationState(null);
              setTrackAnimationDirection(null);
            }, 300);
          }, 50);
        });
      });
    } else if (previousIndex === undefined) {
      // First render - no animation
      setTrackAnimationDirection(null);
      setTrackAnimationState(null);
    }
    
    previousTrackIndexRef.current = currentIndex;
    
    // Cleanup function
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
  }, [currentIndex]);

  // Determine track animation class - always use slide left or right (same as chapter animations)
  const trackAnimationClass = useMemo(() => {
    if (trackAnimationState === "entering" || trackAnimationState === "entered") {
      // Always use slide animations - left for next track, right for previous track
      if (trackAnimationDirection === "left") {
        return animPatterns.chapterSlideLeft;
      } else if (trackAnimationDirection === "right") {
        return animPatterns.chapterSlideRight;
      }
      // Default to slide left if direction is not set
      return animPatterns.chapterSlideLeft;
    }
    return null;
  }, [trackAnimationState, trackAnimationDirection]);

  const commitSeek = useCallback(
    (targetSeconds: number) => {
      const audio = audioRef.current;
      if (!audio || typeof targetSeconds !== "number" || !Number.isFinite(targetSeconds)) {
        return;
      }
      const normalized = Math.max(targetSeconds, 0);
      try {
        audio.currentTime = normalized;
        // Read back the actual position the browser set (may differ slightly from what we requested)
        // This is the single source of truth - always read from audio element
        const appliedTime = audio.currentTime || normalized;
        const now = typeof performance !== "undefined" ? performance.now() : Date.now();
        
        // Immediately update UI state to keep it in sync
        setCurrentTime(appliedTime);
        
        // Reset throttling timers so next timeupdate event can update immediately
        // This prevents the UI from lagging behind after a seek
        lastCurrentTimeUpdateRef.current = now;
        lastEmitTimestampRef.current = now;
        lastEmittedSecondsRef.current = appliedTime;
        
        // Emit progress immediately to save the new position
        emitProgressRef.current(appliedTime);
      } catch (error) {
        logger.warn("[Audio Player] Failed to seek:", error);
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

  // Update loaded track URLs when tracks prop changes (clear cache for removed tracks)
  useEffect(() => {
    const trackIds = new Set(tracks.map(t => t.id));
    // Remove URLs for tracks that no longer exist
    loadedTrackUrlsRef.current.forEach((_, trackId) => {
      if (!trackIds.has(trackId)) {
        loadedTrackUrlsRef.current.delete(trackId);
      }
    });
    // Add URLs for tracks that already have them
    tracks.forEach(track => {
      if (track.url) {
        loadedTrackUrlsRef.current.set(track.id, track.url);
      }
    });
  }, [tracks]);

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

  // Update ref directly (no useEffect needed - this is just a ref assignment)
  isPlayingRef.current = isPlaying;

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
      
      // Don't update UI state if component is dismissing (reduces re-renders during animation)
      if (!hasBeenDismissedRef.current && !isDismissing) {
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

    // IMPROVEMENT 4: Consolidated event handlers
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
        totalTracks: tracks.length,
        isPlayingRef: isPlayingRef.current,
        isPlayingState: isPlaying,
      });
      
      // Emit final progress for the ended track
      emitProgressRef.current(audio.currentTime || 0);
      
      const nextIndex = currentIndex + 1;
      if (nextIndex < tracks.length) {
        const nextTrack = tracks[nextIndex];
        logger.log("[Audio Player] Auto-advancing to next track", {
          nextIndex,
          nextTrackId: nextTrack?.id,
          nextTrackTitle: nextTrack?.title,
        });
        
        // Mark track change as in progress to prevent audio from starting prematurely
        trackChangeInProgressRef.current = true;
        
        // Set flag to prevent timeupdate from resetting playing state
        // This flag will be cleared in setupAudioSource once the new track is set up
        isAutoAdvancingRef.current = true;
        
        // IMPORTANT: Set playing state BEFORE changing track
        // This ensures setupAudioSource knows we want to continue playing
        isPlayingRef.current = true;
        setIsPlaying(true);
        
        // Change track - setupAudioSource will detect isAutoAdvancingRef and autoplay
        setCurrentIndex(nextIndex);
      } else {
        logger.log("[Audio Player] Last track ended, stopping playback");
        // Last track - stop playback
        audio.pause();
        audio.currentTime = 0;
        setCurrentTime(0);
        setIsPlaying(false);
        isPlayingRef.current = false;
      }
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
  }, [currentIndex, tracks.length, isRestoring, restoreTime, flushAudioStateUpdate]);

  // Track loaded count to trigger re-renders when URLs are loaded
  // Use ref to avoid unnecessary re-renders, only update state when needed for UI
  const loadedCountRef = useRef(0);
  const [loadedCount, setLoadedCount] = useState(0);
  // Track if current track is loading
  const [isTrackLoading, setIsTrackLoading] = useState(false);
  // Local track changing state that updates immediately (before async coordinator state)
  const [isLocalTrackChanging, setIsLocalTrackChanging] = useState(false);
  
  // Clear local track changing state when coordinator's state clears
  // This ensures we don't stay in loading state if coordinator clears before we do
  useEffect(() => {
    if (!isTrackChangeInProgress && isLocalTrackChanging) {
      // Use a small delay to ensure coordinator state has propagated
      const timeoutId = setTimeout(() => {
        setIsLocalTrackChanging(false);
      }, 100);
      return () => clearTimeout(timeoutId);
    }
  }, [isTrackChangeInProgress, isLocalTrackChanging]);
  
  // Combine track loading state with coordinator track change state and local state
  // Local state updates immediately for instant UI feedback
  // Coordinator state updates when async operation starts
  const isLoadingOrChanging = isTrackLoading || isTrackChangeInProgress || isLocalTrackChanging;
  
  // Get current track with URL if loaded
  // Memoize to prevent unnecessary recalculations
  const currentTrack = useMemo(() => {
    const track = tracks[currentIndex];
    if (!track) return undefined;
    const loadedUrl = loadedTrackUrlsRef.current.get(track.id);
    return loadedUrl ? { ...track, url: loadedUrl } : track;
  }, [tracks, currentIndex, loadedCount]);

  // Periodically check audio state to detect external pause/play
  // Use currentTrack.id instead of currentTrack object to avoid re-runs
  const currentTrackId = currentTrack?.id;
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrackId) {
      return;
    }

    const checkAudioState = () => {
      // Don't sync state if we're auto-advancing (track ended and moving to next)
      if (isAutoAdvancingRef.current) {
        return;
      }
      // Don't sync state during restoration to prevent conflicts
      if (isRestoringRef.current || restorationInProgressRef.current) {
        return;
      }
      
      const audioIsPlaying = !audio.paused;
      if (audioIsPlaying !== isPlayingRef.current) {
        setIsPlaying(audioIsPlaying);
        isPlayingRef.current = audioIsPlaying;
        // If paused externally, emit progress to save state
        // Single source of truth: read from audio element
        if (!audioIsPlaying) {
          const audioTime = audio.currentTime || 0;
          emitProgressRef.current(audioTime);
          // Flush audio state update immediately on pause
          flushAudioStateUpdate().catch((error) => {
            logger.warn("Failed to flush audio state on pause", error);
          });
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
  }, [currentTrackId]);

  // Track if we've loaded a track for restoration to prevent resetting time after restoration
  const trackLoadedForRestorationRef = useRef(false);
  // Track which tracks we're currently loading to prevent duplicate loads
  const loadingTracksRef = useRef<Set<string>>(new Set());
  // Lock to prevent concurrent restoration attempts
  const restorationInProgressRef = useRef<string | null>(null);
  // Track when a track change is in progress to prevent audio from starting
  const trackChangeInProgressRef = useRef(false);
  // Track the last track href we notified about to prevent duplicate onTrackChange calls
  const lastNotifiedTrackHrefRef = useRef<string | null>(null);

  // Simplified: Pre-load track URL only when needed
  useEffect(() => {
    if (!currentTrack || !bookId || currentIndex === undefined || currentIndex === null) {
      setIsTrackLoading(false);
      return;
    }
    
    const trackId = currentTrack.id;
    
    // Check if already loaded
    if (loadedTrackUrlsRef.current.has(trackId)) {
      setIsTrackLoading(false);
      // Preload next track disabled for memory optimization
      return;
    }
    
    // Check if already loading
    if (loadingTracksRef.current.has(trackId)) {
      setIsTrackLoading(true);
      return;
    }
    
    // Mark as loading
    loadingTracksRef.current.add(trackId);
    setIsTrackLoading(true);
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
          loadedTrackUrlsRef.current.set(trackId, loadedTrack.url);
          setIsTrackLoading(false);
          // Trigger re-render to update currentTrack memo (only when needed)
          loadedCountRef.current += 1;
          setLoadedCount(loadedCountRef.current);
          
          logger.log("[Audio Player] ✓ Track URL loaded successfully", {
            trackId: loadedTrack.id,
            trackTitle: loadedTrack.title,
            urlLength: loadedTrack.url.length,
          });
          
          // Preload next audio track disabled for memory optimization
        }
      })
      .catch((error) => {
        if (!cancelled) {
          loadingTracksRef.current.delete(trackId);
          setIsTrackLoading(false);
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
      setIsTrackLoading(false);
    };
  }, [currentIndex, currentTrack?.id, bookId]);

  // IMPROVEMENT 2: Extract helper functions for autoplay
  const attemptAutoplay = useCallback(async (
    audio: HTMLAudioElement,
    shouldPlay: boolean
  ): Promise<boolean> => {
    // Prevent autoplay during restoration or track changes
    if (isRestoringRef.current || restorationInProgressRef.current || trackChangeInProgressRef.current) {
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
  }, []);

  const tryPlayIfReady = useCallback((
    audio: HTMLAudioElement,
    shouldAutoplay: boolean
  ): boolean => {
    // Prevent play if restoration or track change is in progress
    if (isRestoringRef.current || restorationInProgressRef.current || trackChangeInProgressRef.current) {
      return false;
    }
    
    if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA && audio.paused) {
      attemptAutoplay(audio, shouldAutoplay);
      return true;
    }
    return false;
  }, [attemptAutoplay]);

  // Track the last track ID we set up to prevent duplicate setups
  const lastSetupTrackIdRef = useRef<string | null>(null);

  // IMPROVEMENT 3: Simplified setupAudioSource function
  const setupAudioSource = useCallback((
    audio: HTMLAudioElement,
    track: AudioTrack
  ) => {
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
    const shouldAutoplay = !isRestoringRef.current && (isPlayingRef.current || isAutoAdvancingRef.current);
    
    // Don't clear auto-advancing flag yet - keep it until audio actually starts playing
    // This prevents the timeupdate handler from resetting the playing state
    // The flag will be cleared when playback actually starts (in the event handlers)
    
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
    // Also skip if we already notified about this track (to prevent duplicate calls)
    if (onTrackChange && !isRestoringRef.current && lastNotifiedTrackHrefRef.current !== track.href) {
      logger.log("[Audio Player] Notifying parent of track change (via effect)", {
        trackHref: track.href,
      });
      lastNotifiedTrackHrefRef.current = track.href;
      // Set local loading state if not already set
      setIsLocalTrackChanging(true);
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
        setIsLocalTrackChanging(false);
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
        setIsLocalTrackChanging(false);
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
            setIsLocalTrackChanging(false);
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
            setIsLocalTrackChanging(false);
          }
        });
      }
    };
    
    const handleLoadedData = () => {
      if (cleanupCalled) return;
      // Only try autoplay on loadeddata if canplay hasn't fired yet
      // This is a fallback for very fast loads
      if (shouldAutoplay && audio.paused && audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
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
            setIsLocalTrackChanging(false);
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
        setIsLocalTrackChanging(false);
      }
    };
    
    audio.addEventListener("canplay", handleCanPlay);
    audio.addEventListener("canplaythrough", handleCanPlayThrough);
    audio.addEventListener("loadeddata", handleLoadedData);
    audio.addEventListener("playing", handlePlaying);
    
    // Also try to play after a short delay as a fallback
    // This handles cases where events don't fire reliably
    const fallbackTimeout = setTimeout(() => {
      if (!cleanupCalled && shouldAutoplay && audio.paused && audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
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
            setIsLocalTrackChanging(false);
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
      setIsLocalTrackChanging(false);
    };
  }, [playbackRate, onTrackChanged, onTrackChange, tryPlayIfReady, attemptAutoplay]);

  // Simplified: Main track loading effect - only runs when track or index changes
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack || !bookId) {
      return;
    }

    // Reset setup tracking when track changes
    lastSetupTrackIdRef.current = null;
    
    // Reset scrubbing state when track changes
    resetScrubbingState();

    // Get URL from ref
    const trackUrl = loadedTrackUrlsRef.current.get(currentTrack.id);
    if (!trackUrl) {
      // URL not loaded yet - will be handled by pre-load effect
      return;
    }

    // Create track with URL
    const trackWithUrl = { ...currentTrack, url: trackUrl };

    // Prevent duplicate setup
    if (lastSetupTrackIdRef.current === trackWithUrl.id && audio.src === trackUrl) {
      // Already set up, but check if we need to autoplay (e.g., track just loaded)
      if (isPlayingRef.current && audio.paused) {
        logger.log("[Audio Player] Track already set up but paused, attempting autoplay");
        attemptAutoplay(audio, true);
      }
      return;
    }

    // Setup audio source (will handle autoplay if isPlayingRef is true)
    const cleanup = setupAudioSource(audio, trackWithUrl);
    
    return cleanup;
  }, [currentIndex, currentTrack?.id, bookId, setupAudioSource, loadedCount, attemptAutoplay, resetScrubbingState]);


  const togglePlayback = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || !currentTrack || !bookId) {
      return;
    }

    // Prevent playback changes during restoration or track changes to avoid conflicts
    if (isRestoringRef.current || restorationInProgressRef.current || trackChangeInProgressRef.current) {
      logger.log("[Audio Player] Deferring playback toggle - restoration or track change in progress", {
        isRestoring: isRestoringRef.current,
        restorationInProgress: restorationInProgressRef.current,
        trackChangeInProgress: trackChangeInProgressRef.current,
      });
      return;
    }

    logger.log("[Audio Player] togglePlayback called", {
      isPlayingRef: isPlayingRef.current,
      isPlayingState: isPlaying,
      audioPaused: audio.paused,
      trackId: currentTrack.id,
    });

    // Use audio element's actual state as source of truth (important for iOS background controls)
    // Check audio.paused instead of isPlayingRef to handle external pause/play from iOS control center
    if (!audio.paused) {
      logger.log("[Audio Player] Pausing playback");
      audio.pause();
      // Single source of truth: read from audio element
      emitProgressRef.current(audio.currentTime || 0);
      setIsPlaying(false);
      isPlayingRef.current = false;
      return;
    }

    // Check if track URL is loaded
    let trackUrl = loadedTrackUrlsRef.current.get(currentTrack.id);
    
    // If not loaded, load it first (or wait if already loading)
    if (!trackUrl) {
      logger.log("[Audio Player] Track URL not loaded, loading first", {
        trackId: currentTrack.id,
      });
      
      // Check if already loading
      if (loadingTracksRef.current.has(currentTrack.id)) {
        // Wait for it to finish loading
        logger.log("[Audio Player] Track already loading, waiting...");
        let attempts = 0;
        while (!trackUrl && attempts < 50) { // Max 5 seconds
          await new Promise(resolve => setTimeout(resolve, 100));
          trackUrl = loadedTrackUrlsRef.current.get(currentTrack.id);
          attempts++;
        }
        if (!trackUrl) {
          logger.warn("[Audio Player] Track URL loading timeout");
          return;
        }
      } else {
        // Load it now
        try {
          loadingTracksRef.current.add(currentTrack.id);
          const loadedTrack = await ensureAudioTrackLoaded(bookId, currentTrack);
          loadingTracksRef.current.delete(currentTrack.id);
          
          if (loadedTrack.url) {
            trackUrl = loadedTrack.url;
            loadedTrackUrlsRef.current.set(currentTrack.id, trackUrl);
            loadedCountRef.current += 1;
            setLoadedCount(loadedCountRef.current);
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

    // Ensure audio source is set
    if (audio.src !== trackUrl) {
      audio.src = trackUrl;
      audio.load();
      audio.playbackRate = playbackRate;
      // Wait for audio to be ready
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

    // Final safety check before starting playback
    if (isRestoringRef.current || restorationInProgressRef.current || trackChangeInProgressRef.current) {
      logger.log("[Audio Player] Playback blocked - restoration or track change in progress", {
        isRestoring: isRestoringRef.current,
        restorationInProgress: restorationInProgressRef.current,
        trackChangeInProgress: trackChangeInProgressRef.current,
      });
      return;
    }
    
    logger.log("[Audio Player] Starting playback");
    try {
      await audio.play();
      logger.log("[Audio Player] Playback started successfully");
      setIsPlaying(true);
      isPlayingRef.current = true;
    } catch (error) {
      logger.warn("[Audio Player] Failed to start playback:", error);
      setIsPlaying(false);
      isPlayingRef.current = false;
    }
  }, [currentTrack, isPlaying, bookId, playbackRate]);

  const playTrackAt = useCallback(
    (nextIndex: number) => {
      if (!tracks[nextIndex]) return;
      
      // Prevent track changes during restoration to avoid conflicts
      if (isRestoringRef.current || restorationInProgressRef.current) {
        logger.log("[Audio Player] Deferring track change - restoration in progress", {
          nextIndex,
          isRestoring: isRestoringRef.current,
          restorationInProgress: restorationInProgressRef.current,
        });
        // Wait a bit and retry if restoration is still in progress
        setTimeout(() => {
          if (!isRestoringRef.current && !restorationInProgressRef.current) {
            playTrackAt(nextIndex);
          }
        }, 100);
        return;
      }
      
      // Get the next track to notify parent/coordinator BEFORE changing index
      // This ensures the coordinator's loading state is set before the track index changes
      const nextTrack = tracks[nextIndex];
      if (!nextTrack) return;
      
      // Set local loading state IMMEDIATELY for instant UI feedback
      // This updates synchronously before any async operations
      setIsLocalTrackChanging(true);
      
      // Set timestamp to 0 IMMEDIATELY for clean UI
      // This ensures the UI shows 0:00 right away instead of the old track's time
      setCurrentTime(0);
      const audio = audioRef.current;
      if (audio) {
        audio.currentTime = 0;
      }
      
      // Notify parent about track change IMMEDIATELY (synchronously) to trigger coordinator
      // This ensures buttons are disabled before the track change happens
      if (onTrackChange && !isRestoringRef.current && lastNotifiedTrackHrefRef.current !== nextTrack.href) {
        logger.log("[Audio Player] Notifying parent of track change (via playTrackAt)", {
          nextIndex,
          trackHref: nextTrack.href,
        });
        lastNotifiedTrackHrefRef.current = nextTrack.href;
        // Fire and forget - call synchronously to trigger coordinator immediately
        // The coordinator will handle the async operation
        onTrackChange(nextTrack.href);
      }
      
      // Mark track change as in progress to prevent audio from starting
      trackChangeInProgressRef.current = true;
      // IMPORTANT: Preserve playing state before changing tracks
      // Check both the ref and the actual audio element state
      const wasPlaying = isPlayingRef.current || (audio && !audio.paused);
      
      if (wasPlaying) {
        // Set flag to prevent timeupdate from resetting playing state during track change
        // Similar to auto-advancing, but for manual track changes
        isAutoAdvancingRef.current = true;
        
        // Preserve playing state so autoplay happens when new track loads
        isPlayingRef.current = true;
        setIsPlaying(true);
        logger.log("[Audio Player] Preserving playing state for manual track change", {
          nextIndex,
          wasPlaying,
        });
      } else {
        // Ensure paused state is maintained
        isPlayingRef.current = false;
        setIsPlaying(false);
      }
      
      // Emit progress for current track before changing
      if (audio && Number.isFinite(audio.currentTime)) {
        emitProgressRef.current(audio.currentTime);
      }
      
      // Change the track index - the useEffect that loads tracks will handle
      // autoplay based on isPlayingRef.current
      setCurrentIndex(nextIndex);
      // Reset time and duration will be handled by the track loading effect
      setCurrentTime(0);
      setDuration(0);
    },
    [setCurrentIndex, tracks, onTrackChange],
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
    // Single source of truth: read from audio element
    const newTime = Math.max(0, (audio.currentTime || 0) - 10);
    commitSeek(newTime);
  }, [commitSeek]);

  const handleSkipForward = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    // Single source of truth: read from audio element
    const currentTime = audio.currentTime || 0;
    const maxTime = duration > 0 ? duration : currentTime;
    const newTime = Math.min(maxTime, currentTime + 10);
    commitSeek(newTime);
  }, [commitSeek, duration]);

  // Update MediaSession metadata for macOS Control Center
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) {
      return;
    }

    const mediaSession = navigator.mediaSession;
    
    // Only set metadata if we have a current track
    if (!currentTrack || !bookTitle) {
      // Clear metadata if no track
      try {
        mediaSession.metadata = null;
      } catch {
        // Ignore errors when clearing metadata
      }
      return;
    }

    // Find related chapters for the current track
    const chapterHrefs = audioSyncMap
      ? findChaptersForAudioTrack(audioSyncMap, currentTrack.href)
      : [];
    const relatedChapters = chapters
      ? chapters.filter((chapter) => {
          return chapterHrefs.some((chapterHref) =>
            chapterHrefsMatch(chapter.href, chapterHref)
          );
        })
      : [];
    
    // Build title with chapter information
    const trackTitle = currentTrack.title || bookTitle;
    let title = trackTitle;
    if (relatedChapters.length > 0) {
      const chapterTitle = relatedChapters[0].title;
      title = `${chapterTitle} - ${trackTitle}`;
    }

    // Build artist with app name
    const artist = bookAuthor 
      ? `${bookAuthor} - AuroraBook`
      : "AuroraBook";

    // Build album with book title and app name
    const album = `${bookTitle} - AuroraBook`;

    // Prepare artwork array
    const artwork: MediaImage[] = [];
    if (coverUrl) {
      // Handle both blob URLs and file URLs
      artwork.push({
        src: coverUrl,
        sizes: "512x512", // Standard size for Control Center
        type: "image/jpeg", // Default type, will be detected by browser
      });
    }

    // Set metadata
    try {
      mediaSession.metadata = new MediaMetadata({
        title,
        artist,
        album,
        artwork,
      });

      logger.log("[Audio Player] MediaSession metadata updated", {
        title,
        artist,
        album,
        chapterTitle: relatedChapters.length > 0 ? relatedChapters[0].title : undefined,
        hasArtwork: artwork.length > 0,
      });
    } catch (error) {
      logger.warn("[Audio Player] Failed to set MediaSession metadata", error);
    }

    // Set up action handlers for Control Center controls
    const handlePlay = () => {
      logger.log("[Audio Player] MediaSession play action triggered");
      togglePlayback();
    };

    const handlePause = () => {
      logger.log("[Audio Player] MediaSession pause action triggered");
      togglePlayback();
    };

    const handlePreviousTrack = () => {
      logger.log("[Audio Player] MediaSession previoustrack action triggered");
      handlePrevious();
    };

    const handleNextTrack = () => {
      logger.log("[Audio Player] MediaSession nexttrack action triggered");
      handleNext();
    };

    const handleSeekBackward = () => {
      logger.log("[Audio Player] MediaSession seekbackward action triggered");
      handleSkipBack();
    };

    const handleSeekForward = () => {
      logger.log("[Audio Player] MediaSession seekforward action triggered");
      handleSkipForward();
    };

    // Set action handlers
    mediaSession.setActionHandler("play", handlePlay);
    mediaSession.setActionHandler("pause", handlePause);
    mediaSession.setActionHandler("previoustrack", handlePreviousTrack);
    mediaSession.setActionHandler("nexttrack", handleNextTrack);
    mediaSession.setActionHandler("seekbackward", handleSeekBackward);
    mediaSession.setActionHandler("seekforward", handleSeekForward);

    // Cleanup: remove action handlers when component unmounts or track changes
    return () => {
      try {
        mediaSession.setActionHandler("play", null);
        mediaSession.setActionHandler("pause", null);
        mediaSession.setActionHandler("previoustrack", null);
        mediaSession.setActionHandler("nexttrack", null);
        mediaSession.setActionHandler("seekbackward", null);
        mediaSession.setActionHandler("seekforward", null);
      } catch {
        // Ignore errors when clearing handlers
      }
    };
  }, [currentTrack, bookTitle, bookAuthor, coverUrl, isPlaying, togglePlayback, handlePrevious, handleNext, handleSkipBack, handleSkipForward, audioSyncMap, chapters]);

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
    // Update audio element immediately
    const audio = audioRef.current;
    if (audio) {
      updatePlaybackRate(audio, nextRate);
    }
    // Persist to settings
    updateSettings({ audioPlaybackSpeed: nextRate });
  }, [updateSettings, updatePlaybackRate]);

  const handleTrackSelect = useCallback((trackIndex: number) => {
    logger.log("[Audio Player] handleTrackSelect called", {
      trackIndex,
      tracksLength: tracks.length,
    });
    if (trackIndex >= 0 && trackIndex < tracks.length) {
      playTrackAt(trackIndex);
    }
  }, [tracks, playTrackAt]);

  const handleDismiss = useCallback(() => {
    // Prevent multiple dismiss calls
    if (hasBeenDismissedRef.current || isDismissing) {
      return;
    }
    
    // Start exit animation immediately for responsive UI (synchronous state updates)
    // Mark as dismissed to prevent re-animation
    hasBeenDismissedRef.current = true;
    // Start exit animation - set both states immediately
    setIsDismissing(true);
    setIsVisible(false);
    
    // Save progress asynchronously (don't block animation)
    // Use a microtask to save progress without delaying the animation start
    Promise.resolve().then(async () => {
      const audio = audioRef.current;
      // Single source of truth: always read from audio element
      if (audio && Number.isFinite(audio.currentTime)) {
        emitProgressRef.current(audio.currentTime);
      } else {
        // Fallback to 0 if audio isn't ready
        emitProgressRef.current(0);
      }
      // Flush audio state update immediately on close
      await flushAudioStateUpdate();
    });
    
    // Wait for exit animation to complete before notifying parent
    // Use a slightly longer timeout to ensure animation completes smoothly
    setTimeout(() => {
      // Parent component will handle unmounting after animation
      onClose?.();
    }, 350); // Slightly longer than animation duration to ensure smooth completion
  }, [onClose, isDismissing, flushAudioStateUpdate]);

  // Save progress when component becomes hidden (not just on unmount)
  const previousVisibleRef = useRef(isVisible);
  useEffect(() => {
    // When component transitions from visible to hidden, save progress
    // Skip if we're dismissing (handleDismiss already saves progress)
    if (previousVisibleRef.current && !isVisible && !isDismissing && !hasBeenDismissedRef.current) {
      // Component became hidden - save progress
      // Single source of truth: always read from audio element
      const audio = audioRef.current;
      if (audio && Number.isFinite(audio.currentTime)) {
        emitProgressRef.current(audio.currentTime);
      } else {
        // Fallback to 0 if audio isn't ready
        emitProgressRef.current(0);
      }
      // Flush audio state update when component becomes hidden
      flushAudioStateUpdate().catch((error) => {
        logger.warn("Failed to flush audio state on visibility change", error);
      });
    }
    previousVisibleRef.current = isVisible;
  }, [isVisible, isDismissing, flushAudioStateUpdate]);


  if (!currentTrack) {
    return null;
  }

  return (
    <div
      data-audio-player
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
          "pointer-events-auto flex w-full max-w-2xl flex-col gap-3 rounded-2xl border border-border bg-background/90 p-4 shadow-lg ring-1 ring-black/5 backdrop-blur",
          // Optimize for animations - use will-change when dismissing
          isDismissing && "will-change-transform will-change-opacity will-change-scale",
          animPatterns.audioPlayer,
          // Apply beautiful exit animation when dismissing (slide up + fade + scale down)
          isDismissing || hasBeenDismissedRef.current
            ? cn(
                "animate-out slide-out-to-top-4 fade-out-0 zoom-out-95",
                "duration-300 ease-in-out"
              )
            : enterExit(isVisible, "slideUpFade"),
          // Ensure it stays hidden after dismissal
          hasBeenDismissedRef.current && "opacity-0 pointer-events-none scale-95",
        )}
      >
        {/* Mobile: Top row with title, speed, sync, close */}
        <div className="flex sm:hidden flex-row justify-between items-center gap-2">
          <div className="min-w-0 flex-1">
            <p className={cn("truncate text-sm font-semibold", trackAnimationClass)}>{currentTrack.title}</p>
            {bookTitle ? (
              <p className={cn("truncate text-xs text-muted-foreground", trackAnimationClass)}>{bookTitle}</p>
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
            {tracks.length > 1 ? (
              <Button
                variant="ghost"
                size="icon"
                className="rounded-full"
                onClick={() => setShowTracksDialog(true)}
                aria-label="Show all tracks"
                title="Show all tracks"
              >
                <List className="h-4 w-4" />
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
              disabled={currentIndex <= 0}
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
              disabled={isLoadingOrChanging}
            >
              <StepBack className="h-4 w-4" />
            </Button>
            <Button
              variant="secondary"
              size="icon"
              className="h-12 w-12 rounded-full"
              onClick={togglePlayback}
              aria-label={isPlaying ? "Pause audio" : "Play audio"}
              disabled={isLoadingOrChanging}
            >
              {isLoadingOrChanging ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : isPlaying ? (
                <Pause className="h-5 w-5" />
              ) : (
                <Play className="h-5 w-5" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full"
              onClick={handleSkipForward}
              aria-label="Skip forward 10 seconds"
              title="Skip forward 10 seconds"
              disabled={isLoadingOrChanging}
            >
              <StepForward className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full"
              onClick={handleNext}
              aria-label="Next track"
              disabled={currentIndex + 1 >= tracks.length}
            >
              <SkipForward className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Desktop: Single row with everything */}
        <div className="hidden sm:flex flex-row justify-between items-start gap-3">
          <div className="flex flex-row items-center gap-3 min-w-0 flex-1">
            <div className="min-w-0 flex-1 w-auto">
              <p className={cn("truncate text-sm font-semibold", trackAnimationClass)}>{currentTrack.title}</p>
              {bookTitle ? (
                <p className={cn("truncate text-xs text-muted-foreground", trackAnimationClass)}>{bookTitle}</p>
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
                  disabled={currentIndex <= 0 || isLoadingOrChanging}
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
              disabled={isLoadingOrChanging}
            >
              <StepBack className="h-4 w-4" />
            </Button>
            <Button
              variant="secondary"
              size="icon"
              className="h-12 w-12 rounded-full"
              onClick={togglePlayback}
              aria-label={isPlaying ? "Pause audio" : "Play audio"}
              disabled={isLoadingOrChanging}
            >
              {isLoadingOrChanging ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : isPlaying ? (
                <Pause className="h-5 w-5" />
              ) : (
                <Play className="h-5 w-5" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full"
              onClick={handleSkipForward}
              aria-label="Skip forward 10 seconds"
              title="Skip forward 10 seconds"
              disabled={isLoadingOrChanging}
            >
              <StepForward className="h-4 w-4" />
            </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="rounded-full"
                  onClick={handleNext}
                  aria-label="Next track"
                  disabled={currentIndex + 1 >= tracks.length || isLoadingOrChanging}
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
              {tracks.length > 1 ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="rounded-full"
                  onClick={() => setShowTracksDialog(true)}
                  aria-label="Show all tracks"
                  title="Show all tracks"
                >
                  <List className="h-4 w-4" />
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
            {currentTrack && (currentTrack.url || loadedTrackUrlsRef.current.has(currentTrack.id)) ? (
              <span
                key="current-only"
                className="inline-block transition-opacity duration-300 ease-in-out animate-in fade-in"
              >
                {duration > 0 ? formatTime(duration) : "--:--"}
              </span>
            ) : (
              <span
                key="placeholder"
                className="inline-block transition-opacity duration-300 ease-in-out animate-in fade-in"
              >
                --:--
              </span>
            )}
          </span>
        </div>
      </div>

      {/* Tracks Dialog */}
      <AudioTracksDialog
        open={showTracksDialog}
        onOpenChange={setShowTracksDialog}
        tracks={tracks}
        currentIndex={currentIndex}
        bookTitle={bookTitle}
        loadedTrackUrls={loadedTrackUrlsRef.current}
        onTrackSelect={handleTrackSelect}
        audioSyncMap={audioSyncMap}
        chapters={chapters}
      />
    </div>
  );
}

