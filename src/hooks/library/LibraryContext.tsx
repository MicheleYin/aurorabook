/**
 * Library Context Provider
 * 
 * Provides library state and operations through React Context,
 * ensuring all components have access to the same library state.
 */

import { createContext, useContext, useCallback, useEffect, useState, useMemo } from "react";
import type { Book } from "../../types/reader";
import { useLibraryOperations } from "./useLibraryOperations";
import { useProgressManagement } from "./useProgressManagement";
import { useAudioStateManagement } from "./useAudioStateManagement";
import { useChapterProgress } from "./useChapterProgress";
import { useAudioStateSync } from "./useAudioStateSync";
import type { LibraryContextValue, UseChapterProgressParams, UseAudioStateSyncParams } from "./types";

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
  } = useProgressManagement(library, setLibrary);

  const {
    updateBookAudioState,
  } = useAudioStateManagement(library, setLibrary);

  // Wrap the nested hooks in useCallback to maintain stable references
  const useChapterProgressWrapper = useCallback(
    (params: UseChapterProgressParams) => {
      return useChapterProgress(params);
    },
    [],
  );

  const useAudioStateSyncWrapper = useCallback(
    (params: UseAudioStateSyncParams) => {
      return useAudioStateSync(params);
    },
    [],
  );

  // Hydrate library on mount
  useEffect(() => {
    let cancelled = false;

    const hydrateLibrary = async () => {
      try {
        await refreshLibrary();
        if (cancelled) return;
      } catch (error) {
        console.warn("Failed to load books from Rust backend.", error);
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
      useChapterProgress: useChapterProgressWrapper,
      useAudioStateSync: useAudioStateSyncWrapper,
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
      useAudioStateSyncWrapper,
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

