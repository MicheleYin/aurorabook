/**
 * VirtualizedChapterContent
 * 
 * Renders chapter content using react-virtuoso for memory efficiency.
 * Only renders visible segments, reducing DOM nodes and memory usage.
 */

import { useMemo, useRef, useEffect, useCallback, useImperativeHandle, forwardRef } from "react";
import { Virtuoso, VirtuosoHandle } from "react-virtuoso";
import { parseChapterIntoSegments, type ParsedChapter } from "../../lib/segment-parser";
import { logger } from "../../lib/logger";
import { scrollToElement } from "../../lib/scroll-utils";

export type VirtualizedChapterContentHandle = {
  findSegmentIndex: (elementId: string) => number | undefined;
  ensureSegmentRendered: (elementId: string) => Promise<boolean>;
};

type VirtualizedChapterContentProps = {
  contentHtml: string;
  chapterId: string;
  highlightedElementId?: string | null;
  onContentRendered?: () => void;
  contentRef?: React.RefObject<HTMLDivElement | null>;
  className?: string;
  style?: React.CSSProperties;
  scrollerRef?: React.RefObject<HTMLElement | null>;
};

// Estimate height per segment (in pixels)
// This is approximate and will be adjusted by react-virtuoso
const ESTIMATED_SEGMENT_HEIGHT = 50;

export const VirtualizedChapterContent = forwardRef<VirtualizedChapterContentHandle, VirtualizedChapterContentProps>(({
  contentHtml,
  chapterId,
  highlightedElementId,
  onContentRendered,
  contentRef,
  className,
  style,
  scrollerRef,
}, ref) => {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const parsedChapterRef = useRef<ParsedChapter | null>(null);

  // Parse chapter into segments
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
      if (!parsedChapterRef.current || !virtuosoRef.current) {
        return false;
      }

      // Find the segment that contains this element ID
      const segmentIndex = parsedChapterRef.current.segments.findIndex(
        (s) => s.id === elementId || s.html.includes(`id="${elementId}"`)
      );

      if (segmentIndex < 0) {
        logger.debug("[VirtualizedChapterContent] Segment not found for element", { elementId });
        return false;
      }

      // Use Virtuoso to ensure the segment is rendered
      virtuosoRef.current.scrollToIndex({
        index: segmentIndex,
        align: "start",
        behavior: "auto", // Use auto for quick rendering
      });
      
      // Wait for the element to be rendered
      return new Promise((resolve) => {
        let attempts = 0;
        const maxAttempts = 15;
        const checkInterval = 50;
        
        const checkElement = () => {
          attempts++;
          const element = document.getElementById(elementId);
          
          if (element) {
            logger.debug("[VirtualizedChapterContent] Element rendered", { elementId, segmentIndex, attempts });
            resolve(true);
          } else if (attempts < maxAttempts) {
            setTimeout(checkElement, checkInterval);
          } else {
            logger.warn("[VirtualizedChapterContent] Element not found after rendering", { 
              elementId,
              segmentIndex,
              attempts 
            });
            resolve(false);
          }
        };
        
        setTimeout(checkElement, 100);
      });
    },
  }), []);

  // Store handle reference for scroll utils integration
  const handleRef = useRef<VirtualizedChapterContentHandle | null>(null);
  
  // Update handle ref when ref changes
  useEffect(() => {
    if (ref && "current" in ref) {
      handleRef.current = ref.current;
    }
  }, [ref]);

  // Combine refs: use external contentRef if provided, otherwise use internal
  const setContainerRef = useCallback(
    (node: HTMLDivElement | null) => {
      containerRef.current = node;
      if (contentRef && "current" in contentRef) {
        (contentRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
      }
      
      // Store virtualized handle on the element for scroll utils to find
      if (node && handleRef.current) {
        (node as HTMLElement & { __virtualizedHandle?: VirtualizedChapterContentHandle }).__virtualizedHandle = handleRef.current;
      }
    },
    [contentRef]
  );


  // Notify parent when content is rendered
  useEffect(() => {
    if (onContentRendered && parsedChapter.totalSegments > 0) {
      // Small delay to ensure DOM is ready
      const timer = setTimeout(() => {
        onContentRendered();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [onContentRendered, parsedChapter.totalSegments]);

  // Render a single segment
  const renderSegment = useCallback(
    (index: number) => {
      const segment = parsedChapter.segments[index];
      if (!segment) {
        return null;
      }

      return (
        <>
          {/* Render HTML that appears before this segment (preserves structure between segments) */}
          {segment.htmlBefore && (
            <div
              dangerouslySetInnerHTML={{ __html: segment.htmlBefore }}
              data-segment-gap="true"
            />
          )}
          {/* Render the segment itself - wrapper div uses display:contents to be layout-transparent */}
          {/* This preserves the original HTML structure exactly while allowing React/Virtuoso to work */}
          <div
            key={segment.id}
            id={segment.id}
            data-segment-index={segment.segmentIndex}
            data-element-id={segment.id}
            style={{
              // Use display:contents to make wrapper "transparent" to CSS layout
              // The wrapper div doesn't affect the visual structure at all
              display: "contents",
            }}
            dangerouslySetInnerHTML={{ __html: segment.html }}
          />
        </>
      );
    },
    [parsedChapter.segments]
  );

  // If no segments, render the full HTML (fallback)
  if (parsedChapter.totalSegments === 0) {
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
  }

  return (
    <div
      ref={setContainerRef}
      className={className}
      style={style}
      data-reader-chapter-content="true"
      data-chapter-id={chapterId}
    >
      {/* Render prefix HTML before first segment (only if not included in first segment's htmlBefore) */}
      {parsedChapter.prefix && parsedChapter.segments.length > 0 && !parsedChapter.segments[0]?.htmlBefore && (
        <div
          dangerouslySetInnerHTML={{ __html: parsedChapter.prefix }}
        />
      )}

      {/* Virtualized list of segments */}
      <Virtuoso
        ref={virtuosoRef}
        totalCount={parsedChapter.totalSegments}
        itemContent={renderSegment}
        defaultItemHeight={ESTIMATED_SEGMENT_HEIGHT}
        // Increase viewport to pre-render items above/below visible area
        increaseViewportBy={{ top: 400, bottom: 400 }}
        // Use custom scroll parent if provided (to use parent's scroll container)
        // This tells Virtuoso to delegate scrolling to the parent
        customScrollParent={scrollerRef?.current || undefined}
        // Calculate total height based on estimated segment height
        // This allows Virtuoso to properly calculate scroll positions
        style={{ 
          width: "100%",
          height: parsedChapter.totalSegments * ESTIMATED_SEGMENT_HEIGHT,
          minHeight: "100%",
        }}
        // Initial topmost item index
        initialTopMostItemIndex={0}
      />

      {/* Render suffix HTML after last segment */}
      {parsedChapter.suffix && (
        <div
          dangerouslySetInnerHTML={{ __html: parsedChapter.suffix }}
        />
      )}
    </div>
  );
});

VirtualizedChapterContent.displayName = "VirtualizedChapterContent";
