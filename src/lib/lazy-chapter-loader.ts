/**
 * Lazy chapter loader - loads chapter content from Rust backend on demand
 * This prevents keeping all chapter content in memory at once
 */

import { loadChapterContent as loadChapterContentFromBackend } from "./book-service";
import type { Chapter, AudioTrack } from "../types/reader";
import {
  normalizeChapterContent,
  sanitizeChapterHtml,
  extractPlainText,
} from "./epub";
import { countWords, estimatePagesFromWords } from "./utils";

const LOADER_LOG_PREFIX = "[LazyChapterLoader]";

// Cache for loaded chapters to avoid reloading
const chapterCache = new Map<string, { contentHtml: string; plainText: string; wordCount: number }>();

// Cache for loaded audio track URLs
const audioTrackCache = new Map<string, string>();

/**
 * Clear cache for a book (useful when book is deleted or updated)
 */
export function clearBookCache(sourcePath: string): void {
  const bookId = sourcePath;
  // Clear all chapters for this book
  const keysToDelete: string[] = [];
  chapterCache.forEach((_, key) => {
    if (key.startsWith(`${bookId}:`)) {
      keysToDelete.push(key);
    }
  });
  keysToDelete.forEach((key) => chapterCache.delete(key));
  
  // Clear all audio tracks for this book
  const audioKeysToDelete: string[] = [];
  audioTrackCache.forEach((_, key) => {
    if (key.startsWith(`${bookId}:`)) {
      audioKeysToDelete.push(key);
    }
  });
  audioKeysToDelete.forEach((key) => audioTrackCache.delete(key));
  
  console.debug(`${LOADER_LOG_PREFIX} cleared cache for book`, {
    sourcePath,
    clearedChapters: keysToDelete.length,
    clearedAudioTracks: audioKeysToDelete.length,
  });
}

/**
 * Clear cache for all books except the specified one
 * Useful for keeping only the currently open book in memory
 */
export function clearAllCachesExcept(sourcePath: string): void {
  const keepBookId = sourcePath;
  let clearedChapters = 0;
  
  // Clear all chapters except those for the specified book
  const keysToDelete: string[] = [];
  chapterCache.forEach((_, key) => {
    if (!key.startsWith(`${keepBookId}:`)) {
      keysToDelete.push(key);
      clearedChapters++;
    }
  });
  keysToDelete.forEach((key) => chapterCache.delete(key));
  
  // Clear all audio track URLs except those for the specified book
  const audioKeysToDelete: string[] = [];
  audioTrackCache.forEach((_, key) => {
    if (!key.startsWith(`${keepBookId}:`)) {
      audioKeysToDelete.push(key);
    }
  });
  audioKeysToDelete.forEach((key) => audioTrackCache.delete(key));
  
  console.debug(`${LOADER_LOG_PREFIX} cleared all caches except book`, {
    keepSourcePath: sourcePath,
    clearedChapters,
    clearedAudioTracks: audioKeysToDelete.length,
  });
}


/**
 * Load a single chapter's content from Rust backend
 */
export async function loadChapterContent(
  bookId: string,
  chapter: Chapter,
): Promise<{ contentHtml: string; plainText: string; wordCount: number }> {
  const cacheKey = `${bookId}:${chapter.href}`;
  
  // Check cache first
  if (chapterCache.has(cacheKey)) {
    const cached = chapterCache.get(cacheKey)!;
    console.debug(`${LOADER_LOG_PREFIX} using cached chapter`, { bookId, href: chapter.href });
    return cached;
  }

  try {
    // Load chapter content from Rust backend
    // Try alternative href formats if primary load fails
    const alternatives = [
      chapter.href,
      chapter.href.replace(/^\/+/, ""),
      chapter.href.replace(/^OEBPS\//, ""),
      `OEBPS/${chapter.href.replace(/^\/+/, "").replace(/^OEBPS\//, "")}`,
    ];
    
    let loadedChapter: Chapter | null = null;
    for (const altHref of alternatives) {
      try {
        loadedChapter = await loadChapterContentFromBackend(bookId, altHref);
        if (loadedChapter && loadedChapter.contentHtml) {
          if (altHref !== chapter.href) {
            console.debug(`${LOADER_LOG_PREFIX} loaded chapter using alternative href: ${altHref} (original: ${chapter.href})`);
          }
          break;
        }
      } catch (error) {
        // Continue to next alternative
        console.debug(`${LOADER_LOG_PREFIX} failed to load with href ${altHref}, trying next`, { error });
      }
    }
    
    if (!loadedChapter || !loadedChapter.contentHtml) {
      throw new Error(`Failed to load chapter content: ${chapter.href}`);
    }
    
    const rawHtml = loadedChapter.contentHtml;
    const normalizedHtml = await normalizeChapterContent(rawHtml);
    if (!normalizedHtml) {
      throw new Error(`Failed to normalize chapter: ${chapter.href}`);
    }

    // Note: Image and CSS resolution will be handled separately
    // For now, we just sanitize the HTML
    const parser = new DOMParser();
    const doc = parser.parseFromString(normalizedHtml, "text/html");

    const substitutedHtml = new XMLSerializer().serializeToString(doc);
    const sanitized = sanitizeChapterHtml(substitutedHtml);
    
    if (!sanitized.trim()) {
      throw new Error(`Chapter content is empty: ${chapter.href}`);
    }

    const plainText = extractPlainText(sanitized);
    const wordCount = countWords(plainText);

    // Cache the result
    const result = { contentHtml: sanitized, plainText, wordCount };
    chapterCache.set(cacheKey, result);
    
    console.debug(`${LOADER_LOG_PREFIX} loaded chapter`, {
      bookId,
      href: chapter.href,
      wordCount,
    });

    return result;
  } catch (error) {
    console.error(`${LOADER_LOG_PREFIX} failed to load chapter`, {
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
  // If already loaded, return as-is
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
    console.error(`${LOADER_LOG_PREFIX} failed to ensure chapter loaded`, {
      bookId,
      href: chapter.href,
      error,
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
  const cacheKey = `${bookId}:${track.href}`;
  
  // Check cache first
  if (audioTrackCache.has(cacheKey)) {
    const cachedUrl = audioTrackCache.get(cacheKey)!;
    console.debug(`${LOADER_LOG_PREFIX} using cached audio track URL`, {
      bookId,
      href: track.href,
    });
    return cachedUrl;
  }

  // TODO: Implement audio track loading from Rust backend
  // For now, throw an error indicating this needs to be implemented
  throw new Error("Audio track loading from Rust backend not yet implemented");
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
    return track;
  }

  try {
    const url = await loadAudioTrackUrl(bookId, track);
    
    return {
      ...track,
      url,
      _loading: false,
    };
  } catch (error) {
    console.error(`${LOADER_LOG_PREFIX} failed to ensure audio track loaded`, {
      bookId,
      href: track.href,
      error,
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
  console.debug(`${LOADER_LOG_PREFIX} preloading all content for book`, {
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
        console.error(`${LOADER_LOG_PREFIX} failed to preload chapter`, {
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
        console.error(`${LOADER_LOG_PREFIX} failed to preload audio track`, {
          bookId,
          href: track.href,
          error,
        });
        return track;
      }
    }),
  );

  console.debug(`${LOADER_LOG_PREFIX} finished preloading book content`, {
    bookId,
    loadedChapters: loadedChapters.filter(c => c.contentHtml && c.plainText).length,
    loadedAudioTracks: loadedAudioTracks.filter(t => t.url).length,
  });

  return {
    chapters: loadedChapters,
    audioTracks: loadedAudioTracks,
  };
}

