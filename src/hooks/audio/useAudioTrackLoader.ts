/**
 * Hook for loading and caching audio tracks
 * Uses generic useResourceLoader internally
 * No useEffects - all loading is explicit via callbacks
 */

import { useCallback, useRef, useMemo, useState } from "react";
import { toast } from "sonner";
import type { AudioTrack } from "../../types/reader";
import { loadEpubAudioBlob } from "../../lib/book-service";
import { useResourceLoader } from "../useResourceLoader";
import { useReaderCoordinator } from "../reader/useReaderCoordinatorRedux";
import { blobURLManager } from "../../lib/blob-url-manager";
import { logger } from "../../lib/logger";

export function useAudioTrackLoader() {
  // Get coordinator for operation management
  const coordinator = useReaderCoordinator();
  
  // Track current book ID for cleanup
  const currentBookIdRef = useRef<string | null>(null);
  // Track cache changes with state to trigger re-render when needed
  const [cacheVersion, setCacheVersion] = useState(0);

  // Memoize loadResource callback to prevent loader recreation
  const loadResourceCallback = useCallback(async (bookId: string, track: AudioTrack, signal?: AbortSignal) => {
    // Check if operation is cancelled
    if (signal?.aborted) {
      throw new Error("Audio track load cancelled");
    }
    
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
    // Try alternative href formats if primary load fails (same as loadAudioTrackUrl)
    logger.debug("[useAudioTrackLoader] Loading audio track", {
      bookId,
      trackId: track.id,
      trackHref: track.href,
      trackTitle: track.title,
    });
    
    const alternatives = [
      track.href,
      track.href.replace(/^\/+/, ""),
      track.href.replace(/^OEBPS\//, ""),
      `OEBPS/${track.href.replace(/^\/+/, "").replace(/^OEBPS\//, "")}`,
    ];
    
    logger.debug("[useAudioTrackLoader] Trying href alternatives", {
      bookId,
      trackHref: track.href,
      alternatives,
    });
    
    let blobUrl: string | null = null;
    for (const altHref of alternatives) {
      try {
        logger.debug("[useAudioTrackLoader] Trying to load audio with href:", altHref);
        blobUrl = await loadEpubAudioBlob(bookId, altHref);
        if (blobUrl) {
          if (altHref !== track.href) {
            logger.debug("[useAudioTrackLoader] ✓ Loaded audio track using alternative href", {
              altHref,
              originalHref: track.href,
            });
          } else {
            logger.debug("[useAudioTrackLoader] ✓ Loaded audio track with original href", {
              trackHref: track.href,
            });
          }
          break;
        } else {
          logger.warn("[useAudioTrackLoader] Audio track returned null for href", {
            altHref,
          });
        }
      } catch (error) {
        // Continue to next alternative
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.warn("[useAudioTrackLoader] Failed to load with href, trying next", {
          altHref,
          error: errorMessage,
        });
      }
    }
    
    if (blobUrl) {
      // NOTE: blobUrl is already registered by loadEpubAudioBlob
      // No need to register again - that would cause duplicates
      currentBookIdRef.current = bookId;
      
      const loaded: AudioTrack = { ...track, url: blobUrl };
      logger.debug("[useAudioTrackLoader] ✓ Successfully loaded audio track", {
        bookId,
        trackId: track.id,
        trackHref: track.href,
        isBlobUrl: blobUrl.startsWith("blob:"),
      });
      return loaded;
    } else {
      // Check for cancellation before logging
      if (signal?.aborted) {
        throw new Error("Audio track load cancelled");
      }
      const errorMessage = `Failed to load audio track: ${track.href} (tried ${alternatives.length} alternatives)`;
      logger.error("[useAudioTrackLoader] ✗ Audio track returned null for all alternatives", {
        bookId,
        trackId: track.id,
        trackHref: track.href,
        alternatives,
      });
      toast.error("Failed to load audio track", {
        description: errorMessage || `Unable to load "${track.title || track.id}"`,
      });
      throw new Error(errorMessage);
    }
  }, [coordinator]);

  const loader = useResourceLoader<AudioTrack>({
    isLoaded: (track) => !!track.url,
    loadResource: loadResourceCallback,
    getResourceId: (track) => track.id,
    logPrefix: "[useAudioTrackLoader]",
    retryOptions: {
      maxRetries: 2,
      retryDelay: 1000,
    },
  });

  // Extract stable functions from loader to avoid dependency on loader object
  const { load: loaderLoad, getCached: loaderGetCached, isResourceLoaded: loaderIsResourceLoaded, getCachedResources: loaderGetCachedResources, clearCache: loaderClearCache } = loader;

  const loadTrack = useCallback(async (
    bookId: string,
    track: AudioTrack
  ): Promise<AudioTrack | null> => {
    const result = await loaderLoad(bookId, track);
    if (result) {
      // Update cache version to trigger loadedTracks recalculation
      setCacheVersion(prev => prev + 1);
    }
    return result;
  }, [loaderLoad]);

  const getCachedTrack = useCallback((bookId: string, trackId: string): AudioTrack | null => {
    return loaderGetCached(bookId, trackId);
  }, [loaderGetCached]);

  const isTrackLoaded = useCallback((bookId: string, trackId: string): boolean => {
    return loaderIsResourceLoaded(bookId, trackId);
  }, [loaderIsResourceLoaded]);

  const clearCache = useCallback((bookId?: string) => {
    // Revoke Blob URLs before clearing cache using centralized manager
    if (bookId) {
      // Revoke all blob URLs for this book
      blobURLManager.revokeForBook(bookId);
    } else {
      // Get cached resources from the loader and revoke their blob URLs
      const cachedTracks = loaderGetCachedResources();
      for (const track of cachedTracks) {
        if (track.url && track.url.startsWith("blob:")) {
          blobURLManager.revoke(track.url);
        }
      }
    }
    loaderClearCache(bookId);
    // Update cache version to trigger loadedTracks recalculation
    setCacheVersion(prev => prev + 1);
  }, [loaderGetCachedResources, loaderClearCache]);

  // Get all loaded tracks as a Map (computed on-demand from cache)
  // Memoized with cacheVersion to trigger recalculation when cache changes
  const loadedTracks = useMemo(() => {
    const tracks = loaderGetCachedResources();
    return new Map(tracks.map(track => [track.id, track]));
  }, [loaderGetCachedResources, cacheVersion]);

  return {
    loadTrack,
    getCachedTrack,
    isTrackLoaded,
    clearCache,
    loadedTracks,
  };
}

