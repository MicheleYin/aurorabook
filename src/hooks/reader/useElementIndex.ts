/**
 * Element Index Hook
 * 
 * Builds a fast lookup index for element IDs to avoid expensive DOM queries.
 * This significantly reduces memory usage and improves performance.
 */

import { useMemo, useRef, useEffect } from "react";
import { logger } from "../../lib/logger";

type ElementIndexEntry = {
  elementId: string;
  approximateScrollTop: number; // Estimated scroll position (for virtual scrolling)
  segmentIndex?: number; // Index in segments array if available
};

type ElementIndex = Map<string, ElementIndexEntry>;

/**
 * Build an index of element IDs from chapter HTML
 * This allows O(1) lookups without DOM queries
 */
export function buildElementIndex(contentHtml: string): ElementIndex {
  const index = new Map<string, ElementIndexEntry>();
  
  // Use a simple regex to find all span elements with IDs
  // This is much faster than parsing the entire HTML
  const spanIdRegex = /<span[^>]*id="(f\d{6})"[^>]*>/g;
  let match;
  let segmentIndex = 0;
  
  while ((match = spanIdRegex.exec(contentHtml)) !== null) {
    const elementId = match[1];
    const matchPosition = match.index;
    
    // Estimate scroll position based on character position
    // This is approximate but good enough for virtual scrolling
    const approximateScrollTop = Math.floor(matchPosition / 100); // Rough estimate
    
    index.set(elementId, {
      elementId,
      approximateScrollTop,
      segmentIndex: segmentIndex++,
    });
  }
  
  logger.debug("[Element Index] Built index", {
    elementCount: index.size,
    htmlLength: contentHtml.length,
  });
  
  return index;
}

/**
 * Hook to manage element index for a chapter
 */
export function useElementIndex(contentHtml: string | undefined) {
  const indexRef = useRef<ElementIndex | null>(null);
  
  // Rebuild index when content changes
  useEffect(() => {
    if (contentHtml) {
      indexRef.current = buildElementIndex(contentHtml);
    } else {
      indexRef.current = null;
    }
  }, [contentHtml]);
  
  const getIndex = useMemo(() => {
    return () => indexRef.current;
  }, []);
  
  const getElementInfo = useMemo(() => {
    return (elementId: string): ElementIndexEntry | undefined => {
      return indexRef.current?.get(elementId);
    };
  }, []);
  
  const hasElement = useMemo(() => {
    return (elementId: string): boolean => {
      return indexRef.current?.has(elementId) ?? false;
    };
  }, []);
  
  const getScrollPositionEstimate = useMemo(() => {
    return (elementId: string): number | undefined => {
      return indexRef.current?.get(elementId)?.approximateScrollTop;
    };
  }, []);
  
  const getSegmentIndex = useMemo(() => {
    return (elementId: string): number | undefined => {
      return indexRef.current?.get(elementId)?.segmentIndex;
    };
  }, []);
  
  return {
    getIndex,
    getElementInfo,
    hasElement,
    getScrollPositionEstimate,
    getSegmentIndex,
  };
}

