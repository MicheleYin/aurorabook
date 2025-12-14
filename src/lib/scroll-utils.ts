/**
 * Utility functions for scroll management
 * Uses refs and callbacks to avoid excessive useEffects
 */

export type ScrollMetrics = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  maxScroll: number;
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


export function scrollToElement(
  elementId: string,
  behavior: ScrollBehavior = "smooth",
  headerOffset: number = 0,
  playerOffset: number = 0,
): boolean {
  console.log("[Scroll] scrollToElement called", {
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
  const virtualizedContainer = document.querySelector('[data-reader-chapter-content]')?.parentElement as ElementWithVirtualizedHandle | null;
  const virtualizedHandle = virtualizedContainer?.__virtualizedHandle;
  
  if (virtualizedHandle && typeof virtualizedHandle.ensureSegmentRendered === 'function') {
    // Ensure element is rendered, then scroll it
    console.log("[Scroll] Ensuring virtualized element is rendered", { elementId });
    virtualizedHandle.ensureSegmentRendered(elementId)
      .then((rendered: boolean) => {
        if (!rendered) {
          console.warn("[Scroll] Failed to render virtualized element", { elementId });
          return;
        }

        const element = document.getElementById(elementId);
        if (!element) {
          console.warn("[Scroll] Element not found after rendering", { elementId });
          return;
        }

        // Find the scrollable container (should be the virtualized container or its parent)
        const scrollContainer = virtualizedContainer || 
          (element.closest('[data-reader-chapter-content]')?.parentElement as HTMLElement) ||
          document.documentElement;

        // Check if element is already visible
        const isVisible = isElementVisible(element, scrollContainer, headerOffset, 10, playerOffset);
        if (isVisible) {
          console.log("[Scroll] Element is already visible", { elementId });
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

        console.log("[Scroll] Element scrolled", { elementId });
      })
      .catch((error: Error) => {
        console.warn("[Scroll] Virtualized render failed", { error, elementId });
      });
    
    return true;
  }

  // Fallback: try to find element directly (non-virtualized case)
  const element = document.getElementById(elementId) ||
    document.querySelector<HTMLElement>(`#${CSS.escape(elementId)}`) ||
    document.querySelector<HTMLElement>(`a[name="${elementId}"]`);
  
  if (!element) {
    console.log("[Scroll] Element not found", { elementId });
    return false;
  }

  // Use document as scroll container for non-virtualized content
  const scrollContainer = document.documentElement;
  
  // Check if element is already visible
  const isVisible = isElementVisible(element, scrollContainer, headerOffset, 10, playerOffset);
  if (isVisible) {
    console.log("[Scroll] Element is already visible", { elementId });
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


