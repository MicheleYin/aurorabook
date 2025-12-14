/**
 * DOM Query Cache - Aggressive caching for DOM queries
 * Reduces expensive DOM traversals by caching results
 */

type CachedElement = {
  element: HTMLElement | null;
  timestamp: number;
};

// Cache for element lookups by ID
// Limit cache size to prevent memory leaks
const MAX_CACHE_SIZE = 50; // Reduced from 100 for memory optimization
const elementCache = new Map<string, CachedElement>();

// Cache for querySelector results (data attributes, classes, etc.)
const queryCache = new Map<string, CachedElement>();

// Cache TTL - 3 seconds (reduced from 5 for faster cleanup)
const CACHE_TTL_MS = 3000;

/**
 * Get element by ID with caching
 * Uses browser's native ID map (O(1)) and caches result
 */
export function getCachedElementById(elementId: string): HTMLElement | null {
  const now = Date.now();
  const cached = elementCache.get(elementId);
  
  // Return cached if still valid
  if (cached && (now - cached.timestamp) < CACHE_TTL_MS) {
    // Verify element still exists in DOM
    if (cached.element && cached.element.isConnected) {
      return cached.element;
    }
    // Element removed from DOM, clear cache
    elementCache.delete(elementId);
  }
  
  // Query DOM
  const element = document.getElementById(elementId);
  
  // Limit cache size - remove oldest entries if cache is full
  if (elementCache.size >= MAX_CACHE_SIZE) {
    // Remove oldest entry (first in Map)
    const firstKey = elementCache.keys().next().value;
    if (firstKey) {
      elementCache.delete(firstKey);
    }
  }
  
  // Cache result
  elementCache.set(elementId, {
    element,
    timestamp: now,
  });
  
  return element;
}

/**
 * Get element by querySelector with caching
 * Use sparingly - prefer getElementById when possible
 */
export function getCachedQuerySelector(selector: string, root?: HTMLElement | Document): HTMLElement | null {
  const now = Date.now();
  const cacheKey = root ? `${selector}:${root === document ? 'doc' : 'root'}` : selector;
  const cached = queryCache.get(cacheKey);
  
  // Return cached if still valid
  if (cached && (now - cached.timestamp) < CACHE_TTL_MS) {
    // Verify element still exists in DOM
    if (cached.element && cached.element.isConnected) {
      return cached.element;
    }
    // Element removed from DOM, clear cache
    queryCache.delete(cacheKey);
  }
  
  // Query DOM
  const queryRoot = root || document;
  const element = queryRoot.querySelector<HTMLElement>(selector);
  
  // Limit cache size - remove oldest entries if cache is full
  if (queryCache.size >= MAX_CACHE_SIZE) {
    // Remove oldest entry (first in Map)
    const firstKey = queryCache.keys().next().value;
    if (firstKey) {
      queryCache.delete(firstKey);
    }
  }
  
  // Cache result
  queryCache.set(cacheKey, {
    element,
    timestamp: now,
  });
  
  return element;
}

/**
 * Clear cache for a specific element ID
 */
export function clearElementCache(elementId: string): void {
  elementCache.delete(elementId);
}

/**
 * Clear all caches
 */
export function clearAllCaches(): void {
  elementCache.clear();
  queryCache.clear();
}

/**
 * Clear caches older than TTL (cleanup)
 */
export function clearExpiredCaches(): void {
  const now = Date.now();
  
  // Clear expired element cache entries
  for (const [key, cached] of elementCache.entries()) {
    if ((now - cached.timestamp) >= CACHE_TTL_MS || !cached.element?.isConnected) {
      elementCache.delete(key);
    }
  }
  
  // Clear expired query cache entries
  for (const [key, cached] of queryCache.entries()) {
    if ((now - cached.timestamp) >= CACHE_TTL_MS || !cached.element?.isConnected) {
      queryCache.delete(key);
    }
  }
}

// Store interval ID for cleanup
let cleanupIntervalId: number | null = null;



/**
 * Cleanup function to stop the interval and clear all caches
 * Should be called when the app unmounts or when switching books
 */
export function cleanupDomQueryCache(): void {
  if (cleanupIntervalId !== null) {
    clearInterval(cleanupIntervalId);
    cleanupIntervalId = null;
  }
  clearAllCaches();
}
