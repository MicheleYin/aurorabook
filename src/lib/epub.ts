import DOMPurify from "dompurify";

import type { AudioSyncMap, AudioSyncSegment } from "../types/reader";

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
      ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|blob|data):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
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
 */
const normalizeAudioHref = (href: string): string => {
  // Remove leading slashes and normalize
  return href.replace(/^\/+/, "").replace(/^\.\.\//, "");
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

  // Find segment where currentTime falls within clipBegin and clipEnd
  const segment = syncMap.segments.find(
    (seg) => {
      const normalizedSegHref = normalizeAudioHref(seg.audioTrackHref);
      const matches = (
        normalizedSegHref === normalizedTrackHref &&
        currentTimeSeconds >= seg.clipBegin &&
        currentTimeSeconds < seg.clipEnd
      );
      
      if (matches) {
        console.debug("[Audio Sync] Found matching segment", {
          textElementId: seg.textElementId,
          chapterHref: seg.chapterHref,
          audioTrackHref: seg.audioTrackHref,
          clipBegin: seg.clipBegin,
          clipEnd: seg.clipEnd,
          currentTime: currentTimeSeconds,
        });
      }
      
      return matches;
    },
  );

  if (!segment) {
    console.debug("[Audio Sync] No segment found for", {
      normalizedTrackHref,
      currentTimeSeconds,
      availableSegments: syncMap.segments
        .filter(seg => normalizeAudioHref(seg.audioTrackHref) === normalizedTrackHref)
        .map(seg => ({
          textElementId: seg.textElementId,
          timeRange: `${seg.clipBegin.toFixed(3)}-${seg.clipEnd.toFixed(3)}s`,
        })),
    });
  }

  return segment;
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

  const normalizedTrackHref = normalizeAudioHref(audioTrackHref);
  const chapterHrefs = new Set<string>();

  syncMap.segments.forEach((seg) => {
    const normalizedSegHref = normalizeAudioHref(seg.audioTrackHref);
    if (normalizedSegHref === normalizedTrackHref) {
      chapterHrefs.add(seg.chapterHref);
    }
  });

  return Array.from(chapterHrefs);
};

