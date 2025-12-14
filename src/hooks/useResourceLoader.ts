/**
 * Generic hook for loading and caching resources
 * No useEffects - all loading is explicit via callbacks
 */

import { useCallback, useRef, useState } from "react";

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
  loadResource: (bookId: string, resource: T) => Promise<T | null>;
  
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
};

/**
 * Generic resource loader hook
 */
export function useResourceLoader<T>(
  options: ResourceLoaderOptions<T>
) {
  const { isLoaded, loadResource, transformLoaded, getResourceId, logPrefix = "[ResourceLoader]" } = options;
  
  const cacheRef = useRef<Map<string, ResourceCacheEntry<T>>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  
  // Limit cache size per book to prevent unbounded growth
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
    
    // Check cache first
    const cached = cacheRef.current.get(cacheKey);
    if (cached && isLoaded(cached.resource)) {
      return cached.resource;
    }

    // If resource already has required data, cache and return it
    if (isLoaded(resource)) {
      cacheRef.current.set(cacheKey, {
        resource,
        loadedAt: Date.now(),
      });
      return resource;
    }

    // Load from backend
    setIsLoading(true);
    try {
      const loaded = await loadResource(bookId, resource);
      if (loaded && isLoaded(loaded)) {
        // Transform if needed
        const finalResource = transformLoaded ? transformLoaded(resource, loaded) : loaded;
        
        // Evict oldest resources for this book if over limit
        const bookResources = Array.from(cacheRef.current.entries())
          .filter(([key]) => key.startsWith(`${bookId}:`))
          .sort((a, b) => a[1].loadedAt - b[1].loadedAt); // Sort by load time
        
        if (bookResources.length >= MAX_RESOURCES_PER_BOOK) {
          // Remove oldest entry (first in sorted array)
          const oldestKey = bookResources[0][0];
          cacheRef.current.delete(oldestKey);
        }
        
        // Cache it
        cacheRef.current.set(cacheKey, {
          resource: finalResource,
          loadedAt: Date.now(),
        });
        return finalResource;
      }
    } catch (error) {
      console.error(`${logPrefix} Failed to load resource:`, error, {
        bookId,
        resourceId: getResourceIdInternal(resource),
      });
    } finally {
      setIsLoading(false);
    }
    return null;
  }, [isLoaded, loadResource, transformLoaded, getResourceIdInternal, logPrefix]);

  const getCached = useCallback((bookId: string, resourceId: string): T | null => {
    const cacheKey = `${bookId}:${resourceId}`;
    const cached = cacheRef.current.get(cacheKey);
    return cached?.resource || null;
  }, []);

  const isResourceLoaded = useCallback((bookId: string, resourceId: string): boolean => {
    const cacheKey = `${bookId}:${resourceId}`;
    return cacheRef.current.has(cacheKey);
  }, []);

  const clearCache = useCallback((bookId?: string) => {
    if (bookId) {
      // Clear only this book's resources
      const keysToDelete: string[] = [];
      cacheRef.current.forEach((_, key) => {
        if (key.startsWith(`${bookId}:`)) {
          keysToDelete.push(key);
        }
      });
      keysToDelete.forEach(key => {
        cacheRef.current.delete(key);
      });
    } else {
      // Clear all
      cacheRef.current.clear();
    }
  }, []);

  // Get all cached resources for a book (for cleanup purposes)
  const getCachedResources = useCallback((bookId?: string): T[] => {
    const resources: T[] = [];
    cacheRef.current.forEach((entry, key) => {
      if (!bookId || key.startsWith(`${bookId}:`)) {
        resources.push(entry.resource);
      }
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
