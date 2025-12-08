import DOMPurify from "dompurify";

import type { AudioSyncMap, AudioSyncSegment, AudioTrack } from "../types/reader";

const sharedTextDecoder =
  typeof TextDecoder !== "undefined" ? new TextDecoder("utf-8") : null;
const sharedXmlSerializer =
  typeof XMLSerializer !== "undefined" ? new XMLSerializer() : null;

const decodeBufferToString = (value: ArrayBuffer | ArrayBufferView): string => {
  if (!sharedTextDecoder) {
    return "";
  }

  const view =
    value instanceof Uint8Array
      ? value
      : value instanceof ArrayBuffer
        ? new Uint8Array(value)
        : ArrayBuffer.isView(value)
          ? new Uint8Array(value.buffer)
          : undefined;

  if (!view) {
    return "";
  }

  return sharedTextDecoder.decode(view);
};



export const normalizeChapterContent = async (content: unknown): Promise<string> => {
  if (typeof content === "string") {
    return content;
  }

  if (content instanceof Blob) {
    return await content.text();
  }

  if (content instanceof ArrayBuffer) {
    return decodeBufferToString(content);
  }

  if (ArrayBuffer.isView(content)) {
    return decodeBufferToString(content);
  }

  if (
    typeof content === "object" &&
    content !== null &&
    "buffer" in content &&
    content.buffer instanceof ArrayBuffer
  ) {
    return decodeBufferToString(
      ArrayBuffer.isView(content) ? content : new Uint8Array(content.buffer),
    );
  }

  if (
    typeof Document !== "undefined" &&
    content instanceof Document &&
    sharedXmlSerializer
  ) {
    return sharedXmlSerializer.serializeToString(content);
  }

  if (
    typeof Element !== "undefined" &&
    content instanceof Element &&
    sharedXmlSerializer
  ) {
    return sharedXmlSerializer.serializeToString(content);
  }

  if (
    typeof content === "object" &&
    content !== null &&
    "textContent" in content &&
    typeof (content as { textContent: unknown }).textContent === "string"
  ) {
    return (content as { textContent: string }).textContent;
  }

  console.warn("Unexpected chapter content type received from EPUB spine:", content);
  return "";
};



export const sanitizeChapterHtml = (html: string) => {
  const stripped = html
    .replace(/<!DOCTYPE[^>]*>/gi, "")
    .replace(/<\?xml[^>]*\?>/gi, "");

  try {
    // Configure DOMPurify to allow blob URLs in img src attributes
    // This is necessary because we convert relative image paths to blob URLs
    return DOMPurify.sanitize(stripped, {
      USE_PROFILES: { html: true },
      ADD_TAGS: ["svg", "math", "path", "g"],
      ADD_ATTR: ["xmlns", "viewBox", "xlink:href", "xml:lang"],
      // Explicitly allow blob: and data: URLs
      ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|blob|data):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
      // Keep all content
      KEEP_CONTENT: true,
      // Allow all standard HTML attributes on img tags including src with blob URLs
      ALLOW_DATA_ATTR: true,
    });
  } catch (error) {
    console.warn("DOMPurify failed to sanitize chapter, falling back.", error);
    return stripped.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "");
  }
};

export const extractPlainText = (html: string) => {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    return doc.body?.textContent?.replace(/\s+/g, " ").trim() ?? "";
  } catch (error) {
    console.warn("DOMParser could not extract plain text, using fallback.", error);
    return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
};



export const ensureStringArray = (value: unknown): string[] => {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item.trim() : String(item).trim()))
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/[,;]/)
      .map((part) => part.trim())
      .filter(Boolean);
  }
  return [String(value).trim()].filter(Boolean);
};






/**
 * Normalize audio track href for comparison (handles relative paths)
 * Handles various formats:
 * - "OEBPS/Audio/02.mp3"
 * - "Audio/02.mp3"
 * - "./OEBPS/Audio/02.mp3"
 * - "../OEBPS/Audio/02.mp3"
 * - "/OEBPS/Audio/02.mp3"
 * 
 * Removes OEBPS prefix for consistent matching
 */
