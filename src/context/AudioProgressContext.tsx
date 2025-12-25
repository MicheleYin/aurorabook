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
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";

import type {
  AudioTrack,
  AudioTrackWithData,
  Book,
  BookAudioState,
} from "../types/book";

export interface AudioProgressContextType {
  currentAudioTrack: AudioTrackWithData | null;
  setCurrentAudioTrack: Dispatch<SetStateAction<AudioTrackWithData | null>>;
  isLoadingAudio: boolean;
  setIsLoadingAudio: Dispatch<SetStateAction<boolean>>;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  blobUrlRef: React.RefObject<string | null>;
  loadAudioTrack: (bookId: string, track: AudioTrack) => Promise<void>;
  loadLastOpenedAudioTrack: (book: Book) => void;
  closeAudioPlayer: (book: Book) => Promise<void>;
  calculateAudioProgress: () => BookAudioState | null;
  saveAudioProgress: (book: Book) => Promise<void>;
  restoreAudioProgress: (book: Book, track: AudioTrack) => void;
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
          console.error("Failed to save audio progress:", err);
          // Don't show toast for save errors to avoid spam
        }
      }
    },
    [calculateAudioProgress]
  );

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
    async (bookId: string, track: AudioTrack) => {
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
            if (!audioRef.current.paused) {
              audioRef.current.pause();
            }
          }

          setCurrentAudioTrack({
            ...track,
            data: bytes,
            mimeType,
          });
        }
      } catch (err) {
        console.error("Failed to load audio track:", err);
        toast.error("Failed to load audio track");
      } finally {
        setIsLoadingAudio(false);
      }
    },
    [audioRef]
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
        await loadAudioTrack(book.id, audioTrackToLoad);
        // Restore progress after track is loaded
        restoreAudioProgress(book, audioTrackToLoad);
        console.log("loaded last opened audio track", audioTrackToLoad, book);
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
    ]
  );

  return (
    <AudioProgressContext.Provider value={contextValue}>
      {children}
    </AudioProgressContext.Provider>
  );
}
