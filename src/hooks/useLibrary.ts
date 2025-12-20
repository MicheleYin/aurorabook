/**
 * Library hook - thin wrapper around Redux
 * 
 * This hook provides access to library state and operations through Redux.
 * All library state is managed in Redux store.
 */

import { useCallback } from "react";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import { selectLibrary, selectIsHydrated, selectIsImporting } from "../store/selectors";
import {
  refreshLibrary,
  ingestEpub,
  importFromDialog,
  updateBookProgress,
  updateBookAudioState,
  flushProgressUpdate,
  flushAudioStateUpdate,
} from "../store/thunks/libraryThunks";
import type { Book } from "../types/reader";
import type { ChapterProgressSnapshot } from "../components/reader/types";
import type { IngestParams } from "./library/types";

export type UseLibraryReturn = {
  // Library state
  library: Book[];
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
  flushProgressUpdate: (bookId: string) => Promise<void>;
  flushAudioStateUpdate: (bookId: string) => Promise<void>;
};

/**
 * Hook to access library state and operations from Redux.
 */
export function useLibrary(): UseLibraryReturn {
  const dispatch = useAppDispatch();
  const library = useAppSelector(selectLibrary);
  const isHydrated = useAppSelector(selectIsHydrated);
  const isImporting = useAppSelector(selectIsImporting);

  const handleChapterProgress = useCallback((bookId: string, snapshot: ChapterProgressSnapshot) => {
    dispatch(updateBookProgress({
      bookId,
      progress: {
        chapterId: snapshot.chapterId,
        scrollTop: snapshot.scrollTop,
        scrollHeight: snapshot.scrollHeight,
        clientHeight: snapshot.clientHeight,
        percent: snapshot.chapterProgressPercent,
        elementId: snapshot.elementId,
        elementIndex: snapshot.elementIndex,
        updatedAt: snapshot.updatedAt,
      },
    }));
  }, [dispatch]);

  return {
    library,
    isHydrated,
    isImporting,
    importFromDialog: useCallback(() => dispatch(importFromDialog()).unwrap(), [dispatch]),
    ingestEpub: useCallback(async (params: IngestParams) => {
      const result = await dispatch(ingestEpub(params)).unwrap();
      return result ?? null;
    }, [dispatch]),
    refreshLibrary: useCallback(() => dispatch(refreshLibrary()).unwrap(), [dispatch]),
    updateBookProgress: useCallback(async (bookId: string, payload) => {
      await dispatch(updateBookProgress({ bookId, progress: payload })).unwrap();
    }, [dispatch]),
    updateBookAudioState: useCallback(async (bookId: string, snapshot) => {
      await dispatch(updateBookAudioState({ bookId, audioState: snapshot })).unwrap();
    }, [dispatch]),
    handleChapterProgress,
    flushProgressUpdate: useCallback((bookId: string) => 
      dispatch(flushProgressUpdate({ bookId })).unwrap(), [dispatch]),
    flushAudioStateUpdate: useCallback((bookId: string) => 
      dispatch(flushAudioStateUpdate({ bookId })).unwrap(), [dispatch]),
  };
}
