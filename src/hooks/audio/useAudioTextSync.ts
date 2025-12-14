/**
 * Hook for audio-text synchronization
 * No useEffects - all operations are explicit via callbacks
 */

import { useCallback, useRef, useEffect } from "react";
import { logger } from "../../lib/logger";
import type { Book, Chapter } from "../../types/reader";
import { findCurrentAudioSegment, chapterHrefsMatch, normalizeChapterHref } from "../../lib/epub";
import { scrollToElement } from "../../lib/scroll-utils";
import { useHighlightQueue } from "../../contexts/HighlightQueueContext";
import { getCachedElementById, getCachedQuerySelector, clearAllCaches } from "../../lib/dom-query-cache";

// TEMPORARY: Feature flag to disable audio-text sync
const ENABLE_AUDIO_TEXT_SYNC = true;

type ElementIndexHook = {
  hasElement: (elementId: string) => boolean;
  getElementInfo: (elementId: string) => { elementId: string; approximateScrollTop: number; segmentIndex?: number } | undefined;
  getScrollPositionEstimate: (elementId: string) => number | undefined;
  getSegmentIndex: (elementId: string) => number | undefined;
};

export function useAudioTextSync(
  contentRef: React.RefObject<HTMLDivElement | null>,
  autoScrollEnabled: boolean,
  isRestoringScroll: boolean = false,
  chromeVisible: boolean = true,
  onChapterChange?: (chapterId: string, elementId?: string) => void,
  onChapterReload?: (chapterId: string) => void,
  audioPlayerVisible: boolean = false,
  activeChapterId?: string,
  elementIndex?: ElementIndexHook
) {
  // TEMPORARY: Early return if disabled
  if (!ENABLE_AUDIO_TEXT_SYNC) {
    return {
      updateHighlight: () => {},
      clearHighlight: () => {},
      markTrackChange: () => {},
      markChapterChange: () => {},
    };
  }

  const { pushHighlight } = useHighlightQueue();
  const lastScrolledElementRef = useRef<string | null>(null);
  const lastScrollTimeRef = useRef<number>(0);
  const scrollThrottleMs = 100; // Throttle scrolling to at most once per 100ms
  const lastChapterChangeTimeRef = useRef<number>(0);
  const chapterChangeThrottleMs = 500; // Throttle chapter changes to avoid rapid switching
  const lastReloadAttemptRef = useRef<{ chapterId: string; timestamp: number } | null>(null);
  const reloadThrottleMs = 2000; // Throttle reload attempts to avoid infinite loops
  // Note: lastChapterIdRef is set manually in specific scenarios, not just tracking previous value
  // This is a legitimate use case for refs (internal tracking)
  const lastChapterIdRef = useRef<string | undefined>(undefined); // Track last chapter ID to detect stale references
  const trackChangeInProgressRef = useRef<{ trackHref: string; timestamp: number } | null>(null);
  const TRACK_CHANGE_GRACE_PERIOD_MS = 2000; // Ignore audio sync chapter changes for 2s after track change
  const chapterChangeInProgressRef = useRef<string | null>(null); // Track which chapter is being changed to prevent duplicate changes
  // Refs for timeout cleanup
  const trackChangeTimeoutRef = useRef<number | null>(null);
  const chapterChangeTimeoutRef = useRef<number | null>(null);
  
  // Optimize: Cache scroll operation to batch multiple updates
  const pendingScrollRef = useRef<{
    elementId: string;
    headerOffset: number;
    playerOffset: number;
    rafId: number | null;
  } | null>(null);
  
  // Cache DOM elements and computed values to avoid repeated queries
  const headerCacheRef = useRef<{
    element: HTMLElement | null;
    offset: number;
    lastCheck: number;
  }>({ element: null, offset: 0, lastCheck: 0 });
  
  const playerCacheRef = useRef<{
    element: HTMLElement | null;
    offset: number;
    lastCheck: number;
  }>({ element: null, offset: 0, lastCheck: 0 });
  
  const safeAreaCacheRef = useRef<{
    top: number;
    lastCheck: number;
  }>({ top: 0, lastCheck: 0 });
  
  // Cache a reference to any span element for font size calculations
  // Since spans always have IDs, we can use getElementById instead of querySelector
  const spanElementCacheRef = useRef<{
    element: HTMLElement | null;
    fontSize: number;
    lastCheck: number;
  }>({ element: null, fontSize: 0, lastCheck: 0 });
  
  const CACHE_TTL_MS = 5000; // Re-check every 5 seconds instead of every call (increased for memory optimization)
  
  // Get safe area top inset value (cached) - memoized to avoid recreating function
  const getSafeAreaTop = useCallback((): number => {
    if (typeof document === "undefined") return 0;
    
    const now = Date.now();
    const cache = safeAreaCacheRef.current;
    
    // Use cached value if still valid
    if (cache.lastCheck > 0 && (now - cache.lastCheck) < CACHE_TTL_MS) {
      return cache.top;
    }
    
    // Create a temporary element to measure safe area top
    const tempEl = document.createElement("div");
    tempEl.className = "safe-area-top";
    tempEl.style.position = "absolute";
    tempEl.style.visibility = "hidden";
    tempEl.style.pointerEvents = "none";
    document.body.appendChild(tempEl);
    
    const computedStyle = window.getComputedStyle(tempEl);
    const paddingTop = computedStyle.paddingTop;
    cache.top = paddingTop ? parseInt(paddingTop) : 0;
    
    document.body.removeChild(tempEl);
    cache.lastCheck = now;
    
    return cache.top;
  }, []);
  
  // Calculate header offset dynamically when scrolling (with caching) - memoized
  const getHeaderOffset = useCallback((): number => {
    if (typeof document === "undefined") return 0;
    
    const now = Date.now();
    const cache = headerCacheRef.current;
    
    // Re-query only if cache expired or element not found
    // Use cached querySelector for data attributes
    if (!cache.element || (now - cache.lastCheck) >= CACHE_TTL_MS) {
      cache.element = getCachedQuerySelector("[data-reader-header]") ||
                      document.querySelector<HTMLElement>("[data-reader-header]");
    }
    
    if (cache.element) {
      const rect = cache.element.getBoundingClientRect();
      const style = window.getComputedStyle(cache.element);
      const isVisible = rect.height > 0 && style.opacity !== "0" && style.display !== "none";
      
      if (isVisible && chromeVisible) {
        // Header is visible - use cached value if still valid
        if (cache.lastCheck > 0 && (now - cache.lastCheck) < CACHE_TTL_MS && cache.offset > 0) {
          return cache.offset;
        }
        
        // Get font size from cached span element (more efficient than querying for p)
        // Since spans always have IDs, we can use getElementById with a known span ID
        let fontSize = 0;
        const spanCache = spanElementCacheRef.current;
        if (spanCache.element && spanCache.element.isConnected && (now - spanCache.lastCheck) < CACHE_TTL_MS) {
          fontSize = spanCache.fontSize;
        } else {
          // Try to find any span with ID pattern f\d{6} using getElementById
          // Start with f000001 (first span) and try a few more if needed
          let spanElement: HTMLElement | null = null;
          for (let i = 1; i <= 10 && !spanElement; i++) {
            const spanId = `f${String(i).padStart(6, '0')}`;
            spanElement = getCachedElementById(spanId);
            if (spanElement && spanElement.isConnected) {
              break;
            }
          }
          
          if (spanElement) {
            // Get font size from span or its parent paragraph
            const computedStyle = window.getComputedStyle(spanElement);
            fontSize = parseInt(computedStyle.fontSize) || 0;
            // If span has no font size, try parent paragraph
            if (!fontSize) {
              const parent = spanElement.closest('p');
              if (parent) {
                fontSize = parseInt(window.getComputedStyle(parent).fontSize) || 16;
              }
            }
            // Cache the span element and font size
            spanElementCacheRef.current = {
              element: spanElement,
              fontSize: fontSize || 16,
              lastCheck: now,
            };
          } else {
            // Fallback: use default font size
            fontSize = 16;
          }
        }
        
        cache.offset = fontSize + rect.height;
        cache.lastCheck = now;
        return cache.offset;
      }
    }
    
    // Header is not visible - return safe area top
    if (!chromeVisible) {
      return getSafeAreaTop();
    }
    
    cache.offset = 0;
    cache.lastCheck = now;
    
    return 0;
  }, [chromeVisible, getSafeAreaTop]);

  // Calculate player offset dynamically when scrolling (with caching) - memoized
  const getPlayerOffset = useCallback((): number => {
    if (!audioPlayerVisible || typeof document === "undefined") return 0;
    
    const now = Date.now();
    const cache = playerCacheRef.current;
    
    // Use cached value if still valid
    if (cache.lastCheck > 0 && (now - cache.lastCheck) < CACHE_TTL_MS && cache.offset > 0) {
      return cache.offset;
    }
    
    // Re-query only if cache expired or element not found
    // Use cached querySelector for data attributes
    if (!cache.element || (now - cache.lastCheck) >= CACHE_TTL_MS) {
      // Try most specific selector first with caching
      cache.element = getCachedQuerySelector("[data-audio-player]") ||
                      getCachedQuerySelector("[role='region'][aria-label*='audio']") ||
                      getCachedQuerySelector(".audio-player") ||
                      document.querySelector<HTMLElement>("[data-audio-player]") ||
                      document.querySelector<HTMLElement>("[role='region'][aria-label*='audio']") ||
                      document.querySelector<HTMLElement>(".audio-player");
    }
    
    if (cache.element) {
      const rect = cache.element.getBoundingClientRect();
      const style = window.getComputedStyle(cache.element);
      if (rect.height > 0 && style.opacity !== "0" && style.display !== "none" && style.visibility !== "hidden") {
        const viewportHeight = window.innerHeight;
        const distanceFromBottom = viewportHeight - rect.top;
        
        // Get font size from cached span element (more efficient than querying for p)
        // Since spans always have IDs, we can use getElementById with a known span ID
        let fontSize = 0;
        const spanCache = spanElementCacheRef.current;
        if (spanCache.element && spanCache.element.isConnected && (now - spanCache.lastCheck) < CACHE_TTL_MS) {
          fontSize = spanCache.fontSize;
        } else {
          // Try to find any span with ID pattern f\d{6} using getElementById
          // Start with f000001 (first span) and try a few more if needed
          let spanElement: HTMLElement | null = null;
          for (let i = 1; i <= 10 && !spanElement; i++) {
            const spanId = `f${String(i).padStart(6, '0')}`;
            spanElement = getCachedElementById(spanId);
            if (spanElement && spanElement.isConnected) {
              break;
            }
          }
          
          if (spanElement) {
            // Get font size from span or its parent paragraph
            const computedStyle = window.getComputedStyle(spanElement);
            fontSize = parseInt(computedStyle.fontSize) || 0;
            // If span has no font size, try parent paragraph
            if (!fontSize) {
              const parent = spanElement.closest('p');
              if (parent) {
                fontSize = parseInt(window.getComputedStyle(parent).fontSize) || 16;
              }
            }
            // Cache the span element and font size
            spanElementCacheRef.current = {
              element: spanElement,
              fontSize: fontSize || 16,
              lastCheck: now,
            };
          } else {
            // Fallback: use default font size
            fontSize = 16;
          }
        }
        
        cache.offset = Math.max(0, distanceFromBottom + fontSize);
        cache.lastCheck = now;
        return cache.offset;
      }
    }
    
    cache.offset = 0;
    cache.lastCheck = now;
    return 0;
  }, [audioPlayerVisible]);


  const updateHighlight = useCallback((
    book: Book,
    chapter: Chapter | undefined,
    trackHref: string,
    currentTime: number
  ) => {
    logger.log("[Audio Sync] updateHighlight called", {
      hasSyncMap: !!book.audioSyncMap,
      trackHref,
      currentTime,
      hasChapter: !!chapter,
      autoScrollEnabled,
      isRestoringScroll,
      hasContentRef: !!contentRef.current,
    });

    if (!book.audioSyncMap || !trackHref || !chapter) {
      logger.log("[Audio Sync] Missing required data, clearing highlight");
      pushHighlight(null);
      return;
    }

    const segment = findCurrentAudioSegment(
      book.audioSyncMap,
      trackHref,
      currentTime
    );

    if (!segment) {
      logger.log("[Audio Sync] No segment found");
      pushHighlight(null);
      return;
    }

    const chapterHref = normalizeChapterHref(chapter.href);
    const segmentChapterHref = normalizeChapterHref(segment.chapterHref);
    
    // Debug: Always log the comparison to see what's happening
    const hrefsMatch = chapterHrefsMatch(segment.chapterHref, chapter.href);
    
    // Also find what chapter the segment actually points to
    const segmentChapter = book.chapters.find((ch) => {
      return chapterHrefsMatch(segment.chapterHref, ch.href);
    });
    
    // Check if chapter ID changed (to detect stale chapter references)
    const chapterIdChanged = lastChapterIdRef.current !== undefined && lastChapterIdRef.current !== chapter.id;
    if (chapterIdChanged) {
      logger.log("[Audio Sync] Chapter ID changed - updating reference", {
        oldChapterId: lastChapterIdRef.current,
        newChapterId: chapter.id,
      });
      // Chapter ID changed - will be tracked by usePrevious on next render
    } else if (lastChapterIdRef.current === undefined) {
      // First time - will be tracked by usePrevious on next render
    }
    
    logger.log("[Audio Sync] Chapter href comparison", {
      segmentChapterHref: segment.chapterHref,
      segmentChapterHrefNormalized: segmentChapterHref,
      currentChapterHref: chapter.href,
      currentChapterHrefNormalized: chapterHref,
      hrefsMatch,
      chapterId: chapter.id,
      segmentChapterId: segmentChapter?.id,
      segmentChapterHrefFromMatch: segmentChapter?.href,
      chapterIdMatches: segmentChapter?.id === chapter.id,
      autoScrollEnabled,
      timeSinceLastChange: Date.now() - lastChapterChangeTimeRef.current,
    });
    
    // Use flexible matching instead of direct comparison
    // Also check if the segment's chapter ID differs from current chapter ID
    // This handles cases where hrefs match but we're actually in the wrong chapter
    const chapterIdMismatch = segmentChapter && segmentChapter.id !== chapter.id;
    const shouldChangeChapter = !hrefsMatch || chapterIdMismatch;
    
    // Find matching chapter early so we can check if it's already being changed
    // Use the segmentChapter we already found, or find it again
    const matchingChapter = segmentChapter || book.chapters.find((ch) => {
      return chapterHrefsMatch(segment.chapterHref, ch.href);
    });
    
    // Check if a track change is in progress - if so, ignore chapter changes from audio sync
    // This prevents audio sync from interfering with chapter loading during track changes
    const trackChange = trackChangeInProgressRef.current;
    const isTrackChanging = trackChange && 
      trackChange.trackHref === trackHref && 
      (Date.now() - trackChange.timestamp) < TRACK_CHANGE_GRACE_PERIOD_MS;
    
    if (shouldChangeChapter) {
      logger.log("[Audio Sync] Segment chapter mismatch detected", {
        segmentChapterHref: segment.chapterHref,
        segmentChapterHrefNormalized: segmentChapterHref,
        currentChapterHref: chapter.href,
        currentChapterHrefNormalized: chapterHref,
        hrefsMatch,
        chapterIdMismatch,
        currentChapterId: chapter.id,
        segmentChapterId: segmentChapter?.id,
        matchingChapterId: matchingChapter?.id,
        autoScrollEnabled,
        hasOnChapterChange: !!onChapterChange,
        isTrackChanging,
        trackChangeInProgress: !!trackChange,
      });
      
      // If a track change is in progress, don't trigger chapter changes from audio sync
      // The track change handler will handle the chapter change
      if (isTrackChanging) {
        logger.log("[Audio Sync] Ignoring chapter change - track change in progress", {
          trackHref,
          timeSinceTrackChange: trackChange ? Date.now() - trackChange.timestamp : 0,
        });
        pushHighlight(null);
        return;
      }
      
      // Check if a chapter change is already in progress for this chapter
      if (matchingChapter && chapterChangeInProgressRef.current === matchingChapter.id) {
        logger.log("[Audio Sync] Ignoring chapter change - chapter change already in progress", {
          chapterId: matchingChapter.id,
          trackHref,
        });
        pushHighlight(null);
        return;
      }
      
      // If auto scroll is enabled, navigate to the correct chapter
      if (autoScrollEnabled && onChapterChange) {
        const now = Date.now();
        const timeSinceLastChange = now - lastChapterChangeTimeRef.current;
        
        // Throttle chapter changes to avoid rapid switching
        if (timeSinceLastChange >= chapterChangeThrottleMs) {
          // matchingChapter was already found above
          if (matchingChapter) {
            if (matchingChapter.id !== chapter.id) {
              // Check again if chapter change is in progress (double-check after throttle)
              if (chapterChangeInProgressRef.current === matchingChapter.id) {
                logger.log("[Audio Sync] Ignoring chapter change - chapter change already in progress (after throttle)", {
                  chapterId: matchingChapter.id,
                  trackHref,
                });
                pushHighlight(null);
                return;
              }
              
              logger.log("[Audio Sync] Navigating to correct chapter", {
                fromChapterId: chapter.id,
                fromChapterHref: chapter.href,
                toChapterId: matchingChapter.id,
                toChapterHref: matchingChapter.href,
                segmentChapterHref: segment.chapterHref,
                elementId: segment.textElementId,
                timeSinceLastChange,
              });
              
              // Mark chapter change as in progress BEFORE calling onChapterChange
              chapterChangeInProgressRef.current = matchingChapter.id;
              
              // Update throttle time BEFORE calling onChapterChange to prevent race conditions
              // This ensures that if updateHighlight is called again quickly with stale chapter data,
              // we don't immediately trigger another change
              lastChapterChangeTimeRef.current = now;
              
              // Also update the chapter ID ref to track what we're changing to
              lastChapterIdRef.current = matchingChapter.id;
              
              logger.log("[Audio Sync] Calling onChapterChange", {
                chapterId: matchingChapter.id,
                chapterHref: matchingChapter.href,
                elementId: segment.textElementId,
                currentChapterId: chapter.id,
                currentChapterHref: chapter.href,
              });
              
              // Navigate to the chapter, passing the element ID to scroll to after load
              // Clear the flag after a delay to allow chapter change to complete
              // Clear any existing timeout
              if (chapterChangeTimeoutRef.current) {
                clearTimeout(chapterChangeTimeoutRef.current);
              }
              
              onChapterChange(matchingChapter.id, segment.textElementId);
              chapterChangeTimeoutRef.current = window.setTimeout(() => {
                if (chapterChangeInProgressRef.current === matchingChapter.id) {
                  chapterChangeInProgressRef.current = null;
                  logger.log("[Audio Sync] Chapter change flag cleared", {
                    chapterId: matchingChapter.id,
                  });
                }
                chapterChangeTimeoutRef.current = null;
              }, 3000); // Clear after 3 seconds (enough time for chapter to load)
              
              pushHighlight(null);
              return;
            } else {
              // This can happen if the chapter object reference is stale but the ID matches
              // Log it but don't treat it as an error - the chapter is already correct
              logger.log("[Audio Sync] Matching chapter found with same ID - chapter already correct", {
                chapterId: chapter.id,
                chapterHref: chapter.href,
                segmentChapterHref: segment.chapterHref,
                note: "This is normal if chapter was just changed and React hasn't updated the reference yet",
              });
            }
          } else {
            logger.log("[Audio Sync] No matching chapter found for segment", {
              segmentChapterHref: segment.chapterHref,
              segmentChapterHrefNormalized: segmentChapterHref,
              availableChapters: book.chapters.map(ch => ({
                id: ch.id,
                href: ch.href,
                normalized: normalizeChapterHref(ch.href),
              })),
            });
          }
        } else {
          logger.log("[Audio Sync] Chapter change throttled", {
            timeSinceLastChange,
            throttleMs: chapterChangeThrottleMs,
            remainingMs: chapterChangeThrottleMs - timeSinceLastChange,
          });
        }
      } else {
        logger.log("[Audio Sync] Chapter change blocked", {
          autoScrollEnabled,
          hasOnChapterChange: !!onChapterChange,
        });
      }
      
      pushHighlight(null);
      return;
    }

    logger.log("[Audio Sync] Segment found - chapter matches", {
      textElementId: segment.textElementId,
      segmentChapterHref: segment.chapterHref,
      segmentChapterHrefNormalized: segmentChapterHref,
      currentChapterHref: chapter.href,
      currentChapterHrefNormalized: chapterHref,
    });

    // Phase 1: Check element index first to avoid expensive DOM queries
    if (elementIndex && !elementIndex.hasElement(segment.textElementId)) {
      logger.debug("[Audio Sync] Element not in index, skipping DOM query", {
        elementId: segment.textElementId,
      });
      pushHighlight(null);
      return;
    }

    // Optimize: Check if element exists using elementIndex scroll estimate
    // This allows us to skip DOM queries for elements that are far from viewport
    if (elementIndex && contentRef.current) {
      const elementInfo = elementIndex.getElementInfo(segment.textElementId);
      if (elementInfo) {
        // Use scroll position estimate to determine if element might be visible
        // This is approximate but saves DOM queries for off-screen elements
        const scrollContainer = contentRef.current;
        const currentScroll = scrollContainer.scrollTop;
        const viewportHeight = scrollContainer.clientHeight;
        const estimatedPosition = elementInfo.approximateScrollTop;
        
        // If element is far from viewport, it might not be rendered yet
        // Only skip if it's significantly outside viewport (more than 2 viewports away)
        const distanceFromViewport = Math.abs(estimatedPosition - currentScroll);
        if (distanceFromViewport > viewportHeight * 2) {
          logger.debug("[Audio Sync] Element likely off-screen, skipping immediate highlight", {
            elementId: segment.textElementId,
            estimatedPosition,
            currentScroll,
            distance: distanceFromViewport,
          });
          // Still push highlight - it will be processed when element comes into view
        }
      }
    }

    // Check if the element exists in the DOM
    // If not, and we have audio sync, the chapter might need to be reloaded with spans
    // Use cached getElementById for better performance (O(1) vs O(n) for querySelector)
    let element: HTMLElement | null = null;
    if (contentRef.current) {
      // Try cached getElementById first (much faster - uses browser's ID map + caching)
      const docElement = getCachedElementById(segment.textElementId);
      if (docElement && contentRef.current.contains(docElement)) {
        element = docElement;
        
        // Cache this span element for font size calculations (more efficient than querying for p)
        const now = Date.now();
        const spanCache = spanElementCacheRef.current;
        if (!spanCache.element || !spanCache.element.isConnected || (now - spanCache.lastCheck) >= CACHE_TTL_MS) {
          // Get font size from span or its parent paragraph
          const computedStyle = window.getComputedStyle(element);
          let fontSize = parseInt(computedStyle.fontSize) || 0;
          // If span has no font size, try parent paragraph
          if (!fontSize) {
            const parent = element.closest('p');
            if (parent) {
              fontSize = parseInt(window.getComputedStyle(parent).fontSize) || 16;
            }
          }
          // Cache the span element and font size
          spanElementCacheRef.current = {
            element: element,
            fontSize: fontSize || 16,
            lastCheck: now,
          };
        }
      }
      
      if (!element) {
        // Element not found - check if chapter content has any spans at all
        // Since spans always have IDs, use getElementById instead of querySelector pattern matching
        // Check if any span IDs from the audio sync map exist in the DOM
        let hasAnySpans = false;
        if (book.audioSyncMap && book.audioSyncMap.segments.length > 0) {
          // Try checking a few span IDs from the sync map (more efficient than pattern matching)
          // Check the first few segments to see if any spans exist
          const spanIdsToCheck = book.audioSyncMap.segments
            .slice(0, 5) // Check first 5 segments
            .map(seg => seg.textElementId);
          
          for (const spanId of spanIdsToCheck) {
            const spanElement = getCachedElementById(spanId);
            if (spanElement && contentRef.current?.contains(spanElement)) {
              hasAnySpans = true;
              break;
            }
          }
        } else {
          // Fallback: if no sync map, try checking a known span ID pattern
          // Try first few span IDs (f000001, f000002, etc.)
          for (let i = 1; i <= 5 && !hasAnySpans; i++) {
            const spanId = `f${String(i).padStart(6, '0')}`;
            const spanElement = getCachedElementById(spanId);
            if (spanElement && contentRef.current?.contains(spanElement)) {
              hasAnySpans = true;
              break;
            }
          }
        }
        
        if (!hasAnySpans && onChapterReload) {
          // Chapter content doesn't have the required spans - need to reload
          const now = Date.now();
          const lastAttempt = lastReloadAttemptRef.current;
          const shouldReload = !lastAttempt || 
            lastAttempt.chapterId !== chapter.id || 
            (now - lastAttempt.timestamp) >= reloadThrottleMs;
          
          if (shouldReload) {
            console.warn("[Audio Sync] Chapter content missing spans, triggering reload", {
              chapterId: chapter.id,
              textElementId: segment.textElementId,
            });
            lastReloadAttemptRef.current = { chapterId: chapter.id, timestamp: now };
            onChapterReload(chapter.id);
            // Don't set highlight yet - wait for reload
            return;
          }
        } else if (!element) {
          // Only log warning if we're not reloading (to avoid spam)
          if (!onChapterReload || hasAnySpans) {
            logger.debug("[Audio Sync] Element not found in DOM (may be off-screen)", {
              textElementId: segment.textElementId,
              hasAnySpans: !!hasAnySpans,
            });
          }
        }
      }
    }

    // Push highlight to queue - the highlighting hook will process it
    const newElementId = segment.textElementId;
    logger.log("[Audio Sync] Pushing highlight to queue", {
      textElementId: newElementId,
    });
    pushHighlight(newElementId);

    // Auto-scroll if enabled and not currently restoring scroll position
    // Skip scrolling during restoration to avoid overwriting restored position
    if (autoScrollEnabled && !isRestoringScroll && segment.textElementId && contentRef.current) {
      const now = Date.now();
      const timeSinceLastScroll = now - lastScrollTimeRef.current;
      
      // Always scroll if element changed, or throttle if same element
      const elementChanged = lastScrolledElementRef.current !== segment.textElementId;
      const shouldScroll = elementChanged || timeSinceLastScroll >= scrollThrottleMs;
      
      if (shouldScroll) {
        // Optimize: Batch scroll operations using requestAnimationFrame
        // Cancel any pending scroll operation
        const pendingScroll = pendingScrollRef.current;
        if (pendingScroll && pendingScroll.rafId !== null) {
          cancelAnimationFrame(pendingScroll.rafId);
        }
        
        // Calculate offsets once (they're cached internally)
        const headerOffset = getHeaderOffset();
        const playerOffset = getPlayerOffset();
        
        // Store pending scroll operation
        pendingScrollRef.current = {
          elementId: segment.textElementId,
          headerOffset,
          playerOffset,
          rafId: null,
        };
        
        // Schedule scroll for next animation frame to batch with other updates
        pendingScrollRef.current.rafId = requestAnimationFrame(() => {
          if (!pendingScrollRef.current) return;
          
          const { elementId, headerOffset: hOffset, playerOffset: pOffset } = pendingScrollRef.current;
          logger.debug("[Audio Sync] Executing batched scroll", {
            elementId,
            headerOffset: hOffset,
            playerOffset: pOffset,
          });
          
          const scrolled = scrollToElement(elementId, "smooth", hOffset, pOffset);
          
          if (scrolled) {
            lastScrolledElementRef.current = elementId;
            lastScrollTimeRef.current = Date.now();
          } else if (elementChanged) {
            // Element not found yet, but update ref so we don't keep trying
            lastScrolledElementRef.current = elementId;
          }
          
          pendingScrollRef.current = null;
        });
      }
    }
  }, [autoScrollEnabled, isRestoringScroll, contentRef, getHeaderOffset, getPlayerOffset, onChapterChange, onChapterReload, elementIndex]);

  const clearHighlight = useCallback(() => {
    pushHighlight(null);
    lastScrolledElementRef.current = null;
    lastScrollTimeRef.current = 0;
  }, [pushHighlight]);

  // Mark that a track change is in progress (called from useAudioPlayerProgress)
  const markTrackChange = useCallback((trackHref: string) => {
    trackChangeInProgressRef.current = {
      trackHref,
      timestamp: Date.now(),
    };
    logger.log("[Audio Sync] Track change marked", { trackHref });
    
    // Clear the flag after grace period
    setTimeout(() => {
      if (trackChangeInProgressRef.current?.trackHref === trackHref) {
        trackChangeInProgressRef.current = null;
        logger.log("[Audio Sync] Track change grace period ended", { trackHref });
      }
    }, TRACK_CHANGE_GRACE_PERIOD_MS);
  }, []);

  // Mark that a chapter change is in progress (called from handleAudioTrackChange)
  const markChapterChange = useCallback((chapterId: string) => {
    // Clear existing timeout
    if (chapterChangeTimeoutRef.current) {
      clearTimeout(chapterChangeTimeoutRef.current);
    }
    
    chapterChangeInProgressRef.current = chapterId;
    logger.log("[Audio Sync] Chapter change marked", { chapterId });
    
    // Clear the flag after a delay to allow chapter change to complete
    chapterChangeTimeoutRef.current = window.setTimeout(() => {
      if (chapterChangeInProgressRef.current === chapterId) {
        chapterChangeInProgressRef.current = null;
        logger.log("[Audio Sync] Chapter change flag cleared", { chapterId });
      }
      chapterChangeTimeoutRef.current = null;
    }, 3000); // 3 seconds should be enough for chapter to load
  }, []);

  // Cleanup when chapter changes
  // Use a ref to track the previous activeChapterId to avoid clearing on initial mount
  const previousActiveChapterIdRef = useRef<string | undefined>(activeChapterId);
  
  useEffect(() => {
    const previousChapterId = previousActiveChapterIdRef.current;
    const currentChapterId = activeChapterId;
    
    // Only clear if chapter actually changed (and we have a current chapter ID)
    // AND the previous chapter ID was actually set (not initial mount)
    const chapterActuallyChanged = 
      previousChapterId !== undefined && 
      currentChapterId !== undefined &&
      currentChapterId !== previousChapterId;
    
    if (chapterActuallyChanged) {
      logger.log("[Audio Sync] Chapter changed, clearing highlight", {
        oldChapterId: previousChapterId,
        newChapterId: currentChapterId,
      });
      
      // Cancel any pending scroll operation
      const pendingScroll = pendingScrollRef.current;
      if (pendingScroll && pendingScroll.rafId !== null) {
        cancelAnimationFrame(pendingScroll.rafId);
        pendingScrollRef.current = null;
      }
      
      // Clear all refs and push clear to queue when chapter changes
      pushHighlight(null);
      lastScrolledElementRef.current = null;
      lastScrollTimeRef.current = 0;
      lastChapterChangeTimeRef.current = 0;
      lastReloadAttemptRef.current = null;
      trackChangeInProgressRef.current = null;
      chapterChangeInProgressRef.current = null;
      lastChapterIdRef.current = currentChapterId;
      previousActiveChapterIdRef.current = currentChapterId;
      
      // Clear cached DOM queries
      headerCacheRef.current = { element: null, offset: 0, lastCheck: 0 };
      playerCacheRef.current = { element: null, offset: 0, lastCheck: 0 };
      safeAreaCacheRef.current = { top: 0, lastCheck: 0 };
      spanElementCacheRef.current = { element: null, fontSize: 0, lastCheck: 0 };
      
      // Clear global DOM query cache on chapter change (memory optimization)
      clearAllCaches();
    } else {
      // Update ref to track the current chapter (even on initial mount)
      if (currentChapterId !== undefined) {
        previousActiveChapterIdRef.current = currentChapterId;
      }
    }
  }, [activeChapterId, pushHighlight]);

  // Cleanup all timeouts on unmount
  useEffect(() => {
    return () => {
      if (trackChangeTimeoutRef.current) {
        clearTimeout(trackChangeTimeoutRef.current);
      }
      if (chapterChangeTimeoutRef.current) {
        clearTimeout(chapterChangeTimeoutRef.current);
      }
    };
  }, []);

  return {
    updateHighlight,
    clearHighlight,
    markTrackChange,
    markChapterChange,
  };
}

