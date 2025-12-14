/**
 * Hook for managing audio highlighting animations
 * Pops from the highlight queue and processes animations
 * No useEffects - queue processing happens via explicit polling/effect
 */

import { useRef, useEffect } from "react";
import { useHighlightQueue } from "../../contexts/HighlightQueueContext";

// Match CSS animation duration (--anim-duration-slow = 400ms)
const ANIMATION_DURATION_MS = 400;

type ElementIndexHook = {
  hasElement: (elementId: string) => boolean;
  getElementInfo: (elementId: string) => { elementId: string; approximateScrollTop: number; segmentIndex?: number } | undefined;
};

export function useHighlighting(
  contentRef: React.RefObject<HTMLDivElement | null>,
  activeChapterId?: string,
  elementIndex?: ElementIndexHook
) {
  const { queue, popQueue, clearQueue } = useHighlightQueue();
  
  const highlightRef = useRef({
    processing: false,
    currentElement: null as HTMLElement | null,
    currentElementId: null as string | null,
    enterTimeout: null as number | null,
    exitTimeouts: new Map<HTMLElement, number>(),
  });

  // Process queue when it changes
  useEffect(() => {
    const ref = highlightRef.current;
    const root = contentRef.current;
    
    if (ref.processing || queue.length === 0 || !root) {
      return;
    }

    ref.processing = true;
    const action = queue[0];
    
    // Function to remove processed action from queue and continue processing
    const completeProcessing = () => {
      popQueue();
    };

    if (action.type === 'clear') {
      // Cancel any pending enter timeout
      if (ref.enterTimeout !== null) {
        clearTimeout(ref.enterTimeout);
        ref.enterTimeout = null;
      }

      // Clear all highlights with fade-out
      const allHighlighted = Array.from(root.querySelectorAll(".audio-highlight, .audio-highlight-enter, .audio-highlight-active"));
      
      if (allHighlighted.length === 0) {
        ref.processing = false;
        ref.currentElement = null;
        ref.currentElementId = null;
        completeProcessing();
        return;
      }

      allHighlighted.forEach((el) => {
        const element = el as HTMLElement;
        if (!root.contains(element)) {
          const exitTimeout = ref.exitTimeouts.get(element);
          if (exitTimeout !== undefined) {
            clearTimeout(exitTimeout);
            ref.exitTimeouts.delete(element);
          }
          return;
        }
        
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
        completeProcessing();
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
        if (previousElement.isConnected && root.contains(previousElement)) {
          previousElement.classList.remove("audio-highlight", "audio-highlight-exit");
        }
        ref.exitTimeouts.delete(previousElement);
      }, ANIMATION_DURATION_MS);
      
      ref.exitTimeouts.set(previousElement, timeoutId);
    }

    // Check element index first to avoid expensive DOM queries
    if (elementIndex && !elementIndex.hasElement(elementId)) {
      ref.processing = false;
      ref.currentElement = null;
      ref.currentElementId = null;
      completeProcessing();
      return;
    }

    // Find and apply new highlight
    let element: HTMLElement | null = null;
    const docElement = document.getElementById(elementId);
    if (docElement && root.contains(docElement)) {
      element = docElement;
    }
    
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
        completeProcessing();
        return;
      }

      // Apply new highlight
      element.classList.remove("audio-highlight-exit", "audio-highlight-enter");
      
      // If there's a previous element fading out, wait for it
      const waitTime = isNewHighlight && ref.currentElement ? ANIMATION_DURATION_MS : 0;
      
      if (waitTime === 0) {
        // No wait needed - apply highlight immediately
        element.classList.add("audio-highlight", "audio-highlight-active");
        ref.currentElement = element;
        ref.currentElementId = elementId;
        ref.processing = false;
        completeProcessing();
        return;
      }
      
      // Need to wait for previous element to fade out
      element.classList.add("audio-highlight");

      window.setTimeout(() => {
        if (element && element.id === elementId && element.classList.contains("audio-highlight")) {
          requestAnimationFrame(() => {
            if (element && element.id === elementId && element.classList.contains("audio-highlight")) {
              element.classList.add("audio-highlight-enter");
              
              // Transition to active state after fade-in completes
              ref.enterTimeout = window.setTimeout(() => {
                if (element && element.id === elementId && element.classList.contains("audio-highlight-enter")) {
                  element.classList.remove("audio-highlight-enter");
                  element.classList.add("audio-highlight-active");
                }
                ref.enterTimeout = null;
                ref.processing = false;
                ref.currentElement = element;
                ref.currentElementId = elementId;
                completeProcessing();
              }, ANIMATION_DURATION_MS);
            } else {
              ref.processing = false;
            }
          });
        } else {
          ref.processing = false;
        }
      }, waitTime);
    } else {
      // Element not found, continue processing
      ref.processing = false;
      ref.currentElement = null;
      ref.currentElementId = null;
      completeProcessing();
    }
  }, [queue, contentRef, elementIndex, popQueue]);

  // Cleanup when chapter changes or on unmount
  useEffect(() => {
    const ref = highlightRef.current;
    
    // Clear all pending timeouts
    if (ref.enterTimeout !== null) {
      clearTimeout(ref.enterTimeout);
      ref.enterTimeout = null;
    }
    ref.exitTimeouts.forEach((timeoutId) => {
      clearTimeout(timeoutId);
    });
    ref.exitTimeouts.clear();
    clearQueue();
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
  }, [activeChapterId, contentRef, clearQueue]);

  // Return nothing - this hook only processes the queue
  return {};
}
