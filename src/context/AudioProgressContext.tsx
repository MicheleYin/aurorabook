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
import { toast } from "sonner";

import { AppSettings } from "@/types/settings";

import type {
  AudioTrack,
  AudioTrackWithData,
  Book,
  BookAudioState,
} from "../types/book";
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
  loadLastOpenedAudioTrack: (book: Book) => void;
  closeAudioPlayer: (book: Book) => Promise<void>;
  calculateAudioProgress: () => BookAudioState | null;
  saveAudioProgress: (book: Book) => Promise<void>;
  restoreAudioProgress: (book: Book, track: AudioTrack) => void;
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

export function AudioProgressProvider({
  children,
}: AudioProgressProviderProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);
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

  // Load playback speed from backend on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const settings = await invoke<AppSettings>("get_app_settings");
        console.log("settings", settings);
        if (settings.audioPlaybackSpeed) {
          setPlaybackRate(settings.audioPlaybackSpeed);
          console.log(
            "settings.audioPlaybackSpeed",
            settings.audioPlaybackSpeed
          );
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
    (book: Book, track: AudioTrack) => {
      // Restore audio progress if this is the last played track
      if (
        book.audioState?.currentTrackId === track.id &&
        book.audioState.currentTimeSeconds !== undefined &&
        audioRef.current
      ) {
        const savedTime = book.audioState.currentTimeSeconds;
        // Restore time after metadata is loaded
        const handleLoadedMetadata = () => {
          if (audioRef.current && savedTime < audioRef.current.duration) {
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
    },
    [audioRef]
  );

  const loadAudioTrack = useCallback(
    async (bookId: string, track: AudioTrack, book: Book) => {
      setIsLoadingAudio(true);
      try {
        const result = await invoke<[number[], string] | null>(
          "load_epub_audio_bytes",
          {
            bookId,
            trackId: track.id,
          }
        );

        if (result) {
          const [bytes, mimeType] = result;

          // Clean up previous blob URL
          if (blobUrlRef.current) {
            URL.revokeObjectURL(blobUrlRef.current);
            blobUrlRef.current = null;
          }

          // Convert number[] to Uint8Array and create blob
          const audioBytes = new Uint8Array(bytes);
          const blob = new Blob([audioBytes], { type: mimeType });
          const blobUrl = URL.createObjectURL(blob);
          blobUrlRef.current = blobUrl;

          // Set up audio element
          if (audioRef.current) {
            audioRef.current.src = blobUrl;
            audioRef.current.load();

            // Reset playback state when track changes (will be restored if needed)
            audioRef.current.currentTime = 0;
            audioRef.current.playbackRate = playbackRate;
            if (!audioRef.current.paused) {
              audioRef.current.pause();
            }
          }

          setCurrentAudioTrack({
            ...track,
            data: bytes,
            mimeType,
          });

          // Set MediaSession metadata for OS media controls
          if ("mediaSession" in navigator && book) {
            const trackTitle = track.title || `Track ${track.order + 1}`;

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
    async (book: Book) => {
      let audioTrackToLoad: AudioTrack | null = null;
      if (book.audioState?.currentTrackId) {
        audioTrackToLoad =
          book.audioTracks.find(
            (track) => track.id === book.audioState!.currentTrackId
          ) || null;
      }
      if (!audioTrackToLoad && book.audioTracks.length > 0) {
        audioTrackToLoad = book.audioTracks[0];
      }
      if (audioTrackToLoad) {
        await loadAudioTrack(book.id, audioTrackToLoad, book);
        // Restore progress after track is loaded
        restoreAudioProgress(book, audioTrackToLoad);
        logger.log("loaded last opened audio track", audioTrackToLoad, book);
      } else {
        toast.error("No audio tracks available in this book");
      }
    },
    [loadAudioTrack, restoreAudioProgress]
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
