/**
 * Hook for managing audio highlighting animations
 * Uses pure DOM manipulation - no React re-renders
 * Processes queue via event listener instead of useEffect
 */

import { useRef, useEffect } from "react";
import { useHighlightQueue } from "../../contexts/HighlightQueueContext";

// TEMPORARY: Feature flag to disable highlighting
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const ENABLE_HIGHLIGHTING = true;

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
  // TEMPORARY: Early return if disabled
  if (!ENABLE_HIGHLIGHTING) {
    return {};
  }

  const { _getQueue, _popQueue, clearQueue } = useHighlightQueue();
  
  // Use WeakMap exclusively for exit timeouts to allow garbage collection of removed elements
  const exitTimeoutsWeakMap = useRef(new WeakMap<HTMLElement, number>());
  // Track timeout IDs separately for cleanup (WeakMap doesn't allow iteration)
  const timeoutIdsRef = useRef(new Set<number>());
  
  const highlightRef = useRef({
    processing: false,
    currentElement: null as HTMLElement | null,
    currentElementId: null as string | null,
    enterTimeout: null as number | null,
    pendingUpdates: new Set<HTMLElement>(), // Batch DOM updates
    rafScheduled: false,
    rafId: null as number | null, // Track RAF to cancel if needed
    elementCache: new Map<string, HTMLElement | null>(), // Cache element lookups
  });

  // Process queue via event listener (no React re-renders)
  useEffect(() => {
    const ref = highlightRef.current;
    const root = contentRef.current;
    
    const processQueue = () => {
      if (ref.processing || !root) {
        return;
      }

      const queue = _getQueue();
      if (queue.length === 0) {
        return;
      }

      ref.processing = true;
      const action = queue[0];
      
      // Function to remove processed action from queue and continue processing
      const completeProcessing = () => {
        _popQueue();
        ref.processing = false;
        
        // Process next item in queue if any
        requestAnimationFrame(() => {
          processQueue();
        });
      };

    if (action.type === 'clear') {
      // Cancel any pending enter timeout
      if (ref.enterTimeout !== null) {
        clearTimeout(ref.enterTimeout);
        ref.enterTimeout = null;
      }

      // Clear all highlights with fade-out - batch DOM updates with requestAnimationFrame
      if (!ref.rafScheduled) {
        ref.rafScheduled = true;
        // Cancel previous RAF if any
        if (ref.rafId !== null) {
          cancelAnimationFrame(ref.rafId);
        }
        ref.rafId = requestAnimationFrame(() => {
          ref.rafId = null;
          // Use querySelectorAll but limit results to prevent memory issues
          const allHighlighted = root.querySelectorAll(".audio-highlight, .audio-highlight-enter, .audio-highlight-active");
          
          if (allHighlighted.length === 0) {
            ref.processing = false;
            ref.currentElement = null;
            ref.currentElementId = null;
            ref.rafScheduled = false;
            completeProcessing();
            return;
          }

          // Process in batches to avoid blocking
          const elements = Array.from(allHighlighted).slice(0, 100) as HTMLElement[]; // Limit to 100 elements max
          
          elements.forEach((element) => {
            if (!root.contains(element)) {
              // Use WeakMap for cleanup
              const exitTimeout = exitTimeoutsWeakMap.current.get(element);
              if (exitTimeout !== undefined) {
                clearTimeout(exitTimeout);
                exitTimeoutsWeakMap.current.delete(element);
                timeoutIdsRef.current.delete(exitTimeout);
              }
              return;
            }
            
            // Clear existing timeout
            const exitTimeout = exitTimeoutsWeakMap.current.get(element);
            if (exitTimeout !== undefined) {
              clearTimeout(exitTimeout);
              exitTimeoutsWeakMap.current.delete(element);
              timeoutIdsRef.current.delete(exitTimeout);
            }
            
            // Trigger exit animation
            element.classList.remove("audio-highlight-enter", "audio-highlight-active");
            if (!element.classList.contains("audio-highlight")) {
              element.classList.add("audio-highlight");
            }
            element.classList.add("audio-highlight-exit");
            
            // Clean up after exit animation - use WeakMap exclusively to allow GC
            const timeoutId = window.setTimeout(() => {
              // Clear timeout reference to allow GC
              exitTimeoutsWeakMap.current.delete(element);
              timeoutIdsRef.current.delete(timeoutId);
              
              if (element.isConnected && root.contains(element)) {
                element.classList.remove("audio-highlight", "audio-highlight-exit");
              }
            }, ANIMATION_DURATION_MS);
            
            // Store in WeakMap (allows GC) and track ID for cleanup
            exitTimeoutsWeakMap.current.set(element, timeoutId);
            timeoutIdsRef.current.add(timeoutId);
          });

          // Clear current element reference
          ref.currentElement = null;
          ref.currentElementId = null;
          ref.rafScheduled = false;
          
          // Wait for exit animations to complete before processing next item
          window.setTimeout(() => {
            ref.processing = false;
            completeProcessing();
          }, ANIMATION_DURATION_MS);
        });
      }
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
      
      // Clear existing timeout
      const exitTimeout = exitTimeoutsWeakMap.current.get(previousElement);
      if (exitTimeout !== undefined) {
        clearTimeout(exitTimeout);
        exitTimeoutsWeakMap.current.delete(previousElement);
        timeoutIdsRef.current.delete(exitTimeout);
      }
      
      // Trigger exit animation
      previousElement.classList.remove("audio-highlight-enter", "audio-highlight-active");
      if (!previousElement.classList.contains("audio-highlight")) {
        previousElement.classList.add("audio-highlight");
      }
      previousElement.classList.add("audio-highlight-exit");
      
      // Clean up after exit animation - use WeakMap exclusively to allow GC
      const timeoutId = window.setTimeout(() => {
        // Clear timeout reference to allow GC
        exitTimeoutsWeakMap.current.delete(previousElement);
        timeoutIdsRef.current.delete(timeoutId);
        
        if (previousElement.isConnected && root.contains(previousElement)) {
          previousElement.classList.remove("audio-highlight", "audio-highlight-exit");
        }
      }, ANIMATION_DURATION_MS);
      
      // Store in WeakMap (allows GC) and track ID for cleanup
      exitTimeoutsWeakMap.current.set(previousElement, timeoutId);
      timeoutIdsRef.current.add(timeoutId);
    }

    // Optimize: Check element index first to avoid expensive DOM queries
    if (elementIndex && !elementIndex.hasElement(elementId)) {
      ref.processing = false;
      ref.currentElement = null;
      ref.currentElementId = null;
      // Clear cache entry for non-existent element
      ref.elementCache.delete(elementId);
      completeProcessing();
      return;
    }

    // Optimize: Check cache first before DOM query
    let element: HTMLElement | null = ref.elementCache.get(elementId) ?? null;
    
    // Verify cached element is still valid
    if (element && (!element.isConnected || !root.contains(element))) {
      // Cached element is no longer valid
      ref.elementCache.delete(elementId);
      element = null;
    }
    
    // Only query DOM if not in cache
    if (!element) {
      // Use getElementById (O(1)) instead of querySelector (O(n))
      const docElement = document.getElementById(elementId);
      if (docElement && root.contains(docElement)) {
        element = docElement;
      }
      
      // Cache the result (even if null, to avoid repeated queries)
      ref.elementCache.set(elementId, element);
      
      // Limit cache size to prevent memory leaks
      if (ref.elementCache.size > 100) {
        // Remove oldest entry (first in Map)
        const firstKey = ref.elementCache.keys().next().value;
        if (firstKey) {
          ref.elementCache.delete(firstKey);
        }
      }
    }

    if (element) {
      // Cancel any exit animation on this element
      const exitTimeout = exitTimeoutsWeakMap.current.get(element);
      if (exitTimeout !== undefined) {
        clearTimeout(exitTimeout);
        exitTimeoutsWeakMap.current.delete(element);
        timeoutIdsRef.current.delete(exitTimeout);
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
        // Capture element reference at timeout creation
        const capturedElement = element;
        const capturedElementId = elementId;
        
        if (capturedElement && capturedElement.id === capturedElementId && capturedElement.classList.contains("audio-highlight")) {
          // Cancel previous RAF if any
          if (ref.rafId !== null) {
            cancelAnimationFrame(ref.rafId);
          }
          ref.rafId = requestAnimationFrame(() => {
            ref.rafId = null;
            if (capturedElement && capturedElement.id === capturedElementId && capturedElement.classList.contains("audio-highlight")) {
              capturedElement.classList.add("audio-highlight-enter");
              
              // Transition to active state after fade-in completes
              ref.enterTimeout = window.setTimeout(() => {
                if (capturedElement && capturedElement.id === capturedElementId && capturedElement.classList.contains("audio-highlight-enter")) {
                  capturedElement.classList.remove("audio-highlight-enter");
                  capturedElement.classList.add("audio-highlight-active");
                }
                ref.enterTimeout = null;
                ref.processing = false;
                ref.currentElement = capturedElement;
                ref.currentElementId = capturedElementId;
                completeProcessing();
              }, ANIMATION_DURATION_MS);
            } else {
              ref.processing = false;
              completeProcessing();
            }
          });
        } else {
          ref.processing = false;
          completeProcessing();
        }
      }, waitTime);
      
      // Store timeout ID for potential cleanup (though it should complete)
      // Note: We don't store this in a Map since it's a one-time timeout
    } else {
      // Element not found, continue processing
      ref.processing = false;
      ref.currentElement = null;
      ref.currentElementId = null;
      completeProcessing();
    }
    }; // Close processQueue function

    // Listen for queue updates via custom event (no React re-renders)
    const handleQueueUpdate = () => {
      processQueue();
    };

    window.addEventListener('highlight-queue-updated', handleQueueUpdate);
    
    // Process queue on mount
    processQueue();
    
    return () => {
      window.removeEventListener('highlight-queue-updated', handleQueueUpdate);
      // Cancel any pending RAF
      if (ref.rafId !== null) {
        cancelAnimationFrame(ref.rafId);
        ref.rafId = null;
      }
      // Clear all timeouts
      if (ref.enterTimeout !== null) {
        clearTimeout(ref.enterTimeout);
        ref.enterTimeout = null;
      }
      // Clear exit timeouts (tracked separately since WeakMap doesn't allow iteration)
      timeoutIdsRef.current.forEach((timeoutId) => {
        clearTimeout(timeoutId);
      });
      timeoutIdsRef.current.clear();
      exitTimeoutsWeakMap.current = new WeakMap();
    };
  }, [contentRef, elementIndex, _getQueue, _popQueue]);

  // Cleanup when chapter changes or on unmount
  useEffect(() => {
    const ref = highlightRef.current;
    
    // Clear all pending timeouts
    if (ref.enterTimeout !== null) {
      clearTimeout(ref.enterTimeout);
      ref.enterTimeout = null;
    }
    // Cancel any pending RAF
    if (ref.rafId !== null) {
      cancelAnimationFrame(ref.rafId);
      ref.rafId = null;
    }
    // Clear exit timeouts (tracked separately since WeakMap doesn't allow iteration)
    timeoutIdsRef.current.forEach((timeoutId) => {
      clearTimeout(timeoutId);
    });
    timeoutIdsRef.current.clear();
    exitTimeoutsWeakMap.current = new WeakMap(); // Reset WeakMap
    ref.pendingUpdates.clear();
    ref.elementCache.clear(); // Clear element cache
    ref.rafScheduled = false;
    clearQueue();
    ref.processing = false;
    ref.currentElement = null;
    ref.currentElementId = null;
    
    // Clear all highlights in DOM when chapter changes - batch DOM updates
    if (contentRef.current) {
      requestAnimationFrame(() => {
        if (contentRef.current) {
          const allHighlighted = contentRef.current.querySelectorAll(".audio-highlight, .audio-highlight-enter, .audio-highlight-active, .audio-highlight-exit");
          allHighlighted.forEach((el) => {
            el.classList.remove("audio-highlight", "audio-highlight-enter", "audio-highlight-active", "audio-highlight-exit");
          });
        }
      });
    }
  }, [activeChapterId, contentRef, clearQueue]);

  // Return nothing - this hook only processes the queue
  return {};
}
