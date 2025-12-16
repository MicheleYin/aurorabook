/**
 * Generic hook for loading and caching resources
 * No useEffects - all loading is explicit via callbacks
 * 
 * Cache Strategy:
 * - TTL: None (infinite until manual cleanup)
 *   Rationale: Resources are typically stable once loaded. Manual cleanup is
 *   performed when switching books or when explicit cache clearing is needed.
 *   This avoids unnecessary reloads during a reading session.
 * 
 * - Max Size: 20 resources per book
 *   Rationale: Prevents unbounded memory growth while accommodating typical
 *   resource usage patterns. When limit is reached, oldest resources (by load
 *   time) are evicted first.
 * 
 * - Cleanup: Manual only (via clearCache)
 *   Pattern: Cache is cleared explicitly when switching books or when resources
 *   need to be refreshed. No automatic TTL-based expiration to avoid disrupting
 *   active reading sessions.
 */

import { useCallback, useRef, useState } from "react";
import { logger } from "../lib/logger";
import { executeWithRetry, type AsyncOperationOptions } from "../lib/async-operations";
import { blobURLManager } from "../lib/blob-url-manager";
import { resourceCacheManager } from "../lib/resource-cache-manager";

type ResourceCacheEntry<T> = {
  resource: T;
  loadedAt: number;
};

type ResourceLoaderOptions<T> = {
  /**
   * Check if a resource is already loaded (has required data)
   */
  isLoaded: (resource: T) => boolean;
  
  /**
   * Load the resource from backend
   */
  loadResource: (bookId: string, resource: T, signal?: AbortSignal) => Promise<T | null>;
  
  /**
   * Optional: Transform resource after loading (e.g., add URL field)
   */
  transformLoaded?: (resource: T, loaded: T) => T;
  
  /**
   * Optional: Get resource ID for tracking
   */
  getResourceId?: (resource: T) => string;
  
  /**
   * Optional: Log prefix for debugging
   */
  logPrefix?: string;
  
  /**
   * Optional: Retry options for loading
   */
  retryOptions?: Omit<AsyncOperationOptions, "signal" | "operationName">;
};

/**
 * Generic resource loader hook
 */
