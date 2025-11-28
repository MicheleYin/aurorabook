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

export function scrollToElement(
  root: HTMLElement,
  elementId: string,
  behavior: ScrollBehavior = "smooth",
): boolean {
  const selector = typeof CSS !== "undefined" && CSS.escape
    ? `#${CSS.escape(elementId)}`
    : `#${elementId}`;
  
  const element = root.querySelector<HTMLElement>(selector) ??
    root.querySelector<HTMLElement>(`a[name="${elementId}"]`);
  
  if (element) {
    element.scrollIntoView({ behavior, block: "start" });
    return true;
  }
  
  return false;
}

