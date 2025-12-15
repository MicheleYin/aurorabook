/**
 * Segment Parser
 * 
 * Parses chapter HTML into segments for lazy rendering.
 * Each segment corresponds to a span with an ID (f000001, f000002, etc.)
 * Preserves parent HTML structure (p, h1, h2, div, etc.) that contains the spans.
 */

import { logger } from "./logger";

export type Segment = {
  id: string; // Element ID (e.g., "f000001")
  html: string; // HTML content for this segment (includes parent element if preserveStructure is true)
  startIndex: number; // Character position in original HTML
  endIndex: number; // Character position in original HTML
  segmentIndex: number; // Index in segments array
  htmlBefore?: string; // HTML that appears before this segment (between previous segment and this one)
};

export type ParsedChapter = {
  segments: Segment[];
  prefix: string; // HTML before first segment
  suffix: string; // HTML after last segment
  totalSegments: number;
};

/**
 * Find the parent block element (p, h1, h2, div, etc.) that contains a span
 * Returns the HTML of the entire parent element including the span
 * Uses a simpler approach: look backwards for opening tags, forward for closing tags
 */
function findParentBlockElement(html: string, spanStartIndex: number, spanEndIndex: number): {
  parentHtml: string;
  parentStartIndex: number;
  parentEndIndex: number;
} | null {
  // Block-level elements that commonly contain text spans (in order of preference)
  const blockElementTags = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'div', 'li', 'blockquote', 'pre', 'section', 'article'];
  
  // Look backwards from the span to find the most recent opening block tag
  let bestMatch: { tag: string; startIndex: number; endIndex: number } | null = null;
  let bestStartIndex = -1;
  
  // Search backwards from the span position
  for (let i = spanStartIndex; i >= 0; i--) {
    // Check if we're at the start of an opening tag
    if (html[i] === '<' && i + 1 < html.length) {
      // Check each block element tag
      for (const tag of blockElementTags) {
        const tagPattern = `<${tag}`;
        if (html.substring(i, i + tagPattern.length).toLowerCase() === tagPattern.toLowerCase()) {
          // Found a potential opening tag, verify it's a complete tag
          const tagEnd = html.indexOf('>', i);
          if (tagEnd !== -1) {
            const openingTag = html.substring(i, tagEnd + 1);
            // Make sure it's not a closing tag or self-closing
            if (!openingTag.includes('/>') && !openingTag.startsWith('</')) {
              // Found an opening tag, now find its closing tag
              const tagName = tag.toLowerCase();
              const closingTag = `</${tagName}>`;
              let depth = 1;
              let searchPos = tagEnd + 1;
              
              // Find the matching closing tag
              while (searchPos < html.length && depth > 0) {
                const nextOpen = html.indexOf(`<${tagName}`, searchPos);
                const nextClose = html.indexOf(closingTag, searchPos);
                
                if (nextClose === -1) {
                  // No closing tag found, this isn't a valid match
                  break;
                }
                
                if (nextOpen !== -1 && nextOpen < nextClose) {
                  // Found nested opening tag
                  depth++;
                  // Skip to after this opening tag
                  const nestedTagEnd = html.indexOf('>', nextOpen);
                  if (nestedTagEnd !== -1) {
                    searchPos = nestedTagEnd + 1;
                  } else {
                    searchPos = nextOpen + tagName.length + 1;
                  }
                } else {
                  // Found closing tag
                  depth--;
                  if (depth === 0) {
                    const parentEndIndex = nextClose + closingTag.length;
                    // Verify this parent contains our span
                    if (parentEndIndex >= spanEndIndex && i > bestStartIndex) {
                      bestMatch = {
                        tag: tagName,
                        startIndex: i,
                        endIndex: parentEndIndex,
                      };
                      bestStartIndex = i;
                      // Found the innermost parent, we can stop
                      break;
                    }
                  } else {
                    searchPos = nextClose + closingTag.length;
                  }
                }
              }
              
              // If we found a match, break from tag search (we want the innermost)
              if (bestMatch && bestStartIndex === i) {
                break;
              }
            }
          }
        }
      }
      
      // If we found the best match, we can stop searching backwards
      if (bestMatch) {
        break;
      }
    }
  }
  
  if (bestMatch) {
    return {
      parentHtml: html.substring(bestMatch.startIndex, bestMatch.endIndex),
      parentStartIndex: bestMatch.startIndex,
      parentEndIndex: bestMatch.endIndex,
    };
  }
  
  return null;
}

