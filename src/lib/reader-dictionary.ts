export const MAX_DICTIONARY_QUERY_CHARS = 64;
export const MAX_DICTIONARY_WORDS = 4;

export type SelectionRect = {
  top: number;
  left: number;
  width: number;
  height: number;
  bottom: number;
  right: number;
};

export type DictionaryCardLayout = {
  top?: number;
  bottom?: number;
  left: number;
  width: number;
  maxHeight: number;
};

export type DictionaryLookupResult = {
  term: string;
  definition: string | null;
};

function stripWrappingPunctuation(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && !isLetterOrNumber(value[start])) {
    start += 1;
  }
  while (end > start && !isLetterOrNumber(value[end - 1])) {
    end -= 1;
  }
  return value.slice(start, end);
}

function isLetterOrNumber(character: string): boolean {
  return /\p{L}|\p{N}/u.test(character);
}

export function normalizeDictionaryQuery(raw: string): string | null {
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (!collapsed) {
    return null;
  }

  const words = collapsed.split(" ");
  if (words.length > MAX_DICTIONARY_WORDS) {
    return null;
  }
  if (collapsed.length > MAX_DICTIONARY_QUERY_CHARS) {
    return null;
  }

  const stripped = stripWrappingPunctuation(collapsed);
  if (stripped.length < 1) {
    return null;
  }
  return stripped;
}

export function snapshotReaderSelection(
  root: HTMLElement | null
): { query: string; rect: SelectionRect } | null {
  if (!root) {
    return null;
  }

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }

  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) {
    return null;
  }

  const query = normalizeDictionaryQuery(selection.toString());
  if (!query) {
    return null;
  }

  const rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    return null;
  }

  return {
    query,
    rect: {
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
      bottom: rect.bottom,
      right: rect.right,
    },
  };
}

export function dictionaryCardLayout(
  selectionRect: SelectionRect,
  viewport: { width: number; height: number }
): DictionaryCardLayout {
  const width = Math.min(360, Math.max(240, viewport.width - 32));
  const gap = 10;
  const edge = 16;
  const maxHeight = Math.min(Math.round(viewport.height * 0.42), 360);
  const spaceBelow = viewport.height - selectionRect.bottom - gap - edge;
  const spaceAbove = selectionRect.top - gap - edge;
  const placeBelow =
    spaceBelow >= Math.min(160, maxHeight) || spaceBelow >= spaceAbove;

  const left = Math.min(
    Math.max(edge, selectionRect.left + selectionRect.width / 2 - width / 2),
    Math.max(edge, viewport.width - width - edge)
  );

  if (placeBelow) {
    return {
      top: selectionRect.bottom + gap,
      left,
      width,
      maxHeight,
    };
  }

  return {
    bottom: viewport.height - selectionRect.top + gap,
    left,
    width,
    maxHeight,
  };
}

export function isDictionaryCardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  return Boolean(target.closest("[data-reader-dictionary-card]"));
}
