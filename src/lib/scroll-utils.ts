/**
 * Utility functions for scroll management
 * Uses refs and callbacks to avoid excessive useEffects
 */

import { logger } from "./logger";

export type ScrollMetrics = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  maxScroll: number;
};

// Extended ScrollMetrics type that includes virtualized segment information
export type ScrollMetricsWithSegments = ScrollMetrics & {
  segmentIndex?: number;
  totalSegments?: number;
};

export function computeScrollMetrics(node: HTMLElement | null): ScrollMetrics | null {
  if (!node) return null;

  const scrollHeight = Math.max(node.scrollHeight, 0);
  const clientHeight = Math.max(node.clientHeight, 0);
  const maxScroll = Math.max(scrollHeight - clientHeight, 0);
  
  // Get raw scrollTop before clamping
  const rawScrollTop = node.scrollTop;
  
  // Only clamp if maxScroll > 0, otherwise use raw value
  // This handles cases where scrollHeight === clientHeight but scrollTop might still be set
  const scrollTop = maxScroll > 0 
    ? Math.min(Math.max(rawScrollTop, 0), maxScroll)
    : Math.max(rawScrollTop, 0);

  return { scrollTop, scrollHeight, clientHeight, maxScroll };
}

/**
 * Compute scroll metrics for the window/document
 */
export function computeWindowScrollMetrics(): ScrollMetrics {
  const scrollTop = window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
  const scrollHeight = Math.max(
    document.documentElement.scrollHeight,
    document.body.scrollHeight,
    0
  );
  const clientHeight = window.innerHeight || document.documentElement.clientHeight || 0;
  const maxScroll = Math.max(scrollHeight - clientHeight, 0);
  
  return { 
    scrollTop: Math.max(scrollTop, 0), 
    scrollHeight, 
    clientHeight, 
    maxScroll 
  };
}

export function calculateProgress(metrics: ScrollMetrics | null): number {
  if (!metrics) return 0;
  
  if (metrics.maxScroll > 0) {
    const percent = metrics.scrollTop / metrics.maxScroll;
    return Math.min(Math.max(percent, 0), 1);
  }
  
  // If maxScroll is 0, there's nothing to scroll
  // Return 0 regardless of scrollTop (scrollTop > 0 with maxScroll = 0 is invalid state)
  return 0;
}

export function restoreScrollPosition(
  node: HTMLElement,
  savedMetrics: {
    scrollTop?: number;
    scrollHeight?: number;
    clientHeight?: number;
    percent?: number;
  },
): boolean {
  const current = computeScrollMetrics(node);
  if (!current || current.maxScroll <= 0) return false;

  const savedScrollTop = typeof savedMetrics.scrollTop === "number" && Number.isFinite(savedMetrics.scrollTop)
    ? Math.max(savedMetrics.scrollTop, 0)
    : 0;
  const savedScrollHeight = typeof savedMetrics.scrollHeight === "number" && Number.isFinite(savedMetrics.scrollHeight)
    ? Math.max(savedMetrics.scrollHeight, 0)
    : 0;
  const savedClientHeight = typeof savedMetrics.clientHeight === "number" && Number.isFinite(savedMetrics.clientHeight)
    ? Math.max(savedMetrics.clientHeight, 0)
    : 0;
  const savedPercent = typeof savedMetrics.percent === "number" && Number.isFinite(savedMetrics.percent)
    ? Math.min(Math.max(savedMetrics.percent, 0), 1)
    : 0;

  if (savedScrollTop === 0 && savedPercent === 0) return false;

  const savedMaxScroll = Math.max(savedScrollHeight - savedClientHeight, 0);
  let targetScrollTop = 0;

  // If dimensions match closely, use exact scrollTop
  const heightDiff = Math.abs(current.scrollHeight - savedScrollHeight);
  const clientDiff = Math.abs(current.clientHeight - savedClientHeight);
  const heightTolerance = Math.max(savedScrollHeight * 0.05, 50);
  const clientTolerance = Math.max(savedClientHeight * 0.1, 20);

  if (
    heightDiff < heightTolerance &&
    clientDiff < clientTolerance &&
    savedMaxScroll > 0 &&
    savedScrollTop > 0
  ) {
    targetScrollTop = Math.min(savedScrollTop, current.maxScroll);
  } else if (savedMaxScroll > 0 && savedScrollTop > 0) {
    const savedRatio = Math.min(Math.max(savedScrollTop / savedMaxScroll, 0), 1);
    targetScrollTop = Math.round(savedRatio * current.maxScroll);
  } else if (savedPercent > 0) {
    targetScrollTop = Math.round(savedPercent * current.maxScroll);
  }

  if (targetScrollTop > 0 && Math.abs(node.scrollTop - targetScrollTop) > 1) {
    node.scrollTop = targetScrollTop;
    return true;
  }

  return false;
}

