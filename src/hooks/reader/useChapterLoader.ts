/**
 * Hook for loading and caching chapters
 * No useEffects - all loading is explicit via callbacks
 */

import { useCallback, useRef, useState } from "react";
import type { Chapter } from "../../types/reader";
import { ensureChapterLoaded } from "../../lib/lazy-chapter-loader";

type ChapterCacheEntry = {
  chapter: Chapter;
  loadedAt: number;
};

export function useChapterLoader() {
  const cacheRef = useRef<Map<string, ChapterCacheEntry>>(new Map());
  const [loadedChapter, setLoadedChapter] = useState<Chapter | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const loadChapter = useCallback(async (
    bookId: string,
    chapter: Chapter
  ): Promise<Chapter | null> => {
    const cacheKey = `${bookId}:${chapter.id}`;
    
    // Check cache first
    const cached = cacheRef.current.get(cacheKey);
    if (cached && cached.chapter.contentHtml) {
      return cached.chapter;
    }

    // If chapter already has content, cache and return it
    if (chapter.contentHtml) {
      cacheRef.current.set(cacheKey, {
        chapter,
        loadedAt: Date.now(),
      });
      return chapter;
    }

    // Load from backend (this processes images)
    setIsLoading(true);
    try {
      const loaded = await ensureChapterLoaded(bookId, chapter);
      if (loaded && loaded.contentHtml) {
        // Cache it
        cacheRef.current.set(cacheKey, {
          chapter: loaded,
          loadedAt: Date.now(),
        });
        return loaded;
      }
    } catch (error) {
      console.error("[useChapterLoader] Failed to load chapter:", error, {
        bookId,
        chapterId: chapter.id,
        chapterHref: chapter.href,
      });
    } finally {
      setIsLoading(false);
    }
    return null;
  }, []);

  const getCachedChapter = useCallback((bookId: string, chapterId: string): Chapter | null => {
    const cacheKey = `${bookId}:${chapterId}`;
    const cached = cacheRef.current.get(cacheKey);
    return cached?.chapter || null;
  }, []);

  const clearCache = useCallback((bookId?: string) => {
    if (bookId) {
      // Clear only this book's chapters
      const keysToDelete: string[] = [];
      cacheRef.current.forEach((_, key) => {
        if (key.startsWith(`${bookId}:`)) {
          keysToDelete.push(key);
        }
      });
      keysToDelete.forEach(key => cacheRef.current.delete(key));
    } else {
      // Clear all
      cacheRef.current.clear();
    }
  }, []);

  return {
    loadChapter,
    getCachedChapter,
    clearCache,
    loadedChapter,
    setLoadedChapter,
    isLoading,
    setIsLoading,
  };
}

