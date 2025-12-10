/**
 * Shared types for library functionality
 */

import type { RefObject } from "react";
import type {
  Book,
  BookAudioState,
  BookProgress,
  Chapter,
  AudioTrack,
} from "../../types/reader";
import type {
  ChapterProgressSnapshot,
  AudioProgressSnapshot,
} from "../../components/reader/types";

export type IngestParams = {
  filePath: string;
  sourcePath: string;
  fallbackTitle?: string;
  progress?: BookProgress;
  pageCountHint?: number;
  audioState?: BookAudioState;
};

export type UseChapterProgressParams = {
  activeChapter: Chapter | null;
  contentRef?: RefObject<HTMLElement>;
  onProgress?: (snapshot: ChapterProgressSnapshot) => void;
  onSaveProgress?: (saveFn: () => void) => void;
  isRestoringScroll?: boolean;
};

export type UseAudioPlayerStateParams = {
  bookId?: string;
  tracks: AudioTrack[];
  initialAudioState?: BookAudioState;
  onProgress?: (snapshot: AudioProgressSnapshot) => void;
};

export type LibraryContextValue = {
  // Library state
  library: Book[];
  setLibrary: React.Dispatch<React.SetStateAction<Book[]>>;
  isHydrated: boolean;
  isImporting: boolean;

  // Library operations
  importFromDialog: () => Promise<boolean | { book: Book; buffer: ArrayBuffer }>;
  ingestEpub: (params: IngestParams) => Promise<Book | null>;
  refreshLibrary: () => Promise<void>;

  // Progress operations
  updateBookProgress: (
    bookId: string,
    payload: {
      chapterId: string;
      scrollTop?: number;
      scrollHeight?: number;
      clientHeight?: number;
      percent?: number;
      elementId?: string | null;
      elementIndex?: number | null;
    },
  ) => Promise<void>;
  updateBookAudioState: (
    bookId: string,
    snapshot: {
      currentTimeSeconds: number;
      trackId?: string;
      trackHref?: string;
      trackIndex?: number;
      updatedAt?: string;
    },
  ) => Promise<void>;
  handleChapterProgress: (bookId: string, snapshot: ChapterProgressSnapshot) => void;
  flushProgressUpdate: () => Promise<void>;

  // Chapter progress tracking hook
  useChapterProgress: (params: UseChapterProgressParams) => {
    emitChapterProgress: () => void;
    saveProgress: () => void;
    updateMetricsOnScroll: () => void;
  };

  // Audio player state hook
  useAudioPlayerState: (params: UseAudioPlayerStateParams) => {
    currentIndex: number;
    setCurrentIndex: (index: number) => void;
    restoreTime: number | null;
    isRestoring: boolean;
    onTrackLoaded: (audioElement: HTMLAudioElement) => void;
    onTrackChanged: (newTrackId: string) => void;
    emitProgress: (timeSeconds: number) => void;
  };
};

