import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, SkipBack, SkipForward } from "lucide-react";

import type { AudioTrack, BookAudioState } from "../../types/reader";
import type { AudioProgressSnapshot } from "./types";
import { Button } from "../ui/button";
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

type ReaderAudioPlayerProps = {
  bookId?: string;
  tracks: AudioTrack[];
  bookTitle?: string;
  initialAudioState?: BookAudioState;
  onProgress?: (snapshot: AudioProgressSnapshot) => void;
  chromeVisible?: boolean;
};

export function ReaderAudioPlayer({
  bookId,
  tracks,
  bookTitle,
  initialAudioState,
  onProgress,
  chromeVisible = true,
}: ReaderAudioPlayerProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState<number>(1);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const tracksRef = useRef<AudioTrack[]>(tracks);
  const currentIndexRef = useRef(0);
  const isPlayingRef = useRef(false);
  const progressRef = useRef<HTMLDivElement | null>(null);
  const pendingSeekRef = useRef<number | null>(null);
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

  const applyPendingSeek = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) {
      return false;
    }
    if (pendingSeekRef.current === null) {
      return false;
    }
    const target = Math.max(pendingSeekRef.current, 0);
    try {
      audio.currentTime = target;
      pendingSeekRef.current = null;
      const nextTime = audio.currentTime || target;
      setCurrentTime(nextTime);
      currentTimeRef.current = nextTime;
      return true;
    } catch {
      return false;
    }
  }, []);

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
    pendingSeekRef.current = restoredTime;
    setCurrentTime(restoredTime);
    currentTimeRef.current = restoredTime;
    setIsPlaying(false);
    isPlayingRef.current = false;
    lastProgressSnapshotRef.current = { timestamp: 0 };
  }, [bookId, initialAudioState, tracks]);

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
      if (!applyPendingSeek()) {
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
  }, [applyPendingSeek]);

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
  }, [applyPendingSeek, currentTrack, playbackRate]);
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
      pendingSeekRef.current = null;
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
    [tracks],
  );

  const handlePrevious = useCallback(() => {
    if (currentIndex <= 0) {
      const audio = audioRef.current;
      if (audio) {
        audio.currentTime = 0;
        setCurrentTime(0);
        currentTimeRef.current = 0;
        pendingSeekRef.current = null;
        emitProgressSnapshot(0);
      }
      return;
    }
    playTrackAt(currentIndex - 1);
  }, [currentIndex, playTrackAt]);

  const handleNext = useCallback(() => {
    if (currentIndex + 1 >= tracks.length) {
      return;
    }
    playTrackAt(currentIndex + 1);
  }, [currentIndex, playTrackAt, tracks.length]);

  const progress = useMemo(() => {
    if (!duration) return 0;
    return Math.min(100, Math.max(0, (currentTime / duration) * 100));
  }, [currentTime, duration]);
  const handlePlaybackRateChange = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
    const nextRate = Number(event.target.value);
    if (!Number.isFinite(nextRate)) {
      return;
    }
    setPlaybackRate(nextRate);
  }, []);


  useEffect(() => {
    if (progressRef.current) {
      progressRef.current.style.width = `${progress}%`;
    }
  }, [progress]);

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
          "pointer-events-auto flex w-full max-w-xl flex-col gap-3 rounded-2xl border border-border bg-background/90 p-4 shadow-lg ring-1 ring-black/5 backdrop-blur",
          !chromeVisible && "pointer-events-none",
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{currentTrack.title}</p>
            {bookTitle ? (
              <p className="truncate text-xs text-muted-foreground">{bookTitle}</p>
            ) : null}
          </div>
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
            <span>Speed</span>
            <select
              aria-label="Playback speed"
              value={playbackRate.toString()}
              onChange={handlePlaybackRateChange}
              className="rounded-md border border-input bg-background px-2 py-1 text-xs font-medium text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {PLAYBACK_RATE_OPTIONS.map((rate) => (
                <option key={rate} value={rate.toString()}>
                  {rate % 1 === 0 ? `${rate.toFixed(0)}x` : `${rate.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}x`}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs tabular-nums text-muted-foreground">
            {formatTime(currentTime)}
          </span>
          <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              ref={progressRef}
              className="absolute inset-y-0 left-0 rounded-full bg-primary transition-all"
            />
          </div>
          <span className="text-xs tabular-nums text-muted-foreground">
            {formatTime(duration)}
          </span>
        </div>
      </div>
    </div>
  );
}

