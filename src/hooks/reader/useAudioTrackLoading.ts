/**
 * Hook for managing audio track URL loading and caching
 * Handles track loading, preloading, and URL management
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { logger } from "../../lib/logger";
import type { AudioTrack } from "../../types/reader";
import { ensureAudioTrackLoaded } from "../../lib/lazy-chapter-loader";

type UseAudioTrackLoadingParams = {
  bookId?: string;
  tracks: AudioTrack[];
  currentIndex: number;
  currentTrack?: AudioTrack;
};

export function useAudioTrackLoading({
  bookId,
  tracks,
  currentIndex,
  currentTrack,
}: UseAudioTrackLoadingParams) {
  // Simplified: Use ref to track loaded URLs instead of state to avoid re-render loops
  const loadedTrackUrlsRef = useRef<Map<string, string>>(new Map());
  const loadingTracksRef = useRef<Set<string>>(new Set());
  const loadedCountRef = useRef(0);
  const [loadedCount, setLoadedCount] = useState(0);
  const [isTrackLoading, setIsTrackLoading] = useState(false);

  // Update loaded track URLs when tracks prop changes (clear cache for removed tracks)
  useEffect(() => {
    const trackIds = new Set(tracks.map((t) => t.id));
    // Remove URLs for tracks that no longer exist
    loadedTrackUrlsRef.current.forEach((_, trackId) => {
      if (!trackIds.has(trackId)) {
        loadedTrackUrlsRef.current.delete(trackId);
      }
    });
    // Add URLs for tracks that already have them
    tracks.forEach((track) => {
      if (track.url) {
        loadedTrackUrlsRef.current.set(track.id, track.url);
      }
    });
  }, [tracks]);

  // Simplified: Pre-load track URL only when needed
  useEffect(() => {
    if (!currentTrack || !bookId || currentIndex === undefined || currentIndex === null) {
      setIsTrackLoading(false);
      return;
    }

    const trackId = currentTrack.id;

    // Check if already loaded
    if (loadedTrackUrlsRef.current.has(trackId)) {
      setIsTrackLoading(false);
      // Even if current track is already loaded, preload next track if needed
      const nextIndex = currentIndex + 1;
      if (nextIndex < tracks.length) {
        const nextTrack = tracks[nextIndex];
        // Only preload if next track doesn't already have a URL and isn't already loading
        if (
          nextTrack &&
          !nextTrack.url &&
          !loadedTrackUrlsRef.current.has(nextTrack.id) &&
          !loadingTracksRef.current.has(nextTrack.id)
        ) {
          logger.log("[Audio Player] Preloading next audio track", {
            nextTrackId: nextTrack.id,
            nextTrackTitle: nextTrack.title,
            nextIndex,
          });

          // Mark as loading
          loadingTracksRef.current.add(nextTrack.id);

          ensureAudioTrackLoaded(bookId, nextTrack)
            .then((preloadedTrack) => {
              if (preloadedTrack.url) {
                loadingTracksRef.current.delete(nextTrack.id);
                loadedTrackUrlsRef.current.set(nextTrack.id, preloadedTrack.url);
                // Trigger re-render to update track memos (only when needed)
                loadedCountRef.current += 1;
                setLoadedCount(loadedCountRef.current);
                logger.log("[Audio Player] Next audio track preloaded", {
                  nextTrackId: preloadedTrack.id,
                });
              }
            })
            .catch((error) => {
              loadingTracksRef.current.delete(nextTrack.id);
              logger.warn("[Audio Player] Failed to preload next audio track", {
                nextTrackId: nextTrack.id,
                error,
              });
            });
        }
      }
      return;
    }

    // Check if already loading
    if (loadingTracksRef.current.has(trackId)) {
      setIsTrackLoading(true);
      return;
    }

    // Mark as loading
    loadingTracksRef.current.add(trackId);
    setIsTrackLoading(true);
    let cancelled = false;

    logger.log("[Audio Player] Loading track URL", {
      trackId: currentTrack.id,
      trackTitle: currentTrack.title,
      trackHref: currentTrack.href,
      hasUrl: !!currentTrack.url,
    });

    ensureAudioTrackLoaded(bookId, currentTrack)
      .then((loadedTrack) => {
        if (!cancelled && loadedTrack.url) {
          loadingTracksRef.current.delete(trackId);
          loadedTrackUrlsRef.current.set(trackId, loadedTrack.url);
          setIsTrackLoading(false);
          // Trigger re-render to update currentTrack memo (only when needed)
          loadedCountRef.current += 1;
          setLoadedCount(loadedCountRef.current);

          logger.log("[Audio Player] ✓ Track URL loaded successfully", {
            trackId: loadedTrack.id,
            trackTitle: loadedTrack.title,
            urlLength: loadedTrack.url.length,
          });

          // Preload next audio track if it exists
          const nextIndex = currentIndex + 1;
          if (nextIndex < tracks.length) {
            const nextTrack = tracks[nextIndex];
            // Only preload if next track doesn't already have a URL and isn't already loading
            if (
              nextTrack &&
              !nextTrack.url &&
              !loadedTrackUrlsRef.current.has(nextTrack.id) &&
              !loadingTracksRef.current.has(nextTrack.id)
            ) {
              logger.log("[Audio Player] Preloading next audio track", {
                nextTrackId: nextTrack.id,
                nextTrackTitle: nextTrack.title,
                nextIndex,
              });

              // Mark as loading
              loadingTracksRef.current.add(nextTrack.id);

              ensureAudioTrackLoaded(bookId, nextTrack)
                .then((preloadedTrack) => {
                  if (preloadedTrack.url) {
                    loadingTracksRef.current.delete(nextTrack.id);
                    loadedTrackUrlsRef.current.set(nextTrack.id, preloadedTrack.url);
                    // Trigger re-render to update track memos (only when needed)
                    loadedCountRef.current += 1;
                    setLoadedCount(loadedCountRef.current);
                    logger.log("[Audio Player] Next audio track preloaded", {
                      nextTrackId: preloadedTrack.id,
                    });
                  }
                })
                .catch((error) => {
                  loadingTracksRef.current.delete(nextTrack.id);
                  logger.warn("[Audio Player] Failed to preload next audio track", {
                    nextTrackId: nextTrack.id,
                    error,
                  });
                });
            }
          }
        }
      })
      .catch((error) => {
        if (!cancelled) {
          loadingTracksRef.current.delete(trackId);
          setIsTrackLoading(false);
          logger.error("[Audio Player] ✗ Failed to load audio track", {
            trackId,
            trackHref: currentTrack.href,
            trackTitle: currentTrack.title,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });

    return () => {
      cancelled = true;
      loadingTracksRef.current.delete(trackId);
      setIsTrackLoading(false);
    };
  }, [currentIndex, currentTrack?.id, bookId, tracks]);

  const loadTrackIfNeeded = useCallback(
    async (track: AudioTrack): Promise<string | null> => {
      if (!bookId) return null;

      // Check if already loaded
      const existingUrl = loadedTrackUrlsRef.current.get(track.id);
      if (existingUrl) {
        return existingUrl;
      }

      // Check if already loading
      if (loadingTracksRef.current.has(track.id)) {
        // Wait for it to finish loading
        let attempts = 0;
        while (attempts < 50) {
          // Max 5 seconds
          await new Promise((resolve) => setTimeout(resolve, 100));
          const url = loadedTrackUrlsRef.current.get(track.id);
          if (url) {
            return url;
          }
          attempts++;
        }
        return null;
      }

      // Load it now
      try {
        loadingTracksRef.current.add(track.id);
        const loadedTrack = await ensureAudioTrackLoaded(bookId, track);
        loadingTracksRef.current.delete(track.id);

        if (loadedTrack.url) {
          loadedTrackUrlsRef.current.set(track.id, loadedTrack.url);
          loadedCountRef.current += 1;
          setLoadedCount(loadedCountRef.current);
          return loadedTrack.url;
        }
        return null;
      } catch (error) {
        loadingTracksRef.current.delete(track.id);
        logger.error("[Audio Player] Failed to load track URL:", error);
        return null;
      }
    },
    [bookId]
  );

  return {
    loadedTrackUrlsRef,
    isTrackLoading,
    loadedCount,
    loadTrackIfNeeded,
  };
}

