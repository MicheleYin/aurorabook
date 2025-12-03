/**
 * Hook for scroll operations
 * No useEffects - all operations are explicit via callbacks
 */

import { useCallback } from "react";
import { computeScrollMetrics, computeWindowScrollMetrics, scrollToElement } from "../../lib/scroll-utils";

export function useScrollOperations(contentRef: React.RefObject<HTMLDivElement | null>) {
  const scrollToTop = useCallback(() => {
    const node = contentRef.current;
    if (!node) return;

    const containerMetrics = computeScrollMetrics(node);
    const windowMetrics = computeWindowScrollMetrics();
    
    const useContainer = containerMetrics && containerMetrics.maxScroll > 0;
    const useWindow = !useContainer && windowMetrics && windowMetrics.maxScroll > 0;

    if (useContainer) {
      node.scrollTo({ top: 0, behavior: "smooth" });
    } else if (useWindow) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [contentRef]);

  const scrollToBottom = useCallback(() => {
    const node = contentRef.current;
    if (!node) return;

    const containerMetrics = computeScrollMetrics(node);
    const windowMetrics = computeWindowScrollMetrics();
    
    const useContainer = containerMetrics && containerMetrics.maxScroll > 0;
    const useWindow = !useContainer && windowMetrics && windowMetrics.maxScroll > 0;

    if (useContainer && containerMetrics) {
      node.scrollTo({ top: containerMetrics.maxScroll, behavior: "smooth" });
    } else if (useWindow && windowMetrics) {
      window.scrollTo({ top: windowMetrics.maxScroll, behavior: "smooth" });
    }
  }, [contentRef]);

  const scrollToElementId = useCallback((elementId: string, behavior: "smooth" | "auto" = "smooth") => {
    const node = contentRef.current;
    if (!node) return;
    scrollToElement(node, elementId, behavior);
  }, [contentRef]);

  return {
    scrollToTop,
    scrollToBottom,
    scrollToElementId,
  };
}