export function useResourceLoader<T>(
  options: ResourceLoaderOptions<T>
) {
  const { isLoaded, loadResource, transformLoaded, getResourceId, logPrefix = "[ResourceLoader]", retryOptions } = options;
  
  const cacheRef = useRef<Map<string, ResourceCacheEntry<T>>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  
  // Limit cache size per book to prevent unbounded growth
  // When limit is reached, oldest resources (by load time) are evicted first
  const MAX_RESOURCES_PER_BOOK = 20;

  const getResourceIdInternal = useCallback((resource: T): string => {
    if (getResourceId) {
      return getResourceId(resource);
    }
    // Fallback: try to get id property
    return (resource as { id?: string }).id || "";
  }, [getResourceId]);

  const load = useCallback(async (
    bookId: string,
    resource: T
  ): Promise<T | null> => {
    const resourceId = getResourceIdInternal(resource);
    const cacheKey = `${bookId}:${resourceId}`;
    
    // Check centralized cache first for chapters and audio tracks
    // This eliminates duplicate storage
    // Use type guards that check properties without type narrowing
    const hasChapterProps = (r: unknown): r is { href: string; contentHtml?: string } => {
      return typeof r === "object" && r !== null && "href" in r && "contentHtml" in r;
    };
    const hasAudioTrackProps = (r: unknown): r is { href: string; id: string; url?: string } => {
      return typeof r === "object" && r !== null && "href" in r && "id" in r && !("contentHtml" in r);
    };
    
    if (hasChapterProps(resource)) {
      const cached = resourceCacheManager.getChapter(bookId, resource.href);
      if (cached && (!resource.contentHtml || resource.contentHtml === cached.contentHtml)) {
        // Return resource with cached content
        return { ...resource, contentHtml: cached.contentHtml, plainText: cached.plainText, wordCount: cached.wordCount } as T;
      }
    } else if (hasAudioTrackProps(resource)) {
      const cached = resourceCacheManager.getAudioTrack(bookId, resource.href);
      if (cached && (!resource.url || resource.url === cached.url)) {
        // Return resource with cached URL
        return { ...resource, url: cached.url } as T;
      }
    }
    
    // Check local cache for other resource types or as fallback
    const cached = cacheRef.current.get(cacheKey);
    if (cached && isLoaded(cached.resource)) {
      return cached.resource;
    }

    // If resource already has required data, cache and return it
    if (isLoaded(resource)) {
      // Store in centralized cache for chapters/audio tracks
      if (hasChapterProps(resource) && resource.contentHtml) {
        resourceCacheManager.setChapter(
          bookId,
          resource.href,
          resource.contentHtml,
          (resource as { plainText?: string }).plainText || "",
          (resource as { wordCount?: number }).wordCount || 0
        );
      } else if (hasAudioTrackProps(resource) && resource.url) {
        resourceCacheManager.setAudioTrack(bookId, resource.href, resource.url);
      } else {
        // Store in local cache for other resource types
        cacheRef.current.set(cacheKey, {
          resource,
          loadedAt: Date.now(),
        });
      }
      return resource;
    }

    // Cancel any existing load operation
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Create new abort controller for this operation
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    // Load from backend with retry support
    setIsLoading(true);
    try {
      const loaded = await executeWithRetry(
        async (signal) => {
          // Use the provided signal or the abort controller signal
          const effectiveSignal = signal || abortController.signal;
          return await loadResource(bookId, resource, effectiveSignal);
        },
        {
          ...retryOptions,
          signal: abortController.signal,
          operationName: `${logPrefix} Load resource ${resourceId}`,
          logErrors: true,
        }
      );

      // Check if operation was cancelled
      if (abortController.signal.aborted) {
        return null;
      }

      if (loaded && isLoaded(loaded)) {
        // Transform if needed
        const finalResource = transformLoaded ? transformLoaded(resource, loaded) : loaded;
        
        // Store in centralized cache for chapters/audio tracks
        // This eliminates duplicate storage - centralized cache handles eviction
        if (hasChapterProps(finalResource) && (finalResource as { contentHtml?: string }).contentHtml) {
          const chapterResource = finalResource as { href: string; contentHtml: string; plainText?: string; wordCount?: number };
          resourceCacheManager.setChapter(
            bookId,
            chapterResource.href,
            chapterResource.contentHtml,
            chapterResource.plainText || "",
            chapterResource.wordCount || 0
          );
        } else if (hasAudioTrackProps(finalResource) && finalResource.url) {
          resourceCacheManager.setAudioTrack(bookId, finalResource.href, finalResource.url);
        } else {
          // For other resource types, use local cache with eviction
          // Evict oldest resources for this book if over limit
          const bookResources = Array.from(cacheRef.current.entries())
            .filter(([key]) => key.startsWith(`${bookId}:`))
            .sort((a, b) => a[1].loadedAt - b[1].loadedAt); // Sort by load time
          
          if (bookResources.length >= MAX_RESOURCES_PER_BOOK) {
            // Remove oldest entry (first in sorted array)
            const oldestKey = bookResources[0][0];
            const oldestEntry = cacheRef.current.get(oldestKey);
            
            // Revoke blob URLs if the evicted resource has one
            if (oldestEntry) {
              const evictedResource = oldestEntry.resource;
              // Check if resource has a blob URL (audio tracks, images, etc.)
              if (evictedResource && typeof evictedResource === "object" && "url" in evictedResource) {
                const url = (evictedResource as { url?: string }).url;
                if (url && url.startsWith("blob:")) {
                  logger.debug(`${logPrefix} Evicting resource with blob URL, revoking`, {
                    bookId,
                    resourceId: getResourceIdInternal(evictedResource),
                    url: url.substring(0, 50) + "...",
                  });
                  blobURLManager.revoke(url);
                }
              }
            }
            
            cacheRef.current.delete(oldestKey);
          }
          
          // Cache it in local cache
          cacheRef.current.set(cacheKey, {
            resource: finalResource,
            loadedAt: Date.now(),
          });
        }
        
        return finalResource;
      }
    } catch (error) {
      // Only log if not cancelled
      if (!abortController.signal.aborted) {
        logger.error(`${logPrefix} Failed to load resource:`, {
          bookId,
          resourceId: getResourceIdInternal(resource),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      // Only clear loading if this is still the current operation
      if (abortControllerRef.current === abortController) {
        setIsLoading(false);
        abortControllerRef.current = null;
      }
    }
    return null;
  }, [isLoaded, loadResource, transformLoaded, getResourceIdInternal, logPrefix, retryOptions]);

  const getCached = useCallback((bookId: string, resourceId: string): T | null => {
    // Try centralized cache first (for chapters/audio tracks)
    // Note: This requires knowing the resource type, so we check local cache first
    // The centralized cache is checked in load() method
    const cacheKey = `${bookId}:${resourceId}`;
    const cached = cacheRef.current.get(cacheKey);
    return cached?.resource || null;
  }, []);

  const isResourceLoaded = useCallback((bookId: string, resourceId: string): boolean => {
    const cacheKey = `${bookId}:${resourceId}`;
    return cacheRef.current.has(cacheKey);
  }, []);

  const clearCache = useCallback((bookId?: string) => {
    // Cancel any ongoing load operation
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsLoading(false);
    }
    
    // Clear centralized cache for chapters/audio tracks
    if (bookId) {
      resourceCacheManager.clearBook(bookId);
    } else {
      resourceCacheManager.clearAll();
    }
    
    // Invalidate cached resources cache by incrementing version
    // This ensures getCachedResources will rebuild the cache
    cacheVersionRef.current += 1;
    if (bookId) {
      // Remove specific book's cache entry
      cachedResourcesCacheRef.current.delete(bookId);
      cachedResourcesCacheRef.current.delete('all'); // Also invalidate 'all' cache
    } else {
      // Clear all cached results
      cachedResourcesCacheRef.current.clear();
    }

    if (bookId) {
      // Clear only this book's resources
      // Also revoke blob URLs for evicted resources
      const keysToDelete: string[] = [];
      cacheRef.current.forEach((entry, key) => {
        if (key.startsWith(`${bookId}:`)) {
          keysToDelete.push(key);
          
          // Revoke blob URLs if the resource has one
          const resource = entry.resource;
          if (resource && typeof resource === "object" && "url" in resource) {
            const url = (resource as { url?: string }).url;
            if (url && url.startsWith("blob:")) {
              logger.debug(`${logPrefix} Clearing resource with blob URL, revoking`, {
                bookId,
                resourceId: getResourceIdInternal(resource),
                url: url.substring(0, 50) + "...",
              });
              // Use synchronous import to ensure blob URL is revoked immediately
              blobURLManager.revoke(url);
            }
          }
        }
      });
      keysToDelete.forEach(key => {
        cacheRef.current.delete(key);
      });
    } else {
      // Clear all - revoke all blob URLs first
      cacheRef.current.forEach((entry) => {
        const resource = entry.resource;
        if (resource && typeof resource === "object" && "url" in resource) {
          const url = (resource as { url?: string }).url;
          if (url && url.startsWith("blob:")) {
            // Use synchronous import to ensure blob URL is revoked immediately
            blobURLManager.revoke(url);
          }
        }
      });
      cacheRef.current.clear();
    }
  }, [logPrefix, getResourceIdInternal]);

  // Get all cached resources for a book (for cleanup purposes)
  // Memoized cache to avoid creating new arrays on every call
  // Cache version tracks when cache is invalidated
  const cachedResourcesCacheRef = useRef<Map<string, { resources: T[]; version: number }>>(new Map());
  const cacheVersionRef = useRef(0);
  
  const getCachedResources = useCallback((bookId?: string): T[] => {
    const cacheKey = bookId || 'all';
    const currentVersion = cacheVersionRef.current;
    
    // Check if we have a cached result with matching version
    const cached = cachedResourcesCacheRef.current.get(cacheKey);
    if (cached && cached.version === currentVersion) {
      // Return cached result if version matches
      return cached.resources;
    }
    
    // Build resources array
    const resources: T[] = [];
    cacheRef.current.forEach((entry, key) => {
      if (!bookId || key.startsWith(`${bookId}:`)) {
        resources.push(entry.resource);
      }
    });
    
    // Cache the result with current version
    cachedResourcesCacheRef.current.set(cacheKey, {
      resources,
      version: currentVersion,
    });
    return resources;
  }, []);

  return {
    load,
    getCached,
    isResourceLoaded,
    clearCache,
    getCachedResources,
    isLoading,
  };
}
