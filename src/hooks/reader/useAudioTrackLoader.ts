/**
 * Hook for loading and caching audio tracks
 * Uses generic useResourceLoader internally
 * No useEffects - all loading is explicit via callbacks
 */

import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import type { AudioTrack } from "../../types/reader";
import { loadEpubAudioBlob } from "../../lib/book-service";
import { useResourceLoader } from "./useResourceLoader";

export function useAudioTrackLoader() {
  // Track Blob URLs for cleanup
  const blobUrlsRef = useRef<Set<string>>(new Set());
  // Track cache version to trigger updates (minimal state for memory optimization)
  const [cacheVersion, setCacheVersion] = useState(0);

  // Cleanup Blob URLs on unmount
  useEffect(() => {
    return () => {
      blobUrlsRef.current.forEach((url) => {
        URL.revokeObjectURL(url);
      });
      blobUrlsRef.current.clear();
    };
  }, []);

  const loader = useResourceLoader<AudioTrack>({
    isLoaded: (track) => !!track.url,
    loadResource: async (bookId, track) => {
      console.log("[useAudioTrackLoader] Loading audio track", {
        bookId,
        trackId: track.id,
        trackHref: track.href,
        trackTitle: track.title,
      });
      try {
        const blobUrl = await loadEpubAudioBlob(bookId, track.href);
        if (blobUrl) {
          // Track Blob URL for cleanup
          blobUrlsRef.current.add(blobUrl);
          
          const loaded: AudioTrack = { ...track, url: blobUrl };
          console.log("[useAudioTrackLoader] ✓ Successfully loaded audio track", {
            bookId,
            trackId: track.id,
            trackHref: track.href,
            isBlobUrl: blobUrl.startsWith("blob:"),
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
    },
    getResourceId: (track) => track.id,
    logPrefix: "[useAudioTrackLoader]",
  });

  const loadTrack = useCallback(async (
    bookId: string,
    track: AudioTrack
  ): Promise<AudioTrack | null> => {
    const result = await loader.load(bookId, track);
    if (result) {
      // Increment cache version to trigger loadedTracks update
      setCacheVersion(prev => prev + 1);
    }
    return result;
  }, [loader]);

  const getCachedTrack = useCallback((bookId: string, trackId: string): AudioTrack | null => {
    return loader.getCached(bookId, trackId);
  }, [loader]);

  const isTrackLoaded = useCallback((bookId: string, trackId: string): boolean => {
    return loader.isResourceLoaded(bookId, trackId);
  }, [loader]);

  const clearCache = useCallback((bookId?: string) => {
    // Revoke Blob URLs before clearing cache
    // Get cached resources from the loader
    const cachedTracks = loader.getCachedResources(bookId);
    for (const track of cachedTracks) {
      if (track.url && track.url.startsWith("blob:")) {
        URL.revokeObjectURL(track.url);
        blobUrlsRef.current.delete(track.url);
      }
    }
    loader.clearCache(bookId);
    // Increment cache version to trigger loadedTracks update
    setCacheVersion(prev => prev + 1);
  }, [loader]);

  // Get all loaded tracks as a Map (computed from cache)
  // Use cacheVersion to ensure it updates when cache changes
  const loadedTracks = useMemo(() => {
    const tracks = loader.getCachedResources();
    return new Map(tracks.map(track => [track.id, track]));
  }, [loader, cacheVersion]);

  return {
    loadTrack,
    getCachedTrack,
    isTrackLoaded,
    clearCache,
    loadedTracks,
  };
}