/**
 * Restore window scroll position
 */
export function restoreWindowScrollPosition(savedMetrics: {
  scrollTop?: number;
  scrollHeight?: number;
  clientHeight?: number;
  percent?: number;
}): boolean {
  const current = computeWindowScrollMetrics();
  if (current.maxScroll <= 0) return false;
  logger.debug("[Scroll] restoreWindowScrollPosition called", {
    savedMetrics,
    current,
  });

  const savedScrollTop = typeof savedMetrics.scrollTop === "number" && Number.isFinite(savedMetrics.scrollTop)
    ? Math.max(savedMetrics.scrollTop, 0)
    : 0;
  const savedScrollHeight = typeof savedMetrics.scrollHeight === "number" && Number.isFinite(savedMetrics.scrollHeight)
    ? Math.max(savedMetrics.scrollHeight, 0)
    : 0;
  const savedClientHeight = typeof savedMetrics.clientHeight === "number" && Number.isFinite(savedMetrics.clientHeight)
    ? Math.max(savedMetrics.clientHeight, 0)
    : 0;
  const savedPercent = typeof savedMetrics.percent === "number" && Number.isFinite(savedMetrics.percent)
    ? Math.min(Math.max(savedMetrics.percent, 0), 1)
    : 0;

  if (savedScrollTop === 0 && savedPercent === 0) return false;

  const savedMaxScroll = Math.max(savedScrollHeight - savedClientHeight, 0);
  let targetScrollTop = 0;

  // If dimensions match closely, use exact scrollTop
  const heightDiff = Math.abs(current.scrollHeight - savedScrollHeight);
  const clientDiff = Math.abs(current.clientHeight - savedClientHeight);
  const heightTolerance = Math.max(savedScrollHeight * 0.05, 50);
  const clientTolerance = Math.max(savedClientHeight * 0.1, 20);

  if (
    heightDiff < heightTolerance &&
    clientDiff < clientTolerance &&
    savedMaxScroll > 0 &&
    savedScrollTop > 0
  ) {
    targetScrollTop = Math.min(savedScrollTop, current.maxScroll);
  } else if (savedMaxScroll > 0 && savedScrollTop > 0) {
    const savedRatio = Math.min(Math.max(savedScrollTop / savedMaxScroll, 0), 1);
    targetScrollTop = Math.round(savedRatio * current.maxScroll);
  } else if (savedPercent > 0) {
    targetScrollTop = Math.round(savedPercent * current.maxScroll);
  }

  if (targetScrollTop > 0 && Math.abs(current.scrollTop - targetScrollTop) > 1) {
    window.scrollTo({ top: targetScrollTop, behavior: "auto" });
    return true;
  }

  return false;
}

/**
 * Check if an element is visible in its scrollable container
 * Uses Intersection Observer when available for better performance
 * Accounts for header offset at top and player offset at bottom to determine if element is properly positioned
 */
