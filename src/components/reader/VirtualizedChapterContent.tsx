/**
 * VirtualizedChapterContent
 * 
 * Renders chapter content directly (virtualization disabled).
 * All content is rendered at once for simpler DOM structure.
 */

import { useMemo, useRef, useEffect, useCallback, useImperativeHandle, forwardRef } from "react";
import { parseChapterIntoSegments, type ParsedChapter } from "../../lib/segment-parser";
import { logger } from "../../lib/logger";

export type VirtualizedChapterContentHandle = {
  findSegmentIndex: (elementId: string) => number | undefined;
  ensureSegmentRendered: (elementId: string) => Promise<boolean>;
  getCurrentVisibleSegmentIndex: () => number | undefined;
  getTotalSegments: () => number;
  scrollToSegmentIndex: (segmentIndex: number, behavior?: "smooth" | "auto") => void;
};

type VirtualizedChapterContentProps = {
  contentHtml: string;
  chapterId: string;
  onContentRendered?: () => void;
  contentRef?: React.RefObject<HTMLDivElement | null>;
  className?: string;
  style?: React.CSSProperties;
  scrollerRef?: React.RefObject<HTMLElement | null>;
};

export const VirtualizedChapterContent = forwardRef<VirtualizedChapterContentHandle, VirtualizedChapterContentProps>(({
  contentHtml,
  chapterId,
  onContentRendered,
  contentRef,
  className,
  style,
  scrollerRef,
}, ref) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const parsedChapterRef = useRef<ParsedChapter | null>(null);

  // Parse chapter into segments (for ref methods compatibility)
  const parsedChapter = useMemo(() => {
    const parsed = parseChapterIntoSegments(contentHtml);
    parsedChapterRef.current = parsed;
    logger.debug("[VirtualizedChapterContent] Parsed chapter", {
      chapterId,
      totalSegments: parsed.totalSegments,
      prefixLength: parsed.prefix.length,
      suffixLength: parsed.suffix.length,
    });
    return parsed;
  }, [contentHtml, chapterId]);

  // Expose methods via ref for integration with scroll utils
  // These methods work with the full DOM since virtualization is disabled
  useImperativeHandle(ref, () => ({
    findSegmentIndex: (elementId: string): number | undefined => {
      if (!parsedChapterRef.current) {
        return undefined;
      }
      const segmentIndex = parsedChapterRef.current.segments.findIndex(
        (s) => s.id === elementId || s.html.includes(`id="${elementId}"`)
      );
      return segmentIndex >= 0 ? segmentIndex : undefined;
    },
    ensureSegmentRendered: async (elementId: string): Promise<boolean> => {
      // Since all content is rendered, just check if element exists
      const element = document.getElementById(elementId);
      if (element) {
        logger.debug("[VirtualizedChapterContent] Element already rendered", { elementId });
        return true;
      }
      
      // Wait a bit for DOM to be ready
      return new Promise((resolve) => {
        let attempts = 0;
        const maxAttempts = 10;
        const checkInterval = 50;
        
        const checkElement = () => {
          attempts++;
          const element = document.getElementById(elementId);
          
          if (element) {
            logger.debug("[VirtualizedChapterContent] Element found", { elementId, attempts });
            resolve(true);
          } else if (attempts < maxAttempts) {
            setTimeout(checkElement, checkInterval);
          } else {
            logger.warn("[VirtualizedChapterContent] Element not found", { elementId, attempts });
            resolve(false);
          }
        };
        
        setTimeout(checkElement, 50);
      });
    },
    getCurrentVisibleSegmentIndex: (): number | undefined => {
      // Calculate visible segment index from scroll position
      if (!parsedChapterRef.current || !containerRef.current) {
        return undefined;
      }
      
      const scrollContainer = scrollerRef?.current || containerRef.current.parentElement;
      if (!scrollContainer) {
        return undefined;
      }
      
      const scrollTop = (scrollContainer as HTMLElement).scrollTop || window.scrollY;
      const scrollHeight = (scrollContainer as HTMLElement).scrollHeight || document.documentElement.scrollHeight;
      const clientHeight = (scrollContainer as HTMLElement).clientHeight || window.innerHeight;
      
      if (scrollHeight <= clientHeight) {
        return 0;
      }
      
      const scrollPercent = scrollTop / (scrollHeight - clientHeight);
      const totalSegments = parsedChapterRef.current.totalSegments;
      const segmentIndex = Math.floor(scrollPercent * totalSegments);
      
      logger.debug("[VirtualizedChapterContent] getCurrentVisibleSegmentIndex", {
        chapterId,
        segmentIndex: Math.max(0, Math.min(segmentIndex, totalSegments - 1)),
        scrollTop,
        scrollHeight,
        totalSegments,
      });
      
      return Math.max(0, Math.min(segmentIndex, totalSegments - 1));
    },
    getTotalSegments: (): number => {
      return parsedChapterRef.current?.totalSegments || 0;
    },
    scrollToSegmentIndex: (segmentIndex: number, behavior: "smooth" | "auto" = "smooth"): void => {
      if (!parsedChapterRef.current) {
        logger.warn("[VirtualizedChapterContent] Cannot scroll to segment - missing parsed chapter", {
          chapterId,
          segmentIndex,
        });
        return;
      }
      
      const clampedIndex = Math.max(0, Math.min(segmentIndex, parsedChapterRef.current.totalSegments - 1));
      const totalSegments = parsedChapterRef.current.totalSegments;
      
      // Calculate scroll position based on segment index
      const scrollContainer = scrollerRef?.current || containerRef.current?.parentElement;
      if (!scrollContainer) {
        logger.warn("[VirtualizedChapterContent] Cannot scroll - no scroll container", { chapterId, segmentIndex });
        return;
      }
      
      const scrollHeight = (scrollContainer as HTMLElement).scrollHeight || document.documentElement.scrollHeight;
      const clientHeight = (scrollContainer as HTMLElement).clientHeight || window.innerHeight;
      const maxScroll = scrollHeight - clientHeight;
      
      if (maxScroll <= 0) {
        return;
      }
      
      const scrollPercent = totalSegments > 0 ? clampedIndex / totalSegments : 0;
      const targetScrollTop = scrollPercent * maxScroll;
      
      logger.log("[VirtualizedChapterContent] Scrolling to segment index", {
        chapterId,
        requestedIndex: segmentIndex,
        clampedIndex,
        totalSegments,
        targetScrollTop,
        behavior,
      });
      
      (scrollContainer as HTMLElement).scrollTo({
        top: targetScrollTop,
        behavior: behavior === "smooth" ? "smooth" : "auto",
      });
    },
  }), [chapterId, scrollerRef]);

  // Combine refs: use external contentRef if provided, otherwise use internal
  const setContainerRef = useCallback(
    (node: HTMLDivElement | null) => {
      containerRef.current = node;
      if (contentRef && "current" in contentRef) {
        (contentRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
        logger.log("[VirtualizedChapterContent] Set contentRef", {
          chapterId,
          hasNode: !!node,
          nodeTagName: node?.tagName,
        });
      }
    },
    [contentRef, chapterId]
  );

  // Store virtualized handle on the container element when both are available
  // This needs to be in a useEffect because ref.current is set by useImperativeHandle
  useEffect(() => {
    const node = containerRef.current;
    const handle = ref && "current" in ref ? ref.current : null;
    
    if (node && handle) {
      (node as HTMLElement & { __virtualizedHandle?: VirtualizedChapterContentHandle }).__virtualizedHandle = handle;
      logger.log("[VirtualizedChapterContent] Stored virtualized handle on container", {
        chapterId,
        hasHandle: !!handle,
        hasFindSegmentIndex: !!handle.findSegmentIndex,
        hasGetCurrentVisibleSegmentIndex: !!handle.getCurrentVisibleSegmentIndex,
        hasGetTotalSegments: !!handle.getTotalSegments,
        hasScrollToSegmentIndex: !!handle.scrollToSegmentIndex,
      });
    } else {
      if (node && !handle) {
        logger.debug("[VirtualizedChapterContent] Container node available but handle not ready", {
          chapterId,
          hasNode: !!node,
          hasHandle: !!handle,
        });
      } else if (!node && handle) {
        logger.debug("[VirtualizedChapterContent] Handle available but container node not ready", {
          chapterId,
          hasNode: !!node,
          hasHandle: !!handle,
        });
      }
    }
  }, [ref, chapterId]);


  // Notify parent when content is rendered
  // Use ref to track if we've already notified for this chapter to prevent duplicate calls
  const notifiedForChapterRef = useRef<string | null>(null);
  useEffect(() => {
    if (onContentRendered && contentHtml) {
      // Only notify once per chapter
      if (notifiedForChapterRef.current === chapterId) {
        return;
      }
      
      // Small delay to ensure DOM is ready
      const timer = setTimeout(() => {
        notifiedForChapterRef.current = chapterId;
        onContentRendered();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [onContentRendered, contentHtml, chapterId]);
  
  // Reset notification ref when chapter changes
  useEffect(() => {
    if (notifiedForChapterRef.current !== chapterId) {
      notifiedForChapterRef.current = null;
    }
  }, [chapterId]);

  // Render all content directly (virtualization disabled)
  // Render the full HTML content
  return (
    <div
      ref={setContainerRef}
      className={className}
      style={style}
      data-reader-chapter-content="true"
      data-chapter-id={chapterId}
      dangerouslySetInnerHTML={{ __html: contentHtml }}
    />
  );
});

VirtualizedChapterContent.displayName = "VirtualizedChapterContent";
