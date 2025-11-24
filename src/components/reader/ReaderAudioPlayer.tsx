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
const PROGRESS_ECHO_TOLERANCE_SECONDS = 0.5;

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
  chromeVisible = true,
  onClose,
  autoScrollEnabled = true,
  onAutoScrollToggle,
}: ReaderAudioPlayerProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubTime, setScrubTime] = useState<number | null>(null);
  const [isDismissing, setIsDismissing] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const tracksRef = useRef<AudioTrack[]>(tracks);
  const currentIndexRef = useRef(0);
  const isPlayingRef = useRef(false);
  const pendingSeekRef = useRef<number | null>(null);
  const desiredSeekRef = useRef<number | null>(null);
  const userScrubbingRef = useRef(false);
  const currentTimeRef = useRef(0);
  const onProgressRef = useRef<ReaderAudioPlayerProps["onProgress"]>(undefined);
  const lastProgressSnapshotRef = useRef<{
    trackId?: string;
    trackHref?: string;
    trackIndex?: number;
    currentTimeSeconds?: number;
    updatedAt?: string;
    timestamp: number;
  }>({ timestamp: 0 });
  const lastAppliedAudioStateSignatureRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    onProgressRef.current = onProgress;
  }, [onProgress]);

  // Handle enter animation
  useEffect(() => {
    setIsDismissing(false);
    // Small delay to trigger CSS animation
    const timer = setTimeout(() => {
      setIsVisible(true);
    }, 10);
    return () => clearTimeout(timer);
  }, [bookId, tracks.length]);

  const normalizeSeekTarget = (value: number | null | undefined) => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return null;
    }
    return Math.max(value, 0);
  };

  const setDesiredSeek = useCallback((target: number | null | undefined) => {
    const normalized = normalizeSeekTarget(target);
    pendingSeekRef.current = normalized;
    desiredSeekRef.current = normalized;
  }, []);

  const applySeekTarget = useCallback((target: number | null) => {
    const audio = audioRef.current;
    if (!audio || typeof target !== "number") {
      return false;
    }
    try {
      audio.currentTime = target;
      const nextTime = audio.currentTime || target;
      setCurrentTime(nextTime);
      currentTimeRef.current = nextTime;
      return true;
    } catch {
      return false;
    }
  }, []);

  const applyPendingSeek = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) {
      return false;
    }
    if (pendingSeekRef.current === null) {
      return false;
    }
    const target = pendingSeekRef.current;
    const applied = applySeekTarget(target);
    if (applied) {
      pendingSeekRef.current = null;
    }
    return applied;
  }, [applySeekTarget]);

  const applyDesiredSeek = useCallback(() => {
    return applySeekTarget(desiredSeekRef.current);
  }, [applySeekTarget]);

  const emitProgressSnapshot = useCallback(
    (timeOverride?: number) => {
      const track = tracksRef.current[currentIndexRef.current];
      const listener = onProgressRef.current;
      if (!track || !listener) {
        return;
      }
      const candidateTime =
        typeof timeOverride === "number"
          ? timeOverride
          : (() => {
              const audio = audioRef.current;
              if (audio && Number.isFinite(audio.currentTime)) {
                return audio.currentTime;
              }
              return currentTimeRef.current;
            })();
      const normalizedSeconds = Number(Math.max(candidateTime, 0).toFixed(3));
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
    [],
  );

  const commitSeek = useCallback(
    (targetSeconds: number) => {
      const normalized = normalizeSeekTarget(targetSeconds);
      if (normalized === null) {
        return;
      }
      setDesiredSeek(normalized);
      const applied = applyDesiredSeek();
      if (!applied) {
        setCurrentTime(normalized);
        currentTimeRef.current = normalized;
      }
      emitProgressSnapshot(normalized);
    },
    [applyDesiredSeek, emitProgressSnapshot, setDesiredSeek],
  );

  useEffect(() => {
    return () => {
      emitProgressSnapshot();
    };
  }, [emitProgressSnapshot]);

  useEffect(() => {
    if (!bookId) {
      lastAppliedAudioStateSignatureRef.current = undefined;
      return;
    }

    const signatureComponents = [
      bookId,
      initialAudioState?.currentTrackId ?? "no-track",
      initialAudioState?.updatedAt ?? "no-updated-at",
      Number.isFinite(initialAudioState?.currentTimeSeconds)
        ? String(initialAudioState?.currentTimeSeconds)
        : "0",
      String(tracks.length),
    ];
    const signature = signatureComponents.join("|");
    if (lastAppliedAudioStateSignatureRef.current === signature) {
      return;
    }
    const snapshot = lastProgressSnapshotRef.current;
    // Ignore echoes from our own progress emissions so playback state stays stable while audio is running.
    const nextTrackIndex =
      typeof initialAudioState?.currentTrackIndex === "number" && Number.isFinite(initialAudioState.currentTrackIndex)
        ? initialAudioState.currentTrackIndex
        : undefined;
    const nextTimeSeconds =
      typeof initialAudioState?.currentTimeSeconds === "number" && Number.isFinite(initialAudioState.currentTimeSeconds)
        ? initialAudioState.currentTimeSeconds
        : undefined;
    const trackMatches =
      Boolean(snapshot.trackId && snapshot.trackId === initialAudioState?.currentTrackId) ||
      Boolean(snapshot.trackHref && snapshot.trackHref === initialAudioState?.currentTrackHref) ||
      (typeof snapshot.trackIndex === "number" &&
        typeof nextTrackIndex === "number" &&
        snapshot.trackIndex === nextTrackIndex);
    const isProgressEcho =
      trackMatches &&
      ((snapshot.updatedAt && snapshot.updatedAt === initialAudioState?.updatedAt) ||
        (typeof snapshot.currentTimeSeconds === "number" &&
          typeof nextTimeSeconds === "number" &&
          Math.abs(snapshot.currentTimeSeconds - nextTimeSeconds) <= PROGRESS_ECHO_TOLERANCE_SECONDS));
    if (isProgressEcho) {
      lastAppliedAudioStateSignatureRef.current = signature;
      return;
    }
    lastAppliedAudioStateSignatureRef.current = signature;

    let nextIndex = 0;
    if (tracks.length) {
      const matchById =
        initialAudioState?.currentTrackId &&
        tracks.findIndex((track) => track.id === initialAudioState.currentTrackId);
      if (typeof matchById === "number" && matchById >= 0) {
        nextIndex = matchById;
      } else {
        const matchByHref =
          initialAudioState?.currentTrackHref &&
          tracks.findIndex((track) => track.href === initialAudioState.currentTrackHref);
        if (typeof matchByHref === "number" && matchByHref >= 0) {
          nextIndex = matchByHref;
        } else if (
          typeof initialAudioState?.currentTrackIndex === "number" &&
          Number.isFinite(initialAudioState.currentTrackIndex) &&
          initialAudioState.currentTrackIndex >= 0 &&
          initialAudioState.currentTrackIndex < tracks.length
        ) {
          nextIndex = initialAudioState.currentTrackIndex;
        }
      }
    }

    setCurrentIndex(nextIndex);
    currentIndexRef.current = nextIndex;
    const restoredTime =
      typeof initialAudioState?.currentTimeSeconds === "number" &&
      Number.isFinite(initialAudioState.currentTimeSeconds)
        ? Math.max(initialAudioState.currentTimeSeconds, 0)
        : 0;
    setDesiredSeek(restoredTime);
    setCurrentTime(restoredTime);
    currentTimeRef.current = restoredTime;
    setIsPlaying(false);
    isPlayingRef.current = false;
    lastProgressSnapshotRef.current = { timestamp: 0 };
  }, [bookId, initialAudioState, tracks, setDesiredSeek]);

  useEffect(() => {
    tracksRef.current = tracks;
    if (!tracks.length) {
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.src = "";
      }
      setCurrentIndex(0);
      currentIndexRef.current = 0;
      setIsPlaying(false);
      isPlayingRef.current = false;
      setCurrentTime(0);
      setDuration(0);
      return;
    }

    if (currentIndex >= tracks.length) {
      setCurrentIndex(0);
      currentIndexRef.current = 0;
    }
  }, [tracks, currentIndex]);

  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

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
      const track = tracksRef.current[currentIndexRef.current];
      const listener = onProgressRef.current;
      if (!track || !listener) {
        return;
      }
      const lastSnapshot = lastProgressSnapshotRef.current;
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      const shouldEmit =
        !lastSnapshot.trackId ||
        track.id !== lastSnapshot.trackId ||
        Math.abs((lastSnapshot.currentTimeSeconds ?? 0) - seconds) >= 0.75 ||
        now - lastSnapshot.timestamp >= 1000;
      if (shouldEmit) {
        emitProgressSnapshot(seconds);
      }
    };

    const handleLoadedMetadata = () => {
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
      if (!applyPendingSeek() && !applyDesiredSeek()) {
        const fallbackTime = audio.currentTime || 0;
        setCurrentTime(fallbackTime);
        currentTimeRef.current = fallbackTime;
      }
    };

    const handleEnded = () => {
      const nextIndex = currentIndexRef.current + 1;
      if (nextIndex < tracksRef.current.length) {
        setCurrentIndex(nextIndex);
        currentIndexRef.current = nextIndex;
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
    audio.addEventListener("ended", handleEnded);

    return () => {
      audio.pause();
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("ended", handleEnded);
    };
  }, [applyDesiredSeek, applyPendingSeek]);

  const currentTrack = tracks[currentIndex];

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) {
      return;
    }

    const shouldAutoPlay = isPlayingRef.current;

    audio.pause();
    audio.src = currentTrack.url;
    audio.load();
    audio.playbackRate = playbackRate;
    const seekApplied = applyPendingSeek();
    if (!seekApplied) {
      audio.currentTime = 0;
      setCurrentTime(0);
      currentTimeRef.current = 0;
    }
    setDuration(0);

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
  }, [applyPendingSeek, currentTrack]);

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
      emitProgressSnapshot();
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
  }, [currentTrack]);

  const playTrackAt = useCallback(
    (nextIndex: number) => {
      if (!tracks[nextIndex]) return;
      setCurrentIndex(nextIndex);
      currentIndexRef.current = nextIndex;
      setCurrentTime(0);
      setDuration(0);
      setDesiredSeek(null);
      lastProgressSnapshotRef.current = { timestamp: 0 };
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
    [setDesiredSeek, tracks],
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
    emitProgressSnapshot();
    setIsDismissing(true);
    setIsVisible(false);
    // Parent component will handle keeping component mounted during exit animation
    onClose?.();
  }, [emitProgressSnapshot, onClose]);


  if (!currentTrack) {
    return null;
  }

  return (
    <div
      className={cn(
        "pointer-events-none fixed inset-x-0 bottom-14 z-50 flex justify-center px-4 pb-6 sm:px-6 transition-all duration-200",
        !chromeVisible && "translate-y-12 ",
      )}
    >
      <div
        className={cn(
          "pointer-events-auto flex w-full max-w-xl flex-col gap-3 rounded-2xl border border-border bg-background/90 p-4 shadow-lg ring-1 ring-black/5 backdrop-blur transition-all duration-300 ease-out",
          !chromeVisible && "pointer-events-none",
          isVisible && !isDismissing
            ? "translate-y-0 opacity-100 scale-100"
            : "translate-y-full opacity-0 scale-95",
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
              {onAutoScrollToggle ? (
                <Button
                  variant={autoScrollEnabled ? "secondary" : "ghost"}
                  size="icon"
                  className="rounded-full"
                  onClick={() => onAutoScrollToggle(!autoScrollEnabled)}
                  aria-label={autoScrollEnabled ? "Disable auto-scroll" : "Enable auto-scroll"}
                  title={autoScrollEnabled ? "Auto-scroll enabled" : "Auto-scroll disabled"}
                >
                  <MoveVertical className="h-4 w-4" />
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

