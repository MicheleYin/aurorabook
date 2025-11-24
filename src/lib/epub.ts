import DOMPurify from "dompurify";

import type { AudioSyncMap, AudioSyncSegment, NavItem } from "../types/reader";

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

export const ensureEpubSignature = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer.slice(0, 2));
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error("Please choose a valid EPUB file.");
  }
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

export const buildNavigationMap = (items?: NavItem[]) => {
  const map = new Map<string, string>();
  const visit = (nodes?: NavItem[]) => {
    if (!nodes) return;
    nodes.forEach((node) => {
      if (!node) return;
      const key = node.href?.split("#")[0];
      if (key) {
        map.set(key, node.label?.trim() ?? "");
      }
      if (node.subitems?.length) {
        visit(node.subitems);
      }
    });
  };
  visit(items);
  return map;
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

export const extractYear = (value?: string | null) => {
  if (!value) return undefined;
  const match = value.match(/\d{4}/);
  return match ? match[0] : undefined;
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

export const createId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `wl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
};

export const deriveTitleFromPath = (filepath: string) => {
  const filename = filepath.split(/[/\\]/).pop() ?? "Untitled";
  return filename.replace(/\.epub$/i, "").replace(/[-_]+/g, " ").trim();
};

/**
 * Parse time string from SMIL format (HH:MM:SS.mmm) to seconds
 */
const parseSmilTime = (timeStr: string): number => {
  const parts = timeStr.split(":").map(Number);
  if (parts.length === 3) {
    // HH:MM:SS.mmm format
    const hours = parts[0] || 0;
    const minutes = parts[1] || 0;
    const seconds = parts[2] || 0;
    return hours * 3600 + minutes * 60 + seconds;
  } else if (parts.length === 2) {
    // MM:SS.mmm format
    const minutes = parts[0] || 0;
    const seconds = parts[1] || 0;
    return minutes * 60 + seconds;
  }
  // Fallback: try parsing as seconds
  return Number(timeStr) || 0;
};

/**
 * Parse a SMIL file and extract audio-text sync segments
 */
export const parseSmilFile = async (
  smilContent: string | ArrayBuffer | Blob | unknown,
  chapterHref: string,
): Promise<AudioSyncSegment[]> => {
  let smilText: string;
  
  // Handle SMIL content directly (it's XML, not HTML)
  if (typeof smilContent === "string") {
    smilText = smilContent;
  } else if (smilContent instanceof Blob) {
    smilText = await smilContent.text();
  } else if (smilContent instanceof ArrayBuffer) {
    smilText = decodeBufferToString(smilContent);
  } else if (ArrayBuffer.isView(smilContent)) {
    smilText = decodeBufferToString(smilContent);
  } else if (
    typeof smilContent === "object" &&
    smilContent !== null &&
    "buffer" in smilContent &&
    smilContent.buffer instanceof ArrayBuffer
  ) {
    smilText = decodeBufferToString(
      ArrayBuffer.isView(smilContent) ? smilContent : new Uint8Array(smilContent.buffer),
    );
  } else if (
    typeof Document !== "undefined" &&
    smilContent instanceof Document &&
    sharedXmlSerializer
  ) {
    smilText = sharedXmlSerializer.serializeToString(smilContent);
  } else if (
    typeof Element !== "undefined" &&
    smilContent instanceof Element &&
    sharedXmlSerializer
  ) {
    smilText = sharedXmlSerializer.serializeToString(smilContent);
  } else {
    console.warn("Unexpected SMIL content type:", typeof smilContent, smilContent);
    return [];
  }

  // Check if content is empty
  if (!smilText || smilText.trim().length === 0) {
    console.warn("SMIL file is empty for chapter:", chapterHref, {
      contentLength: smilText?.length ?? 0,
      trimmedLength: smilText?.trim().length ?? 0,
      contentPreview: smilText?.substring(0, 100),
    });
    return [];
  }
  
  // Log first 200 chars for debugging
  console.debug("SMIL content preview (first 200 chars):", smilText.substring(0, 200));

  const parser = new DOMParser();
  const doc = parser.parseFromString(smilText, "text/xml");
  
  // Check for parsing errors
  const parserError = doc.querySelector("parsererror");
  if (parserError) {
    console.warn("Failed to parse SMIL file for chapter:", chapterHref, parserError.textContent);
    return [];
  }

  const segments: AudioSyncSegment[] = [];
  const parElements = doc.querySelectorAll("par");

  parElements.forEach((par) => {
    const textElement = par.querySelector("text");
    const audioElement = par.querySelector("audio");

    if (!textElement || !audioElement) {
      return;
    }

    const textSrc = textElement.getAttribute("src");
    const audioSrc = audioElement.getAttribute("src");
    const clipBegin = audioElement.getAttribute("clipBegin");
    const clipEnd = audioElement.getAttribute("clipEnd");

    if (!textSrc || !audioSrc || !clipBegin || !clipEnd) {
      return;
    }

    // Extract element ID from text src (e.g., "p001.xhtml#f000001" -> "f000001")
    const textIdMatch = textSrc.match(/#([^#]+)$/);
    if (!textIdMatch) {
      return;
    }

    const textElementId = textIdMatch[1];
    const beginSeconds = parseSmilTime(clipBegin);
    const endSeconds = parseSmilTime(clipEnd);

    // Normalize audio src - keep the path as-is if it matches manifest format
    // Paths in SMIL files should match manifest entries exactly
    // epubjs will resolve them correctly if they match
    let normalizedAudioSrc = audioSrc.replace(/^\.\.\//, "");
    // Remove leading slash if present (epubjs handles paths without leading slash)
    if (normalizedAudioSrc.startsWith("/")) {
      normalizedAudioSrc = normalizedAudioSrc.substring(1);
    }

    segments.push({
      textElementId,
      chapterHref,
      audioTrackHref: normalizedAudioSrc,
      clipBegin: beginSeconds,
      clipEnd: endSeconds,
    });
  });

  return segments;
};

/**
 * Build an audio sync map from SMIL files
 */
export const buildAudioSyncMap = async (
  epubBook: {
    resources?: { get: (href: string) => Promise<unknown> };
    load?: (href: string) => Promise<unknown>;
    getFile?: (href: string) => Promise<ArrayBuffer | null>;
  },
  chapters: Array<{ href: string }>,
): Promise<AudioSyncMap | undefined> => {
  const allSegments: AudioSyncSegment[] = [];

  // Find and parse all SMIL files
  for (const chapter of chapters) {
    let chapterHref = chapter.href.split("#")[0];
    // Normalize chapterHref - remove leading OEBPS/ if present to avoid double prefix
    // epubjs may prepend OEBPS/ internally, so we need to handle paths consistently
    if (chapterHref.startsWith("OEBPS/")) {
      chapterHref = chapterHref.substring(6); // Remove "OEBPS/"
    }
    // Also handle absolute paths
    if (chapterHref.startsWith("/OEBPS/")) {
      chapterHref = chapterHref.substring(7); // Remove "/OEBPS/"
    }
    
    // Try both with and without .smil extension, and handle different path formats
    // Try relative paths first (without OEBPS/), then with OEBPS/ prefix
    // Also try variations like .xhtml.smil (common pattern)
    const baseHref = chapterHref.replace(/\.(xhtml|html)$/, "");
    const smilHrefs = [
      // Try exact match with .smil extension
      `${chapterHref}.smil`,
      // Try replacing extension
      chapterHref.replace(/\.xhtml$/, ".smil"),
      chapterHref.replace(/\.html$/, ".smil"),
      // Try .xhtml.smil pattern (common in some EPUBs)
      chapterHref.replace(/\.(xhtml|html)$/, ".xhtml.smil"),
      // Try base name with .smil
      `${baseHref}.smil`,
      // Try with OEBPS/ prefix
      `OEBPS/${chapterHref}.smil`,
      `OEBPS/${chapterHref.replace(/\.xhtml$/, ".smil")}`,
      `OEBPS/${chapterHref.replace(/\.html$/, ".smil")}`,
      `OEBPS/${chapterHref.replace(/\.(xhtml|html)$/, ".xhtml.smil")}`,
      `OEBPS/${baseHref}.smil`,
      // Try Text/ subdirectory variations
      `Text/${baseHref}.smil`,
      `Text/${chapterHref.replace(/\.(xhtml|html)$/, ".smil")}`,
      `OEBPS/Text/${baseHref}.smil`,
      `OEBPS/Text/${chapterHref.replace(/\.(xhtml|html)$/, ".smil")}`,
    ];

    let parsed = false;
    for (const smilHref of smilHrefs) {
      try {
        // Try getFile() first since it handles missing files gracefully (returns null)
        // load() throws errors which we want to avoid for optional SMIL files
        let smilContent: unknown;
        if (epubBook.getFile) {
          try {
            const buffer = await epubBook.getFile(smilHref);
            if (buffer) {
              smilContent = decodeBufferToString(buffer);
            } else {
              // File not found, try next variant
              continue;
            }
          } catch (fileError) {
            console.debug("Failed to load SMIL via getFile:", smilHref, fileError);
            continue;
          }
        } else if (epubBook.load) {
          // Fallback to load() method if getFile() is not available
          try {
            smilContent = await epubBook.load(smilHref);
          } catch (loadError) {
            // If load() fails, try resources.get() as fallback
            if (epubBook.resources?.get) {
              try {
                smilContent = await epubBook.resources.get(smilHref);
              } catch (resourcesError) {
                console.debug("Failed to load SMIL via resources.get:", smilHref, resourcesError);
                continue;
              }
            } else {
              console.debug("No available method to load SMIL:", smilHref);
              continue;
            }
          }
        } else if (epubBook.resources?.get) {
          try {
            smilContent = await epubBook.resources.get(smilHref);
          } catch (resourcesError) {
            console.debug("Failed to load SMIL file:", smilHref, resourcesError);
            continue;
          }
        } else {
          console.debug("No available method to load SMIL:", smilHref);
          continue;
        }

        if (smilContent) {
          console.debug("Loading SMIL file:", smilHref, "Content type:", typeof smilContent);
          // Log raw content preview for debugging
          if (typeof smilContent === "string") {
            console.debug("Raw SMIL content (first 500 chars):", smilContent.substring(0, 500));
            console.debug("Raw SMIL content length:", smilContent.length);
          }
          const segments = await parseSmilFile(smilContent, chapterHref);
          if (segments.length > 0) {
            console.debug(`Parsed ${segments.length} segments from SMIL:`, smilHref);
            allSegments.push(...segments);
            parsed = true;
            break; // Found and parsed successfully, move to next chapter
          } else {
            console.debug("No segments parsed from SMIL:", smilHref);
          }
        } else {
          console.debug("SMIL content is null/undefined for:", smilHref);
        }
      } catch (error) {
        console.debug("Failed to parse SMIL file:", smilHref, error);
        // Try next SMIL href variant
        continue;
      }
    }
    
    if (!parsed) {
      // No SMIL file found for this chapter, which is fine
      console.debug("No SMIL file found for chapter:", chapterHref);
    }
  }

  if (allSegments.length === 0) {
    return undefined;
  }

  // Build lookup map: key is "audioTrackHref|time" -> segment index
  const lookup = new Map<string, number>();
  allSegments.forEach((segment, index) => {
    // Create lookup entries for clipBegin and clipEnd
    const beginKey = `${segment.audioTrackHref}|${segment.clipBegin}`;
    const endKey = `${segment.audioTrackHref}|${segment.clipEnd}`;
    lookup.set(beginKey, index);
    lookup.set(endKey, index);
  });

  return {
    segments: allSegments,
    lookup,
  };
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
    return undefined;
  }

  const normalizedTrackHref = normalizeAudioHref(audioTrackHref);

  // Find segment where currentTime falls within clipBegin and clipEnd
  const segment = syncMap.segments.find(
    (seg) => {
      const normalizedSegHref = normalizeAudioHref(seg.audioTrackHref);
      return (
        normalizedSegHref === normalizedTrackHref &&
        currentTimeSeconds >= seg.clipBegin &&
        currentTimeSeconds < seg.clipEnd
      );
    },
  );

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

