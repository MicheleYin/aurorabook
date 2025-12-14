/**
 * Hook for loading and caching chapters
 * Uses generic useResourceLoader internally
 * No useEffects - all loading is explicit via callbacks
 */

import { useCallback, useMemo, useState } from "react";
import type { Chapter } from "../../types/reader";
import { ensureChapterLoaded } from "../../lib/lazy-chapter-loader";
import { useResourceLoader } from "../useResourceLoader";
import { useReaderCoordinator } from "../../contexts/ReaderCoordinatorContext";

export function useChapterLoader(_bookId?: string) {
  // Get coordinator for operation management
  const coordinator = useReaderCoordinator();
  
  // Track cache version to trigger updates (minimal state for memory optimization)
  const [cacheVersion, setCacheVersion] = useState(0);

  const loader = useResourceLoader<Chapter>({
    isLoaded: (chapter) => !!chapter.contentHtml,
    loadResource: async (bookId, chapter) => {
      // Check if operation is cancelled
      const currentOp = coordinator.getCurrentOperation("changeChapter");
      if (currentOp?.cancelled) {
        throw new Error("Chapter load cancelled");
      }
      
      // Use coordinator to load chapter (if available)
      // For now, still use direct loading but check coordinator state
      console.log("[useChapterLoader] Loading chapter", {
        bookId,
        chapterId: chapter.id,
        chapterHref: chapter.href,
        chapterTitle: chapter.title,
      });
      try {
        const loaded = await ensureChapterLoaded(bookId, chapter);
        if (loaded) {
          console.log("[useChapterLoader] ✓ Successfully loaded chapter", {
            bookId,
            chapterId: chapter.id,
            chapterHref: chapter.href,
            hasContentHtml: !!loaded.contentHtml,
          });
          return loaded;
        } else {
          console.warn("[useChapterLoader] ✗ Chapter returned null", {
            bookId,
            chapterId: chapter.id,
            chapterHref: chapter.href,
          });
        }
      } catch (error) {
        console.error("[useChapterLoader] ✗ Error loading chapter:", {
          bookId,
          chapterId: chapter.id,
          chapterHref: chapter.href,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return null;
    },
    getResourceId: (chapter) => chapter.id,
    logPrefix: "[useChapterLoader]",
  });

  const loadChapter = useCallback(async (
    bookId: string,
    chapter: Chapter
  ): Promise<Chapter | null> => {
    const result = await loader.load(bookId, chapter);
    if (result) {
      // Increment cache version to trigger loadedChapters update
      setCacheVersion(prev => prev + 1);
    }
    return result;
  }, [loader]);

  const getCachedChapter = useCallback((bookId: string, chapterId: string): Chapter | null => {
    return loader.getCached(bookId, chapterId);
  }, [loader]);

  const isChapterLoaded = useCallback((bookId: string, chapterId: string): boolean => {
    return loader.isResourceLoaded(bookId, chapterId);
  }, [loader]);

  const clearCache = useCallback((bookId?: string) => {
    loader.clearCache(bookId);
    // Increment cache version to trigger loadedChapters update
    setCacheVersion(prev => prev + 1);
  }, [loader]);

  // Get all loaded chapters as a Map (computed from cache)
  // Use cacheVersion to ensure it updates when cache changes
  const loadedChapters = useMemo(() => {
    const chapters = loader.getCachedResources();
    return new Map(chapters.map(chapter => [chapter.id, chapter]));
  }, [loader, cacheVersion]);

  // Track the most recently set chapter (for backward compatibility)
  const [loadedChapterState, setLoadedChapterState] = useState<Chapter | null>(null);

  // Get the most recently loaded chapter (for backward compatibility)
  const loadedChapter = useMemo(() => {
    // Return explicitly set chapter, or most recently cached chapter
    if (loadedChapterState) return loadedChapterState;
    const chapters = loader.getCachedResources();
    // Return the most recently loaded chapter (last in array, or first if only one)
    return chapters.length > 0 ? chapters[chapters.length - 1] : null;
  }, [loader, cacheVersion, loadedChapterState]);

  // Set loaded chapter (for backward compatibility - just updates state, chapter is already loaded)
  const setLoadedChapter = useCallback((chapter: Chapter | null) => {
    setLoadedChapterState(chapter);
    // Increment cache version to trigger updates
    if (chapter) {
      setCacheVersion(prev => prev + 1);
    }
  }, []);

  return {
    loadChapter,
    getCachedChapter,
    isChapterLoaded,
    clearCache,
    loadedChapters,
    // Backward compatibility
    loadedChapter,
    setLoadedChapter,
    isLoading: loader.isLoading,
  };
}

