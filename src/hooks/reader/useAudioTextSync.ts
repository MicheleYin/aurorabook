/**
 * Hook for audio-text synchronization
 * No useEffects - all operations are explicit via callbacks
 */

import { useCallback, useRef, useState } from "react";
import type { Book, Chapter } from "../../types/reader";
import { findCurrentAudioSegment } from "../../lib/epub";
import { scrollToElement } from "../../lib/scroll-utils";

export function useAudioTextSync(
  contentRef: React.RefObject<HTMLDivElement | null>,
  autoScrollEnabled: boolean,
  isRestoringScroll: boolean = false
) {
  const [highlightedElementId, setHighlightedElementId] = useState<string | null>(null);
  const lastScrolledElementRef = useRef<string | null>(null);
  const lastScrollTimeRef = useRef<number>(0);
  const scrollThrottleMs = 100; // Throttle scrolling to at most once per 100ms

  const updateHighlight = useCallback((
    book: Book,
    chapter: Chapter | undefined,
    trackHref: string,
    currentTime: number
  ) => {
    if (!book.audioSyncMap || !trackHref || !chapter) {
      setHighlightedElementId(null);
      return;
    }

    const segment = findCurrentAudioSegment(
      book.audioSyncMap,
      trackHref,
      currentTime
    );

    if (!segment) {
      setHighlightedElementId(null);
      return;
    }

    const chapterHref = chapter.href.split("#")[0];
    if (segment.chapterHref !== chapterHref) {
      setHighlightedElementId(null);
      return;
    }

    // Always update highlighting, even if element hasn't changed
    // This ensures highlighting is applied when audio sync updates
    setHighlightedElementId(segment.textElementId);

    // Auto-scroll if enabled and not currently restoring scroll position
    // Skip scrolling during restoration to avoid overwriting restored position
    if (autoScrollEnabled && !isRestoringScroll && segment.textElementId && contentRef.current) {
      const now = Date.now();
      const timeSinceLastScroll = now - lastScrollTimeRef.current;
      
      // Throttle scrolling to avoid excessive scroll operations
      // But always scroll if element changed
      const shouldScroll = 
        lastScrolledElementRef.current !== segment.textElementId || 
        timeSinceLastScroll >= scrollThrottleMs;
      
      if (shouldScroll) {
        const element = contentRef.current.querySelector<HTMLElement>(
          `#${CSS.escape(segment.textElementId)}`
        );
        
        if (element) {
          const elementRect = element.getBoundingClientRect();
          const containerRect = contentRef.current.getBoundingClientRect();
          const viewportHeight = containerRect.height || window.innerHeight;
          
          // Check if element is visible in the viewport
          // Use a larger margin (20% of viewport) to trigger scrolling earlier
          const margin = viewportHeight * 0.2;
          const isVisible = 
            elementRect.top >= containerRect.top - margin && 
            elementRect.bottom <= containerRect.bottom + margin;
          
          // Also check if element is partially visible
          const isPartiallyVisible = 
            elementRect.top < containerRect.bottom && 
            elementRect.bottom > containerRect.top;
          
          // Scroll if element is not visible or only partially visible
          // This ensures we keep the highlighted text centered/visible
          if (!isVisible || (isPartiallyVisible && elementRect.top < containerRect.top + margin)) {
            scrollToElement(contentRef.current, segment.textElementId, "smooth");
            lastScrolledElementRef.current = segment.textElementId;
            lastScrollTimeRef.current = now;
          } else if (lastScrolledElementRef.current !== segment.textElementId) {
            // Element changed but is already visible - just update ref
            lastScrolledElementRef.current = segment.textElementId;
          }
        } else {
          // Element not found - might not be loaded yet, try scrolling anyway
          // This handles cases where content is still loading
          scrollToElement(contentRef.current, segment.textElementId, "smooth");
          lastScrolledElementRef.current = segment.textElementId;
          lastScrollTimeRef.current = now;
        }
      }
    }
  }, [autoScrollEnabled, isRestoringScroll, contentRef]);

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

