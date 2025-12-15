/**
 * Lazy chapter loader - loads chapter content from Rust backend on demand
 * This prevents keeping all chapter content in memory at once
 */

import { logger } from "./logger";
import { toast } from "sonner";
import { loadEpubAudioBlob, loadEpubChapterBlob } from "./book-service";
import type { Chapter, AudioTrack } from "../types/reader";
import {
  normalizeChapterContent,
  sanitizeChapterHtml,
  extractPlainText,
} from "./epub";
import { countWords, estimatePagesFromWords } from "./utils";
import { blobURLManager } from "./blob-url-manager";
import { resourceCacheManager } from "./resource-cache-manager";

const LOADER_LOG_PREFIX = "[LazyChapterLoader]";

// Note: Caching is now handled by centralized resourceCacheManager
// This eliminates duplicate cache storage and ensures proper eviction

/**
 * Clear cache for a specific chapter (useful when chapter is updated during conversion)
 */
export function clearChapterCache(sourcePath: string, chapterHref: string): void {
  const bookId = sourcePath;
  
  // Try multiple href variations to ensure we clear all possible cache keys
  const hrefVariations = [
    chapterHref,
    chapterHref.replace(/^\/+/, ""),
    chapterHref.replace(/^OEBPS\//, ""),
    `OEBPS/${chapterHref.replace(/^\/+/, "").replace(/^OEBPS\//, "")}`,
  ];
  
  let cleared = false;
  for (const href of hrefVariations) {
    // Use centralized cache manager
    if (resourceCacheManager.hasChapter(bookId, href)) {
      resourceCacheManager.deleteChapter(bookId, href);
      cleared = true;
      logger.debug(`${LOADER_LOG_PREFIX} cleared chapter cache`, {
        sourcePath,
        chapterHref: href,
      });
    }
  }
  
  if (!cleared) {
    logger.debug(`${LOADER_LOG_PREFIX} chapter cache not found (may not be cached yet)`, {
      sourcePath,
      chapterHref,
    });
  }
}

/**
 * Clear cache for a book (useful when book is deleted or updated)
 */
export function clearBookCache(sourcePath: string): void {
  const bookId = sourcePath;
  // Use centralized cache manager
  resourceCacheManager.clearBook(bookId);
  logger.debug(`${LOADER_LOG_PREFIX} cleared cache for book`, {
    sourcePath,
  });
}

/**
 * Clear cache for all books except the specified one
 * Useful for keeping only the currently open book in memory
 */
export function clearAllCachesExcept(sourcePath: string): void {
  const keepBookId = sourcePath;
  // Use centralized cache manager
  resourceCacheManager.clearAllExcept(keepBookId);
  logger.debug(`${LOADER_LOG_PREFIX} cleared all caches except book`, {
    keepSourcePath: sourcePath,
  });
}


/**
 * Load a single chapter's content from Rust backend
 */
export async function loadChapterContent(
  bookId: string,
  chapter: Chapter,
): Promise<{ contentHtml: string; plainText: string; wordCount: number }> {
  // Check centralized cache first
  const cached = resourceCacheManager.getChapter(bookId, chapter.href);
  if (cached) {
    logger.debug(`${LOADER_LOG_PREFIX} using cached chapter`, { 
      bookId, 
      href: chapter.href,
      cachedHtmlSize: cached.contentHtml.length,
      hasSpans: cached.contentHtml.includes('id="f'),
    });
    return cached;
  }
  
  logger.debug(`${LOADER_LOG_PREFIX} cache miss, loading from backend`, {
    bookId,
    href: chapter.href,
  });

  try {
    // Load chapter content from Rust backend as blob URL
    // Try alternative href formats if primary load fails
    const alternatives = [
      chapter.href,
      chapter.href.replace(/^\/+/, ""),
      chapter.href.replace(/^OEBPS\//, ""),
      `OEBPS/${chapter.href.replace(/^\/+/, "").replace(/^OEBPS\//, "")}`,
    ];
    
    let chapterBlob: { blobUrl: string; htmlString: string } | null = null;
    for (const altHref of alternatives) {
      try {
        chapterBlob = await loadEpubChapterBlob(bookId, altHref);
        if (chapterBlob && chapterBlob.htmlString) {
          if (altHref !== chapter.href) {
            logger.debug(`${LOADER_LOG_PREFIX} loaded chapter using alternative href: ${altHref} (original: ${chapter.href})`);
          }
          break;
        }
      } catch (error) {
        // Continue to next alternative
        logger.debug(`${LOADER_LOG_PREFIX} failed to load with href ${altHref}, trying next`, { error });
      }
    }
    
    if (!chapterBlob || !chapterBlob.htmlString) {
      throw new Error(`Failed to load chapter content: ${chapter.href}`);
    }
    
    // NOTE: blobUrl is already registered by loadEpubChapterBlob
    // No need to register again - that would cause duplicates
    
    // Backend now handles image resolution, so we just normalize and sanitize
    const rawHtml = chapterBlob.htmlString;
    const normalizedHtml = await normalizeChapterContent(rawHtml);
    if (!normalizedHtml) {
      throw new Error(`Failed to normalize chapter: ${chapter.href}`);
    }

    const sanitized = sanitizeChapterHtml(normalizedHtml);
    
    if (!sanitized.trim()) {
      throw new Error(`Chapter content is empty: ${chapter.href}`);
    }

    const plainText = extractPlainText(sanitized);
    const wordCount = countWords(plainText);

    // Cache the result in centralized cache
    resourceCacheManager.setChapter(bookId, chapter.href, sanitized, plainText, wordCount);
    
    const result = { contentHtml: sanitized, plainText, wordCount };
    logger.debug(`${LOADER_LOG_PREFIX} ✓ loaded chapter from backend`, {
      bookId,
      href: chapter.href,
      htmlSize: sanitized.length,
      wordCount,
      hasSpans: sanitized.includes('id="f'),
      spanCount: (sanitized.match(/id="f\d{6}"/g) || []).length,
    });

    return result;
  } catch (error) {
    logger.error(`${LOADER_LOG_PREFIX} failed to load chapter`, {
      bookId,
      href: chapter.href,
      error,
    });
    throw error;
  }
}

/**
 * Ensure a chapter is loaded, loading it if necessary
 */
export async function ensureChapterLoaded(
  bookId: string,
  chapter: Chapter,
): Promise<Chapter> {
  // If already loaded, return as-is (images are now resolved by backend)
  if (chapter.contentHtml && chapter.plainText) {
    return chapter;
  }

  try {
    const { contentHtml, plainText, wordCount } = await loadChapterContent(bookId, chapter);
    
    return {
      ...chapter,
      contentHtml,
      plainText,
      wordCount: chapter.wordCount ?? wordCount,
      estimatedPageCount: chapter.estimatedPageCount ?? estimatePagesFromWords(wordCount),
      _loading: false,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`${LOADER_LOG_PREFIX} failed to ensure chapter loaded`, {
      bookId,
      href: chapter.href,
      error,
    });
    // Show user-friendly error toast
    toast.error("Failed to load chapter", {
      description: errorMessage || `Unable to load "${chapter.title || chapter.href}"`,
    });
    // Return chapter with loading flag cleared even on error
    return { ...chapter, _loading: false };
  }
}

/**
 * Load an audio track URL from EPUB
 */
export async function loadAudioTrackUrl(
  bookId: string,
  track: AudioTrack,
): Promise<string> {
  // Check centralized cache first
  const cached = resourceCacheManager.getAudioTrack(bookId, track.href);
  if (cached) {
    // Verify the cached URL is still valid (not revoked)
    if (blobURLManager.has(cached.url)) {
      logger.debug(`${LOADER_LOG_PREFIX} using cached audio track URL`, {
        bookId,
        trackId: track.id,
        href: track.href,
        urlLength: cached.url.length,
      });
      return cached.url;
    } else {
      // Cached URL was revoked, remove from cache
      logger.debug(`${LOADER_LOG_PREFIX} cached audio track URL was revoked, removing from cache`, {
        bookId,
        trackId: track.id,
        href: track.href,
      });
      resourceCacheManager.deleteAudioTrack(bookId, track.href);
    }
  }

  logger.debug(`${LOADER_LOG_PREFIX} Loading audio track URL from backend`, {
    bookId,
    trackId: track.id,
    trackHref: track.href,
    trackTitle: track.title,
  });

  try {
    // Load audio track from Rust backend
    // Try alternative href formats if primary load fails
    const alternatives = [
      track.href,
      track.href.replace(/^\/+/, ""),
      track.href.replace(/^OEBPS\//, ""),
      `OEBPS/${track.href.replace(/^\/+/, "").replace(/^OEBPS\//, "")}`,
    ];
    
    logger.debug(`${LOADER_LOG_PREFIX} Trying ${alternatives.length} href alternatives`, {
      bookId,
      trackHref: track.href,
      alternatives,
    });
    
    let blobUrl: string | null = null;
    for (const altHref of alternatives) {
      try {
        logger.debug(`${LOADER_LOG_PREFIX} Trying to load audio with href: ${altHref}`);
        blobUrl = await loadEpubAudioBlob(bookId, altHref);
        if (blobUrl) {
          if (altHref !== track.href) {
            logger.debug(`${LOADER_LOG_PREFIX} ✓ Loaded audio track using alternative href: ${altHref} (original: ${track.href})`);
          } else {
            logger.debug(`${LOADER_LOG_PREFIX} ✓ Loaded audio track with original href: ${track.href}`);
          }
          break;
        } else {
          logger.warn(`${LOADER_LOG_PREFIX} Audio track returned null for href: ${altHref}`);
        }
      } catch (error) {
        // Continue to next alternative
        logger.warn(`${LOADER_LOG_PREFIX} Failed to load with href ${altHref}, trying next`, { 
          error: error instanceof Error ? error.message : String(error) 
        });
      }
    }
    
    if (!blobUrl) {
      throw new Error(`Failed to load audio track: ${track.href} (tried ${alternatives.length} alternatives)`);
    }
    
    // NOTE: blobUrl is already registered by loadEpubAudioBlob
    // No need to register again - that would cause duplicates
    
    // Cache the result in centralized cache
    resourceCacheManager.setAudioTrack(bookId, track.href, blobUrl);
    
    logger.debug(`${LOADER_LOG_PREFIX} ✓ Successfully loaded and cached audio track URL`, {
      bookId,
      trackId: track.id,
      href: track.href,
      isBlobUrl: blobUrl.startsWith("blob:"),
    });
    
    return blobUrl;
  } catch (error) {
    logger.error(`${LOADER_LOG_PREFIX} ✗ Failed to load audio track URL`, {
      bookId,
      trackId: track.id,
      href: track.href,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Ensure an audio track URL is loaded, loading it if necessary
 */
export async function ensureAudioTrackLoaded(
  bookId: string,
  track: AudioTrack,
): Promise<AudioTrack> {
  // If already loaded, return as-is
  if (track.url) {
    logger.debug(`${LOADER_LOG_PREFIX} Audio track already has URL`, {
      bookId,
      trackId: track.id,
      trackHref: track.href,
      trackTitle: track.title,
    });
    return track;
  }

  logger.debug(`${LOADER_LOG_PREFIX} Ensuring audio track is loaded`, {
    bookId,
    trackId: track.id,
    trackHref: track.href,
    trackTitle: track.title,
  });

  try {
    const url = await loadAudioTrackUrl(bookId, track);
    
    if (url) {
      logger.debug(`${LOADER_LOG_PREFIX} ✓ Successfully loaded audio track URL`, {
        bookId,
        trackId: track.id,
        trackHref: track.href,
        urlLength: url.length,
      });
      return {
        ...track,
        url,
        _loading: false,
      };
    } else {
      logger.warn(`${LOADER_LOG_PREFIX} ✗ Audio track URL returned null`, {
        bookId,
        trackId: track.id,
        trackHref: track.href,
      });
      return { ...track, _loading: false };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`${LOADER_LOG_PREFIX} ✗ Failed to ensure audio track loaded`, {
      bookId,
      trackId: track.id,
      href: track.href,
      error: errorMessage,
    });
    // Show user-friendly error toast
    toast.error("Failed to load audio track", {
      description: errorMessage || `Unable to load "${track.title || track.href}"`,
    });
    // Return track with loading flag cleared even on error
    return { ...track, _loading: false };
  }
}

/**
 * Preload all chapters and audio tracks for a book
 * This replaces lazy loading by loading everything upfront
 */
export async function preloadBookContent(
  bookId: string,
  chapters: Chapter[],
  audioTracks: AudioTrack[],
): Promise<{ chapters: Chapter[]; audioTracks: AudioTrack[] }> {
  logger.debug(`${LOADER_LOG_PREFIX} preloading all content for book`, {
    bookId,
    chapterCount: chapters.length,
    audioTrackCount: audioTracks.length,
  });

  // Load all chapters in parallel
  const loadedChapters = await Promise.all(
    chapters.map(async (chapter) => {
      // Skip if already loaded
      if (chapter.contentHtml && chapter.plainText) {
        return chapter;
      }
      try {
        return await ensureChapterLoaded(bookId, chapter);
      } catch (error) {
        logger.error(`${LOADER_LOG_PREFIX} failed to preload chapter`, {
          bookId,
          href: chapter.href,
          error,
        });
        return chapter;
      }
    }),
  );

  // Load all audio tracks in parallel
  const loadedAudioTracks = await Promise.all(
    audioTracks.map(async (track) => {
      // Skip if already loaded
      if (track.url) {
        return track;
      }
      try {
        return await ensureAudioTrackLoaded(bookId, track);
      } catch (error) {
        logger.error(`${LOADER_LOG_PREFIX} failed to preload audio track`, {
          bookId,
          href: track.href,
          error,
        });
        return track;
      }
    }),
  );

  logger.debug(`${LOADER_LOG_PREFIX} finished preloading book content`, {
    bookId,
    loadedChapters: loadedChapters.filter(c => c.contentHtml && c.plainText).length,
    loadedAudioTracks: loadedAudioTracks.filter(t => t.url).length,
  });

  return {
    chapters: loadedChapters,
    audioTracks: loadedAudioTracks,
  };
}

