/**
 * Hook for loading and caching chapters
 * Uses generic useResourceLoader internally
 * No useEffects - all loading is explicit via callbacks
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { Chapter } from "../../types/reader";
import { ensureChapterLoaded } from "../../lib/lazy-chapter-loader";
import { useResourceLoader } from "../useResourceLoader";
import { useReaderCoordinator } from "../../contexts/ReaderCoordinatorContext";
import { blobURLManager } from "../../lib/blob-url-manager";
import { logger } from "../../lib/logger";

export function useChapterLoader(_bookId?: string) {
  // Get coordinator for operation management
  const coordinator = useReaderCoordinator();
  
  // Track cache changes with state to trigger re-render when needed (like useAudioTrackLoader)
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
      logger.debug("[useChapterLoader] Loading chapter", {
        bookId,
        chapterId: chapter.id,
        chapterHref: chapter.href,
        chapterTitle: chapter.title,
      });
      try {
        const loaded = await ensureChapterLoaded(bookId, chapter);
        if (loaded && loaded.contentHtml) {
          logger.debug("[useChapterLoader] ✓ Successfully loaded chapter", {
            bookId,
            chapterId: chapter.id,
            chapterHref: chapter.href,
            hasContentHtml: !!loaded.contentHtml,
          });
          return loaded;
        } else {
          const errorMessage = `Chapter "${chapter.title || chapter.id}" failed to load`;
          logger.warn("[useChapterLoader] ✗ Chapter returned without content", {
            bookId,
            chapterId: chapter.id,
            chapterHref: chapter.href,
          });
          toast.error("Failed to load chapter", {
            description: errorMessage,
          });
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error("[useChapterLoader] ✗ Error loading chapter:", {
          bookId,
          chapterId: chapter.id,
          chapterHref: chapter.href,
          error: errorMessage,
        });
        toast.error("Failed to load chapter", {
          description: errorMessage || `Unable to load "${chapter.title || chapter.id}"`,
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
      // Update cache version to trigger loadedChapters recalculation
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
    // Revoke Blob URLs before clearing cache using centralized manager
    if (bookId) {
      // Revoke all blob URLs for this book
      blobURLManager.revokeForBook(bookId);
    } else {
      // When clearing all chapters, blob URLs are managed per-book
      // If chapters create blob URLs in the future, they should be
      // registered with blobURLManager and will be cleaned up via revokeForBook
      // For now, chapters don't store blob URLs, so no per-resource cleanup needed
    }
    loader.clearCache(bookId);
    // Update cache version to trigger loadedChapters recalculation
    setCacheVersion(prev => prev + 1);
  }, [loader]);

  // Get all loaded chapters as a Map (computed on-demand from cache)
  // Memoized with cacheVersion to trigger recalculation when cache changes
  const loadedChapters = useMemo(() => {
    const chapters = loader.getCachedResources();
    return new Map(chapters.map(chapter => [chapter.id, chapter]));
  }, [loader, cacheVersion]);

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
  }, [loader, cacheVersion]); // Include cacheVersion to trigger recalculation when cache changes

  // Set loaded chapter (for backward compatibility - stores only ID, not full chapter)
  const setLoadedChapter = useCallback((chapter: Chapter | null) => {
    // Store only ID reference, not full chapter object (memory optimization)
    loadedChapterIdRef.current = chapter?.id || null;
    // Update cache version to trigger loadedChapters recalculation
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

