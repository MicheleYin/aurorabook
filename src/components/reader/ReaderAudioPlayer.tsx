import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MoveVertical, Pause, Play, SkipBack, SkipForward, X } from "lucide-react";

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
import { useAudioStateSync } from "../../hooks/useAudioStateSync";
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
  initialAudioState,
  onProgress,
  onRestorationStateChange,
  chromeVisible = true,
  onClose,
  autoScrollEnabled = true,
  onAutoScrollToggle,
}: ReaderAudioPlayerProps) {
  // Use custom hook for state sync and restoration
  const {
    currentIndex,
    setCurrentIndex,
    restoreTime,
    isRestoring,
    onTrackLoaded,
    onTrackChanged,
    emitProgress,
  } = useAudioStateSync({
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
        emitProgress(appliedTime);
      } catch (error) {
        console.warn("[Audio Player] Failed to seek:", error);
      }
    },
    [emitProgress],
  );

  // Emit progress on unmount
  useEffect(() => {
    return () => {
      const audio = audioRef.current;
      if (audio && Number.isFinite(audio.currentTime)) {
        emitProgress(audio.currentTime);
      }
    };
  }, [emitProgress]);

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
      setCurrentTime(seconds);
      currentTimeRef.current = seconds;
      
      // Throttle progress emissions (every 1 second or 0.75s change)
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      const timeSinceLastEmit = now - lastEmitTimestampRef.current;
      const timeDiff = Math.abs(seconds - lastEmittedSecondsRef.current);
      
      if (timeSinceLastEmit >= 1000 || timeDiff >= 0.75) {
        emitProgress(seconds);
        lastEmitTimestampRef.current = now;
        lastEmittedSecondsRef.current = seconds;
      }
    };

    const handleLoadedMetadata = () => {
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
      // Hook handles restoration via onTrackLoaded
      onTrackLoaded(audio);
      
      // Update current time from audio element
      const audioTime = audio.currentTime || 0;
      setCurrentTime(audioTime);
      currentTimeRef.current = audioTime;
      
      // If we just restored, emit progress to ensure parent state is updated
      // This is important for paused audio where timeupdate might not fire
      if (!isRestoring && audioTime > 0) {
        // Small delay to ensure restoration completed
        setTimeout(() => {
          emitProgress(audioTime);
        }, 50);
      }
    };
    
    const handleCanPlay = () => {
      // Only call onTrackLoaded if we loaded this track for restoration
      // This prevents double restoration (loadedmetadata already calls it)
      if (trackLoadedForRestorationRef.current) {
        // onTrackLoaded will check if restoration is needed and prevent double application
        onTrackLoaded(audio);
        // Clear the flag after attempting restoration
        trackLoadedForRestorationRef.current = false;
      } else {
        // After restoration completes or for normal playback, ensure progress is emitted
        const audioTime = audio.currentTime || 0;
        if (audioTime > 0) {
          emitProgress(audioTime);
        }
      }
    };

    const handleEnded = () => {
      const nextIndex = currentIndex + 1;
      if (nextIndex < tracks.length) {
        setCurrentIndex(nextIndex);
        setIsPlaying(true);
        isPlayingRef.current = true;
      } else {
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
  }, [currentIndex, tracks.length, isRestoring, restoreTime, onTrackLoaded, emitProgress]);

  const currentTrack = tracks[currentIndex];

  // Track if we've loaded a track for restoration to prevent resetting time after restoration
  const trackLoadedForRestorationRef = useRef(false);

  // Load track when currentIndex changes
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) {
      return;
    }

    const shouldAutoPlay = isPlayingRef.current;

    // Notify hook about track change
    onTrackChanged(currentTrack.id);

    // Reset the restoration flag when starting a new track load
    trackLoadedForRestorationRef.current = false;

    audio.pause();
    audio.src = currentTrack.url;
    audio.load();
    audio.playbackRate = playbackRate;
    
    // Reset duration while loading
    setDuration(0);
    
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
      audio
        .play()
        .then(() => {
          setIsPlaying(true);
        })
        .catch(() => {
          setIsPlaying(false);
          isPlayingRef.current = false;
        });
    }
  }, [currentTrack, playbackRate, onTrackChanged]);

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

    if (isPlayingRef.current) {
      audio.pause();
      emitProgress(audio.currentTime || currentTimeRef.current);
      setIsPlaying(false);
      isPlayingRef.current = false;
      return;
    }

    audio
      .play()
      .then(() => {
        setIsPlaying(true);
        isPlayingRef.current = true;
      })
      .catch(() => {
        setIsPlaying(false);
        isPlayingRef.current = false;
      });
  }, [currentTrack, emitProgress]);

  const playTrackAt = useCallback(
    (nextIndex: number) => {
      if (!tracks[nextIndex]) return;
      setCurrentIndex(nextIndex);
      setCurrentTime(0);
      setDuration(0);
      if (isPlayingRef.current) {
        const audio = audioRef.current;
        if (audio) {
          audio.pause();
          audio
            .play()
            .then(() => {
              setIsPlaying(true);
            })
            .catch(() => {
              setIsPlaying(false);
              isPlayingRef.current = false;
            });
        }
      }
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
      emitProgress(audio.currentTime);
    } else {
      // Even if audio isn't ready, emit current time from ref
      emitProgress(currentTimeRef.current);
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
  }, [emitProgress, onClose]);

  // Save progress when component becomes hidden (not just on unmount)
  const previousVisibleRef = useRef(isVisible);
  useEffect(() => {
    // When component transitions from visible to hidden, save progress
    if (previousVisibleRef.current && !isVisible && !isDismissing) {
      // Component became hidden - save progress
      const audio = audioRef.current;
      if (audio && Number.isFinite(audio.currentTime)) {
        emitProgress(audio.currentTime);
      } else if (currentTimeRef.current > 0) {
        emitProgress(currentTimeRef.current);
      }
    }
    previousVisibleRef.current = isVisible;
  }, [isVisible, isDismissing, emitProgress]);


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
        <div className="flex flex-row justify-between items-start gap-3">
          <div className="flex flex-col sm:flex-row items-center gap-3 min-w-0 flex-1">
            <div className="min-w-0 flex-1 w-full sm:w-auto">
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
          <span className="text-xs tabular-nums text-muted-foreground">
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
          <span className="text-xs tabular-nums text-muted-foreground">
            {formatTime(duration)}
          </span>
        </div>
      </div>
    </div>
  );
}

