/**
 * Library Context Provider
 * 
 * Provides library state and operations through React Context,
 * ensuring all components have access to the same library state.
 */

import { createContext, useContext, useCallback, useEffect, useState, useMemo } from "react";
import { logger } from "../../lib/logger";
import type { Book } from "../../types/reader";
import { useLibraryOperations } from "./useLibraryOperations";
import { useChapterStatePersistence } from "../chapter/useChapterStatePersistence";
import { useAudioStatePersistence } from "../audio/useAudioStatePersistence";
import { useChapterProgress } from "../chapter/useChapterProgress";
import { useAudioPlayerState } from "../audio/useAudioPlayerState";
import type { LibraryContextValue, UseChapterProgressParams, UseAudioPlayerStateParams } from "./types";
import type { ScrollMetrics } from "../../lib/scroll-utils";

const LibraryContext = createContext<LibraryContextValue | null>(null);

export function LibraryProvider({ children }: { children: React.ReactNode }) {

  const [library, setLibrary] = useState<Book[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);

  // Initialize all operations
  const {
    isImporting,
    importFromDialog,
    ingestEpub,
    refreshLibrary,
  } = useLibraryOperations(library, setLibrary);

  const {
    updateBookProgress,
    handleChapterProgress,
    flushProgressUpdate,
  } = useChapterStatePersistence(library, setLibrary);

  const {
    updateBookAudioState,
    flushAudioStateUpdate,
  } = useAudioStatePersistence(library, setLibrary);

  // Wrap the nested hooks in useCallback to maintain stable references
  const useChapterProgressWrapper = useCallback(
    (params: UseChapterProgressParams) => {
      // Convert library-level params to unified hook params
      // Note: LibraryContext doesn't provide onSaveProgress in the format expected by useChapterProgress
      // So we create a no-op function that satisfies the type
      const progressHook = useChapterProgress({
        activeBook: undefined, // Library context doesn't have activeBook
        activeChapter: params.activeChapter ?? undefined,
        contentRef: params.contentRef as React.RefObject<HTMLDivElement | null>,
        onSaveProgress: async (_chapterId: string) => {
          // Library-level save is handled via handleChapterProgress callback
          // If onSaveProgress is provided, call it with a no-op function
          if (params.onSaveProgress) {
            params.onSaveProgress(() => {
              // No-op - actual saving happens via handleChapterProgress
            });
          }
        },
        isRestoringScroll: typeof params.isRestoringScroll === 'function' 
          ? params.isRestoringScroll() 
          : params.isRestoringScroll ?? false,
      });
      
      // Adapt the return value to match expected interface
      return {
        emitChapterProgress: () => {
          const snapshot = progressHook.getCurrentProgressSnapshot();
          if (snapshot && params.onProgress) {
            params.onProgress(snapshot);
          }
        },
        saveProgress: () => {
          // No-op for library-level usage - progress is saved via handleChapterProgress
        },
        updateMetricsOnScroll: () => {
          // No-op for library-level usage
        },
        updateScrollState: (_chapterId: string, _metrics: ScrollMetrics) => {
          // No-op for library-level usage
        },
      };
    },
    [],
  );

  const useAudioPlayerStateWrapper = useCallback(
    (params: UseAudioPlayerStateParams) => {
      return useAudioPlayerState({ ...params, library });
    },
    [library],
  );

  // Hydrate library on mount
  useEffect(() => {
    let cancelled = false;

    const hydrateLibrary = async () => {
      try {
        await refreshLibrary();
        if (cancelled) return;
      } catch (error) {
        logger.warn("Failed to load books from Rust backend.", error);
      } finally {
        if (!cancelled) {
          setIsHydrated(true);
        }
      }
    };

    void hydrateLibrary();

    return () => {
      cancelled = true;
    };
  }, [refreshLibrary]);

  // Memoize context value to prevent unnecessary re-renders
  const contextValue = useMemo<LibraryContextValue>(
    () => ({
      library,
      setLibrary,
      isHydrated,
      isImporting,
      importFromDialog,
      ingestEpub,
      refreshLibrary,
      updateBookProgress,
      updateBookAudioState,
      handleChapterProgress,
      flushProgressUpdate,
      flushAudioStateUpdate,
      useChapterProgress: useChapterProgressWrapper,
      useAudioPlayerState: useAudioPlayerStateWrapper,
    }),
    [
      library,
      isHydrated,
      isImporting,
      importFromDialog,
      ingestEpub,
      refreshLibrary,
      updateBookProgress,
      updateBookAudioState,
      handleChapterProgress,
      flushProgressUpdate,
      useChapterProgressWrapper,
      useAudioPlayerStateWrapper,
    ],
  );

  return (
    <LibraryContext.Provider value={contextValue}>
      {children}
    </LibraryContext.Provider>
  );
}

export function useLibraryContext(): LibraryContextValue {
  const context = useContext(LibraryContext);
  if (!context) {
    throw new Error("useLibraryContext must be used within a LibraryProvider");
  }
  return context;
}

