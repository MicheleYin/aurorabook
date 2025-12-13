/**
 * Segment Parser
 * 
 * Parses chapter HTML into segments for lazy rendering.
 * Each segment corresponds to a span with an ID (f000001, f000002, etc.)
 */

import { logger } from "./logger";

export type Segment = {
  id: string; // Element ID (e.g., "f000001")
  html: string; // HTML content for this segment
  startIndex: number; // Character position in original HTML
  endIndex: number; // Character position in original HTML
  segmentIndex: number; // Index in segments array
};

export type ParsedChapter = {
  segments: Segment[];
  prefix: string; // HTML before first segment
  suffix: string; // HTML after last segment
  totalSegments: number;
};

/**
 * Parse chapter HTML into segments
 * Each segment is a span with an ID starting with "f" followed by 6 digits
 */
export function parseChapterIntoSegments(contentHtml: string): ParsedChapter {
  const segments: Segment[] = [];
  
  // Find all span elements with IDs matching pattern f\d{6}
  const spanIdRegex = /<span[^>]*id="(f\d{6})"[^>]*>([\s\S]*?)<\/span>/g;
  
  let match;
  let segmentIndex = 0;
  let lastEndIndex = 0;
  let prefix = "";
  let suffix = "";
  
  // Track positions for prefix/suffix extraction
  const segmentPositions: Array<{ start: number; end: number; id: string }> = [];
  
  while ((match = spanIdRegex.exec(contentHtml)) !== null) {
    const elementId = match[1];
    const fullMatch = match[0]; // Full matched HTML including tags
    const matchStart = match.index;
    const matchEnd = matchStart + fullMatch.length;
    
    segmentPositions.push({
      start: matchStart,
      end: matchEnd,
      id: elementId,
    });
    
    segments.push({
      id: elementId,
      html: fullMatch,
      startIndex: matchStart,
      endIndex: matchEnd,
      segmentIndex: segmentIndex++,
    });
    
    lastEndIndex = matchEnd;
  }
  
  // Extract prefix (HTML before first segment)
  if (segments.length > 0) {
    prefix = contentHtml.substring(0, segments[0].startIndex);
    suffix = contentHtml.substring(lastEndIndex);
  } else {
    // No segments found, entire HTML is prefix
    prefix = contentHtml;
    suffix = "";
  }
  
  logger.debug("[Segment Parser] Parsed chapter", {
    totalSegments: segments.length,
    prefixLength: prefix.length,
    suffixLength: suffix.length,
    htmlLength: contentHtml.length,
  });
  
  return {
    segments,
    prefix,
    suffix,
    totalSegments: segments.length,
  };
}

/**
 * Get segments within a range (for lazy rendering)
 */
export function getSegmentsInRange(
  parsedChapter: ParsedChapter,
  startIndex: number,
  endIndex: number
): Segment[] {
  return parsedChapter.segments.filter(
    (segment) => segment.segmentIndex >= startIndex && segment.segmentIndex <= endIndex
  );
}

/**
 * Find segment index by element ID
 */
export function findSegmentIndexByElementId(
  parsedChapter: ParsedChapter,
  elementId: string
): number | undefined {
  const segment = parsedChapter.segments.find((s) => s.id === elementId);
  return segment?.segmentIndex;
}

