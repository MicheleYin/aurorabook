/**
 * Centralized Resource Cache Manager
 * 
 * Single source of truth for all resource caching (chapters, audio tracks, etc.)
 * Provides LRU eviction, TTL expiration, and proper cleanup.
 * 
 * Cache Strategy:
 * - Chapters: Max 5, 15min TTL
 * - Audio Tracks: Max 1, 30min TTL
 * - Automatic blob URL revocation on eviction
 * - Per-book resource limits to prevent unbounded growth
 */

import { LRUCache } from "lru-cache";
import { logger } from "./logger";
import { blobURLManager } from "./blob-url-manager";
import type { Chapter, AudioTrack } from "../types/reader";

const CACHE_LOG_PREFIX = "[ResourceCacheManager]";

/**
 * Cache entry for chapters
 */
type ChapterCacheEntry = {
  contentHtml: string;
  plainText: string;
  wordCount: number;
  loadedAt: number;
};

/**
 * Cache entry for audio tracks
 */
type AudioTrackCacheEntry = {
  url: string;
  loadedAt: number;
};

/**
 * Centralized Resource Cache Manager
 * Singleton instance shared across all hooks
 */
class ResourceCacheManager {
  // Chapter cache: Max 5 chapters, 15min TTL
  private chapterCache = new LRUCache<string, ChapterCacheEntry>({
    max: 5,
    ttl: 1000 * 60 * 15, // 15 minutes
    updateAgeOnGet: true, // Update access time on get (LRU behavior)
    dispose: (value, key) => {
      logger.debug(`${CACHE_LOG_PREFIX} Evicting chapter from cache`, {
        cacheKey: key,
        wordCount: value.wordCount,
      });
    },
  });

  // Audio track cache: Max 1 track, 30min TTL
  private audioTrackCache = new LRUCache<string, AudioTrackCacheEntry>({
    max: 1,
    ttl: 1000 * 60 * 30, // 30 minutes
    updateAgeOnGet: true,
    dispose: (value, key) => {
      // Revoke blob URL when track is evicted
      if (value.url && value.url.startsWith("blob:")) {
        const bookId = key.split(":")[0];
        logger.debug(`${CACHE_LOG_PREFIX} Evicting audio track from cache, revoking blob URL`, {
          bookId,
          cacheKey: key,
          blobUrl: value.url.substring(0, 50) + "...",
        });
        blobURLManager.revoke(value.url);
      }
    },
  });

  // Track per-book resource counts for eviction
  private bookResourceCounts = new Map<string, number>();

  /**
   * Get chapter from cache
   */
  getChapter(bookId: string, chapterId: string): ChapterCacheEntry | undefined {
    const key = `${bookId}:${chapterId}`;
    return this.chapterCache.get(key);
  }

  /**
   * Set chapter in cache
   */
  setChapter(
    bookId: string,
    chapterId: string,
    contentHtml: string,
    plainText: string,
    wordCount: number
  ): void {
    const key = `${bookId}:${chapterId}`;
    this.chapterCache.set(key, {
      contentHtml,
      plainText,
      wordCount,
      loadedAt: Date.now(),
    });
    
    // Track resource count per book
    const count = this.bookResourceCounts.get(bookId) || 0;
    this.bookResourceCounts.set(bookId, count + 1);
    
    logger.debug(`${CACHE_LOG_PREFIX} Cached chapter`, {
      bookId,
      chapterId,
      cacheSize: this.chapterCache.size,
    });
  }

  /**
   * Check if chapter is cached
   */
  hasChapter(bookId: string, chapterId: string): boolean {
    const key = `${bookId}:${chapterId}`;
    return this.chapterCache.has(key);
  }

  /**
   * Delete chapter from cache
   */
  deleteChapter(bookId: string, chapterId: string): void {
    const key = `${bookId}:${chapterId}`;
    if (this.chapterCache.delete(key)) {
      const count = this.bookResourceCounts.get(bookId) || 0;
      this.bookResourceCounts.set(bookId, Math.max(0, count - 1));
      logger.debug(`${CACHE_LOG_PREFIX} Deleted chapter from cache`, {
        bookId,
        chapterId,
      });
    }
  }

  /**
   * Get audio track from cache
   */
  getAudioTrack(bookId: string, trackId: string): AudioTrackCacheEntry | undefined {
    const key = `${bookId}:${trackId}`;
    return this.audioTrackCache.get(key);
  }

  /**
   * Set audio track in cache
   */
  setAudioTrack(bookId: string, trackId: string, url: string): void {
    const key = `${bookId}:${trackId}`;
    this.audioTrackCache.set(key, {
      url,
      loadedAt: Date.now(),
    });
    
    logger.debug(`${CACHE_LOG_PREFIX} Cached audio track`, {
      bookId,
      trackId,
      isBlobUrl: url.startsWith("blob:"),
    });
  }

  /**
   * Check if audio track is cached
   */
  hasAudioTrack(bookId: string, trackId: string): boolean {
    const key = `${bookId}:${trackId}`;
    return this.audioTrackCache.has(key);
  }