export function isElementVisible(
  element: HTMLElement,
  container: HTMLElement,
  headerOffset: number = 0,
  tolerance: number = 10,
  playerOffset: number = 0
): boolean {
  // Use Intersection Observer for document-level containers (more efficient)
  if (typeof IntersectionObserver !== "undefined" && 
      (container === document.documentElement || container === document.body)) {
    // Create a one-time observer for synchronous check
    // Note: This is a simplified approach - for continuous monitoring, use observeElementVisibility
    const rect = element.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    
    // Check if element intersects with viewport (accounting for offsets)
    const visibleTop = headerOffset;
    const visibleBottom = viewportHeight - playerOffset;
    
    const isInViewport = 
      rect.top < visibleBottom + tolerance &&
      rect.bottom > visibleTop - tolerance &&
      rect.left < viewportWidth &&
      rect.right > 0;
    
    if (isInViewport) {
      // Calculate intersection ratio manually for header/player offset
      const visibleHeight = Math.min(rect.bottom, visibleBottom) - Math.max(rect.top, visibleTop);
      const elementHeight = rect.height;
      const visibilityRatio = elementHeight > 0 ? Math.max(0, visibleHeight / elementHeight) : 0;
      return visibilityRatio >= 0.5; // At least 50% visible
    }
    
    return false;
  }
  
  // Fallback to manual calculation for non-document containers
  const elementRect = element.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  const isDocumentElement = container === document.documentElement;
  
  // Calculate visible area of container
  const containerTop = isDocumentElement ? 0 : containerRect.top;
  const containerBottom = isDocumentElement ? window.innerHeight : containerRect.bottom;
  
  // Account for header offset - element should be visible below the header
  const visibleTop = containerTop + headerOffset;
  // Account for player offset - element should be visible above the audio player
  const visibleBottom = containerBottom - playerOffset;
  
  // Check if element is within the visible area (with tolerance)
  const isTopVisible = elementRect.top >= visibleTop - tolerance;
  const isBottomVisible = elementRect.bottom <= visibleBottom + tolerance;
  const isFullyVisible = isTopVisible && isBottomVisible;
  
  // Also check if element is at least partially visible
  const isPartiallyVisible = 
    elementRect.top < visibleBottom + tolerance && 
    elementRect.bottom > visibleTop - tolerance;
  
  // Element is considered visible if it's fully visible or mostly visible (80% or more)
  const elementHeight = elementRect.height;
  const visibleHeight = Math.min(
    elementRect.bottom,
    visibleBottom
  ) - Math.max(
    elementRect.top,
    visibleTop
  );
  const visibilityRatio = elementHeight > 0 ? visibleHeight / elementHeight : 0;
  const isMostlyVisible = visibilityRatio >= 0.8;
  
  return isFullyVisible || (isPartiallyVisible && isMostlyVisible);
}

/**
 * Find the actual scrollable container for an element
 * Walks up the DOM tree to find the first parent that can actually scroll
 * Only returns containers that can actually scroll (maxScroll > 0)
 * Returns the scrollable container, or null if none found
 */
