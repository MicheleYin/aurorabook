/**
 * Lazy chapter loader - loads chapter content from Rust backend on demand
 * This prevents keeping all chapter content in memory at once
 */

import { loadChapterContent as loadChapterContentFromBackend, loadEpubAudio } from "./book-service";
import type { Chapter, AudioTrack } from "../types/reader";
import {
  normalizeChapterContent,
  sanitizeChapterHtml,
  extractPlainText,
} from "./epub";
import { countWords, estimatePagesFromWords } from "./utils";
import { LRUCache } from "lru-cache";

const LOADER_LOG_PREFIX = "[LazyChapterLoader]";

// Cache for loaded chapters to avoid reloading
const chapterCache = new LRUCache<string, { contentHtml: string; plainText: string; wordCount: number }>({
  max: 50, // Keep max 50 chapters in memory
  ttl: 1000 * 60 * 30, // 30 minutes TTL
});

// Cache for loaded audio track URLs - using LRU cache like chapters
const audioTrackCache = new LRUCache<string, string>({
  max: 10, // Keep max 10 audio tracks in memory (more than chapters since they're just URLs)
  ttl: 1000 * 60 * 30, // 30 minutes TTL
});

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
  for (const key of audioTrackCache.keys()) {
    if (key.startsWith(`${bookId}:`)) {
      audioKeysToDelete.push(key);
    }
  }
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
  for (const key of audioTrackCache.keys()) {
    if (!key.startsWith(`${keepBookId}:`)) {
      audioKeysToDelete.push(key);
    }
  }
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
    console.debug(`${LOADER_LOG_PREFIX} using cached chapter`, { 
      bookId, 
      href: chapter.href,
    });
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
    
    // Backend now handles image resolution, so we just normalize and sanitize
    const rawHtml = loadedChapter.contentHtml;
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
    console.log(`${LOADER_LOG_PREFIX} using cached audio track URL`, {
      bookId,
      trackId: track.id,
      href: track.href,
      urlLength: cachedUrl.length,
    });
    return cachedUrl;
  }

  console.log(`${LOADER_LOG_PREFIX} Loading audio track URL from backend`, {
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
    
    console.log(`${LOADER_LOG_PREFIX} Trying ${alternatives.length} href alternatives`, {
      bookId,
      trackHref: track.href,
      alternatives,
    });
    
    let dataUrl: string | null = null;
    for (const altHref of alternatives) {
      try {
        console.log(`${LOADER_LOG_PREFIX} Trying to load audio with href: ${altHref}`);
        dataUrl = await loadEpubAudio(bookId, altHref);
        if (dataUrl) {
          if (altHref !== track.href) {
            console.log(`${LOADER_LOG_PREFIX} ✓ Loaded audio track using alternative href: ${altHref} (original: ${track.href})`);
          } else {
            console.log(`${LOADER_LOG_PREFIX} ✓ Loaded audio track with original href: ${track.href}`);
          }
          break;
        } else {
          console.warn(`${LOADER_LOG_PREFIX} Audio track returned null for href: ${altHref}`);
        }
      } catch (error) {
        // Continue to next alternative
        console.warn(`${LOADER_LOG_PREFIX} Failed to load with href ${altHref}, trying next`, { 
          error: error instanceof Error ? error.message : String(error) 
        });
      }
    }
    
    if (!dataUrl) {
      throw new Error(`Failed to load audio track: ${track.href} (tried ${alternatives.length} alternatives)`);
    }
    
    // Cache the result
    audioTrackCache.set(cacheKey, dataUrl);
    
    console.log(`${LOADER_LOG_PREFIX} ✓ Successfully loaded and cached audio track URL`, {
      bookId,
      trackId: track.id,
      href: track.href,
      urlLength: dataUrl.length,
    });
    
    return dataUrl;
  } catch (error) {
    console.error(`${LOADER_LOG_PREFIX} ✗ Failed to load audio track URL`, {
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
    console.log(`${LOADER_LOG_PREFIX} Audio track already has URL`, {
      bookId,
      trackId: track.id,
      trackHref: track.href,
      trackTitle: track.title,
    });
    return track;
  }

  console.log(`${LOADER_LOG_PREFIX} Ensuring audio track is loaded`, {
    bookId,
    trackId: track.id,
    trackHref: track.href,
    trackTitle: track.title,
  });

  try {
    const url = await loadAudioTrackUrl(bookId, track);
    
    if (url) {
      console.log(`${LOADER_LOG_PREFIX} ✓ Successfully loaded audio track URL`, {
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
      console.warn(`${LOADER_LOG_PREFIX} ✗ Audio track URL returned null`, {
        bookId,
        trackId: track.id,
        trackHref: track.href,
      });
      return { ...track, _loading: false };
    }
  } catch (error) {
    console.error(`${LOADER_LOG_PREFIX} ✗ Failed to ensure audio track loaded`, {
      bookId,
      trackId: track.id,
      href: track.href,
      error: error instanceof Error ? error.message : String(error),
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

