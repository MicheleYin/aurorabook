/**
 * Hook for loading and caching chapters
 * Uses generic useResourceLoader internally
 * No useEffects - all loading is explicit via callbacks
 * 
 * Note: Chapters use data URLs for images (not blob URLs), so no blob URL cleanup needed
 */

import { useCallback, useMemo, useRef } from "react";
import type { Chapter } from "../../types/reader";
import { ensureChapterLoaded } from "../../lib/lazy-chapter-loader";
import { useResourceLoader } from "../useResourceLoader";
import { useReaderCoordinator } from "../../contexts/ReaderCoordinatorContext";

export function useChapterLoader(_bookId?: string) {
  // Get coordinator for operation management
  const coordinator = useReaderCoordinator();
  
  // Use ref instead of state to avoid re-renders (memory optimization)
  const cacheVersionRef = useRef(0);

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
      // Increment cache version (using ref - no re-render)
      cacheVersionRef.current += 1;
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
    // Clear chapter cache
    // Note: Chapters use data URLs for images (handled by backend), not blob URLs
    // So no blob URL cleanup needed here
    loader.clearCache(bookId);
    // Increment cache version (using ref - no re-render)
    cacheVersionRef.current += 1;
  }, [loader]);

  // Get all loaded chapters as a Map (computed on-demand from cache)
  // No memoization - computed fresh each time to avoid memory duplication
  // The cache itself is the single source of truth
  const loadedChapters = useMemo(() => {
    const chapters = loader.getCachedResources();
    return new Map(chapters.map(chapter => [chapter.id, chapter]));
  }, [loader]);

  // Track the most recently set chapter ID (not full chapter - memory optimization)
  const loadedChapterIdRef = useRef<string | null>(null);

  // Get the most recently loaded chapter (computed on-demand from cache)
  // No state storage - single source of truth is the cache
  const loadedChapter = useMemo(() => {
    // If we have a specific chapter ID, get it from cache
    if (loadedChapterIdRef.current) {
      const chapters = loader.getCachedResources();
      const found = chapters.find(ch => ch.id === loadedChapterIdRef.current);
      if (found) return found;
    }
    
    // Otherwise return most recently cached chapter
    const chapters = loader.getCachedResources();
    return chapters.length > 0 ? chapters[chapters.length - 1] : null;
  }, [loader]);

  // Set loaded chapter (for backward compatibility - stores only ID, not full chapter)
  const setLoadedChapter = useCallback((chapter: Chapter | null) => {
    // Store only ID reference, not full chapter object (memory optimization)
    loadedChapterIdRef.current = chapter?.id || null;
    // Increment cache version (using ref - no re-render)
    if (chapter) {
      cacheVersionRef.current += 1;
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