export function findScrollableContainer(element: HTMLElement | null): HTMLElement | null {
  if (!element) return null;
  
  let current: HTMLElement | null = element;
  let candidateWithOverflow: HTMLElement | null = null;
  const checkedContainers: Array<{ tag: string; id: string; className: string; maxScroll: number; hasOverflow: boolean }> = [];
  
  // First pass: look for containers with overflow styles or that can scroll
  while (current) {
    const style = window.getComputedStyle(current);
    const hasOverflow = style.overflowY === "auto" || style.overflowY === "scroll" || 
                        style.overflow === "auto" || style.overflow === "scroll";
    
    // Check if it can actually scroll (has scrollable content)
    const maxScroll = current.scrollHeight - current.clientHeight;
    const canScroll = maxScroll > 0;
    
    // Log checked containers for debugging
    checkedContainers.push({
      tag: current.tagName,
      id: current.id || "",
      className: current.className || "",
      maxScroll,
      hasOverflow,
    });
    
    // If it has overflow styles and can actually scroll, it's the scrollable container
    if (hasOverflow && canScroll) {
      logger.debug("[findScrollableContainer] Found scrollable container with overflow", {
        tag: current.tagName,
        id: current.id,
        className: current.className,
        maxScroll,
        checkedContainers,
      });
      return current;
    }
    
    // If it can scroll (even without explicit overflow styles), it's scrollable
    if (canScroll) {
      logger.debug("[findScrollableContainer] Found scrollable container without overflow styles", {
        tag: current.tagName,
        id: current.id,
        className: current.className,
        maxScroll,
        checkedContainers,
      });
      return current;
    }
    
    // Track the first element with overflow styles (in case content isn't loaded yet)
    if (hasOverflow && !candidateWithOverflow) {
      candidateWithOverflow = current;
    }
    
    // Stop at body or html
    if (current === document.body || current === document.documentElement) {
      break;
    }
    
    current = current.parentElement;
  }
  
  // Second pass: if we found a candidate with overflow but it's not scrollable yet,
  // check if document/window can scroll as a fallback
  if (candidateWithOverflow) {
    // Re-check the candidate - content might have loaded
    const maxScroll = candidateWithOverflow.scrollHeight - candidateWithOverflow.clientHeight;
    if (maxScroll > 0) {
      logger.debug("[findScrollableContainer] Candidate with overflow became scrollable", {
        tag: candidateWithOverflow.tagName,
        id: candidateWithOverflow.id,
        className: candidateWithOverflow.className,
        maxScroll,
        checkedContainers,
      });
      return candidateWithOverflow;
    }
  }
  
  // Fallback: check if window/document can scroll
  const documentMaxScroll = document.documentElement.scrollHeight - window.innerHeight;
  if (documentMaxScroll > 0) {
    logger.debug("[findScrollableContainer] Using document.documentElement as scrollable container", {
      documentScrollHeight: document.documentElement.scrollHeight,
      windowInnerHeight: window.innerHeight,
      documentMaxScroll,
      checkedContainers,
    });
    return document.documentElement;
  }
  
  // If no scrollable container found, return the candidate with overflow styles
  // (it might become scrollable once content fully loads)
  if (candidateWithOverflow) {
    logger.debug("[findScrollableContainer] No scrollable container found, returning candidate with overflow", {
      tag: candidateWithOverflow.tagName,
      id: candidateWithOverflow.id,
      className: candidateWithOverflow.className,
      checkedContainers,
    });
  } else {
    logger.debug("[findScrollableContainer] No scrollable container found", {
      checkedContainers,
    });
  }
  return candidateWithOverflow;
}

