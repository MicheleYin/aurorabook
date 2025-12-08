/**
 * Hook for managing audio highlighting animations
 * No useEffects - highlighting applied explicitly via callback
 */

import { useCallback, useRef } from "react";

// Match CSS animation duration (--anim-duration-slow = 400ms)
const ANIMATION_DURATION_MS = 400;

export function useHighlighting(
  contentRef: React.RefObject<HTMLDivElement | null>
) {
  const highlightRef = useRef({
    enterTimeout: null as number | null,
    exitTimeouts: new Map<HTMLElement, number>(),
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
        // Cancel any pending exit timeouts for this element
        const exitTimeout = highlightRef.current.exitTimeouts.get(element);
        if (exitTimeout !== undefined) {
          clearTimeout(exitTimeout);
          highlightRef.current.exitTimeouts.delete(element);
        }
        element.classList.remove("audio-highlight", "audio-highlight-enter", "audio-highlight-active", "audio-highlight-exit");
      });
      highlightRef.current.lastHighlightedId = null;
      return;
    }

    const previousHighlightedId = highlightRef.current.lastHighlightedId;
    const isNewHighlight = elementId !== previousHighlightedId;

    // Clear previous enter timeout
    if (highlightRef.current.enterTimeout !== null) {
      clearTimeout(highlightRef.current.enterTimeout);
      highlightRef.current.enterTimeout = null;
    }

    // Remove existing highlights
    const allHighlighted = root.querySelectorAll(".audio-highlight, .audio-highlight-enter, .audio-highlight-active");
    allHighlighted.forEach((el) => {
      const element = el as HTMLElement;
      if (element.id === elementId) {
        // This is the element being highlighted - cancel any exit animation
        const exitTimeout = highlightRef.current.exitTimeouts.get(element);
        if (exitTimeout !== undefined) {
          clearTimeout(exitTimeout);
          highlightRef.current.exitTimeouts.delete(element);
        }
        element.classList.remove("audio-highlight-exit");
        return;
      }
      
      // Cancel any pending exit timeout for this element
      const exitTimeout = highlightRef.current.exitTimeouts.get(element);
      if (exitTimeout !== undefined) {
        clearTimeout(exitTimeout);
        highlightRef.current.exitTimeouts.delete(element);
      }
      
      // Remove enter/active states and trigger exit animation
      element.classList.remove("audio-highlight-enter", "audio-highlight-active");
      if (!element.classList.contains("audio-highlight")) {
        element.classList.add("audio-highlight");
      }
      element.classList.add("audio-highlight-exit");
      
      // Set timeout to clean up after exit animation completes
      // Match the CSS animation duration
      const timeoutId = window.setTimeout(() => {
        element.classList.remove("audio-highlight", "audio-highlight-exit");
        highlightRef.current.exitTimeouts.delete(element);
      }, ANIMATION_DURATION_MS);
      
      highlightRef.current.exitTimeouts.set(element, timeoutId);
    });

    // Apply new highlighting
    const selector =
      typeof CSS !== "undefined" && CSS.escape
        ? `#${CSS.escape(elementId)}`
        : `#${elementId}`;
    const element = root.querySelector<HTMLElement>(selector);
    
    if (element) {
      // Ensure exit animation is removed
      element.classList.remove("audio-highlight-exit");
      
      // If this element was previously highlighted and is being re-highlighted,
      // we might need to reset the animation state
      const wasHighlighted = element.classList.contains("audio-highlight") || 
                             element.classList.contains("audio-highlight-enter") ||
                             element.classList.contains("audio-highlight-active");
      
      if (wasHighlighted && !isNewHighlight) {
        // Same element, just ensure it's in active state
        element.classList.remove("audio-highlight-enter");
        element.classList.add("audio-highlight", "audio-highlight-active");
      } else {
        // New highlight or element
        element.classList.remove("audio-highlight-enter", "audio-highlight-active");
        element.classList.add("audio-highlight");
        
        if (isNewHighlight) {
          // Use requestAnimationFrame to ensure DOM is ready
          requestAnimationFrame(() => {
            // Double-check element still exists and is still the target
            if (element.id === elementId && element.classList.contains("audio-highlight")) {
              element.classList.add("audio-highlight-enter");
              highlightRef.current.enterTimeout = window.setTimeout(() => {
                // Double-check again before transitioning
                if (element.id === elementId && element.classList.contains("audio-highlight-enter")) {
                  element.classList.remove("audio-highlight-enter");
                  element.classList.add("audio-highlight-active");
                }
                highlightRef.current.enterTimeout = null;
              }, ANIMATION_DURATION_MS);
            }
          });
        } else {
          element.classList.add("audio-highlight-active");
        }
      }
    }

    highlightRef.current.lastHighlightedId = elementId;
  }, [contentRef]);

  return {
    applyHighlight,
  };
}

