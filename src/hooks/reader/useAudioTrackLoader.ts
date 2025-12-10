/**
 * Hook for loading and caching audio tracks
 * Uses generic useResourceLoader internally
 * No useEffects - all loading is explicit via callbacks
 */

import { useCallback } from "react";
import type { AudioTrack } from "../../types/reader";
import { loadEpubAudio } from "../../lib/book-service";
import { useResourceLoader } from "./useResourceLoader";

export function useAudioTrackLoader() {
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
        const dataUrl = await loadEpubAudio(bookId, track.href);
        if (dataUrl) {
          const loaded: AudioTrack = { ...track, url: dataUrl };
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
    },
    getResourceId: (track) => track.id,
    logPrefix: "[useAudioTrackLoader]",
  });

  const loadTrack = useCallback(async (
    bookId: string,
    track: AudioTrack
  ): Promise<AudioTrack | null> => {
    return await loader.load(bookId, track);
  }, [loader]);

  const getCachedTrack = useCallback((bookId: string, trackId: string): AudioTrack | null => {
    return loader.getCached(bookId, trackId);
  }, [loader]);

  const isTrackLoaded = useCallback((bookId: string, trackId: string): boolean => {
    return loader.isResourceLoaded(bookId, trackId);
  }, [loader]);

  const clearCache = useCallback((bookId?: string) => {
    loader.clearCache(bookId);
  }, [loader]);

  return {
    loadTrack,
    getCachedTrack,
    isTrackLoaded,
    clearCache,
    loadedTracks: loader.loadedResources,
  };
}