  /**
   * Delete audio track from cache
   */
  deleteAudioTrack(bookId: string, trackId: string): void {
    const key = `${bookId}:${trackId}`;
    const entry = this.audioTrackCache.peek(key);
    if (entry && entry.url.startsWith("blob:")) {
      blobURLManager.revoke(entry.url);
    }
    if (this.audioTrackCache.delete(key)) {
      logger.debug(`${CACHE_LOG_PREFIX} Deleted audio track from cache`, {
        bookId,
        trackId,
      });
    }
  }

  /**
   * Clear all cache entries for a specific book
   */
  clearBook(bookId: string): void {
    // Clear chapters
    const chapterKeys: string[] = [];
    for (const key of this.chapterCache.keys()) {
      if (key.startsWith(`${bookId}:`)) {
        chapterKeys.push(key);
      }
    }
    chapterKeys.forEach(key => this.chapterCache.delete(key));

    // Clear audio tracks and revoke blob URLs
    const audioKeys: string[] = [];
    for (const key of this.audioTrackCache.keys()) {
      if (key.startsWith(`${bookId}:`)) {
        audioKeys.push(key);
      }
    }
    audioKeys.forEach(key => {
      const entry = this.audioTrackCache.peek(key);
      if (entry && entry.url.startsWith("blob:")) {
        blobURLManager.revoke(entry.url);
      }
      this.audioTrackCache.delete(key);
    });

    // Clear resource count
    this.bookResourceCounts.delete(bookId);

    logger.debug(`${CACHE_LOG_PREFIX} Cleared cache for book`, {
      bookId,
      clearedChapters: chapterKeys.length,
      clearedAudioTracks: audioKeys.length,
    });
  }

  /**
   * Clear all cache entries except for a specific book
   */
  clearAllExcept(bookId: string): void {
    // Clear chapters for all books except the specified one
    const chapterKeys: string[] = [];
    for (const key of this.chapterCache.keys()) {
      if (!key.startsWith(`${bookId}:`)) {
        chapterKeys.push(key);
      }
    }
    chapterKeys.forEach(key => this.chapterCache.delete(key));

    // Clear audio tracks for all books except the specified one
    const audioKeys: string[] = [];
    for (const key of this.audioTrackCache.keys()) {
      if (!key.startsWith(`${bookId}:`)) {
        audioKeys.push(key);
        const entry = this.audioTrackCache.peek(key);
        if (entry && entry.url.startsWith("blob:")) {
          blobURLManager.revoke(entry.url);
        }
      }
    }
    audioKeys.forEach(key => this.audioTrackCache.delete(key));

    // Clear resource counts for all books except the specified one
    for (const [bid] of this.bookResourceCounts) {
      if (bid !== bookId) {
        this.bookResourceCounts.delete(bid);
      }
    }

    logger.debug(`${CACHE_LOG_PREFIX} Cleared cache for all books except`, {
      bookId,
      clearedChapters: chapterKeys.length,
      clearedAudioTracks: audioKeys.length,
    });
  }

  /**
   * Clear all caches
   */
  clearAll(): void {
    // Revoke all blob URLs before clearing
    for (const key of this.audioTrackCache.keys()) {
      const entry = this.audioTrackCache.peek(key);
      if (entry && entry.url.startsWith("blob:")) {
        blobURLManager.revoke(entry.url);
      }
    }

    this.chapterCache.clear();
    this.audioTrackCache.clear();
    this.bookResourceCounts.clear();

    logger.debug(`${CACHE_LOG_PREFIX} Cleared all caches`);
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    chapterCount: number;
    audioTrackCount: number;
    bookCount: number;
  } {
    return {
      chapterCount: this.chapterCache.size,
      audioTrackCount: this.audioTrackCache.size,
      bookCount: this.bookResourceCounts.size,
    };
  }

  /**
   * Get all cached chapters for a book
   */
  getChaptersForBook(bookId: string): Map<string, ChapterCacheEntry> {
    const chapters = new Map<string, ChapterCacheEntry>();
    for (const key of this.chapterCache.keys()) {
      if (key.startsWith(`${bookId}:`)) {
        const chapterId = key.split(":")[1];
        const entry = this.chapterCache.get(key);
        if (entry) {
          chapters.set(chapterId, entry);
        }
      }
    }
    return chapters;
  }

  /**
   * Get all cached audio tracks for a book
   */
  getAudioTracksForBook(bookId: string): Map<string, AudioTrackCacheEntry> {
    const tracks = new Map<string, AudioTrackCacheEntry>();
    for (const key of this.audioTrackCache.keys()) {
      if (key.startsWith(`${bookId}:`)) {
        const trackId = key.split(":")[1];
        const entry = this.audioTrackCache.get(key);
        if (entry) {
          tracks.set(trackId, entry);
        }
      }
    }
    return tracks;
  }
}

// Singleton instance
export const resourceCacheManager = new ResourceCacheManager();



