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

    setHighlightedElementId(segment.textElementId);

    // Auto-scroll if enabled and not currently restoring scroll position
    // Skip scrolling during restoration to avoid overwriting restored position
    if (autoScrollEnabled && !isRestoringScroll && segment.textElementId && contentRef.current) {
      // Only scroll if we haven't scrolled to this element yet
      if (lastScrolledElementRef.current !== segment.textElementId) {
        const element = contentRef.current.querySelector<HTMLElement>(
          `#${CSS.escape(segment.textElementId)}`
        );
        if (element) {
          const elementRect = element.getBoundingClientRect();
          const viewportHeight = window.innerHeight;
          const isVisible = elementRect.top < viewportHeight && elementRect.bottom > 0;
          
          if (!isVisible) {
            scrollToElement(contentRef.current, segment.textElementId, "smooth");
            lastScrolledElementRef.current = segment.textElementId;
          }
        }
      }
    }
  }, [autoScrollEnabled, isRestoringScroll, contentRef]);

  const clearHighlight = useCallback(() => {
    setHighlightedElementId(null);
    lastScrolledElementRef.current = null;
  }, []);

  return {
    highlightedElementId,
    updateHighlight,
    clearHighlight,
  };
}

