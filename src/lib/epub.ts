import DOMPurify from "dompurify";

import type { NavItem } from "../types/reader";

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
    return DOMPurify.sanitize(stripped, {
      USE_PROFILES: { html: true },
      ADD_TAGS: ["svg", "math", "path", "g"],
      ADD_ATTR: ["xmlns", "viewBox", "xlink:href", "xml:lang"],
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