/**
 * Parse chapter HTML into segments
 * Each segment is a span with an ID starting with "f" followed by 6 digits
 * Now preserves parent block elements (p, h1, etc.) that contain the spans
 * Multiple spans within the same parent are grouped into one segment
 */
export function parseChapterIntoSegments(contentHtml: string): ParsedChapter {
  const segments: Segment[] = [];
  
  // Find all span elements with IDs matching pattern f\d{6}
  const spanIdRegex = /<span[^>]*id="(f\d{6})"[^>]*>([\s\S]*?)<\/span>/g;
  
  // Collect all spans first
  const allSpans: Array<{ id: string; startIndex: number; endIndex: number }> = [];
  let match;
  
  while ((match = spanIdRegex.exec(contentHtml)) !== null) {
    allSpans.push({
      id: match[1],
      startIndex: match.index,
      endIndex: match.index + match[0].length,
    });
  }
  
  if (allSpans.length === 0) {
    // No segments found, entire HTML is prefix
    return {
      segments: [],
      prefix: contentHtml,
      suffix: "",
      totalSegments: 0,
    };
  }
  
  // Group spans by their parent elements
  const processedParentRanges = new Map<string, { 
    parentHtml: string; 
    startIndex: number; 
    endIndex: number; 
    firstSpanId: string;
  }>();
  
  for (const span of allSpans) {
    // Try to find the parent block element
    const parentInfo = findParentBlockElement(contentHtml, span.startIndex, span.endIndex);
    
    if (parentInfo) {
      const rangeKey = `${parentInfo.parentStartIndex}-${parentInfo.parentEndIndex}`;
      
      // Only process each parent element once
      if (!processedParentRanges.has(rangeKey)) {
        processedParentRanges.set(rangeKey, {
          parentHtml: parentInfo.parentHtml,
          startIndex: parentInfo.parentStartIndex,
          endIndex: parentInfo.parentEndIndex,
          firstSpanId: span.id, // Use the first span ID in this parent
        });
      }
    } else {
      // Fallback: use just the span if no parent found
      const rangeKey = `${span.startIndex}-${span.endIndex}`;
      if (!processedParentRanges.has(rangeKey)) {
        const spanHtml = contentHtml.substring(span.startIndex, span.endIndex);
        processedParentRanges.set(rangeKey, {
          parentHtml: spanHtml,
          startIndex: span.startIndex,
          endIndex: span.endIndex,
          firstSpanId: span.id,
        });
      }
    }
  }
  
  // Convert to segments array, sorted by start index
  const sortedRanges = Array.from(processedParentRanges.values()).sort(
    (a, b) => a.startIndex - b.startIndex
  );
  
  let segmentIndex = 0;
  let lastEndIndex = 0;
  
  for (let i = 0; i < sortedRanges.length; i++) {
    const range = sortedRanges[i];
    const htmlBefore = i === 0 
      ? contentHtml.substring(0, range.startIndex) // Prefix for first segment
      : contentHtml.substring(lastEndIndex, range.startIndex); // HTML between segments
    
    segments.push({
      id: range.firstSpanId,
      html: range.parentHtml,
      startIndex: range.startIndex,
      endIndex: range.endIndex,
      segmentIndex: segmentIndex++,
      htmlBefore: htmlBefore || undefined,
    });
    
    lastEndIndex = range.endIndex;
  }
  
  // Extract suffix (HTML after last segment)
  const suffix = segments.length > 0 
    ? contentHtml.substring(segments[segments.length - 1].endIndex)
    : "";
  
  // Prefix is now stored in the first segment's htmlBefore
  const prefix = segments.length > 0 && segments[0].htmlBefore 
    ? segments[0].htmlBefore 
    : (segments.length === 0 ? contentHtml : "");
  
  logger.debug("[Segment Parser] Parsed chapter", {
    totalSegments: segments.length,
    totalSpans: allSpans.length,
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

