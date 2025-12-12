/**
 * Hook for audio-text synchronization
 * No useEffects - all operations are explicit via callbacks
 */

import { useCallback, useRef, useState } from "react";
import { logger } from "../../lib/logger";
import type { Book, Chapter } from "../../types/reader";
import { findCurrentAudioSegment, chapterHrefsMatch, normalizeChapterHref } from "../../lib/epub";
import { scrollToElement } from "../../lib/scroll-utils";

export function useAudioTextSync(
  contentRef: React.RefObject<HTMLDivElement | null>,
  autoScrollEnabled: boolean,
  isRestoringScroll: boolean = false,
  chromeVisible: boolean = true,
  onChapterChange?: (chapterId: string, elementId?: string) => void,
  onChapterReload?: (chapterId: string) => void,
  audioPlayerVisible: boolean = false
) {
  const [highlightedElementId, setHighlightedElementId] = useState<string | null>(null);
  const lastScrolledElementRef = useRef<string | null>(null);
  const lastScrollTimeRef = useRef<number>(0);
  const scrollThrottleMs = 100; // Throttle scrolling to at most once per 100ms
  const lastChapterChangeTimeRef = useRef<number>(0);
  const chapterChangeThrottleMs = 500; // Throttle chapter changes to avoid rapid switching
  const lastReloadAttemptRef = useRef<{ chapterId: string; timestamp: number } | null>(null);
  const reloadThrottleMs = 2000; // Throttle reload attempts to avoid infinite loops
  const lastChapterIdRef = useRef<string | undefined>(undefined); // Track last chapter ID to detect stale references
  const trackChangeInProgressRef = useRef<{ trackHref: string; timestamp: number } | null>(null);
  const TRACK_CHANGE_GRACE_PERIOD_MS = 2000; // Ignore audio sync chapter changes for 2s after track change
  const chapterChangeInProgressRef = useRef<string | null>(null); // Track which chapter is being changed to prevent duplicate changes
  
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
  
  const CACHE_TTL_MS = 1000; // Re-check every second instead of every call
  
  // Get safe area top inset value (cached)
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
  
  // Calculate header offset dynamically when scrolling (with caching)
  const getHeaderOffset = useCallback((): number => {
    if (typeof document === "undefined") return 0;
    
    const now = Date.now();
    const cache = headerCacheRef.current;
    
    // Re-query only if cache expired or element not found
    if (!cache.element || (now - cache.lastCheck) >= CACHE_TTL_MS) {
      cache.element = document.querySelector<HTMLElement>("[data-reader-header]");
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
        
        // Cache text element query - only query once per cache period
        let textElement: HTMLElement | null = null;
        if (cache.lastCheck === 0 || (now - cache.lastCheck) >= CACHE_TTL_MS) {
          textElement = document.querySelector<HTMLElement>("p");
        }
        
        if (textElement) {
          const fontSize = window.getComputedStyle(textElement).fontSize;
          cache.offset = parseInt(fontSize) + rect.height;
        } else {
          cache.offset = rect.height;
        }
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

  // Calculate player offset dynamically when scrolling (with caching)
  const getPlayerOffset = useCallback((): number => {
    if (!audioPlayerVisible || typeof document === "undefined") return 0;
    
    const now = Date.now();
    const cache = playerCacheRef.current;
    
    // Use cached value if still valid
    if (cache.lastCheck > 0 && (now - cache.lastCheck) < CACHE_TTL_MS && cache.offset > 0) {
      return cache.offset;
    }
    
    // Re-query only if cache expired or element not found
    if (!cache.element || (now - cache.lastCheck) >= CACHE_TTL_MS) {
      cache.element = document.querySelector<HTMLElement>("[data-audio-player], [role='region'][aria-label*='audio'], .audio-player");
    }
    
    if (cache.element) {
      const rect = cache.element.getBoundingClientRect();
      const style = window.getComputedStyle(cache.element);
      if (rect.height > 0 && style.opacity !== "0" && style.display !== "none" && style.visibility !== "hidden") {
        const viewportHeight = window.innerHeight;
        const distanceFromBottom = viewportHeight - rect.top;
        
        // Cache text element query - only query once per cache period
        let textElement: HTMLElement | null = null;
        if (cache.lastCheck === 0 || (now - cache.lastCheck) >= CACHE_TTL_MS) {
          textElement = document.querySelector<HTMLElement>("p");
        }
        
        if (textElement) {
          const fontSize = window.getComputedStyle(textElement).fontSize;
          cache.offset = Math.max(0, distanceFromBottom + parseInt(fontSize));
        } else {
          cache.offset = Math.max(0, distanceFromBottom);
        }
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
      setHighlightedElementId(null);
      return;
    }

    const segment = findCurrentAudioSegment(
      book.audioSyncMap,
      trackHref,
      currentTime
    );

    if (!segment) {
      logger.log("[Audio Sync] No segment found");
      setHighlightedElementId(null);
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
      lastChapterIdRef.current = chapter.id;
    } else if (lastChapterIdRef.current === undefined) {
      lastChapterIdRef.current = chapter.id;
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
        setHighlightedElementId(null);
        return;
      }
      
      // Check if a chapter change is already in progress for this chapter
      if (matchingChapter && chapterChangeInProgressRef.current === matchingChapter.id) {
        logger.log("[Audio Sync] Ignoring chapter change - chapter change already in progress", {
          chapterId: matchingChapter.id,
          trackHref,
        });
        setHighlightedElementId(null);
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
                setHighlightedElementId(null);
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
              onChapterChange(matchingChapter.id, segment.textElementId);
              setTimeout(() => {
                if (chapterChangeInProgressRef.current === matchingChapter.id) {
                  chapterChangeInProgressRef.current = null;
                  logger.log("[Audio Sync] Chapter change flag cleared", {
                    chapterId: matchingChapter.id,
                  });
                }
              }, 3000); // Clear after 3 seconds (enough time for chapter to load)
              
              setHighlightedElementId(null);
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
      
      setHighlightedElementId(null);
      return;
    }

    logger.log("[Audio Sync] Segment found - chapter matches", {
      textElementId: segment.textElementId,
      segmentChapterHref: segment.chapterHref,
      segmentChapterHrefNormalized: segmentChapterHref,
      currentChapterHref: chapter.href,
      currentChapterHrefNormalized: chapterHref,
    });

    // Check if the element exists in the DOM
    // If not, and we have audio sync, the chapter might need to be reloaded with spans
    // Use getElementById for better performance than querySelector
    if (contentRef.current) {
      const element = contentRef.current.querySelector<HTMLElement>(`#${CSS.escape ? CSS.escape(segment.textElementId) : segment.textElementId}`);
      
      if (!element) {
        // Element not found - check if chapter content has any spans at all
        // Cache chapter content query to avoid repeated queries
        const chapterContent = contentRef.current.querySelector('[data-reader-chapter-content="true"]');
        const hasAnySpans = chapterContent?.querySelector('span[id^="f"]');
        
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
              hasChapterContent: !!chapterContent,
            });
            lastReloadAttemptRef.current = { chapterId: chapter.id, timestamp: now };
            onChapterReload(chapter.id);
            // Don't set highlight yet - wait for reload
            return;
          }
        } else if (!element) {
          // Only log warning if we're not reloading (to avoid spam)
          if (!onChapterReload || hasAnySpans) {
            console.warn("[Audio Sync] Element not found in DOM", {
              textElementId: segment.textElementId,
              hasChapterContent: !!chapterContent,
              hasAnySpans: !!hasAnySpans,
            });
          }
        }
      }
    }

    // Always update highlighting, even if element hasn't changed
    // This ensures highlighting is applied when audio sync updates
    setHighlightedElementId(segment.textElementId);

    // Auto-scroll if enabled and not currently restoring scroll position
    // Skip scrolling during restoration to avoid overwriting restored position
    if (autoScrollEnabled && !isRestoringScroll && segment.textElementId && contentRef.current) {
      const now = Date.now();
      const timeSinceLastScroll = now - lastScrollTimeRef.current;
      
      // Always scroll if element changed, or throttle if same element
      const elementChanged = lastScrolledElementRef.current !== segment.textElementId;
      const shouldScroll = elementChanged || timeSinceLastScroll >= scrollThrottleMs;
      
      logger.log("[Audio Sync] Scroll check", {
        elementChanged,
        timeSinceLastScroll,
        shouldScroll,
        lastElement: lastScrolledElementRef.current,
        currentElement: segment.textElementId,
      });
      
      if (shouldScroll) {
        const headerOffset = getHeaderOffset();
        const playerOffset = getPlayerOffset();
        logger.log("[Audio Sync] Attempting scroll", {
          elementId: segment.textElementId,
          headerOffset,
          playerOffset,
          hasContentRef: !!contentRef.current,
        });
        
        const scrolled = scrollToElement(contentRef.current, segment.textElementId, "smooth", headerOffset, playerOffset);
        
        logger.log("[Audio Sync] Scroll result", {
          scrolled,
          elementId: segment.textElementId,
        });
        
        if (scrolled) {
          lastScrolledElementRef.current = segment.textElementId;
          lastScrollTimeRef.current = now;
        } else if (elementChanged) {
          // Element not found yet, but update ref so we don't keep trying
          logger.log("[Audio Sync] Element not found, updating ref");
          lastScrolledElementRef.current = segment.textElementId;
        }
      }
    } else {
      logger.log("[Audio Sync] Scroll conditions not met", {
        autoScrollEnabled,
        isRestoringScroll,
        hasElementId: !!segment.textElementId,
        hasContentRef: !!contentRef.current,
      });
    }
  }, [autoScrollEnabled, isRestoringScroll, contentRef, getHeaderOffset, getPlayerOffset, onChapterChange, onChapterReload]);

  const clearHighlight = useCallback(() => {
    setHighlightedElementId(null);
    lastScrolledElementRef.current = null;
    lastScrollTimeRef.current = 0;
  }, []);

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
    chapterChangeInProgressRef.current = chapterId;
    logger.log("[Audio Sync] Chapter change marked", { chapterId });
    
    // Clear the flag after a delay to allow chapter change to complete
    setTimeout(() => {
      if (chapterChangeInProgressRef.current === chapterId) {
        chapterChangeInProgressRef.current = null;
        logger.log("[Audio Sync] Chapter change flag cleared", { chapterId });
      }
    }, 3000); // 3 seconds should be enough for chapter to load
  }, []);

  return {
    highlightedElementId,
    updateHighlight,
    clearHighlight,
    markTrackChange,
    markChapterChange,
  };
}

