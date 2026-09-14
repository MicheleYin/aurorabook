import {
  createContext,
  Dispatch,
  ReactNode,
  SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { getName } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";

import type {
  AudioTrack,
  AudioTrackWithData,
  Book,
  BookAudioState,
} from "../types/book";
import {
  clearMediaSession,
  createPlaybackEngine,
  type PlaybackEngine,
  type PlaybackEngineKind,
} from "../audio";
import {
  applyMediaPlaybackRate,
  mimeTypeFromTrackHref,
  trackDisplayTitle,
} from "../lib/audio-progress-utils";
import {
  audioTrackChapterIndex,
  completedAudioChapterIndices,
  resolveUnfinishedChapterIndex,
} from "../lib/book-audio-duration";
import { logger } from "../lib/logger";
import { normalizeBook } from "../lib/normalize-book";
import { useConversionState } from "./ConversionStateContext";
import { useSettingsContext } from "./SettingsContext";

export interface AudioProgressContextType {
  currentAudioTrack: AudioTrackWithData | null;
  setCurrentAudioTrack: Dispatch<SetStateAction<AudioTrackWithData | null>>;
  isLoadingAudio: boolean;
  setIsLoadingAudio: Dispatch<SetStateAction<boolean>>;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  blobUrlRef: React.RefObject<string | null>;
  /** True when native AVPlayer is the audible source (iOS). */
  isIosNativeAudio: boolean;
  /** Active engine kind once resolved. */
  playbackEngineKind: PlaybackEngineKind | null;
  /** Shared play/pause UI state (native-authoritative on iOS). */
  isPlaying: boolean;
  setIsPlaying: (playing: boolean) => void;
  /** Playback clock used by progress save + text sync (native on iOS). */
  getPlaybackTime: () => number;
  /** Whether audio is currently playing (AVPlayer on iOS, `<audio>` elsewhere). */
  isPlaybackActive: () => boolean;
  playAudio: () => Promise<void>;
  pauseAudio: () => Promise<void>;
  seekAudio: (seconds: number) => Promise<void>;
  loadLiveAudio: (options: {
    bookId: string;
    chapterIndex: number;
    title: string;
    artist: string;
    coverUrl?: string | null;
  }) => Promise<{ durationSeconds: number; byteLength: number }>;
  refreshLiveAudio: (
    bookId: string,
    chapterIndex: number
  ) => Promise<{ durationSeconds: number; byteLength: number }>;
  setExpectsMoreContent: (expectsMore: boolean) => Promise<void>;
  /** Mark native player load success; WebView stays muted / empty on iOS. */
  markIosNativeReady: (ready: boolean) => void;
  loadAudioTrack: (
    bookId: string,
    track: AudioTrack,
    book: Book
  ) => Promise<void>;
  loadLastOpenedAudioTrack: (book: Book, autoPlayAudio: boolean) => void;
  closeAudioPlayer: (
    book: Book,
    options?: { skipSave?: boolean }
  ) => Promise<void>;
  calculateAudioProgress: () => BookAudioState | null;
  saveAudioProgress: (book: Book) => Promise<void>;
  restoreAudioProgress: (
    book: Book,
    track: AudioTrack,
    autoPlayAudio: boolean
  ) => void;
  playbackRate: number;
  setPlaybackRate: (rate: number) => void;
  livePlaybackRequestRef: React.RefObject<{
    resumeTime: number;
    autoPlay: boolean;
  }>;
  queueLivePlaybackRequest: (resumeTime: number, autoPlay: boolean) => void;
  livePlaybackRequestVersion: number;
}

export const AudioProgressContext = createContext<
  AudioProgressContextType | undefined
>(undefined);

export function useAudioProgressContext() {
  const context = useContext(AudioProgressContext);
  if (!context) {
    throw new Error(
      "useAudioProgressContext must be used within AudioProgressProvider"
    );
  }
  return context;
}

interface AudioProgressProviderProps {
  readonly children: ReactNode;
}

function tryResumePlayback(
  el: HTMLAudioElement,
  savedTime: number,
  wasPlaying: boolean
) {
  el.currentTime = savedTime;
  if (wasPlaying) {
    el.play().catch((err: unknown) =>
      logger.warn("Could not auto-resume after server restart:", err)
    );
  }
}

export function AudioProgressProvider({
  children,
}: AudioProgressProviderProps) {
  const { getCurrentConvertingChapter, refreshCurrentConvertingChapter } =
    useConversionState();
  const {
    settings,
    isLoading: isLoadingSettings,
    saveSettings,
  } = useSettingsContext();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const engineRef = useRef<PlaybackEngine | null>(null);
  // Last known position from the native AVPlayer (updated by engine events).
  const nativeTimeRef = useRef<number>(0);
  /** True while AVPlayer reports playing (iOS). */
  const iosPlayingRef = useRef(false);
  /** True only after a successful ios_player_load / load_live. */
  const iosNativeReadyRef = useRef(false);
  const [isIosNativeAudio, setIsIosNativeAudio] = useState(false);
  const [playbackEngineKind, setPlaybackEngineKind] =
    useState<PlaybackEngineKind | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  // Whether we're running on iOS (set when the engine resolves).
  const isIosRef = useRef<boolean>(false);
  const livePlaybackRequestRef = useRef({
    resumeTime: 0,
    autoPlay: false,
  });
  const [currentAudioTrack, setCurrentAudioTrack] =
    useState<AudioTrackWithData | null>(null);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [livePlaybackRequestVersion, setLivePlaybackRequestVersion] =
    useState(0);
  const setPlayingState = useCallback((playing: boolean) => {
    iosPlayingRef.current = playing;
    setIsPlaying(playing);
  }, []);

  const getPlaybackTime = useCallback((): number => {
    const engine = engineRef.current;
    if (engine) {
      return Math.max(0, engine.getCurrentTime());
    }
    if (isIosRef.current) {
      const nativeTime = nativeTimeRef.current;
      return Number.isFinite(nativeTime) ? Math.max(0, nativeTime) : 0;
    }
    const webTime = audioRef.current?.currentTime ?? 0;
    return Number.isFinite(webTime) ? Math.max(0, webTime) : 0;
  }, []);

  const isPlaybackActive = useCallback((): boolean => {
    const engine = engineRef.current;
    if (engine) {
      return engine.isPlaying();
    }
    if (isIosRef.current) {
      return iosPlayingRef.current;
    }
    const el = audioRef.current;
    return Boolean(el && !el.paused && !el.ended);
  }, []);

  const playAudio = useCallback(async () => {
    const engine = engineRef.current;
    if (engine) {
      await engine.play();
      return;
    }
    await audioRef.current?.play();
  }, []);

  const pauseAudio = useCallback(async () => {
    const engine = engineRef.current;
    if (engine) {
      await engine.pause();
      return;
    }
    audioRef.current?.pause();
  }, []);

  const seekAudio = useCallback(async (seconds: number) => {
    const engine = engineRef.current;
    if (engine) {
      await engine.seek(seconds);
      nativeTimeRef.current = Math.max(0, seconds);
      return;
    }
    if (audioRef.current) {
      audioRef.current.currentTime = Math.max(0, seconds);
    }
  }, []);

  const loadLiveAudio = useCallback(
    async (options: {
      bookId: string;
      chapterIndex: number;
      title: string;
      artist: string;
      coverUrl?: string | null;
    }) => {
      const engine = engineRef.current;
      if (!engine?.loadLive) {
        throw new Error("Live load is not supported on this platform engine");
      }
      iosNativeReadyRef.current = true;
      return engine.loadLive(options);
    },
    []
  );

  const refreshLiveAudio = useCallback(
    async (bookId: string, chapterIndex: number) => {
      const engine = engineRef.current;
      if (!engine?.refreshLive) {
        throw new Error("Live refresh is not supported on this platform engine");
      }
      return engine.refreshLive(bookId, chapterIndex);
    },
    []
  );

  const setExpectsMoreContent = useCallback(async (expectsMore: boolean) => {
    await engineRef.current?.setExpectsMore?.(expectsMore);
  }, []);

  const calculateAudioProgress = useCallback((): BookAudioState | null => {
    if (!currentAudioTrack) return null;
    return {
      currentTrackId: currentAudioTrack.id,
      currentTrackHref:
        currentAudioTrack.href ?? currentAudioTrack.filePath,
      currentTrackIndex: currentAudioTrack.order,
      currentTimeSeconds: getPlaybackTime(),
      updatedAt: new Date().toISOString(),
    };
  }, [currentAudioTrack, getPlaybackTime]);
  const saveAudioProgress = useCallback(
    async (book: Book) => {
      const audioState = calculateAudioProgress();
      if (audioState) {
        try {
          await invoke("update_book_audio_state", {
            bookId: book.id,
            audioState,
          });
        } catch (err) {
          logger.error("Failed to save audio progress:", err);
          // Don't show toast for save errors to avoid spam
        }
      }
    },
    [calculateAudioProgress]
  );

  const handleSetPlaybackRate = useCallback(
    (rate: number) => {
      const nextRate = applyMediaPlaybackRate(
        audioRef.current ?? { playbackRate: 1, defaultPlaybackRate: 1 },
        rate
      );
      setPlaybackRate(nextRate);
      void saveSettings({ audioPlaybackSpeed: nextRate });
      void engineRef.current?.setRate(nextRate).catch(() => undefined);
    },
    [audioRef, saveSettings]
  );
  const queueLivePlaybackRequest = useCallback(
    (resumeTime: number, autoPlay: boolean) => {
      livePlaybackRequestRef.current = {
        resumeTime: Math.max(0, resumeTime),
        autoPlay,
      };
      setLivePlaybackRequestVersion((prev) => prev + 1);
    },
    []
  );

  const markIosNativeReady = useCallback((ready: boolean) => {
    iosNativeReadyRef.current = ready;
    // On iOS the WebView <audio> is visual-only — never audible, never loaded.
    if (audioRef.current && isIosRef.current) {
      audioRef.current.muted = true;
      audioRef.current.volume = 0;
      audioRef.current.removeAttribute("src");
      audioRef.current.load();
    }
  }, []);

  // When the streaming server restarts (desktop / WebView fallback only).
  // On iOS AVPlayer owns playback and does not use the local HTTP server.
  useEffect(() => {
    if (isIosNativeAudio) return;

    const currentTrackRef = { current: currentAudioTrack };
    currentTrackRef.current = currentAudioTrack;

    const unlisten = listen<number>("audio-server-restarted", async () => {
      const track = currentTrackRef.current;
      if (!track || !audioRef.current || track.isLiveStream) return;

      const el = audioRef.current;
      const savedTime = el.currentTime;
      const wasPlaying = !el.paused;

      try {
        const newUrl = await invoke<string>("get_audio_stream_url", {
          bookId: track.bookId,
          trackId: track.id,
        });

        el.src = newUrl;
        el.load();

        const onReady = () => {
          tryResumePlayback(el, savedTime, wasPlaying);
          el.removeEventListener("loadedmetadata", onReady);
        };
        el.addEventListener("loadedmetadata", onReady);
      } catch (err) {
        logger.error("Failed to reconnect audio after server restart:", err);
      }
    });

    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [currentAudioTrack, audioRef, isIosNativeAudio]);

  // Resolve platform playback engine once and subscribe to its events.
  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    void createPlaybackEngine(() => audioRef.current).then((engine) => {
      if (cancelled) {
        engine.destroy();
        return;
      }

      engineRef.current = engine;
      const isIos = engine.kind === "ios-native";
      isIosRef.current = isIos;
      setIsIosNativeAudio(isIos);
      setPlaybackEngineKind(engine.kind);

      if (isIos && audioRef.current) {
        audioRef.current.muted = true;
        audioRef.current.volume = 0;
      }

      unsubscribe = engine.subscribe((event) => {
        if (event.type === "play") {
          setPlayingState(true);
          window.dispatchEvent(
            new CustomEvent("aurora-native-ui", { detail: { type: "play" } })
          );
        } else if (event.type === "pause") {
          setPlayingState(false);
          window.dispatchEvent(
            new CustomEvent("aurora-native-ui", { detail: { type: "pause" } })
          );
        } else if (event.type === "timeUpdate") {
          nativeTimeRef.current = event.time;
          setPlayingState(true);
          window.dispatchEvent(
            new CustomEvent("aurora-native-ui", {
              detail: { type: "timeUpdate", time: event.time },
            })
          );
        } else if (event.type === "seek") {
          nativeTimeRef.current = event.time;
          window.dispatchEvent(
            new CustomEvent("aurora-native-ui", {
              detail: { type: "seek", time: event.time },
            })
          );
        } else if (event.type === "durationUpdate") {
          window.dispatchEvent(
            new CustomEvent("aurora-native-ui", {
              detail: { type: "durationUpdate", time: event.time },
            })
          );
        } else if (event.type === "ended") {
          setPlayingState(false);
          window.dispatchEvent(new CustomEvent("aurora-native-ended"));
          window.dispatchEvent(
            new CustomEvent("aurora-native-ui", { detail: { type: "ended" } })
          );
        } else if (event.type === "next") {
          window.dispatchEvent(
            new CustomEvent("aurora-native-skip", { detail: "next" })
          );
        } else if (event.type === "prev") {
          window.dispatchEvent(
            new CustomEvent("aurora-native-skip", { detail: "prev" })
          );
        }
      });
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
      engineRef.current?.destroy();
      engineRef.current = null;
    };
  }, [setPlayingState]);

  // Load playback speed from shared app settings
  useEffect(() => {
    if (isLoadingSettings || !settings?.audioPlaybackSpeed) return;

    setPlaybackRate(settings.audioPlaybackSpeed);
    if (audioRef.current) {
      applyMediaPlaybackRate(audioRef.current, settings.audioPlaybackSpeed);
    }
  }, [audioRef, isLoadingSettings, settings?.audioPlaybackSpeed]);
  const restoreAudioProgress = useCallback(
    (book: Book, track: AudioTrack, autoPlayAudio: boolean) => {
      const savedState = book.audioState;
      const savedTrackHref = savedState?.currentTrackHref;
      const savedTrackIndex = savedState?.currentTrackIndex;
      const trackHref = track.href || track.filePath;

      // Restore audio progress if this matches the last track by id, href, or chapter index.
      const isSameTrack = Boolean(
        savedState &&
          (
            savedState.currentTrackId === track.id ||
            (savedTrackHref && trackHref && savedTrackHref === trackHref) ||
            (savedTrackIndex !== undefined && savedTrackIndex === track.order)
          )
      );

      logger.info("[audio-restore] evaluating saved progress", {
        bookId: book.id,
        requestedTrackId: track.id,
        requestedTrackOrder: track.order,
        savedTrackId: savedState?.currentTrackId,
        savedTrackHref,
        savedTrackIndex,
        savedTime: savedState?.currentTimeSeconds,
        isSameTrack,
      });

      if (
        isSameTrack &&
        savedState?.currentTimeSeconds !== undefined
      ) {
        const savedTime = Math.max(0, savedState.currentTimeSeconds);
        nativeTimeRef.current = savedTime;

        if (isIosRef.current && iosNativeReadyRef.current) {
          logger.info("[audio-restore] seeking native player", {
            bookId: book.id,
            trackId: track.id,
            savedTime,
          });
          void seekAudio(savedTime);
        } else if (audioRef.current) {
          const applySavedTime = () => {
            if (!audioRef.current) return;

            const audio = audioRef.current;
            const hasFiniteDuration =
              Number.isFinite(audio.duration) && audio.duration > 0;
            const maxSeek = hasFiniteDuration ? audio.duration : savedTime;

            let minSeek = 0;
            if (audio.seekable.length > 0) {
              const seekableStart = audio.seekable.start(0);
              if (Number.isFinite(seekableStart) && seekableStart >= 0) {
                minSeek = seekableStart;
              }
            }

            const targetTime = Math.max(minSeek, Math.min(savedTime, maxSeek));

            logger.info("[audio-restore] applying saved timestamp", {
              bookId: book.id,
              trackId: track.id,
              savedTime,
              minSeek,
              maxSeek,
              targetTime,
              readyState: audio.readyState,
            });

            try {
              audio.currentTime = targetTime;
              window.dispatchEvent(
                new CustomEvent("aurora-native-ui", {
                  detail: { type: "seek", time: targetTime },
                })
              );
            } catch (err) {
              logger.warn("Failed restoring saved audio timestamp:", err);
            }
          };

          if (audioRef.current.readyState >= 1) {
            applySavedTime();
          } else {
            const handleAudioReady = () => {
              applySavedTime();
              audioRef.current?.removeEventListener(
                "loadedmetadata",
                handleAudioReady
              );
              audioRef.current?.removeEventListener(
                "loadeddata",
                handleAudioReady
              );
              audioRef.current?.removeEventListener(
                "canplay",
                handleAudioReady
              );
            };
            audioRef.current.addEventListener(
              "loadedmetadata",
              handleAudioReady
            );
            audioRef.current.addEventListener("loadeddata", handleAudioReady);
            audioRef.current.addEventListener("canplay", handleAudioReady);
          }
        }
      } else if (isIosRef.current && iosNativeReadyRef.current) {
        // Different track: start at 0 so the previous chapter's clock cannot stick.
        nativeTimeRef.current = 0;
        void seekAudio(0);
      }
      if (autoPlayAudio) {
        if (isIosRef.current && iosNativeReadyRef.current) {
          void playAudio();
        } else {
          audioRef.current?.play().catch(() => undefined);
        }
      }
    },
    [audioRef, playAudio, seekAudio]
  );

  const resolveTrackChapterIndex = useCallback((book: Book, track: AudioTrack) => {
    // Handle live track IDs (format: live-bookId-chapterIndex)
    if (track.id?.startsWith('live-')) {
      const parts = track.id.split('-');
      if (parts.length >= 3) {
        const chapterIndex = parseInt(parts[parts.length - 1], 10);
        if (!isNaN(chapterIndex) && chapterIndex >= 0 && chapterIndex < book.chapters.length) {
          return chapterIndex;
        }
      }
    }

    const trackHref = track.href || track.filePath;
    if (trackHref && book.audioSyncMap?.segments?.length) {
      const matchingSegment = book.audioSyncMap.segments.find(
        (segment) => segment.audioTrackHref === trackHref
      );
      if (matchingSegment) {
        const chapterIndex = book.chapters.findIndex(
          (chapter) => chapter.href === matchingSegment.chapterHref
        );
        if (chapterIndex >= 0) {
          return chapterIndex;
        }
      }
    }

    if (track.order >= 0 && track.order < book.chapters.length) {
      return track.order;
    }

    return null;
  }, []);

  const loadAudioTrack = useCallback(
    async (bookId: string, track: AudioTrack, book: Book) => {
      setIsLoadingAudio(true);
      // New track = new clock. Don't let the previous native position leak into UI/saves.
      nativeTimeRef.current = 0;
      try {
        const chapterIndex = resolveTrackChapterIndex(book, track);

        // Use conversion state first, then refresh from backend if missing.
        let currentConvertingChapter = getCurrentConvertingChapter(bookId);
        if (currentConvertingChapter === null) {
          currentConvertingChapter =
            await refreshCurrentConvertingChapter(bookId);
        }

        const isExplicitLiveTrack = Boolean(track.id?.startsWith("live-"));
        // A real completed audio track must never be treated as live, even if the
        // converting-chapter pointer still briefly points at this chapter index
        // (checkpoint deletion / next-chapter mark can lag chapter-completed).
        const isCompletedLibraryTrack =
          !isExplicitLiveTrack &&
          book.audioTracks.some((audioTrack) => audioTrack.id === track.id);
        const shouldUseLive =
          chapterIndex !== null &&
          !isCompletedLibraryTrack &&
          (isExplicitLiveTrack || currentConvertingChapter === chapterIndex);

        // Helper: set OS media controls metadata (desktop Media Session only).
        const setMediaSessionMetadata = () => {
          if (isIosRef.current) {
            clearMediaSession();
            return;
          }
          if (!("mediaSession" in navigator) || !book) return;
          const trackTitle = track.title || `Track ${track.order + 1}`;
          let chapterTitle: string | undefined;
          const trackHref = track.href || track.filePath;
          if (trackHref && book.audioSyncMap?.segments) {
            const matchingSegment = book.audioSyncMap.segments.find(
              (segment) => segment.audioTrackHref === trackHref
            );
            if (matchingSegment) {
              const chapter = book.chapters.find(
                (ch) => ch.href === matchingSegment.chapterHref
              );
              if (chapter) chapterTitle = chapter.title;
            }
          }
          const fullTrackTitle = chapterTitle
            ? `${trackTitle} - ${chapterTitle}`
            : trackTitle;
          const artwork: MediaImage[] = [];
          if (book.coverUrl) {
            artwork.push({ src: book.coverUrl, sizes: "512x512", type: "image/jpeg" });
          }
          getName()
            .then((appName) => {
              navigator.mediaSession.metadata = new MediaMetadata({
                title: fullTrackTitle,
                artist: book.author,
                album: `${book.title} - ${appName}`,
                artwork,
              });
            })
            .catch((err) => {
              logger.error("Failed to get app name:", err);
              navigator.mediaSession.metadata = new MediaMetadata({
                title: fullTrackTitle,
                artist: book.author,
                album: book.title,
                artwork,
              });
            });
        };

        if (shouldUseLive && chapterIndex !== null) {
          // Live track: the MSE effect in FloatingAudioPlayer owns all audio element
          // setup (src, load, seek, play). Just update track state here so the effect
          // is triggered. Pending live playback requests carry the desired seek
          // position and auto-play intent to the player effect.
          setCurrentAudioTrack({
            ...track,
            mimeType: "audio/mpeg",
            isLiveStream: true,
            liveChapterIndex: chapterIndex,
          });
          setMediaSessionMetadata();
          return;
        }

        // Non-live: iOS loads native AVPlayer only; desktop uses HTTP stream URL.
        if (isIosRef.current) {
          if (blobUrlRef.current) {
            URL.revokeObjectURL(blobUrlRef.current);
            blobUrlRef.current = null;
          }

          if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.removeAttribute("src");
            audioRef.current.load();
            audioRef.current.muted = true;
            audioRef.current.volume = 0;
            audioRef.current.currentTime = 0;
          }

          const mimeType = mimeTypeFromTrackHref(track.href);
          setCurrentAudioTrack({
            ...track,
            mimeType,
            isLiveStream: false,
            liveChapterIndex: undefined,
          });

          try {
            const engine = engineRef.current;
            if (!engine) {
              throw new Error("Playback engine not ready");
            }
            await engine.load({
              bookId,
              trackId: track.id,
              title: trackDisplayTitle(track.title, track.order),
              artist: book.author ?? "",
              duration: track.duration ?? 0,
              coverUrl: book.coverUrl ?? null,
              playbackRate,
            });
            iosNativeReadyRef.current = true;
            clearMediaSession();
          } catch (err: unknown) {
            iosNativeReadyRef.current = false;
            logger.error("ios native load failed:", err);
            toast.error("Failed to load audio on device");
            throw err;
          }

          setMediaSessionMetadata();
          return;
        }

        let streamUrl: string;
        try {
          streamUrl = await invoke<string>("get_audio_stream_url", {
            bookId,
            trackId: track.id,
          });
        } catch (streamErr) {
          // Fallback: chapter may have become live while loading (not a completed track).
          const retryCurrentChapter =
            await refreshCurrentConvertingChapter(bookId);
          if (
            chapterIndex !== null &&
            !isCompletedLibraryTrack &&
            retryCurrentChapter === chapterIndex
          ) {
            setCurrentAudioTrack({
              ...track,
              mimeType: "audio/mpeg",
              isLiveStream: true,
              liveChapterIndex: chapterIndex,
            });
            setMediaSessionMetadata();
            return;
          }
          throw streamErr;
        }

        if (streamUrl) {
          // Clean up previous blob URL (if any)
          if (blobUrlRef.current) {
            URL.revokeObjectURL(blobUrlRef.current);
            blobUrlRef.current = null;
          }

          const engine = engineRef.current;
          if (engine) {
            await engine.load({
              bookId,
              trackId: track.id,
              title: trackDisplayTitle(track.title, track.order),
              artist: book.author ?? "",
              duration: track.duration ?? 0,
              coverUrl: book.coverUrl ?? null,
              streamUrl,
              playbackRate,
            });
          } else if (audioRef.current) {
            const waitForAudioReady = () =>
              new Promise<void>((resolve) => {
                const audio = audioRef.current;
                if (!audio) {
                  resolve();
                  return;
                }

                let settled = false;
                const settle = () => {
                  if (settled) return;
                  settled = true;
                  audio.removeEventListener("loadedmetadata", settle);
                  audio.removeEventListener("loadeddata", settle);
                  audio.removeEventListener("canplay", settle);
                  audio.removeEventListener("canplaythrough", settle);
                  audio.removeEventListener("error", settle);
                  resolve();
                };

                const timeoutId = setTimeout(settle, 8000);
                const settleWithTimeoutClear = () => {
                  clearTimeout(timeoutId);
                  settle();
                };

                audio.addEventListener("loadedmetadata", settleWithTimeoutClear, { once: true });
                audio.addEventListener("loadeddata", settleWithTimeoutClear, { once: true });
                audio.addEventListener("canplay", settleWithTimeoutClear, { once: true });
                audio.addEventListener("canplaythrough", settleWithTimeoutClear, { once: true });
                audio.addEventListener("error", settleWithTimeoutClear, { once: true });
              });

            audioRef.current.src = streamUrl;
            audioRef.current.load();
            if (!audioRef.current.paused) {
              audioRef.current.pause();
            }
            audioRef.current.currentTime = 0;
            applyMediaPlaybackRate(audioRef.current, playbackRate);
            await waitForAudioReady();
          }

          const mimeType = mimeTypeFromTrackHref(track.href);

          setCurrentAudioTrack({
            ...track,
            mimeType,
            isLiveStream: false,
            liveChapterIndex: undefined,
          });

          setMediaSessionMetadata();
        }
      } catch (err) {
        logger.error("Failed to load audio track:", err);
        toast.error("Failed to load audio track");
      } finally {
        setIsLoadingAudio(false);
      }
    },
    [
      audioRef,
      getCurrentConvertingChapter,
      playbackRate,
      refreshCurrentConvertingChapter,
      resolveTrackChapterIndex,
    ]
  );

  const loadLastOpenedAudioTrack = useCallback(
    async (book: Book, autoPlayAudio: boolean) => {
      setIsLoadingAudio(true);
      let audioTrackToLoad: AudioTrack | null = null;
      // load from be
      const loadedBookRaw = await invoke<Book | null>("read_one_book", {
        bookId: book.id,
      });
      const loadedBook = loadedBookRaw ? normalizeBook(loadedBookRaw) : null;
      const bookForLoad = loadedBook || book;
      const savedState = loadedBook?.audioState;
      const audioTracks = bookForLoad.audioTracks ?? [];

      const buildLiveTrackForChapter = (
        chapterIndex: number
      ): AudioTrack | null => {
        const chapter = bookForLoad.chapters[chapterIndex];
        if (!chapter) return null;
        return {
          id: `live-${bookForLoad.id}-${chapterIndex}`,
          bookId: bookForLoad.id,
          chapterHref: chapter.href,
          filePath: chapter.href,
          href: chapter.href,
          title: chapter.title || `Chapter ${chapterIndex + 1}`,
          order: chapterIndex,
        };
      };

      const canAttemptLivePlayback = async (): Promise<{
        convertingChapter: number | null;
        allowed: boolean;
      }> => {
        let convertingChapter = getCurrentConvertingChapter(bookForLoad.id);
        if (convertingChapter === null) {
          convertingChapter =
            await refreshCurrentConvertingChapter(bookForLoad.id);
        }
        const allowed =
          bookForLoad.conversionStatus === "started" ||
          convertingChapter !== null ||
          (bookForLoad.completedChapters?.length ?? 0) > 0;
        return { convertingChapter, allowed };
      };

      /** Resolve a saved live chapter: completed track if ready, else live. */
      const resolveTrackForChapterIndex = async (
        chapterIndex: number
      ): Promise<AudioTrack | null> => {
        if (
          !Number.isInteger(chapterIndex) ||
          chapterIndex < 0 ||
          chapterIndex >= bookForLoad.chapters.length
        ) {
          return null;
        }

        const completedTrack =
          audioTracks.find(
            (track) =>
              audioTrackChapterIndex(track, bookForLoad) === chapterIndex
          ) ?? null;
        if (completedTrack) {
          return completedTrack;
        }

        const completedIndices = completedAudioChapterIndices(bookForLoad);
        if (completedIndices.has(chapterIndex)) {
          return null;
        }

        const { allowed } = await canAttemptLivePlayback();
        if (!allowed) {
          return null;
        }

        return buildLiveTrackForChapter(chapterIndex);
      };

      const openFirstAvailableTrack = async (): Promise<AudioTrack | null> => {
        if (audioTracks.length > 0) {
          return audioTracks[0];
        }

        const { convertingChapter, allowed } = await canAttemptLivePlayback();
        if (!allowed) {
          return null;
        }

        const unfinishedChapterIndex = resolveUnfinishedChapterIndex(
          bookForLoad,
          convertingChapter
        );
        if (unfinishedChapterIndex === null) {
          return null;
        }

        return buildLiveTrackForChapter(unfinishedChapterIndex);
      };

      // First open (no save data): always start on the first track.
      // Returning: restore last track + timestamp — including live chapters whose
      // conversion is still incomplete, even when earlier chapters are completed.
      if (savedState) {
        if (savedState.currentTrackId) {
          const savedTrackId = savedState.currentTrackId;
          if (savedTrackId.startsWith("live-")) {
            const parts = savedTrackId.split("-");
            const chapterIndex = parseInt(parts[parts.length - 1], 10);
            if (!Number.isNaN(chapterIndex)) {
              audioTrackToLoad =
                await resolveTrackForChapterIndex(chapterIndex);
            }
          } else {
            audioTrackToLoad =
              audioTracks.find((track) => track.id === savedTrackId) || null;
          }
        }

        if (!audioTrackToLoad && savedState.currentTrackHref) {
          const savedHref = savedState.currentTrackHref;
          audioTrackToLoad =
            audioTracks.find((track) => {
              const trackHref = track.href || track.filePath;
              return trackHref === savedHref;
            }) || null;

          if (!audioTrackToLoad) {
            const chapterIndex = bookForLoad.chapters.findIndex(
              (chapter) => chapter.href === savedHref
            );
            if (chapterIndex >= 0) {
              audioTrackToLoad =
                await resolveTrackForChapterIndex(chapterIndex);
            }
          }
        }

        if (
          !audioTrackToLoad &&
          savedState.currentTrackIndex !== undefined
        ) {
          const savedTrackIndex = savedState.currentTrackIndex;
          audioTrackToLoad =
            audioTracks.find((track) => track.order === savedTrackIndex) ||
            null;

          if (!audioTrackToLoad) {
            audioTrackToLoad =
              await resolveTrackForChapterIndex(savedTrackIndex);
          }
        }

        if (!audioTrackToLoad) {
          audioTrackToLoad = await openFirstAvailableTrack();
        }
      } else {
        audioTrackToLoad = await openFirstAvailableTrack();
      }

      if (audioTrackToLoad) {
        logger.info("[audio-load-last] resolved track to load", {
          requestedBookId: book.id,
          loadedBookId: loadedBook?.id,
          trackId: audioTrackToLoad.id,
          trackOrder: audioTrackToLoad.order,
          trackHref: audioTrackToLoad.href || audioTrackToLoad.filePath,
          savedState: loadedBook?.audioState,
        });
        const isLiveTrack = Boolean(audioTrackToLoad.id?.startsWith("live-"));
        if (isLiveTrack) {
          // Queue the desired resume time and auto-play intent for the live stream
          // effect before switching the current track.
          queueLivePlaybackRequest(
            savedState?.currentTimeSeconds ?? 0,
            autoPlayAudio
          );
        }
        await loadAudioTrack(book.id, audioTrackToLoad, bookForLoad);
        if (!isLiveTrack) {
          restoreAudioProgress(bookForLoad, audioTrackToLoad, autoPlayAudio);
        }
        logger.log("loaded last opened audio track", audioTrackToLoad, book);
      } else {
        // Clear previous playback state when switching to a book with no audio.
        if (audioRef.current) {
          audioRef.current.pause();
          audioRef.current.currentTime = 0;
          audioRef.current.src = "";
        }

        if (blobUrlRef.current) {
          URL.revokeObjectURL(blobUrlRef.current);
          blobUrlRef.current = null;
        }

        setCurrentAudioTrack(null);

        if ("mediaSession" in navigator) {
          navigator.mediaSession.metadata = null;
        }
      }
      setIsLoadingAudio(false);
    },

    [
      getCurrentConvertingChapter,
      loadAudioTrack,
      queueLivePlaybackRequest,
      refreshCurrentConvertingChapter,
      restoreAudioProgress,
    ]
  );

  const closeAudioPlayer = useCallback(
    async (book: Book, options?: { skipSave?: boolean }) => {
      // Save progress before closing if we have a track and book
      if (!options?.skipSave && currentAudioTrack) {
        try {
          await saveAudioProgress(book);
        } catch (err) {
          logger.warn("Failed to save audio progress while closing player:", err);
        }
      }

      if (isIosRef.current) {
        void pauseAudio();
        void engineRef.current?.setExpectsMore?.(false).catch(() => undefined);
      }

      // Stop WebView playback (desktop) / clear visual element (iOS)
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
        audioRef.current.removeAttribute("src");
        audioRef.current.load();
        if (isIosRef.current) {
          audioRef.current.muted = true;
          audioRef.current.volume = 0;
        } else {
          audioRef.current.muted = false;
          audioRef.current.volume = 1;
        }
      }
      iosNativeReadyRef.current = false;
      nativeTimeRef.current = 0;
      setPlayingState(false);

      // Clean up blob URL
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }

      // Clear current track
      setCurrentAudioTrack(null);

      // Clear MediaSession metadata + handlers
      clearMediaSession();
    },
    [currentAudioTrack, pauseAudio, saveAudioProgress, setPlayingState]
  );

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, []);

  const contextValue = useMemo(
    () => ({
      currentAudioTrack,
      setCurrentAudioTrack,
      isLoadingAudio,
      setIsLoadingAudio,
      audioRef,
      blobUrlRef,
      isIosNativeAudio,
      playbackEngineKind,
      isPlaying,
      setIsPlaying: setPlayingState,
      getPlaybackTime,
      isPlaybackActive,
      playAudio,
      pauseAudio,
      seekAudio,
      loadLiveAudio,
      refreshLiveAudio,
      setExpectsMoreContent,
      markIosNativeReady,
      loadAudioTrack,
      loadLastOpenedAudioTrack,
      closeAudioPlayer,
      saveAudioProgress,
      restoreAudioProgress,
      calculateAudioProgress,
      playbackRate,
      setPlaybackRate: handleSetPlaybackRate,
      livePlaybackRequestRef,
      queueLivePlaybackRequest,
      livePlaybackRequestVersion,
    }),
    [
      currentAudioTrack,
      isLoadingAudio,
      isIosNativeAudio,
      playbackEngineKind,
      isPlaying,
      setPlayingState,
      getPlaybackTime,
      isPlaybackActive,
      playAudio,
      pauseAudio,
      seekAudio,
      loadLiveAudio,
      refreshLiveAudio,
      setExpectsMoreContent,
      markIosNativeReady,
      loadAudioTrack,
      loadLastOpenedAudioTrack,
      closeAudioPlayer,
      saveAudioProgress,
      restoreAudioProgress,
      calculateAudioProgress,
      playbackRate,
      handleSetPlaybackRate,
      queueLivePlaybackRequest,
      livePlaybackRequestVersion,
    ]
  );

  return (
    <AudioProgressContext.Provider value={contextValue}>
      {children}
    </AudioProgressContext.Provider>
  );
}