const normalizeAudioHref = (href: string): string => {
  if (!href) return "";
  
  // Remove leading slashes, dots, and normalize path separators
  let normalized = href
    .replace(/^\/+/, "") // Remove leading slashes
    .replace(/^\.+\//, "") // Remove leading ./ or ../
    .replace(/\\/g, "/") // Normalize backslashes to forward slashes
    .toLowerCase(); // Case-insensitive comparison
  
  // Remove any remaining leading dots or slashes
  normalized = normalized.replace(/^[./]+/, "");
  
  // Remove OEBPS prefix for consistent matching (handles both "OEBPS/Audio/..." and "Audio/...")
  normalized = normalized.replace(/^oebps\//, "");
  
  return normalized;
};

/**
 * Find the current audio segment based on track href and time
 */
export const findCurrentAudioSegment = (
  syncMap: AudioSyncMap | undefined,
  audioTrackHref: string,
  currentTimeSeconds: number,
): AudioSyncSegment | undefined => {
  if (!syncMap) {
    console.debug("[Audio Sync] No sync map available");
    return undefined;
  }

  const normalizedTrackHref = normalizeAudioHref(audioTrackHref);
  console.debug("[Audio Sync] Finding segment", {
    audioTrackHref,
    normalizedTrackHref,
    currentTimeSeconds,
    totalSegments: syncMap.segments.length,
  });

  // Try multiple matching strategies
  // Strategy 1: Exact normalized match
  let segment = syncMap.segments.find(
    (seg) => {
      const normalizedSegHref = normalizeAudioHref(seg.audioTrackHref);
      return (
        normalizedSegHref === normalizedTrackHref &&
        currentTimeSeconds >= seg.clipBegin &&
        currentTimeSeconds < seg.clipEnd
      );
    },
  );

  // Strategy 2: If no exact match, try filename-only match (for cases where paths differ)
  if (!segment) {
    const trackFilename = normalizedTrackHref.split("/").pop() || normalizedTrackHref;
    segment = syncMap.segments.find(
      (seg) => {
        const normalizedSegHref = normalizeAudioHref(seg.audioTrackHref);
        const segFilename = normalizedSegHref.split("/").pop() || normalizedSegHref;
        return (
          segFilename === trackFilename &&
          currentTimeSeconds >= seg.clipBegin &&
          currentTimeSeconds < seg.clipEnd
        );
      },
    );
  }

  // Strategy 3: Try case-insensitive match
  if (!segment) {
    segment = syncMap.segments.find(
      (seg) => {
        const normalizedSegHref = normalizeAudioHref(seg.audioTrackHref);
        return (
          normalizedSegHref.toLowerCase() === normalizedTrackHref.toLowerCase() &&
          currentTimeSeconds >= seg.clipBegin &&
          currentTimeSeconds < seg.clipEnd
        );
      },
    );
  }
  
  if (segment) {
    console.debug("[Audio Sync] Found matching segment", {
      textElementId: segment.textElementId,
      chapterHref: segment.chapterHref,
      audioTrackHref: segment.audioTrackHref,
      clipBegin: segment.clipBegin,
      clipEnd: segment.clipEnd,
      currentTime: currentTimeSeconds,
    });
  }

  if (!segment) {
    // Get sample of segment hrefs to debug matching issues
    const sampleSegments = syncMap.segments.slice(0, 10).map(seg => ({
      original: seg.audioTrackHref,
      normalized: normalizeAudioHref(seg.audioTrackHref),
      timeRange: `${seg.clipBegin.toFixed(3)}-${seg.clipEnd.toFixed(3)}s`,
    }));
    
    // Count segments with matching normalized href
    const matchingSegments = syncMap.segments.filter(
      seg => normalizeAudioHref(seg.audioTrackHref) === normalizedTrackHref
    );
    
    console.debug("[Audio Sync] No segment found for", {
      audioTrackHref,
      normalizedTrackHref,
      currentTimeSeconds,
      totalSegments: syncMap.segments.length,
      matchingSegmentsCount: matchingSegments.length,
      sampleSegments,
      // Show first few segments with matching href (if any)
      availableSegments: matchingSegments.slice(0, 5).map(seg => ({
        textElementId: seg.textElementId,
        timeRange: `${seg.clipBegin.toFixed(3)}-${seg.clipEnd.toFixed(3)}s`,
        clipBegin: seg.clipBegin,
        clipEnd: seg.clipEnd,
      })),
    });
  }

  return segment;
};

/**
 * Normalize a chapter href by removing fragment and leading slashes
 */
export const normalizeChapterHref = (href: string): string => {
  return href.split("#")[0].replace(/^\/+/, "");
};

/**
 * Check if two chapter hrefs match, handling various path format differences
 * This handles cases like:
 * - "OEBPS/chapter_2.xhtml" vs "chapter_2.xhtml"
 * - "chapter_2.xhtml" vs "OEBPS/chapter_2.xhtml"
 * - Different path separators or leading slashes
 */
export const chapterHrefsMatch = (href1: string, href2: string): boolean => {
  const norm1 = normalizeChapterHref(href1);
  const norm2 = normalizeChapterHref(href2);
  
  // Exact match
  if (norm1 === norm2) return true;
  
  // Match with/without OEBPS prefix
  const withoutOEBPS1 = norm1.replace(/^OEBPS\//, "");
  const withoutOEBPS2 = norm2.replace(/^OEBPS\//, "");
  if (withoutOEBPS1 === withoutOEBPS2) return true;
  
  // Match with OEBPS prefix added
  if (`OEBPS/${withoutOEBPS1}` === norm2 || `OEBPS/${withoutOEBPS2}` === norm1) return true;
  
  // End-with matching (for partial paths)
  if (norm1.endsWith(norm2) || norm2.endsWith(norm1)) return true;
  
  // Filename-only matching (last resort)
  const filename1 = norm1.split("/").pop() || norm1;
  const filename2 = norm2.split("/").pop() || norm2;
  if (filename1 === filename2) return true;
  
  return false;
};

/**
 * Check if two audio track hrefs match, handling various path format differences
 * This handles cases like:
 * - "OEBPS/Audio/01.mp3" vs "Audio/01.mp3"
 * - "Audio/01.mp3" vs "OEBPS/Audio/01.mp3"
 * - Different path separators or leading slashes
 */
const audioTrackHrefsMatch = (href1: string, href2: string): boolean => {
  const norm1 = normalizeAudioHref(href1);
  const norm2 = normalizeAudioHref(href2);
  
  // Exact match after normalization
  if (norm1 === norm2) return true;
  
  // Filename-only matching (last resort)
  const filename1 = norm1.split("/").pop() || norm1;
  const filename2 = norm2.split("/").pop() || norm2;
  if (filename1 === filename2) return true;
  
  return false;
};

/**
 * Find chapters that use a specific audio track
 */
export const findChaptersForAudioTrack = (
  syncMap: AudioSyncMap | undefined,
  audioTrackHref: string,
): string[] => {
  if (!syncMap) {
    return [];
  }

  const chapterHrefs = new Set<string>();

  syncMap.segments.forEach((seg) => {
    if (audioTrackHrefsMatch(seg.audioTrackHref, audioTrackHref)) {
      chapterHrefs.add(seg.chapterHref);
    }
  });

  return Array.from(chapterHrefs);
};

/**
 * Find the audio track for a specific chapter
 * Returns the audio track if the chapter has associated audio segments
 */
export const findAudioTrackForChapter = (
  syncMap: AudioSyncMap | undefined,
  audioTracks: AudioTrack[],
  chapterHref: string,
): AudioTrack | undefined => {
  if (!syncMap || audioTracks.length === 0) {
    return undefined;
  }

  const normalizedChapterHref = normalizeChapterHref(chapterHref);
  const audioTrackHrefs = new Set<string>();

  // Find all audio track hrefs that have segments for this chapter
  syncMap.segments.forEach((seg) => {
    if (chapterHrefsMatch(seg.chapterHref, normalizedChapterHref)) {
      audioTrackHrefs.add(seg.audioTrackHref);
    }
  });

  // Return the first matching audio track
  if (audioTrackHrefs.size > 0) {
    const trackHref = Array.from(audioTrackHrefs)[0];
    const normalizedTrackHref = normalizeAudioHref(trackHref);
    
    return audioTracks.find((track) => {
      const normalizedTrack = normalizeAudioHref(track.href);
      return normalizedTrack === normalizedTrackHref;
    });
  }

  return undefined;
};

