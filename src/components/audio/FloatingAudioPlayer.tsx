import { invoke } from "@tauri-apps/api/core";
import {
  FastForward,
  Link2,
  Loader2,
  Pause,
  Play,
  Rewind,
  SkipBack,
  SkipForward,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useAppContext } from "@/context/AppContext";
import { useAudioProgressContext } from "@/context/AudioProgressContext";
import { useAudioSyncContext } from "@/context/AudioSyncContext";
import { useChapterProgressContext } from "@/context/ChapterProgressContext";
import { useConversionState } from "@/context/ConversionStateContext";

import { logger } from "../../lib/logger";
import {
  shouldHoldLivePlayback,
  shouldResumeLiveAfterHold,
} from "../../lib/live-playback";
import { cn, formatTime } from "../../lib/utils";
import type { AudioTrack, Book } from "../../types/book";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Slider } from "../ui/slider";
import { AudioTracksButton, AudioTracksDrawer } from "./AudioTracksDrawer";

export function FloatingAudioPlayer() {
  const {
    audioRef,
    currentAudioTrack,
    setCurrentAudioTrack,
    isLoadingAudio,
    loadAudioTrack,
    closeAudioPlayer,
    calculateAudioProgress,
    saveAudioProgress,
    restoreAudioProgress,
    playbackRate,
    setPlaybackRate,
    livePlaybackRequestRef,
    queueLivePlaybackRequest,
    livePlaybackRequestVersion,
  } = useAudioProgressContext();
  const { library, setLibrary, currentBook, setCurrentBook } = useAppContext();
  const { loadChapterContent } = useChapterProgressContext();
  const {
    isConverting,
    convertingBookId,
    getCurrentConvertingChapter,
    refreshCurrentConvertingChapter,
    registerCallbacks,
  } = useConversionState();

  // Local state for UI updates (only this component re-renders)
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isTracksOpen, setIsTracksOpen] = useState(false);
  const [liveGeneratedDuration, setLiveGeneratedDuration] = useState(0);
  const playbackIntentRef = useRef(false);
  const isSwitchingFromLiveRef = useRef(false);
  const isRefreshingLiveSeekRef = useRef(false);
  const liveReloadRequestIdRef = useRef(0);
  const lastLiveBoundaryRefreshAtRef = useRef(0);
  const waitingForLiveChunksRef = useRef(false);
  const heldLiveTimeRef = useRef(0);
  const currentBookRef = useRef(currentBook);
  const currentAudioTrackRef = useRef(currentAudioTrack);
  const liveChapterIndexRef = useRef(-1);
  const { isSyncEnabled, toggleSync } = useAudioSyncContext();

  useEffect(() => {
    currentBookRef.current = currentBook;
  }, [currentBook]);

  useEffect(() => {
    currentAudioTrackRef.current = currentAudioTrack;
  }, [currentAudioTrack]);

  useEffect(() => {
    if (!currentBook) return;

    const completedChapters = currentBook.completedChapters ?? [];
    const isConvertingThisBook =
      isConverting && convertingBookId === currentBook.id;
    const hasPartialConversion =
      currentBook.conversionStatus === "started" ||
      (completedChapters.length > 0 &&
        completedChapters.length < currentBook.chapters.length);

    if (!isConvertingThisBook && !hasPartialConversion) {
      return;
    }

    void refreshCurrentConvertingChapter(currentBook.id);
  }, [
    currentBook,
    convertingBookId,
    isConverting,
    refreshCurrentConvertingChapter,
  ]);

  const selectableTracks = useMemo(() => {
    if (!currentBook) return [];
    const completedChapters = currentBook.completedChapters ?? [];
    const isConvertingThisBook =
      isConverting && convertingBookId === currentBook.id;
    const hasPartialConversion =
      currentBook.conversionStatus === "started" ||
      (completedChapters.length > 0 &&
        completedChapters.length < currentBook.chapters.length);

    const tracks = [...currentBook.audioTracks];
    const existingChapterIndices = new Set<number>();

    for (const track of tracks) {
      if (track.order >= 0 && track.order < currentBook.chapters.length) {
        existingChapterIndices.add(track.order);
      }
    }

    const currentLiveTrackChapter =
      currentAudioTrack?.id?.startsWith(`live-${currentBook.id}-`) &&
      Number.isFinite(currentAudioTrack.order)
        ? currentAudioTrack.order
        : null;

    const firstMissingChapter =
      isConvertingThisBook || hasPartialConversion
        ? currentBook.chapters.findIndex((_, idx) => !existingChapterIndices.has(idx))
        : -1;

    const reportedConvertingChapter = getCurrentConvertingChapter(currentBook.id);
    const shouldFallbackToFirstMissing =
      reportedConvertingChapter !== null &&
      reportedConvertingChapter >= 0 &&
      existingChapterIndices.has(reportedConvertingChapter) &&
      firstMissingChapter >= 0;

    const activeConvertingChapter =
      (shouldFallbackToFirstMissing ? firstMissingChapter : reportedConvertingChapter) ??
      currentLiveTrackChapter ??
      firstMissingChapter;

    const normalizedActiveConvertingChapter =
      activeConvertingChapter >= 0 ? activeConvertingChapter : null;

    if (isConvertingThisBook || hasPartialConversion) {
      if (
        normalizedActiveConvertingChapter !== null &&
        normalizedActiveConvertingChapter < currentBook.chapters.length &&
        !existingChapterIndices.has(normalizedActiveConvertingChapter)
      ) {
        const chapter = currentBook.chapters[normalizedActiveConvertingChapter];
        tracks.push({
          id: `live-${currentBook.id}-${normalizedActiveConvertingChapter}`,
          bookId: currentBook.id,
          chapterHref: chapter.href,
          filePath: chapter.href,
          href: chapter.href,
          title: chapter.title || `Chapter ${normalizedActiveConvertingChapter + 1}`,
          order: normalizedActiveConvertingChapter,
        });
      }
    }

    if (currentAudioTrack) {
      const hasExactTrack = tracks.some(
        (track) => track.id === currentAudioTrack.id
      );

      const currentHref = currentAudioTrack.href || currentAudioTrack.filePath;
      const hasEquivalentChapterTrack = tracks.some((track) => {
        if (track.id?.startsWith(`live-${currentBook.id}-`)) {
          return false;
        }
        const trackHref = track.href || track.filePath;
        const sameHref = Boolean(currentHref && trackHref && currentHref === trackHref);
        const sameOrder = track.order === currentAudioTrack.order;
        const sameChapterHref =
          Boolean(currentAudioTrack.chapterHref) &&
          track.chapterHref === currentAudioTrack.chapterHref;
        return sameHref || sameOrder || sameChapterHref;
      });

      // Keep an in-progress live track visible only until a completed equivalent exists.
      if (!hasExactTrack && !hasEquivalentChapterTrack) {
        tracks.push({
          id: currentAudioTrack.id,
          bookId: currentAudioTrack.bookId,
          chapterHref: currentAudioTrack.chapterHref,
          filePath: currentAudioTrack.filePath,
          href: currentAudioTrack.href,
          title: currentAudioTrack.title,
          duration: currentAudioTrack.duration,
          fileSizeBytes: currentAudioTrack.fileSizeBytes,
          order: currentAudioTrack.order,
        });
      }
    }

    return tracks.sort((a, b) => a.order - b.order);
  }, [
    currentBook,
    currentAudioTrack,
    convertingBookId,
    getCurrentConvertingChapter,
    isConverting,
  ]);

  useEffect(() => {
    if (!currentBook) {
      return;
    }

    const currentTrackHref = currentAudioTrack?.href || currentAudioTrack?.filePath;
    const currentInList = currentAudioTrack
      ? selectableTracks.some((track) => track.id === currentAudioTrack.id)
      : false;

    logger.info("[floating-player] selectable tracks recalculated", {
      bookId: currentBook.id,
      totalTracks: selectableTracks.length,
      currentTrackId: currentAudioTrack?.id,
      currentTrackOrder: currentAudioTrack?.order,
      currentTrackHref,
      currentTrackIsLive: currentAudioTrack?.isLiveStream,
      currentTrackInList: currentInList,
      selectedTrackIds: selectableTracks.map((track) => track.id),
    });
  }, [currentAudioTrack, currentBook, selectableTracks]);

  const statusBadge = useMemo(() => {
    if (!currentBook) return null;

    const completedChapters = currentBook.completedChapters ?? [];
    const isConvertingThisBook = isConverting && convertingBookId === currentBook.id;
    const hasPartialConversion =
      currentBook.conversionStatus === "started" ||
      (completedChapters.length > 0 &&
        completedChapters.length < currentBook.chapters.length);

    if (!isConvertingThisBook && !hasPartialConversion) {
      return null;
    }

    return {
      text: isConvertingThisBook ? "Live" : "Paused",
      className: isConvertingThisBook
        ? "bg-amber-500 text-amber-950 hover:bg-amber-500"
        : "bg-sky-600 text-sky-50 hover:bg-sky-600",
    };
  }, [currentBook, convertingBookId, isConverting]);

  useEffect(() => {
    const unregister = registerCallbacks({
      onChapterCompleted: async (bookId) => {
        if (!bookId) {
          return;
        }

        try {
          const updatedBook = await invoke<Book | null>("read_one_book", {
            bookId,
          });

          if (!updatedBook) {
            return;
          }

          const audioState =
            currentAudioTrack?.bookId === updatedBook.id
              ? calculateAudioProgress()
              : null;

          const refreshedBook = audioState
            ? { ...updatedBook, audioState }
            : updatedBook;

          setLibrary((prevBooks) =>
            prevBooks.map((book) =>
              book.id === refreshedBook.id ? refreshedBook : book
            )
          );

          if (currentBook?.id === refreshedBook.id) {
            setCurrentBook(refreshedBook);
          }
        } catch (err) {
          logger.warn(
            "Failed to refresh audio tracks after chapter completion:",
            err
          );
        }
      },
    });

    return unregister;
  }, [
    calculateAudioProgress,
    currentAudioTrack?.bookId,
    currentBook?.id,
    registerCallbacks,
    setCurrentBook,
    setLibrary,
  ]);

  const currentTrackPosition = useMemo(() => {
    if (!currentAudioTrack) return -1;
    return selectableTracks.findIndex((track) => track.id === currentAudioTrack.id);
  }, [currentAudioTrack, selectableTracks]);

  // Update UI state from audio element (throttled to reduce re-renders)
  useEffect(() => {
    if (!audioRef.current || !currentAudioTrack) return;

    // Update on interval (throttled to ~10fps for smooth UI)
    const updateState = () => {
      if (audioRef.current) {
        setCurrentTime(audioRef.current.currentTime);
        const nextDuration = audioRef.current.duration;
        setDuration(
          Number.isFinite(nextDuration) && nextDuration > 0 ? nextDuration : 0
        );
        setIsPlaying(!audioRef.current.paused);
      }
    };

    const timeoutId = setTimeout(updateState, 0);
    const interval = setInterval(updateState, 100);

    const audio = audioRef.current;
    const handleTimeUpdate = () => setCurrentTime(audio.currentTime);
    const handleLoadedMetadata = () => {
      const nextDuration = audio.duration;
      setDuration(
        Number.isFinite(nextDuration) && nextDuration > 0 ? nextDuration : 0
      );
    };
    const handlePlay = () => {
      playbackIntentRef.current = true;
      waitingForLiveChunksRef.current = false;
      setIsPlaying(true);
    };
    const handlePause = async () => {
      setIsPlaying(false);
      if (
        currentBook &&
        currentAudioTrack &&
        !Number.isNaN(audio.currentTime) &&
        audio.currentTime > 0
      ) {
        saveAudioProgress(currentBook);
      }
    };
    const handleEnded = async () => {
      const isLive = Boolean(currentAudioTrack?.isLiveStream);
      const liveHref = currentAudioTrack?.chapterHref;
      const chapterCompleted = Boolean(
        liveHref && (currentBook?.completedChapters ?? []).includes(liveHref)
      );
      if (
        shouldHoldLivePlayback({
          isLiveStream: isLive,
          chapterCompleted,
          generatedDuration: liveGeneratedDuration,
          currentTime: audio.currentTime,
        })
      ) {
        waitingForLiveChunksRef.current = playbackIntentRef.current;
        heldLiveTimeRef.current = Number.isFinite(audio.currentTime)
          ? audio.currentTime
          : 0;
        setIsPlaying(false);
        return;
      }

      waitingForLiveChunksRef.current = false;
      setIsPlaying(false);
      setCurrentTime(0);

      if (
        currentBook &&
        currentAudioTrack &&
        !Number.isNaN(audio.currentTime)
      ) {
        saveAudioProgress(currentBook);
      }

      if (
        currentBook &&
        currentTrackPosition >= 0 &&
        currentTrackPosition < selectableTracks.length - 1
      ) {
        playbackIntentRef.current = true;
        const nextTrack = selectableTracks[currentTrackPosition + 1];
          const isLiveNextTrack = Boolean(nextTrack.id?.startsWith('live-'));
          if (isLiveNextTrack) {
            queueLivePlaybackRequest(0, true);
          }
          await loadAudioTrack(currentBook.id, nextTrack, currentBook);
          if (!isLiveNextTrack) {
            restoreAudioProgress(currentBook, nextTrack, true);
          }
        } else {
          playbackIntentRef.current = false;
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
    currentBook,
    currentTrackPosition,
    selectableTracks,
    loadAudioTrack,
    queueLivePlaybackRequest,
    saveAudioProgress,
    restoreAudioProgress,
    currentAudioTrack,
    liveGeneratedDuration,
  ]);

  // Auto-save progress every 2 seconds
  useEffect(() => {
    if (!currentBook || !currentAudioTrack || !audioRef.current) return;

    const saveProgressInterval = setInterval(() => {
      if (
        audioRef.current &&
        currentAudioTrack &&
        !Number.isNaN(audioRef.current.currentTime) &&
        audioRef.current.currentTime > 0
      ) {
        saveAudioProgress(currentBook);
      }
    }, 2000);

    return () => {
      clearInterval(saveProgressInterval);
    };
  }, [currentBook, currentAudioTrack, audioRef, saveAudioProgress]);

  const hasNextTrack = useMemo(
    () => currentTrackPosition >= 0 && currentTrackPosition < selectableTracks.length - 1,
    [currentTrackPosition, selectableTracks.length]
  );
  const hasPreviousTrack = useMemo(
    () => currentTrackPosition > 0,
    [currentTrackPosition]
  );

  const switchToTrack = useCallback(
    async (track: AudioTrack) => {
      if (!currentBook) return;

      if (
        audioRef.current &&
        currentAudioTrack &&
        !Number.isNaN(audioRef.current.currentTime)
      ) {
        saveAudioProgress(currentBook);
      }

      const shouldResumePlayback = playbackIntentRef.current;
      if (audioRef.current) {
        audioRef.current.pause();
      }

      const isLiveTrack = Boolean(track.id?.startsWith('live-'));
      if (isLiveTrack) {
        const savedState = currentBook.audioState;
        const trackHref = track.href || track.filePath;
        const savedTrackMatches = Boolean(
          savedState &&
            (
              savedState.currentTrackId === track.id ||
              (savedState.currentTrackHref &&
                trackHref &&
                savedState.currentTrackHref === trackHref) ||
              (savedState.currentTrackIndex !== undefined &&
                savedState.currentTrackIndex === track.order)
            )
        );

        queueLivePlaybackRequest(
          savedTrackMatches ? Math.max(0, savedState?.currentTimeSeconds ?? 0) : 0,
          shouldResumePlayback
        );
      }

      await loadAudioTrack(currentBook.id, track, currentBook);

      if (!isLiveTrack) {
        restoreAudioProgress(currentBook, track, shouldResumePlayback);
      }
    },
    [
      audioRef,
      currentAudioTrack,
      currentBook,
      loadAudioTrack,
      restoreAudioProgress,
      saveAudioProgress,
      queueLivePlaybackRequest,
    ]
  );

  const handlePlayPause = useCallback(async () => {
    if (!audioRef.current) return;

    if (isPlaying) {
      playbackIntentRef.current = false;
      audioRef.current.pause();
    } else {
      try {
        playbackIntentRef.current = true;
        await audioRef.current.play();
      } catch (err) {
        playbackIntentRef.current = false;
        logger.error("Failed to play audio:", err);
      }
    }
  }, [audioRef, isPlaying]);

  const isLiveStream = useMemo(
    () => Boolean(currentAudioTrack?.isLiveStream),
    [currentAudioTrack]
  );

  const liveChapterCompleted = useMemo(() => {
    if (!isLiveStream || !currentBook || !currentAudioTrack) {
      return false;
    }
    const href = currentAudioTrack.chapterHref;
    return Boolean(href && (currentBook.completedChapters ?? []).includes(href));
  }, [currentAudioTrack, currentBook, isLiveStream]);

  const liveChapterIndex = useMemo(() => {
    if (!currentAudioTrack) {
      return -1;
    }

    return typeof currentAudioTrack.liveChapterIndex === "number"
      ? currentAudioTrack.liveChapterIndex
      : currentAudioTrack.order;
  }, [currentAudioTrack]);

  useEffect(() => {
    liveChapterIndexRef.current = liveChapterIndex;
  }, [liveChapterIndex]);

  const liveStreamSourceKey = useMemo(() => {
    if (!isLiveStream || !currentBook || !currentAudioTrack || liveChapterIndex < 0) {
      return null;
    }

    return `${currentBook.id}:${currentAudioTrack.id}:${liveChapterIndex}`;
  }, [currentAudioTrack, currentBook, isLiveStream, liveChapterIndex]);

  const liveWindow = useMemo(() => {
    const fallbackEnd = Math.max(currentTime, duration, 0);
    const audio = audioRef.current;

    if (!isLiveStream || !audio) {
      return { start: 0, end: fallbackEnd };
    }

    let start = 0;
    let end = fallbackEnd;

    let seekableStart: number | null = null;
    let seekableEnd: number | null = null;
    let bufferedStart: number | null = null;
    let bufferedEnd: number | null = null;

    if (audio.seekable.length > 0) {
      seekableStart = audio.seekable.start(0);
      seekableEnd = audio.seekable.end(audio.seekable.length - 1);
    }

    if (audio.buffered.length > 0) {
      bufferedStart = audio.buffered.start(0);
      bufferedEnd = audio.buffered.end(audio.buffered.length - 1);
    }

    const starts = [seekableStart, bufferedStart]
      .filter((value): value is number => value !== null)
      .filter((value) => Number.isFinite(value) && value >= 0);

    const ends = [seekableEnd, bufferedEnd, fallbackEnd]
      .filter((value): value is number => value !== null)
      .filter((value) => Number.isFinite(value));

    if (starts.length > 0) {
      start = Math.min(...starts);
    }

    if (ends.length > 0) {
      end = Math.max(...ends);
    }

    if (!Number.isFinite(start) || start < 0) {
      start = 0;
    }

    if (!Number.isFinite(end) || end < start) {
      end = fallbackEnd;
    }

    return { start, end };
  }, [audioRef, currentTime, duration, isLiveStream]);

  const timelineMin = useMemo(
    () => (isLiveStream ? Math.max(0, liveWindow.start) : 0),
    [isLiveStream, liveWindow.start]
  );

  const timelineMax = useMemo(
    () =>
      isLiveStream
        ? Math.max(liveWindow.end, currentTime, liveGeneratedDuration, 1)
        : duration || 100,
    [isLiveStream, liveWindow.end, currentTime, liveGeneratedDuration, duration]
  );

  const seekMin = useMemo(
    () => (isLiveStream ? Math.max(0, liveWindow.start) : timelineMin),
    [isLiveStream, liveWindow.start, timelineMin]
  );

  const seekMax = useMemo(
    () => (isLiveStream ? Math.max(seekMin, liveWindow.end) : timelineMax),
    [isLiveStream, liveWindow.end, seekMin, timelineMax]
  );

  useEffect(() => {
    if (!isLiveStream || !currentBook || !currentAudioTrack) {
      return;
    }

    const logLiveStatus = () => {
      const audio = audioRef.current;

      const seekableStart =
        audio && audio.seekable.length > 0 ? audio.seekable.start(0) : null;
      const seekableEnd =
        audio && audio.seekable.length > 0
          ? audio.seekable.end(audio.seekable.length - 1)
          : null;
      const bufferedStart =
        audio && audio.buffered.length > 0 ? audio.buffered.start(0) : null;
      const bufferedEnd =
        audio && audio.buffered.length > 0
          ? audio.buffered.end(audio.buffered.length - 1)
          : null;

      logger.info("[live-track-status]", {
        bookId: currentBook.id,
        trackId: currentAudioTrack.id,
        chapterIndex:
          typeof currentAudioTrack.liveChapterIndex === "number"
            ? currentAudioTrack.liveChapterIndex
            : currentAudioTrack.order,
        isLoadingAudio,
        isPlaying,
        currentTime,
        duration,
        liveGeneratedDuration,
        timelineMin,
        timelineMax,
        seekMin,
        seekMax,
        liveSourceMode: "native-stream",
        readyState: audio?.readyState ?? null,
        paused: audio?.paused ?? null,
        audioCurrentTime: audio?.currentTime ?? null,
        audioDuration: audio?.duration ?? null,
        seekableStart,
        seekableEnd,
        bufferedStart,
        bufferedEnd,
      });
    };

    logLiveStatus();
    const interval = setInterval(logLiveStatus, 1000);

    return () => {
      clearInterval(interval);
    };
  }, [
    audioRef,
    currentAudioTrack,
    currentBook,
    currentTime,
    duration,
    isLiveStream,
    isLoadingAudio,
    isPlaying,
    liveGeneratedDuration,
    seekMax,
    seekMin,
    timelineMax,
    timelineMin,
  ]);

  useEffect(() => {
    if (!isLiveStream || !currentBook || !currentAudioTrack) {
      setLiveGeneratedDuration(0);
      return;
    }

    const chapterIndex =
      typeof currentAudioTrack.liveChapterIndex === "number"
        ? currentAudioTrack.liveChapterIndex
        : currentAudioTrack.order;

    if (chapterIndex < 0) {
      setLiveGeneratedDuration(0);
      return;
    }

    let cancelled = false;

    const refreshLiveDuration = async () => {
      try {
        const nextDuration = await invoke<number>("get_live_chapter_duration", {
          bookId: currentBook.id,
          chapterIndex,
        });

        if (!cancelled && Number.isFinite(nextDuration) && nextDuration >= 0) {
          setLiveGeneratedDuration((prev) => Math.max(prev, nextDuration));
        }
      } catch (err) {
        if (!cancelled) {
          logger.warn("Failed to refresh live chapter duration:", err);
        }
      }
    };

    refreshLiveDuration();
    const interval = setInterval(refreshLiveDuration, 400);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isLiveStream, currentBook, currentAudioTrack]);

  useEffect(() => {
    if (!isLiveStream || !audioRef.current || !liveStreamSourceKey) {
      return;
    }

    const activeBook = currentBookRef.current;
    const activeTrack = currentAudioTrackRef.current;
    const activeChapterIndex = liveChapterIndexRef.current;

    if (!activeBook || !activeTrack || activeChapterIndex < 0) {
      return;
    }

    const savedState = activeBook.audioState;
    const trackHref = activeTrack.href || activeTrack.filePath;
    const savedTrackMatches = Boolean(
      savedState &&
        (
          savedState.currentTrackId === activeTrack.id ||
          (savedState.currentTrackHref &&
            trackHref &&
            savedState.currentTrackHref === trackHref) ||
          (savedState.currentTrackIndex !== undefined &&
            savedState.currentTrackIndex === activeChapterIndex)
        )
    );

    const bookId = activeBook.id;
    const chapterIndex = activeChapterIndex;
    const fallbackResumeTime = savedTrackMatches
      ? Math.max(0, savedState?.currentTimeSeconds ?? 0)
      : 0;
    const pendingPlaybackRequest = livePlaybackRequestRef.current;
    const resumeTime = Math.max(
      0,
      pendingPlaybackRequest.resumeTime,
      fallbackResumeTime
    );
    const wasPlaying = pendingPlaybackRequest.autoPlay;
    livePlaybackRequestRef.current = { resumeTime: 0, autoPlay: false };
    const requestId = ++liveReloadRequestIdRef.current;

    let cancelled = false;

    const applySeekAndPlayback = async () => {
      if (cancelled || requestId !== liveReloadRequestIdRef.current || !audioRef.current) {
        return;
      }

      const audioEl = audioRef.current;
      let minSeek = 0;
      let maxSeek = resumeTime;

      if (audioEl.seekable.length > 0) {
        minSeek = Math.max(0, audioEl.seekable.start(0));
        maxSeek = audioEl.seekable.end(audioEl.seekable.length - 1);
      } else if (Number.isFinite(audioEl.duration) && audioEl.duration > 0) {
        maxSeek = audioEl.duration;
      }

      const target = Math.max(minSeek, Math.min(resumeTime, maxSeek));

      if (Number.isFinite(target) && target >= 0) {
        try {
          audioEl.currentTime = target;
          setCurrentTime(target);
        } catch (err) {
          logger.warn("Failed to apply live seek target:", err);
        }
      }

      if (wasPlaying) {
        try {
          await audioEl.play();
        } catch (err) {
          logger.warn("Failed to play live stream:", err);
        }
      }
    };

    const loadLiveStream = async () => {
      try {
        const baseUrl = await invoke<string>("get_audio_live_stream_url", {
          bookId,
          chapterIndex,
        });

        if (cancelled || requestId !== liveReloadRequestIdRef.current || !audioRef.current) {
          return;
        }

        const cacheBustedUrl = `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}ts=${Date.now()}`;
        audioRef.current.pause();
        audioRef.current.playbackRate = playbackRate;

        const handleReady = () => {
          void applySeekAndPlayback();
        };

        audioRef.current.addEventListener("loadedmetadata", handleReady, {
          once: true,
        });
        audioRef.current.addEventListener("loadeddata", handleReady, {
          once: true,
        });
        audioRef.current.addEventListener("canplay", handleReady, {
          once: true,
        });

        audioRef.current.src = cacheBustedUrl;
        audioRef.current.load();

        // Try once immediately in case metadata is already available.
        void applySeekAndPlayback();
      } catch (err) {
        if (!cancelled) {
          logger.warn("Failed loading live stream URL:", err);
        }
      }
    };

    void loadLiveStream();

    return () => {
      cancelled = true;
    };
  }, [
    audioRef,
    isLiveStream,
    livePlaybackRequestRef,
    livePlaybackRequestVersion,
    playbackRate,
    liveStreamSourceKey,
  ]);

  const refreshLiveSourceAtTime = useCallback(
    async (requestedTime: number) => {
      if (!isLiveStream || !currentBook || !currentAudioTrack) {
        return;
      }

      if (isLoadingAudio || isSwitchingFromLiveRef.current || isRefreshingLiveSeekRef.current) {
        return;
      }

      isRefreshingLiveSeekRef.current = true;

      try {
        const shouldResumePlayback = playbackIntentRef.current;
        // Tell the MSE effect where to seek and whether to auto-play.
        queueLivePlaybackRequest(requestedTime, shouldResumePlayback);
        await loadAudioTrack(currentBook.id, currentAudioTrack, currentBook);
        // The live stream effect consumes the pending playback request.
      } catch (err) {
        logger.warn("Failed live source refresh for seek request:", err);
      } finally {
        isRefreshingLiveSeekRef.current = false;
      }
    },
    [
      currentAudioTrack,
      currentBook,
      isLiveStream,
      isLoadingAudio,
      loadAudioTrack,
      queueLivePlaybackRequest,
    ]
  );

  const maybeRefreshLiveAtBoundary = useCallback(
    (reason: "progress" | "waiting" | "stalled" | "ended") => {
      if (!isLiveStream || !currentBook || !currentAudioTrack || !audioRef.current) {
        return;
      }

      if (
        isLoadingAudio ||
        isSwitchingFromLiveRef.current ||
        isRefreshingLiveSeekRef.current ||
        !playbackIntentRef.current
      ) {
        return;
      }

      const audio = audioRef.current;
      const currentPosition = audio.currentTime;
      const seekableEnd =
        audio.seekable.length > 0
          ? audio.seekable.end(audio.seekable.length - 1)
          : null;

      if (!Number.isFinite(currentPosition)) {
        return;
      }

      const boundaryThreshold = 0.35;
      const hasFutureContent = timelineMax > seekMax + boundaryThreshold;
      const nearSeekableBoundary =
        seekableEnd !== null && currentPosition >= seekableEnd - boundaryThreshold;
      // On finite snapshots (iOS), `ended` should refresh whenever generated audio
      // has grown past what the current media element can play.
      const endedWithMoreAudio =
        reason === "ended" && liveGeneratedDuration > currentPosition + boundaryThreshold;

      if ((!hasFutureContent && !endedWithMoreAudio) || (!nearSeekableBoundary && reason !== "ended")) {
        return;
      }

      const now = Date.now();
      if (now - lastLiveBoundaryRefreshAtRef.current < 1500) {
        return;
      }

      lastLiveBoundaryRefreshAtRef.current = now;
      const requestedTime = Math.min(
        timelineMax,
        Math.max(currentPosition, seekableEnd ?? currentPosition)
      );

      logger.info("[live-track-boundary-refresh]", {
        reason,
        bookId: currentBook.id,
        trackId: currentAudioTrack.id,
        currentPosition,
        seekableEnd,
        seekMax,
        timelineMax,
        requestedTime,
      });

      void refreshLiveSourceAtTime(requestedTime);
    },
    [
      audioRef,
      currentAudioTrack,
      currentBook,
      isLiveStream,
      isLoadingAudio,
      liveGeneratedDuration,
      refreshLiveSourceAtTime,
      seekMax,
      timelineMax,
    ]
  );

  useEffect(() => {
    if (!isLiveStream || !audioRef.current) {
      return;
    }

    const audio = audioRef.current;
    const holdIfUnderrun = () => {
      if (
        !playbackIntentRef.current ||
        !shouldHoldLivePlayback({
          isLiveStream: true,
          chapterCompleted: liveChapterCompleted,
          generatedDuration: liveGeneratedDuration,
          currentTime: audio.currentTime,
        })
      ) {
        return;
      }
      waitingForLiveChunksRef.current = true;
      heldLiveTimeRef.current = Number.isFinite(audio.currentTime)
        ? audio.currentTime
        : 0;
    };
    const handleWaiting = () => {
      holdIfUnderrun();
      maybeRefreshLiveAtBoundary("waiting");
    };
    const handleStalled = () => {
      holdIfUnderrun();
      maybeRefreshLiveAtBoundary("stalled");
    };
    const handleEnded = () => {
      holdIfUnderrun();
      maybeRefreshLiveAtBoundary("ended");
    };

    audio.addEventListener("waiting", handleWaiting);
    audio.addEventListener("stalled", handleStalled);
    audio.addEventListener("ended", handleEnded);

    const interval = setInterval(() => {
      maybeRefreshLiveAtBoundary("progress");
    }, 500);

    return () => {
      audio.removeEventListener("waiting", handleWaiting);
      audio.removeEventListener("stalled", handleStalled);
      audio.removeEventListener("ended", handleEnded);
      clearInterval(interval);
    };
  }, [audioRef, isLiveStream, liveChapterCompleted, liveGeneratedDuration, maybeRefreshLiveAtBoundary]);

  useEffect(() => {
    if (!isLiveStream || !waitingForLiveChunksRef.current) {
      return;
    }
    if (
      !shouldResumeLiveAfterHold({
        generatedDuration: liveGeneratedDuration,
        heldAtTime: heldLiveTimeRef.current,
      })
    ) {
      return;
    }
    const audio = audioRef.current;
    if (audio && !audio.paused && !audio.ended) {
      waitingForLiveChunksRef.current = false;
      return;
    }
    void refreshLiveSourceAtTime(heldLiveTimeRef.current);
  }, [audioRef, isLiveStream, liveGeneratedDuration, refreshLiveSourceAtTime]);

  const handleSeek = useCallback(
    (value: number[]) => {
      if (audioRef.current) {
        const requestedTime = Math.max(timelineMin, value[0]);

        if (
          isLiveStream &&
          (requestedTime > seekMax + 0.25 || seekMax <= seekMin + 0.05) &&
          requestedTime <= timelineMax
        ) {
          // Reload live stream at target time when the browser seekable window is stale.
          void refreshLiveSourceAtTime(requestedTime);
          return;
        }

        // On live streams, clamp to the browser seekable window to avoid invalid seeks.
        const nextTime = Math.min(seekMax, Math.max(seekMin, requestedTime));
        try {
          audioRef.current.currentTime = nextTime;
          setCurrentTime(nextTime);
        } catch (err) {
          logger.warn("Seek failed for current stream:", err);
        }
      }
    },
    [
      audioRef,
      isLiveStream,
      refreshLiveSourceAtTime,
      seekMax,
      seekMin,
      timelineMax,
      timelineMin,
    ]
  );

  const handleSkipBackward = useCallback(() => {
    if (audioRef.current) {
      const newTime = Math.max(timelineMin, audioRef.current.currentTime - 10);
      try {
        audioRef.current.currentTime = newTime;
        setCurrentTime(newTime);
      } catch (err) {
        logger.warn("Skip backward failed for current stream:", err);
      }
    }
  }, [audioRef]);

  const handleSkipForward = useCallback(() => {
    if (audioRef.current) {
      const maxTime = isLiveStream ? seekMax : audioRef.current.duration;
      const newTime = Math.min(maxTime, audioRef.current.currentTime + 10);
      try {
        audioRef.current.currentTime = newTime;
        setCurrentTime(newTime);
      } catch (err) {
        logger.warn("Skip forward failed for current stream:", err);
      }
    }
  }, [audioRef, isLiveStream, seekMax, timelineMin]);

  const handlePreviousTrack = useCallback(async () => {
    if (!hasPreviousTrack || currentTrackPosition <= 0) return;

    const previousTrack = selectableTracks[currentTrackPosition - 1];
    if (!previousTrack) return;

    await switchToTrack(previousTrack);
  }, [
    hasPreviousTrack,
    currentTrackPosition,
    selectableTracks,
    switchToTrack,
  ]);

  const handleNextTrack = useCallback(async () => {
    if (!hasNextTrack || currentTrackPosition < 0) return;

    const nextTrack = selectableTracks[currentTrackPosition + 1];
    if (!nextTrack) return;

    await switchToTrack(nextTrack);
  }, [
    currentTrackPosition,
    hasNextTrack,
    selectableTracks,
    switchToTrack,
  ]);

  const handleTrackSelect = useCallback(
    async (track: AudioTrack) => {
      await switchToTrack(track);
    },
    [switchToTrack]
  );

  const audioTrackTitle = useMemo(
    () => currentAudioTrack?.title || "Unknown Audio Track",
    [currentAudioTrack]
  );

  const showCurrentTrackStatusBadge = useMemo(() => {
    if (!statusBadge || !currentAudioTrack || !currentBook) {
      return false;
    }

    const isLiveTrack = Boolean(
      currentAudioTrack.isLiveStream ||
        currentAudioTrack.id?.startsWith(`live-${currentBook.id}-`)
    );
    if (!isLiveTrack) {
      return false;
    }

    // Hide Live once this chapter is completed / has a finished audio track.
    const chapterHref = currentAudioTrack.chapterHref;
    if (
      chapterHref &&
      (currentBook.completedChapters ?? []).includes(chapterHref)
    ) {
      return false;
    }

    const hasCompletedEquivalent = currentBook.audioTracks.some((track) => {
      if (track.id?.startsWith("live-")) return false;
      const trackHref = track.href || track.filePath;
      return (
        track.id === currentAudioTrack.id ||
        (Boolean(chapterHref) && track.chapterHref === chapterHref) ||
        track.order === currentAudioTrack.order ||
        Boolean(
          chapterHref &&
            trackHref &&
            (trackHref === currentAudioTrack.href ||
              trackHref === currentAudioTrack.filePath)
        )
      );
    });

    return !hasCompletedEquivalent;
  }, [currentAudioTrack, currentBook, statusBadge]);

  useEffect(() => {
    if (!currentBook || !currentAudioTrack || !currentAudioTrack.isLiveStream) {
      return;
    }
    const completedChapters = currentBook.completedChapters ?? [];

    if (isSwitchingFromLiveRef.current || isLoadingAudio) {
      return;
    }

    const liveChapterIndex =
      typeof currentAudioTrack.liveChapterIndex === "number"
        ? currentAudioTrack.liveChapterIndex
        : currentAudioTrack.order;

    const liveChapterHref =
      currentAudioTrack.chapterHref ||
      (liveChapterIndex >= 0 && liveChapterIndex < currentBook.chapters.length
        ? currentBook.chapters[liveChapterIndex].href
        : undefined);
    const completedChapter =
      currentBook.chapters.find((chapter) => chapter.href === liveChapterHref) ??
      (liveChapterIndex >= 0 && liveChapterIndex < currentBook.chapters.length
        ? currentBook.chapters[liveChapterIndex]
        : undefined);

    const chapterCompleted = Boolean(
      liveChapterHref && completedChapters.includes(liveChapterHref)
    );

    if (!chapterCompleted) {
      return;
    }

    let completedTrack = currentBook.audioTracks.find(
      (track) => track.chapterHref === liveChapterHref
    );

    if (!completedTrack && liveChapterHref && currentBook.audioSyncMap?.segments?.length) {
      const segmentForChapter = currentBook.audioSyncMap.segments.find(
        (segment) => segment.chapterHref === liveChapterHref
      );

      if (segmentForChapter) {
        completedTrack = currentBook.audioTracks.find((track) => {
          const trackHref = track.href || track.filePath;
          return trackHref === segmentForChapter.audioTrackHref;
        });
      }
    }

    if (!completedTrack && liveChapterIndex >= 0) {
      completedTrack = currentBook.audioTracks.find(
        (track) => track.order === liveChapterIndex
      );
    }

    if (!completedTrack) {
      return;
    }

    // Stuck live flags on an already-completed library track: clear them.
    if (
      completedTrack.id === currentAudioTrack.id &&
      currentAudioTrack.isLiveStream
    ) {
      setCurrentAudioTrack({
        ...currentAudioTrack,
        isLiveStream: false,
        liveChapterIndex: undefined,
      });
      return;
    }

    if (completedTrack.id === currentAudioTrack.id) {
      return;
    }

    const switchFromLive = async () => {
      isSwitchingFromLiveRef.current = true;
      try {
        const audio = audioRef.current;
        const resumeTime = Math.max(0, audio?.currentTime ?? 0);
        const shouldResumePlayback =
          playbackIntentRef.current || Boolean(audio && !audio.paused);

        // loadAudioTrack pauses the element; keep intent so we resume after.
        playbackIntentRef.current = shouldResumePlayback;

        if (completedChapter) {
          try {
            await loadChapterContent(currentBook.id, completedChapter);
          } catch (err) {
            logger.warn("Failed to refresh completed chapter content:", err);
          }
        }

        const trackHref = completedTrack.href || completedTrack.filePath;
        const bookWithResumeState: Book = {
          ...currentBook,
          audioState: {
            currentTrackId: completedTrack.id,
            currentTrackHref: trackHref,
            currentTrackIndex: completedTrack.order,
            currentTimeSeconds: resumeTime,
            updatedAt: new Date().toISOString(),
          },
        };

        await loadAudioTrack(
          currentBook.id,
          completedTrack,
          bookWithResumeState
        );

        restoreAudioProgress(
          bookWithResumeState,
          completedTrack,
          shouldResumePlayback
        );

        // Extra play attempt after metadata settles (restore may race load).
        if (shouldResumePlayback && audioRef.current) {
          const audioEl = audioRef.current;
          const resumePlay = async () => {
            try {
              if (audioEl.paused) {
                await audioEl.play();
              }
            } catch (err) {
              logger.warn("Failed to resume after live-to-normal switch:", err);
            }
          };

          if (audioEl.readyState >= 2) {
            await resumePlay();
          } else {
            await new Promise<void>((resolve) => {
              const onReady = () => {
                audioEl.removeEventListener("canplay", onReady);
                void resumePlay().finally(resolve);
              };
              audioEl.addEventListener("canplay", onReady, { once: true });
              // Don't hang if canplay never fires.
              setTimeout(() => {
                audioEl.removeEventListener("canplay", onReady);
                void resumePlay().finally(resolve);
              }, 2000);
            });
          }
        }
      } catch (err) {
        logger.error("Failed to switch from live track to completed track:", err);
      } finally {
        isSwitchingFromLiveRef.current = false;
      }
    };

    void switchFromLive();
  }, [
    audioRef,
    currentAudioTrack,
    currentBook,
    isLoadingAudio,
    loadChapterContent,
    loadAudioTrack,
    restoreAudioProgress,
    setCurrentAudioTrack,
  ]);

  if ((!currentBook || !currentAudioTrack) && !isLoadingAudio) {
    return null;
  }

  return (
    <div
      className={cn(
        "fixed bottom-20 left-1/2 -translate-x-1/2 z-50 select-none",
        "w-full max-w-2xl",
        "px-4",
        "transition-all duration-300"
      )}
    >
      <div className="bg-background/95 backdrop-blur-lg border rounded-lg shadow-lg space-y-3 p-4">
        <audio ref={audioRef} preload="auto">
          <track kind="captions" />
        </audio>
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-medium truncate">
                {currentBook?.title || "Unknown Book"}
              </p>
              {showCurrentTrackStatusBadge && statusBadge && (
                <Badge
                  variant="secondary"
                  className={cn(
                    "h-6 min-w-0 truncate text-[10px] uppercase",
                    statusBadge.className
                  )}
                >
                  <span className="min-w-0 truncate">{statusBadge.text}</span>
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground truncate">
              {audioTrackTitle}
            </p>
          </div>


          <Button
            variant={isSyncEnabled ? "secondary" : "ghost"}
            size="icon"
            className={cn(
              "h-10 w-10",
              isSyncEnabled && "bg-primary/10 hover:bg-primary/20"
            )}
            onClick={toggleSync}
            disabled={isLoadingAudio || !currentBook}
            title={isSyncEnabled ? "Disable text sync" : "Enable text sync"}
          >
            <Link2 className="h-5 w-5 shrink-0" />
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

          <AudioTracksButton
            onClick={() => setIsTracksOpen(true)}
            disabled={isLoadingAudio || !currentBook}
          />

          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={async () => {
              if (currentBook) {
                playbackIntentRef.current = false;
                const audioState = calculateAudioProgress();

                if (audioState) {
                  const updatedBook = {
                    ...currentBook,
                    audioState,
                  };
                  setCurrentBook(updatedBook);
                  setLibrary(
                    library.map((book) =>
                      book.id === currentBook.id ? updatedBook : book
                    )
                  );
                  await saveAudioProgress(updatedBook);
                }

                await closeAudioPlayer(currentBook);
              }
            }}
            title="Close audio player"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-2">
          <Slider
            value={[currentTime]}
            min={timelineMin}
            max={timelineMax}
            step={0.1}
            onValueChange={handleSeek}
            className="w-full"
            disabled={isLoadingAudio}
          />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(timelineMax)}</span>
          </div>
        </div>

        <div className="flex items-center justify-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10"
            onClick={handlePreviousTrack}
            disabled={!hasPreviousTrack || isLoadingAudio}
            title="Previous track"
          >
            <SkipBack className="h-5 w-5 shrink-0" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10"
            onClick={handleSkipBackward}
            disabled={isLoadingAudio}
            title="Skip backward 10 seconds"
          >
            <Rewind className="h-5 w-5 shrink-0" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-12 w-12 shrink-0"
            onClick={handlePlayPause}
            disabled={isLoadingAudio}
          >
            {isLoadingAudio ? (
              <Loader2 className="h-6 w-6 animate-spin shrink-0" />
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
            <FastForward className="h-5 w-5 shrink-0" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10"
            onClick={handleNextTrack}
            disabled={!hasNextTrack || isLoadingAudio}
            title="Next track"
          >
            <SkipForward className="h-5 w-5 shrink-0" />
          </Button>
        </div>
      </div>

      {currentBook && (
        <AudioTracksDrawer
          book={currentBook}
          currentTrackId={currentAudioTrack?.id ?? null}
          isOpen={isTracksOpen}
          onOpenChange={setIsTracksOpen}
          onTrackSelect={handleTrackSelect}
        />
      )}
    </div>
  );
}
