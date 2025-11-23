import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, SkipBack, SkipForward } from "lucide-react";

import type { AudioTrack } from "../../types/reader";
import { Button } from "../ui/button";

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

type ReaderAudioPlayerProps = {
  tracks: AudioTrack[];
  bookTitle?: string;
};

export function ReaderAudioPlayer({ tracks, bookTitle }: ReaderAudioPlayerProps) {
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
      setCurrentTime(audio.currentTime || 0);
    };

    const handleLoadedMetadata = () => {
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
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
  }, []);

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
    audio.currentTime = 0;
    audio.playbackRate = playbackRate;
    setCurrentTime(0);
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
  }, [currentTrack, playbackRate]);
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
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-6 sm:px-6">
      <div className="pointer-events-auto flex w-full max-w-xl flex-col gap-3 rounded-2xl border border-border bg-background/90 p-4 shadow-lg ring-1 ring-black/5 backdrop-blur">
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