export function scrollToElement(
  elementId: string,
  behavior: ScrollBehavior = "smooth",
  headerOffset: number = 0,
  playerOffset: number = 0,
): boolean {
  logger.debug("[Scroll] scrollToElement called", {
    elementId,
    behavior,
    headerOffset,
    playerOffset,
  });

  // Find the virtualized container handle
  type ElementWithVirtualizedHandle = HTMLElement & {
    __virtualizedHandle?: {
      ensureSegmentRendered: (elementId: string) => Promise<boolean>;
    };
  };
  
  // Look for virtualized handle in the document
  // Use querySelector for data attributes (no ID available)
  const virtualizedContainer = document.querySelector('[data-reader-chapter-content]')?.parentElement as ElementWithVirtualizedHandle | null;
  const virtualizedHandle = virtualizedContainer?.__virtualizedHandle;
  
  if (virtualizedHandle && typeof virtualizedHandle.ensureSegmentRendered === 'function') {
    // Ensure element is rendered, then scroll it
    logger.debug("[Scroll] Ensuring virtualized element is rendered", { elementId });
    virtualizedHandle.ensureSegmentRendered(elementId)
      .then((rendered: boolean) => {
        if (!rendered) {
          logger.warn("[Scroll] Failed to render virtualized element", { elementId });
          return;
        }

        const element = document.getElementById(elementId);
        if (!element) {
          logger.warn("[Scroll] Element not found after rendering", { elementId });
          return;
        }

        // Find the scrollable container (should be the virtualized container or its parent)
        const scrollContainer = virtualizedContainer || 
          (element.closest('[data-reader-chapter-content]')?.parentElement as HTMLElement) ||
          document.documentElement;

        // Check if element is already visible
        const isVisible = isElementVisible(element, scrollContainer, headerOffset, 10, playerOffset);
        if (isVisible) {
          logger.debug("[Scroll] Element is already visible", { elementId });
          return;
        }

        // Scroll using scrollIntoView, then adjust for header offset
        element.scrollIntoView({ 
          behavior, 
          block: "start",
          inline: "nearest"
        });

        // Adjust for header offset if needed
        if (headerOffset > 0) {
          setTimeout(() => {
            const elementRect = element.getBoundingClientRect();
            
            if (scrollContainer === document.documentElement) {
              // Window/document scrolling
              const currentScrollY = window.scrollY;
              const elementTopRelativeToViewport = elementRect.top + currentScrollY;
              const targetScrollY = elementTopRelativeToViewport - headerOffset;
              
              window.scrollTo({
                top: Math.max(0, targetScrollY),
                behavior,
              });
            } else {
              // Container scrolling
              const containerRect = scrollContainer.getBoundingClientRect();
              const currentScrollTop = scrollContainer.scrollTop;
              const elementTopRelativeToContainer = elementRect.top - containerRect.top + currentScrollTop;
              const targetScrollTop = elementTopRelativeToContainer - headerOffset;
              const maxScroll = scrollContainer.scrollHeight - scrollContainer.clientHeight;
              const clampedScrollTop = Math.max(0, Math.min(targetScrollTop, maxScroll));
              
              scrollContainer.scrollTo({
                top: clampedScrollTop,
                behavior,
              });
            }
          }, behavior === "smooth" ? 300 : 100);
        }

        logger.debug("[Scroll] Element scrolled", { elementId });
      })
      .catch((error: Error) => {
        logger.warn("[Scroll] Virtualized render failed", { error, elementId });
      });
    
    return true;
  }

  // Fallback: try to find element directly (non-virtualized case)
  // Use getElementById first (O(1) - fastest)
  let element = document.getElementById(elementId);
  
  // If not found by ID, try anchor name (for legacy support)
  if (!element) {
    // Only use querySelector as last resort
    element = document.querySelector<HTMLElement>(`a[name="${elementId}"]`);
  }
  
  if (!element) {
    logger.debug("[Scroll] Element not found", { elementId });
    return false;
  }

  // Use document as scroll container for non-virtualized content
  const scrollContainer = document.documentElement;
  
  // Check if element is already visible
  const isVisible = isElementVisible(element, scrollContainer, headerOffset, 10, playerOffset);
  if (isVisible) {
    logger.debug("[Scroll] Element is already visible", { elementId });
    return true;
  }

  // Scroll using scrollIntoView
  element.scrollIntoView({ 
    behavior, 
    block: "start",
    inline: "nearest"
  });

  // Adjust for header offset if needed
  if (headerOffset > 0) {
    setTimeout(() => {
      const currentScrollY = window.scrollY;
      const elementRect = element.getBoundingClientRect();
      const elementTopRelativeToViewport = elementRect.top + currentScrollY;
      const targetScrollY = elementTopRelativeToViewport - headerOffset;
      
      window.scrollTo({
        top: Math.max(0, targetScrollY),
        behavior,
      });
    }, behavior === "smooth" ? 300 : 100);
  }

  return true;
}


