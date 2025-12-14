/**
 * Hook for loading and caching audio tracks
 * Uses generic useResourceLoader internally
 * No useEffects - all loading is explicit via callbacks
 */

import { useCallback, useEffect, useRef, useMemo } from "react";
import type { AudioTrack } from "../../types/reader";
import { loadEpubAudioBlob } from "../../lib/book-service";
import { useResourceLoader } from "../useResourceLoader";
import { useReaderCoordinator } from "../../contexts/ReaderCoordinatorContext";
import { blobURLManager } from "../../lib/blob-url-manager";

export function useAudioTrackLoader() {
  // Get coordinator for operation management
  const coordinator = useReaderCoordinator();
  
  // Track current book ID for cleanup
  const currentBookIdRef = useRef<string | null>(null);
  // Use ref instead of state to avoid re-renders (memory optimization)
  const cacheVersionRef = useRef(0);

  const loader = useResourceLoader<AudioTrack>({
    isLoaded: (track) => !!track.url,
    loadResource: async (bookId, track) => {
      // Check if operation is cancelled
      const currentOp = coordinator.getCurrentOperation("loadAudioTrack");
      if (currentOp?.cancelled) {
        throw new Error("Audio track load cancelled");
      }
      
      // Use coordinator to load track
      const url = await coordinator.loadAudioTrack(bookId, track.id);
      if (url) {
        // NOTE: url is already registered by loadEpubAudioBlob (via coordinator)
        // No need to register again - that would cause duplicates
        currentBookIdRef.current = bookId;
        return { ...track, url };
      }
      
      // Fallback to direct loading if coordinator doesn't have handler
      console.log("[useAudioTrackLoader] Loading audio track", {
        bookId,
        trackId: track.id,
        trackHref: track.href,
        trackTitle: track.title,
      });
      try {
        const blobUrl = await loadEpubAudioBlob(bookId, track.href);
        if (blobUrl) {
          // NOTE: blobUrl is already registered by loadEpubAudioBlob
          // No need to register again - that would cause duplicates
          currentBookIdRef.current = bookId;
          
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
      // Increment cache version (using ref - no re-render)
      cacheVersionRef.current += 1;
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
    // Revoke Blob URLs before clearing cache using centralized manager
    if (bookId) {
      // Revoke all blob URLs for this book
      blobURLManager.revokeForBook(bookId);
    } else {
      // Get cached resources from the loader and revoke their blob URLs
      const cachedTracks = loader.getCachedResources();
      for (const track of cachedTracks) {
        if (track.url && track.url.startsWith("blob:")) {
          blobURLManager.revoke(track.url);
        }
      }
    }
    loader.clearCache(bookId);
    // Increment cache version (using ref - no re-render)
    cacheVersionRef.current += 1;
  }, [loader]);

  // Get all loaded tracks as a Map (computed on-demand from cache)
  // No memoization with cacheVersion - computed fresh each time to avoid memory duplication
  // The cache itself is the single source of truth
  const loadedTracks = useMemo(() => {
    const tracks = loader.getCachedResources();
    return new Map(tracks.map(track => [track.id, track]));
  }, [loader]);

  return {
    loadTrack,
    getCachedTrack,
    isTrackLoaded,
    clearCache,
    loadedTracks,
  };
}

