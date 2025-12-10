/**
 * Hook for loading and caching chapters
 * Uses generic useResourceLoader internally
 * No useEffects - all loading is explicit via callbacks
 */

import { useCallback, useState } from "react";
import type { Chapter } from "../../types/reader";
import { ensureChapterLoaded } from "../../lib/lazy-chapter-loader";
import { useResourceLoader } from "./useResourceLoader";

export function useChapterLoader() {
  const [loadedChapter, setLoadedChapter] = useState<Chapter | null>(null);
  
  const loader = useResourceLoader<Chapter>({
    isLoaded: (chapter) => !!chapter.contentHtml,
    loadResource: async (bookId, chapter) => {
      return await ensureChapterLoaded(bookId, chapter);
    },
    getResourceId: (chapter) => chapter.id,
    logPrefix: "[useChapterLoader]",
  });

  const loadChapter = useCallback(async (
    bookId: string,
    chapter: Chapter
  ): Promise<Chapter | null> => {
    const loaded = await loader.load(bookId, chapter);
    if (loaded) {
      setLoadedChapter(loaded);
    }
    return loaded;
  }, [loader]);

  const getCachedChapter = useCallback((bookId: string, chapterId: string): Chapter | null => {
    return loader.getCached(bookId, chapterId);
  }, [loader]);

  const clearCache = useCallback((bookId?: string) => {
    loader.clearCache(bookId);
  }, [loader]);

  return {
    loadChapter,
    getCachedChapter,
    clearCache,
    loadedChapter,
    setLoadedChapter,
    isLoading: loader.isLoading,
    setIsLoading: () => {}, // Not used, but kept for API compatibility
  };
}

