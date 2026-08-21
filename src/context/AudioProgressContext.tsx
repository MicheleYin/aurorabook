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
import { type } from "@tauri-apps/plugin-os";
import { toast } from "sonner";

import { AppSettings } from "@/types/settings";

import type {
  AudioTrack,
  AudioTrackWithData,
  Book,
  BookAudioState,
} from "../types/book";
import {
  applyNativePlayerEvent,
  applyMediaPlaybackRate,
  mimeTypeFromTrackHref,
  trackDisplayTitle,
} from "../lib/audio-progress-utils";
import { logger } from "../lib/logger";
import { normalizeBook } from "../lib/normalize-book";
import { useConversionState } from "./ConversionStateContext";

export interface AudioProgressContextType {
  currentAudioTrack: AudioTrackWithData | null;
  setCurrentAudioTrack: Dispatch<SetStateAction<AudioTrackWithData | null>>;
  isLoadingAudio: boolean;
  setIsLoadingAudio: Dispatch<SetStateAction<boolean>>;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  blobUrlRef: React.RefObject<string | null>;
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
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  // Last known position from the native AVPlayer (updated by native-player-event).
  const nativeTimeRef = useRef<number>(0);
  // Whether we're running on iOS (set async on mount, so starts false).
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
  const calculateAudioProgress = useCallback(() => {
    if (!currentAudioTrack) return null;
    return {
      currentTrackId: currentAudioTrack?.id,
      currentTrackHref: currentAudioTrack?.href,
      currentTrackIndex: currentAudioTrack?.order,
      currentTimeSeconds: audioRef.current?.currentTime,
      updatedAt: new Date().toISOString(),
    };
  }, [currentAudioTrack]);
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

