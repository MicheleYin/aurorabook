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
  isRestoringScroll: boolean = false,
  chromeVisible: boolean = true
) {
  const [highlightedElementId, setHighlightedElementId] = useState<string | null>(null);
  const lastScrolledElementRef = useRef<string | null>(null);
  const lastScrollTimeRef = useRef<number>(0);
  const scrollThrottleMs = 100; // Throttle scrolling to at most once per 100ms
  
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
      }
    }
    return 0;
  }, [chromeVisible]);

  const updateHighlight = useCallback((
    book: Book,
    chapter: Chapter | undefined,
    trackHref: string,
    currentTime: number
  ) => {
    console.log("[Audio Sync] updateHighlight called", {
      hasSyncMap: !!book.audioSyncMap,
      trackHref,
      currentTime,
      hasChapter: !!chapter,
      autoScrollEnabled,
      isRestoringScroll,
      hasContentRef: !!contentRef.current,
    });

    if (!book.audioSyncMap || !trackHref || !chapter) {
      console.log("[Audio Sync] Missing required data, clearing highlight");
      setHighlightedElementId(null);
      return;
    }

    const segment = findCurrentAudioSegment(
      book.audioSyncMap,
      trackHref,
      currentTime
    );

    if (!segment) {
      console.log("[Audio Sync] No segment found");
      setHighlightedElementId(null);
      return;
    }

    const chapterHref = chapter.href.split("#")[0];
    if (segment.chapterHref !== chapterHref) {
      console.log("[Audio Sync] Segment chapter mismatch", {
        segmentChapterHref: segment.chapterHref,
        currentChapterHref: chapterHref,
      });
      setHighlightedElementId(null);
      return;
    }

    console.log("[Audio Sync] Segment found", {
      textElementId: segment.textElementId,
      chapterHref: segment.chapterHref,
    });

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
      
      console.log("[Audio Sync] Scroll check", {
        elementChanged,
        timeSinceLastScroll,
        shouldScroll,
        lastElement: lastScrolledElementRef.current,
        currentElement: segment.textElementId,
      });
      
      if (shouldScroll) {
        const headerOffset = getHeaderOffset();
        console.log("[Audio Sync] Attempting scroll", {
          elementId: segment.textElementId,
          headerOffset,
          hasContentRef: !!contentRef.current,
        });
        
        const scrolled = scrollToElement(contentRef.current, segment.textElementId, "smooth", headerOffset);
        
        console.log("[Audio Sync] Scroll result", {
          scrolled,
          elementId: segment.textElementId,
        });
        
        if (scrolled) {
          lastScrolledElementRef.current = segment.textElementId;
          lastScrollTimeRef.current = now;
        } else if (elementChanged) {
          // Element not found yet, but update ref so we don't keep trying
          console.log("[Audio Sync] Element not found, updating ref");
          lastScrolledElementRef.current = segment.textElementId;
        }
      }
    } else {
      console.log("[Audio Sync] Scroll conditions not met", {
        autoScrollEnabled,
        isRestoringScroll,
        hasElementId: !!segment.textElementId,
        hasContentRef: !!contentRef.current,
      });
    }
  }, [autoScrollEnabled, isRestoringScroll, contentRef, getHeaderOffset]);

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

