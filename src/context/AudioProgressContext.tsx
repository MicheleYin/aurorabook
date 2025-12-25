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

import type { AudioTrack, AudioTrackWithData, Book } from "../types/book";

export interface AudioProgressContextType {
  currentAudioTrack: AudioTrackWithData | null;
  setCurrentAudioTrack: Dispatch<SetStateAction<AudioTrackWithData | null>>;
  isLoadingAudio: boolean;
  setIsLoadingAudio: Dispatch<SetStateAction<boolean>>;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  blobUrlRef: React.RefObject<string | null>;
  loadAudioTrack: (bookId: string, track: AudioTrack) => Promise<void>;
  loadLastOpenedAudioTrack: (book: Book) => void;
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
  // const [currentAudioState, setCurrentAudioState] = useState<BookAudioState>({
  //   currentTrackId: undefined,
  //   currentTrackHref: undefined,
  //   currentTrackIndex: undefined,
  //   currentTimeSeconds: undefined,
  //   updatedAt: undefined,
  // });
  const [currentAudioTrack, setCurrentAudioTrack] =
    useState<AudioTrackWithData | null>(null);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);

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

            // Reset playback state when track changes
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
    []
  );

  const loadLastOpenedAudioTrack = useCallback(
    (book: Book) => {
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
        loadAudioTrack(book.id, audioTrackToLoad);
      } else {
        toast.error("No audio tracks available in this book");
      }
    },
    [loadAudioTrack]
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
    }),
    [
      currentAudioTrack,
      isLoadingAudio,
      loadAudioTrack,
      loadLastOpenedAudioTrack,
    ]
  );

  return (
    <AudioProgressContext.Provider value={contextValue}>
      {children}
    </AudioProgressContext.Provider>
  );
}
