/**
 * Hook for managing audio highlighting animations
 * Uses an animation queue to ensure animations play in correct order
 * No useEffects - highlighting applied explicitly via callback
 */

import { useCallback, useRef, useEffect } from "react";

// Match CSS animation duration (--anim-duration-slow = 400ms)
const ANIMATION_DURATION_MS = 400;

type QueuedAction = 
  | { type: 'clear' }
  | { type: 'highlight'; elementId: string };

export function useHighlighting(
  contentRef: React.RefObject<HTMLDivElement | null>,
  activeChapterId?: string
) {
  const highlightRef = useRef({
    queue: [] as QueuedAction[],
    processing: false,
    currentElement: null as HTMLElement | null,
    currentElementId: null as string | null,
    enterTimeout: null as number | null,
    exitTimeouts: new Map<HTMLElement, number>(),
  });

  const processQueue = useCallback(() => {
    const ref = highlightRef.current;
    const root = contentRef.current;
    
    if (ref.processing || ref.queue.length === 0 || !root) {
      return;
    }

    ref.processing = true;
    const action = ref.queue.shift()!;

    if (action.type === 'clear') {
      // Cancel any pending enter timeout
      if (ref.enterTimeout !== null) {
        clearTimeout(ref.enterTimeout);
        ref.enterTimeout = null;
      }

      // Clear all highlights with fade-out
      // Use a snapshot to avoid issues if DOM changes during iteration
      const allHighlighted = Array.from(root.querySelectorAll(".audio-highlight, .audio-highlight-enter, .audio-highlight-active"));
      
      if (allHighlighted.length === 0) {
        ref.processing = false;
        ref.currentElement = null;
        ref.currentElementId = null;
        processQueue();
        return;
      }

      allHighlighted.forEach((el) => {
        const element = el as HTMLElement;
        // Skip if element is no longer in the DOM
        if (!root.contains(element)) {
          // Clean up any pending timeout for this element
          const exitTimeout = ref.exitTimeouts.get(element);
          if (exitTimeout !== undefined) {
            clearTimeout(exitTimeout);
            ref.exitTimeouts.delete(element);
          }
          return;
        }
        
        // Cancel any pending exit timeouts
        const exitTimeout = ref.exitTimeouts.get(element);
        if (exitTimeout !== undefined) {
          clearTimeout(exitTimeout);
          ref.exitTimeouts.delete(element);
        }
        
        // Trigger exit animation
        element.classList.remove("audio-highlight-enter", "audio-highlight-active");
        if (!element.classList.contains("audio-highlight")) {
          element.classList.add("audio-highlight");
        }
        element.classList.add("audio-highlight-exit");
        
        // Clean up after exit animation
        const timeoutId = window.setTimeout(() => {
          // Check if element still exists before manipulating
          if (element.isConnected && root.contains(element)) {
            element.classList.remove("audio-highlight", "audio-highlight-exit");
          }
          ref.exitTimeouts.delete(element);
        }, ANIMATION_DURATION_MS);
        
        ref.exitTimeouts.set(element, timeoutId);
      });

      // Clear current element reference
      ref.currentElement = null;
      ref.currentElementId = null;
      
      // Wait for exit animations to complete before processing next item
      window.setTimeout(() => {
        ref.processing = false;
        processQueue();
      }, ANIMATION_DURATION_MS);
      return;
    }

    // Handle highlight action
    const { elementId } = action;
    const previousElementId = ref.currentElementId;
    const isNewHighlight = elementId !== previousElementId;

    // Clear previous enter timeout
    if (ref.enterTimeout !== null) {
      clearTimeout(ref.enterTimeout);
      ref.enterTimeout = null;
    }

    // If there's a current element and it's different, fade it out first
    if (ref.currentElement && isNewHighlight) {
      const previousElement = ref.currentElement;
      
      // Cancel any pending exit timeout
      const exitTimeout = ref.exitTimeouts.get(previousElement);
      if (exitTimeout !== undefined) {
        clearTimeout(exitTimeout);
        ref.exitTimeouts.delete(previousElement);
      }
      
      // Trigger exit animation
      previousElement.classList.remove("audio-highlight-enter", "audio-highlight-active");
      if (!previousElement.classList.contains("audio-highlight")) {
        previousElement.classList.add("audio-highlight");
      }
      previousElement.classList.add("audio-highlight-exit");
      
      // Clean up after exit animation
      const timeoutId = window.setTimeout(() => {
        // Check if element still exists before manipulating
        if (previousElement.isConnected && root.contains(previousElement)) {
          previousElement.classList.remove("audio-highlight", "audio-highlight-exit");
        }
        ref.exitTimeouts.delete(previousElement);
      }, ANIMATION_DURATION_MS);
      
      ref.exitTimeouts.set(previousElement, timeoutId);
    }

    // Find and apply new highlight
    // Use getElementById for better performance (O(1) vs O(n) for querySelector)
    let element: HTMLElement | null = null;
    const docElement = document.getElementById(elementId);
    if (docElement && root.contains(docElement)) {
      element = docElement;
    }
    
    // Fallback to querySelector only if getElementById didn't find it in our container
    if (!element) {
      const selector =
        typeof CSS !== "undefined" && CSS.escape
          ? `#${CSS.escape(elementId)}`
          : `#${elementId}`;
      element = root.querySelector<HTMLElement>(selector);
    }

    if (element) {
      // Cancel any exit animation on this element
      const exitTimeout = ref.exitTimeouts.get(element);
      if (exitTimeout !== undefined) {
        clearTimeout(exitTimeout);
        ref.exitTimeouts.delete(element);
      }
      element.classList.remove("audio-highlight-exit");

      // If this is the same element, just ensure it's active
      if (!isNewHighlight && ref.currentElement === element) {
        element.classList.remove("audio-highlight-enter");
        element.classList.add("audio-highlight", "audio-highlight-active");
        ref.processing = false;
        processQueue();
        return;
      }

      // Apply new highlight
      element.classList.remove("audio-highlight-enter", "audio-highlight-active");
      element.classList.add("audio-highlight");

      // Wait for previous exit animation if needed
      const waitTime = isNewHighlight && ref.currentElement ? ANIMATION_DURATION_MS : 0;

      window.setTimeout(() => {
        // Double-check element still exists and is still the target
        if (element.id === elementId && element.classList.contains("audio-highlight")) {
          // Start fade-in animation
          requestAnimationFrame(() => {
            if (element.id === elementId && element.classList.contains("audio-highlight")) {
              element.classList.add("audio-highlight-enter");
              
              // Transition to active state after fade-in completes
              ref.enterTimeout = window.setTimeout(() => {
                if (element.id === elementId && element.classList.contains("audio-highlight-enter")) {
                  element.classList.remove("audio-highlight-enter");
                  element.classList.add("audio-highlight-active");
                }
                ref.enterTimeout = null;
                ref.processing = false;
                ref.currentElement = element;
                ref.currentElementId = elementId;
                processQueue();
              }, ANIMATION_DURATION_MS);
            } else {
              ref.processing = false;
              processQueue();
            }
          });
        } else {
          ref.processing = false;
          processQueue();
        }
      }, waitTime);
    } else {
      // Element not found, continue processing
      ref.processing = false;
      ref.currentElement = null;
      ref.currentElementId = null;
      processQueue();
    }
  }, [contentRef]);

  const applyHighlight = useCallback((elementId: string | null) => {
    const root = contentRef.current;
    if (!root) return;

    // Add action to queue
    if (!elementId) {
      highlightRef.current.queue.push({ type: 'clear' });
    } else {
      highlightRef.current.queue.push({ type: 'highlight', elementId });
    }

    // Process queue
    processQueue();
  }, [processQueue]);

  // Cleanup when chapter changes or on unmount
  useEffect(() => {
    const ref = highlightRef.current;
    
    // Clear all pending timeouts
    if (ref.enterTimeout !== null) {
      clearTimeout(ref.enterTimeout);
      ref.enterTimeout = null;
    }
    // Clear all exit timeouts
    ref.exitTimeouts.forEach((timeoutId) => {
      clearTimeout(timeoutId);
    });
    ref.exitTimeouts.clear();
    // Clear queue
    ref.queue.length = 0;
    ref.processing = false;
    ref.currentElement = null;
    ref.currentElementId = null;
    
    // Clear all highlights in DOM when chapter changes
    if (contentRef.current) {
      const allHighlighted = contentRef.current.querySelectorAll(".audio-highlight, .audio-highlight-enter, .audio-highlight-active, .audio-highlight-exit");
      allHighlighted.forEach((el) => {
        el.classList.remove("audio-highlight", "audio-highlight-enter", "audio-highlight-active", "audio-highlight-exit");
      });
    }
  }, [activeChapterId, contentRef]);

  return {
    applyHighlight,
  };
}

