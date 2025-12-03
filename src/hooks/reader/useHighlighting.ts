/**
 * Hook for managing audio highlighting animations
 * No useEffects - highlighting applied explicitly via callback
 */

import { useCallback, useRef } from "react";

export function useHighlighting(
  contentRef: React.RefObject<HTMLDivElement | null>
) {
  const highlightRef = useRef({
    enterTimeout: null as number | null,
    lastHighlightedId: null as string | null,
  });

  const applyHighlight = useCallback((elementId: string | null) => {
    const root = contentRef.current;
    if (!root) return;

    if (!elementId) {
      // Clear all highlights
      const allHighlighted = root.querySelectorAll(".audio-highlight, .audio-highlight-enter, .audio-highlight-active");
      allHighlighted.forEach((el) => {
        const element = el as HTMLElement;
        element.classList.remove("audio-highlight", "audio-highlight-enter", "audio-highlight-active", "audio-highlight-exit");
      });
      highlightRef.current.lastHighlightedId = null;
      return;
    }

    const previousHighlightedId = highlightRef.current.lastHighlightedId;
    const isNewHighlight = elementId !== previousHighlightedId;

    // Clear previous timeout
    if (highlightRef.current.enterTimeout !== null) {
      clearTimeout(highlightRef.current.enterTimeout);
      highlightRef.current.enterTimeout = null;
    }

    // Remove existing highlights
    const allHighlighted = root.querySelectorAll(".audio-highlight, .audio-highlight-enter, .audio-highlight-active");
    allHighlighted.forEach((el) => {
      const element = el as HTMLElement;
      if (element.id === elementId) {
        return;
      }
      
      element.classList.remove("audio-highlight-enter", "audio-highlight-active");
      if (!element.classList.contains("audio-highlight")) {
        element.classList.add("audio-highlight");
      }
      element.classList.add("audio-highlight-exit");
      
      setTimeout(() => {
        element.classList.remove("audio-highlight", "audio-highlight-exit");
      }, 200);
    });

    // Apply new highlighting
    const selector =
      typeof CSS !== "undefined" && CSS.escape
        ? `#${CSS.escape(elementId)}`
        : `#${elementId}`;
    const element = root.querySelector<HTMLElement>(selector);
    
    if (element) {
      element.classList.remove("audio-highlight-exit");
      element.classList.remove("audio-highlight-enter", "audio-highlight-active");
      element.classList.add("audio-highlight");
      
      if (isNewHighlight) {
        requestAnimationFrame(() => {
          element.classList.add("audio-highlight-enter");
          highlightRef.current.enterTimeout = window.setTimeout(() => {
            element.classList.remove("audio-highlight-enter");
            element.classList.add("audio-highlight-active");
            highlightRef.current.enterTimeout = null;
          }, 200);
        });
      } else {
        element.classList.add("audio-highlight-active");
      }
    }

    highlightRef.current.lastHighlightedId = elementId;
  }, [contentRef]);

  return {
    applyHighlight,
  };
}