  const saveSettings = useCallback(async (updates: Partial<AppSettings>) => {
    try {
      const currentSettings = await invoke<AppSettings>("get_app_settings");
      const updatedSettings: AppSettings = { ...currentSettings, ...updates };
      await invoke<AppSettings>("update_app_settings", {
        settings: updatedSettings,
      });
    } catch (err) {
      logger.error("Failed to save settings:", err);
    }
  }, []);
  const handleSetPlaybackRate = useCallback(
    (rate: number) => {
      const nextRate = applyMediaPlaybackRate(
        audioRef.current ?? { playbackRate: 1, defaultPlaybackRate: 1 },
        rate
      );
      setPlaybackRate(nextRate);
      saveSettings({ audioPlaybackSpeed: nextRate });
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

  // When the streaming server restarts (iOS app resume), reconnect the audio element.
  useEffect(() => {
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
  }, [currentAudioTrack, audioRef]);

  // Detect iOS once on mount (plugin-os `type()` is async).
  useEffect(() => {
    void (async () => {
      try {
        isIosRef.current = (await type()) === "ios";
      } catch {
        isIosRef.current = false;
      }
    })();
  }, []);

  // Listen for native-player-event (AVPlayer callbacks from Swift).
  useEffect(() => {
    const unlisten = listen<{ type: string; time?: number }>(
      "native-player-event",
      (event) => {
        const result = applyNativePlayerEvent(
          event.payload,
          audioRef.current?.currentTime ?? null
        );
        if (result.nativeTime !== null) {
          nativeTimeRef.current = result.nativeTime;
        }
        if (result.seekWebViewTo !== null && audioRef.current) {
          audioRef.current.currentTime = result.seekWebViewTo;
        }
        if (result.synthesiseEnded) {
          audioRef.current?.dispatchEvent(new Event("ended"));
        }
      }
    );

    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [audioRef]);

  // Load playback speed from backend on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const settings = await invoke<AppSettings>("get_app_settings");

        if (settings.audioPlaybackSpeed) {
          setPlaybackRate(settings.audioPlaybackSpeed);

          if (audioRef.current) {
            applyMediaPlaybackRate(
              audioRef.current,
              settings.audioPlaybackSpeed
            );
          }
        }
      } catch (err) {
        logger.error("Failed to load playback speed:", err);
      }
    };
    loadSettings();
  }, [audioRef]);
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
        savedState?.currentTimeSeconds !== undefined &&
        audioRef.current
      ) {
        const savedTime = savedState.currentTimeSeconds;
        const applySavedTime = () => {
          if (!audioRef.current) return;

          const audio = audioRef.current;
          const hasFiniteDuration = Number.isFinite(audio.duration) && audio.duration > 0;
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
          } catch (err) {
            logger.warn("Failed restoring saved audio timestamp:", err);
          }
        };

        // `loadAudioTrack` may already have loaded metadata before this runs.
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
          audioRef.current.addEventListener(
            "loadeddata",
            handleAudioReady
          );
          audioRef.current.addEventListener(
            "canplay",
            handleAudioReady
          );
        }
      }
      if (autoPlayAudio) {
        audioRef.current?.play();
      }
    },
    [audioRef]
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

        // Helper: set OS media controls metadata (same logic for live and non-live).
        const setMediaSessionMetadata = () => {
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

        // Non-live: load a completed audio track via HTTP stream URL.
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

          // Set up audio element with streaming URL
          if (audioRef.current) {
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

                // Keep loader from hanging forever on problematic streams.
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

            // Pause first so the previous track is saved at its actual timestamp,
            // then reset time for the newly loaded source.
            if (!audioRef.current.paused) {
              audioRef.current.pause();
            }
            audioRef.current.currentTime = 0;
            applyMediaPlaybackRate(audioRef.current, playbackRate);

            await waitForAudioReady();

            // Mirror WebView audio events into the native AVPlayer so the lock
            // screen always reflects what the in-app player is doing.
            if (isIosRef.current) {
              const el = audioRef.current;
              const onPlay = () =>
                void invoke("ios_player_play").catch(() => undefined);
              const onPause = () =>
                void invoke("ios_player_pause").catch(() => undefined);
              const onSeeked = () =>
                void invoke("ios_player_seek", {
                  seconds: el.currentTime,
                }).catch(() => undefined);
              const onRate = () =>
                void invoke("ios_player_set_rate", {
                  rate: el.playbackRate,
                }).catch(() => undefined);
              el.removeEventListener("play", onPlay);
              el.removeEventListener("pause", onPause);
              el.removeEventListener("seeked", onSeeked);
              el.removeEventListener("ratechange", onRate);
              el.addEventListener("play", onPlay);
              el.addEventListener("pause", onPause);
              el.addEventListener("seeked", onSeeked);
              el.addEventListener("ratechange", onRate);
            }
          }

          // Get MIME type from track href for metadata
          const mimeType = mimeTypeFromTrackHref(track.href);

          setCurrentAudioTrack({
            ...track,
            mimeType,
            isLiveStream: false,
            liveChapterIndex: undefined,
          });

          if (isIosRef.current) {
            void invoke("ios_player_load", {
              bookId,
              trackId: track.id,
              title: trackDisplayTitle(track.title, track.order),
              artist: book.author ?? "",
              duration: track.duration ?? 0,
            }).catch((err: unknown) =>
              logger.warn("ios_player_load failed (non-fatal):", err)
            );
          }

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
      
      // First priority: use centralized converting chapter state for live chapters.
      if (loadedBook) {
        let currentConvertingChapter = getCurrentConvertingChapter(loadedBook.id);
        if (currentConvertingChapter === null) {
          currentConvertingChapter =
            await refreshCurrentConvertingChapter(loadedBook.id);
        }

        if (
          currentConvertingChapter !== null &&
          currentConvertingChapter >= 0 &&
          currentConvertingChapter < loadedBook.chapters.length
        ) {
          const chapter = loadedBook.chapters[currentConvertingChapter];
          audioTrackToLoad = {
            id: `live-${loadedBook.id}-${currentConvertingChapter}`,
            bookId: loadedBook.id,
            chapterHref: chapter.href,
            filePath: chapter.href,
            href: chapter.href,
            title: chapter.title || `Chapter ${currentConvertingChapter + 1}`,
            order: currentConvertingChapter,
          };
        }

        // Paused mid-chapter with no active pointer yet: synthesize from the first
        // chapter that does not already have a completed audio track.
        if (
          !audioTrackToLoad &&
          loadedBook.conversionStatus === "started" &&
          loadedBook.chapters.length > 0
        ) {
          const completedHrefs = new Set(
            (loadedBook.completedChapters ?? []).map((href) => href)
          );
          const trackHrefs = new Set(
            (loadedBook.audioTracks ?? []).map(
              (track) => track.href || track.filePath
            )
          );
          const incompleteIndex = loadedBook.chapters.findIndex((chapter) => {
            if (completedHrefs.has(chapter.href)) return false;
            if (trackHrefs.has(chapter.href)) return false;
            return true;
          });
          if (incompleteIndex >= 0) {
            const chapter = loadedBook.chapters[incompleteIndex];
            audioTrackToLoad = {
              id: `live-${loadedBook.id}-${incompleteIndex}`,
              bookId: loadedBook.id,
              chapterHref: chapter.href,
              filePath: chapter.href,
              href: chapter.href,
              title: chapter.title || `Chapter ${incompleteIndex + 1}`,
              order: incompleteIndex,
            };
          }
        }
      }

      // Second priority: Try saved track references (for completed chapters)
      if (!audioTrackToLoad && loadedBook?.audioState?.currentTrackId) {
        const savedTrackId = loadedBook.audioState.currentTrackId;
        // Handle live track IDs directly (no need to search)
        if (savedTrackId.startsWith('live-')) {
          const parts = savedTrackId.split('-');
          if (parts.length >= 3) {
            const chapterIndex = parseInt(parts[parts.length - 1], 10);
            if (!isNaN(chapterIndex) && chapterIndex >= 0 && chapterIndex < loadedBook.chapters.length) {
              const chapter = loadedBook.chapters[chapterIndex];
              audioTrackToLoad = {
                id: savedTrackId,
                bookId: loadedBook.id,
                chapterHref: chapter.href,
                filePath: chapter.href,
                href: chapter.href,
                title: chapter.title || `Chapter ${chapterIndex + 1}`,
                order: chapterIndex,
              };
            }
          }
        }
        else {
          // Regular track - find in audioTracks
          audioTrackToLoad =
            loadedBook.audioTracks.find(
              (track) => track.id === savedTrackId
            ) || null;
        }
      }

      if (!audioTrackToLoad && loadedBook?.audioState?.currentTrackHref) {
        const savedHref = loadedBook.audioState.currentTrackHref;
        audioTrackToLoad =
          loadedBook.audioTracks.find((track) => {
            const trackHref = track.href || track.filePath;
            return trackHref === savedHref;
          }) || null;
      }

      if (
        !audioTrackToLoad &&
        loadedBook?.audioState?.currentTrackIndex !== undefined
      ) {
        const savedTrackIndex = loadedBook.audioState.currentTrackIndex;
        audioTrackToLoad =
          loadedBook.audioTracks.find((track) => track.order === savedTrackIndex) ||
          null;
      }

      if (
        !audioTrackToLoad &&
        loadedBook?.audioTracks?.length &&
        loadedBook.audioTracks.length > 0
      ) {
        audioTrackToLoad = loadedBook.audioTracks[0];
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
        const isLiveTrack = Boolean(audioTrackToLoad.id?.startsWith('live-'));
        if (isLiveTrack) {
          // Queue the desired resume time and auto-play intent for the live stream
          // effect before switching the current track.
          queueLivePlaybackRequest(
            (loadedBook || book).audioState?.currentTimeSeconds ?? 0,
            autoPlayAudio
          );
        }
        await loadAudioTrack(book.id, audioTrackToLoad, loadedBook || book);
        if (!isLiveTrack) {
          restoreAudioProgress(loadedBook || book, audioTrackToLoad, autoPlayAudio);
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
      if (
        !options?.skipSave &&
        audioRef.current &&
        currentAudioTrack &&
        !Number.isNaN(audioRef.current.currentTime)
      ) {
        try {
          await saveAudioProgress(book);
        } catch (err) {
          logger.warn("Failed to save audio progress while closing player:", err);
        }
      }

      // Stop playback
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
        audioRef.current.src = "";
      }

      // Clean up blob URL
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }

      // Clear current track
      setCurrentAudioTrack(null);

      // Clear MediaSession metadata
      if ("mediaSession" in navigator) {
        navigator.mediaSession.metadata = null;
      }
    },
    [currentAudioTrack, saveAudioProgress]
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
