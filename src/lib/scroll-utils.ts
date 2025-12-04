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
 * Accounts for header offset to determine if element is properly positioned
 */
export function isElementVisible(
  element: HTMLElement,
  container: HTMLElement,
  headerOffset: number = 0,
  tolerance: number = 10
): boolean {
  const elementRect = element.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  const isDocumentElement = container === document.documentElement;
  
  // Calculate visible area of container
  const containerTop = isDocumentElement ? 0 : containerRect.top;
  const containerBottom = isDocumentElement ? window.innerHeight : containerRect.bottom;
  
  // Account for header offset - element should be visible below the header
  const visibleTop = containerTop + headerOffset;
  const visibleBottom = containerBottom;
  
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
 * Returns the first parent that can actually scroll
 */
function findScrollableContainer(element: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = element;
  
  while (current) {
    const style = window.getComputedStyle(current);
    const hasOverflow = style.overflowY === "auto" || style.overflowY === "scroll" || 
                        style.overflow === "auto" || style.overflow === "scroll";
    
    // Check if it can actually scroll (has scrollable content)
    const canScroll = current.scrollHeight > current.clientHeight;
    
    // Also check if it has overflow styles (even if not currently scrollable, it might be the intended container)
    if (hasOverflow) {
      // If it has overflow styles, prefer it even if not currently scrollable
      // (content might not be fully loaded yet)
      return current;
    }
    
    if (canScroll) {
      return current;
    }
    
    // Stop at body or html
    if (current === document.body || current === document.documentElement) {
      break;
    }
    
    current = current.parentElement;
  }
  
  // Fallback: check if window/document can scroll
  if (document.documentElement.scrollHeight > window.innerHeight) {
    return document.documentElement;
  }
  
  return null;
}

export function scrollToElement(
  root: HTMLElement,
  elementId: string,
  behavior: ScrollBehavior = "smooth",
  headerOffset: number = 0,
): boolean {
  console.log("[Scroll] scrollToElement called", {
    elementId,
    behavior,
    headerOffset,
    rootTag: root.tagName,
    rootId: root.id,
    rootScrollHeight: root.scrollHeight,
    rootClientHeight: root.clientHeight,
  });

  const selector = typeof CSS !== "undefined" && CSS.escape
    ? `#${CSS.escape(elementId)}`
    : `#${elementId}`;
  
  console.log("[Scroll] Searching for element", { selector });
  
  const element = root.querySelector<HTMLElement>(selector) ??
    root.querySelector<HTMLElement>(`a[name="${elementId}"]`);
  
  if (!element) {
    console.log("[Scroll] Element not found", { elementId, selector });
    // Try to find any element with this ID in the document
    const docElement = document.getElementById(elementId);
    if (docElement) {
      console.log("[Scroll] Element found in document but not in root", {
        elementId,
        rootContains: root.contains(docElement),
      });
    }
    return false;
  }

  console.log("[Scroll] Element found", {
    elementId,
    elementTag: element.tagName,
    headerOffset,
  });

  // Find the actual scrollable container
  let scrollContainer = findScrollableContainer(element);
  
  // If no scrollable container found, try the root
  if (!scrollContainer || scrollContainer.scrollHeight <= scrollContainer.clientHeight) {
    // Check if root can scroll
    if (root.scrollHeight > root.clientHeight) {
      scrollContainer = root;
    } else {
      // Try document/window as fallback
      if (document.documentElement.scrollHeight > window.innerHeight) {
        scrollContainer = document.documentElement;
      } else {
        scrollContainer = root; // Use root anyway, might work
      }
    }
  }
  
  const isRootScrollable = scrollContainer === root;
  const isDocumentElement = scrollContainer === document.documentElement;
  
  console.log("[Scroll] Scroll container", {
    isRootScrollable,
    isDocumentElement,
    containerTag: scrollContainer.tagName,
    containerScrollHeight: scrollContainer.scrollHeight,
    containerClientHeight: scrollContainer.clientHeight,
    containerMaxScroll: scrollContainer.scrollHeight - scrollContainer.clientHeight,
  });

  // Check if element is already visible (accounting for header offset)
  const isVisible = isElementVisible(element, scrollContainer, headerOffset);
  console.log("[Scroll] Element visibility check", {
    isVisible,
    headerOffset,
  });
  
  if (isVisible) {
    console.log("[Scroll] Element is already visible, skipping scroll");
    return true;
  }

  // If container can't scroll (maxScroll is 0 or negative), use scrollIntoView with offset
  const maxScroll = scrollContainer.scrollHeight - scrollContainer.clientHeight;
  if (maxScroll <= 0) {
    console.log("[Scroll] Container cannot scroll, using scrollIntoView with offset workaround");
    
    // Use scrollIntoView and then adjust for header offset
    element.scrollIntoView({ behavior, block: "start" });
    
    // If header offset is needed, adjust after scroll
    if (headerOffset > 0) {
      // Wait for scroll to start, then adjust
      requestAnimationFrame(() => {
        if (isDocumentElement) {
          window.scrollBy({ top: -headerOffset, behavior: "smooth" });
        } else {
          scrollContainer.scrollBy({ top: -headerOffset, behavior: "smooth" });
        }
      });
    }
    
    return true;
  }

  // If no header offset, use simple scrollIntoView
  if (headerOffset === 0) {
    console.log("[Scroll] Using scrollIntoView (no header offset)");
    element.scrollIntoView({ behavior, block: "start" });
    return true;
  }

  // Calculate scroll position accounting for header
  const elementRect = element.getBoundingClientRect();
  const containerRect = scrollContainer.getBoundingClientRect();
  
  // For document element, use window coordinates
  const containerTop = isDocumentElement ? 0 : containerRect.top;
  const currentScrollTop = isDocumentElement ? window.scrollY : scrollContainer.scrollTop;
  
  console.log("[Scroll] Calculating scroll position", {
    elementTop: elementRect.top,
    containerTop,
    currentScrollTop,
    headerOffset,
    containerScrollHeight: scrollContainer.scrollHeight,
    containerClientHeight: scrollContainer.clientHeight,
    isDocumentElement,
  });
  
  // Calculate the element's position relative to the scroll container
  // elementRect.top is relative to viewport
  // For document element, elementRect.top is already relative to viewport (containerTop = 0)
  // For other containers, elementRect.top - containerRect.top gives position relative to container's visible area
  const elementTopRelativeToContainer = elementRect.top - containerTop + currentScrollTop;
  
  // Subtract header offset to position element below header
  const targetScrollTop = elementTopRelativeToContainer - headerOffset;
  
  // Ensure we don't scroll past the bounds
  const clampedScrollTop = Math.max(0, Math.min(targetScrollTop, maxScroll));
  
  console.log("[Scroll] Scrolling to position", {
    elementTopRelativeToContainer,
    targetScrollTop,
    clampedScrollTop,
    maxScroll,
    currentScrollTop,
    behavior,
  });
  
  // Scroll the container
  if (isDocumentElement) {
    window.scrollTo({
      top: clampedScrollTop,
      behavior,
    });
  } else {
    scrollContainer.scrollTo({
      top: clampedScrollTop,
      behavior,
    });
  }
  
  return true;
}

