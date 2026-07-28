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
  canRestoreSavedTime,
  mimeTypeFromTrackHref,
  trackDisplayTitle,
} from "../lib/audio-progress-utils";
import { logger } from "../lib/logger";

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
  closeAudioPlayer: (book: Book) => Promise<void>;
  calculateAudioProgress: () => BookAudioState | null;
  saveAudioProgress: (book: Book) => Promise<void>;
  restoreAudioProgress: (
    book: Book,
    track: AudioTrack,
    autoPlayAudio: boolean
  ) => void;
  playbackRate: number;
  setPlaybackRate: (rate: number) => void;
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
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  // Last known position from the native AVPlayer (updated by native-player-event).
  // Used to seek WebView audio back to the right spot when the app returns to foreground.
  const nativeTimeRef = useRef<number>(0);
  // Whether we're running on iOS (set async on mount, so starts false).
  const isIosRef = useRef<boolean>(false);
  const [currentAudioTrack, setCurrentAudioTrack] =
    useState<AudioTrackWithData | null>(null);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
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
      setPlaybackRate(rate);
      if (audioRef.current) {
        audioRef.current.playbackRate = rate;
      }
      saveSettings({ audioPlaybackSpeed: rate });
    },
    [audioRef, saveSettings]
  );

  // When the streaming server restarts (iOS app resume), reconnect the audio element.
  // The server binds to a new random port on each restart, making the old URL stale.
  useEffect(() => {
    const currentTrackRef = { current: currentAudioTrack };
    currentTrackRef.current = currentAudioTrack;

    const unlisten = listen<number>("audio-server-restarted", async () => {
      const track = currentTrackRef.current;
      if (!track || !audioRef.current) return;

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

  // Detect iOS once on mount.
  useEffect(() => {
    try {
      isIosRef.current = type() === "ios";
    } catch {
      isIosRef.current = false;
    }
  }, []);

  // Listen for native-player-event (AVPlayer callbacks from Swift).
  // Handles: time tracking, lock-screen seek syncing, and ended notifications.
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
          // Synthesise an 'ended' event on the <audio> element so FloatingAudioPlayer
          // can advance to the next track using its existing handler.
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
            audioRef.current.playbackRate = settings.audioPlaybackSpeed;
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
      // Restore audio progress if this is the last played track
      if (
        book.audioState?.currentTrackId === track.id &&
        book.audioState.currentTimeSeconds !== undefined &&
        audioRef.current
      ) {
        const savedTime = book.audioState.currentTimeSeconds;
        // Restore time after metadata is loaded
        const handleLoadedMetadata = () => {
          if (
            audioRef.current &&
            canRestoreSavedTime(savedTime, audioRef.current.duration)
          ) {
            audioRef.current.currentTime = savedTime;
          }
          audioRef.current?.removeEventListener(
            "loadedmetadata",
            handleLoadedMetadata
          );
        };
        audioRef.current.addEventListener(
          "loadedmetadata",
          handleLoadedMetadata
        );
      }
      if (autoPlayAudio) {
        audioRef.current?.play();
      }
    },
    [audioRef]
  );

  const loadAudioTrack = useCallback(
    async (bookId: string, track: AudioTrack, book: Book) => {
      setIsLoadingAudio(true);
      try {
        // Get streaming URL from backend
        const streamUrl = await invoke<string>("get_audio_stream_url", {
          bookId,
          trackId: track.id,
        });

        if (streamUrl) {
          // Clean up previous blob URL (if any)
          if (blobUrlRef.current) {
            URL.revokeObjectURL(blobUrlRef.current);
            blobUrlRef.current = null;
          }

          // Set up audio element with streaming URL
          if (audioRef.current) {
            audioRef.current.src = streamUrl;
            audioRef.current.load();

            // Reset playback state when track changes (will be restored if needed)
            audioRef.current.currentTime = 0;
            audioRef.current.playbackRate = playbackRate;
            if (!audioRef.current.paused) {
              audioRef.current.pause();
            }

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
              // Remove listeners from any previous track on the same element.
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
          });

          // On iOS: hand the track to the native AVPlayer so lock-screen controls
          // and background audio work even when the HTTP server is down.
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

          // Set MediaSession metadata for OS media controls
          if ("mediaSession" in navigator && book) {
            const trackTitle = trackDisplayTitle(track.title, track.order);

            // Find chapter name for this track using audio sync map (same as TOC)
            let chapterTitle: string | undefined;
            const trackHref = track.href || track.filePath;
            if (trackHref && book.audioSyncMap?.segments) {
              // Find the first segment that matches this track
              const matchingSegment = book.audioSyncMap.segments.find(
                (segment) => segment.audioTrackHref === trackHref
              );

              if (matchingSegment) {
                const chapter = book.chapters.find(
                  (ch) => ch.href === matchingSegment.chapterHref
                );
                if (chapter) {
                  chapterTitle = chapter.title;
                }
              }
            }

            // Append chapter name to track title if available
            const fullTrackTitle = chapterTitle
              ? `${trackTitle} - ${chapterTitle}`
              : trackTitle;

            const artwork: MediaImage[] = [];

            if (book.coverUrl) {
              artwork.push({
                src: book.coverUrl,
                sizes: "512x512",
                type: "image/jpeg",
              });
            }

            // Get app name asynchronously
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
                // Fallback without app name
                navigator.mediaSession.metadata = new MediaMetadata({
                  title: fullTrackTitle,
                  artist: book.author,
                  album: book.title,
                  artwork,
                });
              });
          }
        }
      } catch (err) {
        logger.error("Failed to load audio track:", err);
        toast.error("Failed to load audio track");
      } finally {
        setIsLoadingAudio(false);
      }
    },
    [audioRef, playbackRate]
  );

  const loadLastOpenedAudioTrack = useCallback(
    async (book: Book, autoPlayAudio: boolean) => {
      setIsLoadingAudio(true);
      let audioTrackToLoad: AudioTrack | null = null;
      // load from be
      const loadedBook = await invoke<Book | null>("read_one_book", {
        bookId: book.id,
      });
      if (loadedBook?.audioState?.currentTrackId) {
        audioTrackToLoad =
          loadedBook.audioTracks.find(
            (track) => track.id === loadedBook.audioState!.currentTrackId
          ) || null;
      }
      if (
        !audioTrackToLoad &&
        loadedBook?.audioTracks?.length &&
        loadedBook.audioTracks.length > 0
      ) {
        audioTrackToLoad = loadedBook.audioTracks[0];
      }
      if (audioTrackToLoad) {
        await loadAudioTrack(book.id, audioTrackToLoad, loadedBook || book);
        // Restore progress after track is loaded
        restoreAudioProgress(
          loadedBook || book,
          audioTrackToLoad,
          autoPlayAudio
        );
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

    [audioRef, loadAudioTrack, restoreAudioProgress]
  );

  const closeAudioPlayer = useCallback(
    async (book: Book) => {
      // Save progress before closing if we have a track and book
      if (
        audioRef.current &&
        currentAudioTrack &&
        book.audioState?.currentTrackId &&
        !Number.isNaN(audioRef.current.currentTime)
      ) {
        saveAudioProgress(book);
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
    ]
  );

  return (
    <AudioProgressContext.Provider value={contextValue}>
      {children}
    </AudioProgressContext.Provider>
  );
}
