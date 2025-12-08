/**
 * Hook for loading and caching audio tracks
 * No useEffects - all loading is explicit via callbacks
 */

import { useCallback, useRef, useState } from "react";
import type { AudioTrack } from "../../types/reader";
import { loadEpubAudio } from "../../lib/book-service";

type AudioCacheEntry = {
  track: AudioTrack;
  loadedAt: number;
};

export function useAudioTrackLoader() {
  const cacheRef = useRef<Map<string, AudioCacheEntry>>(new Map());
  const [loadedTracks, setLoadedTracks] = useState<Map<string, AudioTrack>>(new Map());

  const loadTrack = useCallback(async (
    bookId: string,
    track: AudioTrack
  ): Promise<AudioTrack | null> => {
    const cacheKey = `${bookId}:${track.id}`;
    
    // Check cache first
    const cached = cacheRef.current.get(cacheKey);
    if (cached && cached.track.url) {
      return cached.track;
    }

    // If track already has URL, cache and return it
    if (track.url) {
      cacheRef.current.set(cacheKey, {
        track,
        loadedAt: Date.now(),
      });
      setLoadedTracks(prev => new Map(prev).set(track.id, track));
      return track;
    }

    // Load from backend
    console.log("[useAudioTrackLoader] Loading audio track", {
      bookId,
      trackId: track.id,
      trackHref: track.href,
      trackTitle: track.title,
    });
    try {
      const dataUrl = await loadEpubAudio(bookId, track.href);
      if (dataUrl) {
        const loaded: AudioTrack = { ...track, url: dataUrl };
        // Cache it
        cacheRef.current.set(cacheKey, {
          track: loaded,
          loadedAt: Date.now(),
        });
        setLoadedTracks(prev => new Map(prev).set(track.id, loaded));
        console.log("[useAudioTrackLoader] ✓ Successfully loaded audio track", {
          bookId,
          trackId: track.id,
          trackHref: track.href,
          dataUrlLength: dataUrl.length,
        });
        return loaded;
      } else {
        console.warn("[useAudioTrackLoader] ✗ Audio track returned null", {
          bookId,
          trackId: track.id,
          trackHref: track.href,
        });
      }
    } catch (error) {
      console.error("[useAudioTrackLoader] ✗ Error loading audio track:", {
        bookId,
        trackId: track.id,
        trackHref: track.href,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return null;
  }, []);

  const getCachedTrack = useCallback((bookId: string, trackId: string): AudioTrack | null => {
    const cacheKey = `${bookId}:${trackId}`;
    const cached = cacheRef.current.get(cacheKey);
    return cached?.track || null;
  }, []);

  const isTrackLoaded = useCallback((bookId: string, trackId: string): boolean => {
    const cacheKey = `${bookId}:${trackId}`;
    return cacheRef.current.has(cacheKey) || loadedTracks.has(trackId);
  }, [loadedTracks]);

  const clearCache = useCallback((bookId?: string) => {
    if (bookId) {
      // Clear only this book's tracks
      const keysToDelete: string[] = [];
      cacheRef.current.forEach((_, key) => {
        if (key.startsWith(`${bookId}:`)) {
          keysToDelete.push(key);
        }
      });
      keysToDelete.forEach(key => {
        const entry = cacheRef.current.get(key);
        if (entry) {
          loadedTracks.delete(entry.track.id);
        }
        cacheRef.current.delete(key);
      });
      setLoadedTracks(prev => {
        const next = new Map(prev);
        keysToDelete.forEach(key => {
          const entry = cacheRef.current.get(key);
          if (entry) {
            next.delete(entry.track.id);
          }
        });
        return next;
      });
    } else {
      // Clear all
      cacheRef.current.clear();
      setLoadedTracks(new Map());
    }
  }, [loadedTracks]);

  return {
    loadTrack,
    getCachedTrack,
    isTrackLoaded,
    clearCache,
    loadedTracks,
  };
}

