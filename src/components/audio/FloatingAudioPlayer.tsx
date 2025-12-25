import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FastForward,
  Loader2,
  Pause,
  Play,
  Rewind,
  SkipBack,
  SkipForward,
} from "lucide-react";

import { useAppContext } from "@/context/AppContext";
import { useAudioProgressContext } from "@/context/AudioProgressContext";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Slider } from "../ui/slider";

const formatTime = (seconds: number) => {
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return `${hours}:${mins}:${secs.toString().padStart(2, "0")}`;
};

export function FloatingAudioPlayer() {
  const { audioRef, currentAudioTrack, isLoadingAudio, loadAudioTrack } =
    useAudioProgressContext();

  // Local state for UI updates (only this component re-renders)
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const { currentBook } = useAppContext();

  // Get current audio track index (needed for event handlers)
  const currentTrackIndex = useMemo(
    () => currentAudioTrack?.order ?? -1,
    [currentAudioTrack]
  );

  // Update playback rate when it changes
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
    }
  }, [audioRef, playbackRate]);

  // Update UI state from audio element (throttled to reduce re-renders)
  useEffect(() => {
    if (!audioRef.current || !currentAudioTrack) return;

    // Update on interval (throttled to ~10fps for smooth UI)
    const updateState = () => {
      if (audioRef.current) {
        setCurrentTime(audioRef.current.currentTime);
        setDuration(audioRef.current.duration);
        setIsPlaying(!audioRef.current.paused);
      }
    };

    // Initial update (deferred to avoid linter warning)
    const timeoutId = setTimeout(updateState, 0);

    const interval = setInterval(updateState, 100);

    // Also listen to key events for immediate updates
    const audio = audioRef.current;
    const handleTimeUpdate = () => setCurrentTime(audio.currentTime);
    const handleLoadedMetadata = () => setDuration(audio.duration);
    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleEnded = async () => {
      setIsPlaying(false);
      setCurrentTime(0);

      // Auto-load next track if available
      if (currentBook && currentTrackIndex >= 0) {
        const nextIndex = currentTrackIndex + 1;
        if (nextIndex < currentBook.audioTracks.length) {
          const nextTrack = currentBook.audioTracks[nextIndex];
          if (nextTrack) {
            await loadAudioTrack(currentBook.id, nextTrack);
            // Auto-play the next track
            if (audioRef.current) {
              try {
                await audioRef.current.play();
              } catch (err) {
                console.error("Failed to auto-play next track:", err);
              }
            }
          }
        }
      }
    };

    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("ended", handleEnded);

    return () => {
      clearTimeout(timeoutId);
      clearInterval(interval);
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("ended", handleEnded);
    };
  }, [
    audioRef,
    currentAudioTrack,
    currentBook,
    currentTrackIndex,
    loadAudioTrack,
  ]);
  const hasNextTrack = useMemo(
    () =>
      currentBook &&
      currentTrackIndex >= 0 &&
      currentTrackIndex < currentBook.audioTracks.length - 1,
    [currentBook, currentTrackIndex]
  );
  const hasPreviousTrack = useMemo(
    () => currentBook && currentTrackIndex > 0,
    [currentBook, currentTrackIndex]
  );

  const handlePlayPause = useCallback(async () => {
    if (!audioRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
    } else {
      try {
        await audioRef.current.play();
      } catch (err) {
        console.error("Failed to play audio:", err);
      }
    }
  }, [audioRef, isPlaying]);

  const handleSeek = useCallback(
    (value: number[]) => {
      if (audioRef.current) {
        audioRef.current.currentTime = value[0];
        // Update immediately for responsive UI during drag
        setCurrentTime(value[0]);
      }
    },
    [audioRef]
  );

  const handleSkipBackward = useCallback(() => {
    if (audioRef.current) {
      const newTime = Math.max(0, audioRef.current.currentTime - 10);
      audioRef.current.currentTime = newTime;
      setCurrentTime(newTime);
    }
  }, [audioRef]);

  const handleSkipForward = useCallback(() => {
    if (audioRef.current) {
      const newTime = Math.min(
        audioRef.current.duration,
        audioRef.current.currentTime + 10
      );
      audioRef.current.currentTime = newTime;
      setCurrentTime(newTime);
    }
  }, [audioRef]);

  const handlePreviousTrack = useCallback(async () => {
    if (!currentBook || !hasPreviousTrack) return;

    const previousIndex = currentTrackIndex - 1;
    const previousTrack = currentBook.audioTracks[previousIndex];
    if (previousTrack) {
      // Save playing state before pausing
      const wasPlaying = audioRef.current && !audioRef.current.paused;
      if (audioRef.current) {
        audioRef.current.pause();
      }
      await loadAudioTrack(currentBook.id, previousTrack);
      // Resume playback if it was playing
      if (wasPlaying && audioRef.current) {
        try {
          await audioRef.current.play();
        } catch (err) {
          console.error("Failed to play previous track:", err);
        }
      }
    }
  }, [
    audioRef,
    currentBook,
    currentTrackIndex,
    hasPreviousTrack,
    loadAudioTrack,
  ]);

  const handleNextTrack = useCallback(async () => {
    if (!currentBook || !hasNextTrack) return;

    const nextIndex = currentTrackIndex + 1;
    const nextTrack = currentBook.audioTracks[nextIndex];
    if (nextTrack) {
      // Save playing state before pausing
      const wasPlaying = audioRef.current && !audioRef.current.paused;
      if (audioRef.current) {
        audioRef.current.pause();
      }
      await loadAudioTrack(currentBook.id, nextTrack);
      // Resume playback if it was playing
      if (wasPlaying && audioRef.current) {
        try {
          await audioRef.current.play();
        } catch (err) {
          console.error("Failed to play next track:", err);
        }
      }
    }
  }, [audioRef, currentBook, currentTrackIndex, hasNextTrack, loadAudioTrack]);

  // Get chapter title for current track
  const chapterTitle = useMemo(
    () =>
      currentBook?.chapters.find(
        (ch) => ch.href === currentAudioTrack?.chapterHref
      )?.title || "Unknown Chapter",
    [currentBook, currentAudioTrack]
  );

  if ((!currentBook || !currentAudioTrack) && !isLoadingAudio) {
    return null;
  }

  return (
    <div
      className={cn(
        "fixed bottom-20 left-1/2 -translate-x-1/2 z-50",
        "w-full max-w-2xl",
        "px-4",
        "transition-all duration-300"
      )}
    >
      <div className="bg-background/95 backdrop-blur-lg border rounded-lg shadow-lg space-y-3 p-4">
        <audio ref={audioRef} preload="metadata">
          <track kind="captions" />
        </audio>
        <div className="flex items-center gap-3">
          {/* Track Info */}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">
              {currentBook?.title || "Unknown Book"}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {chapterTitle}
            </p>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="space-y-2">
          <Slider
            value={[currentTime]}
            max={duration || 100}
            step={0.1}
            onValueChange={handleSeek}
            className="w-full"
            disabled={isLoadingAudio}
          />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10"
            onClick={handlePreviousTrack}
            disabled={!hasPreviousTrack || isLoadingAudio}
            title="Previous track"
          >
            <SkipBack className="h-5 w-5" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10"
            onClick={handleSkipBackward}
            disabled={isLoadingAudio}
            title="Skip backward 10 seconds"
          >
            <Rewind className="h-5 w-5" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-12 w-12"
            onClick={handlePlayPause}
            disabled={isLoadingAudio}
          >
            {isLoadingAudio ? (
              <Loader2 className="h-6 w-6 animate-spin" />
            ) : isPlaying ? (
              <Pause className="h-6 w-6" />
            ) : (
              <Play className="h-6 w-6" />
            )}
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10"
            onClick={handleSkipForward}
            disabled={isLoadingAudio}
            title="Skip forward 10 seconds"
          >
            <FastForward className="h-5 w-5" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10"
            onClick={handleNextTrack}
            disabled={!hasNextTrack || isLoadingAudio}
            title="Next track"
          >
            <SkipForward className="h-5 w-5" />
          </Button>

          <Select
            value={playbackRate.toString()}
            onValueChange={(value) => setPlaybackRate(Number.parseFloat(value))}
          >
            <SelectTrigger className="h-10 w-20">
              <SelectValue placeholder="1x" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0.5">0.5x</SelectItem>
              <SelectItem value="0.75">0.75x</SelectItem>
              <SelectItem value="1">1x</SelectItem>
              <SelectItem value="1.25">1.25x</SelectItem>
              <SelectItem value="1.5">1.5x</SelectItem>
              <SelectItem value="1.75">1.75x</SelectItem>
              <SelectItem value="2">2x</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
