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
  
  // Calculate header offset dynamically when scrolling
  const getHeaderOffset = useCallback((): number => {
    if (!chromeVisible || typeof document === "undefined") return 0;
    const header = document.querySelector<HTMLElement>("[data-reader-header]");
    if (header) {
      const rect = header.getBoundingClientRect();
      // Only return height if header is actually visible (not hidden/immersive)
      // Check computed style to see if it's hidden
      const style = window.getComputedStyle(header);
      if (rect.height > 0 && style.opacity !== "0" && style.display !== "none") {
        // get the font size of a text in the window and add to the header height
        const text = document.querySelector<HTMLElement>("p");
        if (text) {
          const fontSize = window.getComputedStyle(text).fontSize;
          return parseInt(fontSize) + rect.height;
        }
        return rect.height;
      }
    }
    return 0;
  }, [chromeVisible]);

  // Calculate player offset dynamically when scrolling
  const getPlayerOffset = useCallback((): number => {
    if (!audioPlayerVisible || typeof document === "undefined") return 0;
    // Find the audio player element - it's typically a fixed element at the bottom
    // Look for common audio player selectors or data attributes
    const player = document.querySelector<HTMLElement>("[data-audio-player], [role='region'][aria-label*='audio'], .audio-player");
    if (player) {
      const rect = player.getBoundingClientRect();
      const style = window.getComputedStyle(player);
      // Only return height if player is actually visible
      if (rect.height > 0 && style.opacity !== "0" && style.display !== "none" && style.visibility !== "hidden") {
        // Calculate offset from bottom of viewport
        // For fixed elements at bottom, this is the height plus any bottom spacing
        const viewportHeight = window.innerHeight;
        const distanceFromBottom = viewportHeight - rect.top;
        // add the font size of a text in the window to the distance from bottom
        const text = document.querySelector<HTMLElement>("p");
        if (text) {
          const fontSize = window.getComputedStyle(text).fontSize;
          return Math.max(0, distanceFromBottom + parseInt(fontSize));
        }
        return Math.max(0, distanceFromBottom);
      }
    }
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
        autoScrollEnabled,
        hasOnChapterChange: !!onChapterChange,
      });
      
      // If auto scroll is enabled, navigate to the correct chapter
      if (autoScrollEnabled && onChapterChange) {
        const now = Date.now();
        const timeSinceLastChange = now - lastChapterChangeTimeRef.current;
        
        // Throttle chapter changes to avoid rapid switching
        if (timeSinceLastChange >= chapterChangeThrottleMs) {
          // Use the segmentChapter we already found, or find it again
          const matchingChapter = segmentChapter || book.chapters.find((ch) => {
            return chapterHrefsMatch(segment.chapterHref, ch.href);
          });

          if (matchingChapter) {
            if (matchingChapter.id !== chapter.id) {
              logger.log("[Audio Sync] Navigating to correct chapter", {
                fromChapterId: chapter.id,
                fromChapterHref: chapter.href,
                toChapterId: matchingChapter.id,
                toChapterHref: matchingChapter.href,
                segmentChapterHref: segment.chapterHref,
                elementId: segment.textElementId,
                timeSinceLastChange,
              });
              
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
              onChapterChange(matchingChapter.id, segment.textElementId);
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
    if (contentRef.current) {
      const selector = typeof CSS !== "undefined" && CSS.escape
        ? `#${CSS.escape(segment.textElementId)}`
        : `#${segment.textElementId}`;
      const element = contentRef.current.querySelector<HTMLElement>(selector);
      
      if (!element) {
        // Element not found - check if chapter content has any spans at all
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
          console.warn("[Audio Sync] Element not found in DOM", {
            textElementId: segment.textElementId,
            hasChapterContent: !!chapterContent,
            hasAnySpans: !!hasAnySpans,
          });
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

  return {
    highlightedElementId,
    updateHighlight,
    clearHighlight,
  };
}

