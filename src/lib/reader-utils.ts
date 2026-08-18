import type { Book, BookProgress, Chapter } from "../types/book";

/**
 * Normalize chapter XHTML so it can live inside the reader `div.prose`.
 *
 * Conversion used to wrap fragments in `<html><body>`. Injecting a full document
 * into a div can drop `body` descendants (including `span id="f000001"`), which
 * leaves audio running with no highlight. Parse as HTML and keep head styles
 * plus the body contents.
 */
export function prepareChapterHtmlForReader(html: string): string {
  const trimmed = html.trim();
  if (!trimmed) return html;

  const looksLikeDocument =
    /^(?:\uFEFF)?\s*(?:<\?xml\b|<!doctype\b|<html\b)/i.test(trimmed);
  if (!looksLikeDocument) {
    return html;
  }

  if (typeof DOMParser === "undefined") {
    return html;
  }

  const parsed = new DOMParser().parseFromString(html, "text/html");
  const headAssets = Array.from(
    parsed.head.querySelectorAll("style, link[rel~='stylesheet']")
  )
    .map((element) => element.outerHTML)
    .join("");
  return `${headAssets}${parsed.body.innerHTML}`;
}

/**
 * Calculates the reading progress for a book based on scroll position and current chapter
 * @param scrollContainer - The scrollable container element
 * @param currentBook - The current book being read
 * @param currentChapter - The current chapter being read
 * @returns BookProgress object with all progress information
 */
export function calculateBookProgress(
  scrollContainer: HTMLDivElement,
  currentBook: Book,
  currentChapter: Chapter
): BookProgress {
  const scrollTop = scrollContainer.scrollTop;
  const scrollHeight = scrollContainer.scrollHeight;
  const clientHeight = scrollContainer.clientHeight;

  // Calculate chapter progress
  const chapterProgress =
    scrollHeight > clientHeight
      ? Math.min(100, (scrollTop / (scrollHeight - clientHeight)) * 100)
      : 100;

  // Find current chapter index
  const chapterIndex = currentBook.chapters.findIndex(
    (ch) => ch.id === currentChapter.id
  );

  // Calculate book progress
  const bookProgress =
    currentBook.chapters.length > 0
      ? ((chapterIndex + chapterProgress / 100) / currentBook.chapters.length) *
        100
      : 0;

  // Find current element (if any)
  let elementId: string | undefined;
  let elementIndex: number | undefined;

  const shadowHost = scrollContainer.querySelector<HTMLElement>(
    "[data-reader-chapter-shadow-host]"
  );
  const contentRef =
    shadowHost?.shadowRoot?.querySelector<HTMLElement>(
      "[data-reader-chapter-content]"
    ) ?? scrollContainer.querySelector<HTMLElement>(".prose");
  if (contentRef && scrollContainer) {
    const elements = contentRef.querySelectorAll("p, h1, h2, h3, h4, h5, h6");
    let closestElement: HTMLElement | null = null;
    let closestDistance = Infinity;
    let foundIndex: number | undefined;

    elements.forEach((el, index) => {
      const htmlEl = el as HTMLElement;
      const rect = htmlEl.getBoundingClientRect();
      const containerRect = scrollContainer.getBoundingClientRect();
      const distance = Math.abs(rect.top - containerRect.top);

      if (distance < closestDistance && rect.top >= containerRect.top) {
        closestDistance = distance;
        closestElement = htmlEl;
        foundIndex = index;
      }
    });

    if (closestElement && foundIndex !== undefined) {
      elementIndex = foundIndex;
      const htmlElement = closestElement as HTMLElement;
      elementId = htmlElement.id || `element-${foundIndex}`;
      if (!htmlElement.id) {
        htmlElement.id = elementId;
      }
    }
  }

  return {
    currentChapterId: currentChapter.id,
    currentChapterHref: currentChapter.href,
    currentChapterIndex: chapterIndex,
    currentChapterElementId: elementId,
    currentChapterElementIndex: elementIndex,
    currentChapterScrollTop: scrollTop,
    currentChapterScrollHeight: scrollHeight,
    currentChapterClientHeight: clientHeight,
    chapterProgressPercent: chapterProgress,
    bookProgressPercent: bookProgress,
    updatedAt: new Date().toISOString(),
  };
}

const READER_INTERACTIVE_SELECTOR =
  "a, button, input, textarea, select, [role='button']";

/** Ignore small pointer jitter when deciding if a tap should toggle chrome. */
export const READER_CHROME_TOGGLE_DRAG_THRESHOLD_PX = 8;

/** Wait so double-click word selection can cancel a pending chrome toggle. */
export const READER_CHROME_TOGGLE_DELAY_MS = 280;

/** Ignore layout/scroll events from the header show/hide animation. */
export const READER_CHROME_SCROLL_GUARD_MS = 400;

/**
 * Keep the same on-screen paragraph when in-flow header height changes.
 * The scroll container grows/shrinks from the top, so scrollTop must move
 * by the header height delta.
 */
export function scrollTopAfterChromeToggle(
  scrollTop: number,
  previousHeaderHeight: number,
  nextHeaderHeight: number
): number {
  return Math.max(0, scrollTop + (nextHeaderHeight - previousHeaderHeight));
}

export function getPointerDistance(
  start: { x: number; y: number } | null,
  end: { x: number; y: number }
): number {
  if (!start) {
    return 0;
  }
  return Math.hypot(end.x - start.x, end.y - start.y);
}

export function isNativeReaderContextMenuTarget(
  _target: EventTarget | null
): boolean {
  return false;
}

function isReaderChromeToggleBlockedTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  return Boolean(target.closest(READER_INTERACTIVE_SELECTOR));
}

export function shouldToggleReaderHeaderOnClick({
  target,
  selectedText,
  pointerDistancePx,
}: {
  target: EventTarget | null;
  selectedText: string;
  pointerDistancePx: number;
}): boolean {
  if (isReaderChromeToggleBlockedTarget(target)) {
    return false;
  }
  if (selectedText.trim().length > 0) {
    return false;
  }
  if (pointerDistancePx > READER_CHROME_TOGGLE_DRAG_THRESHOLD_PX) {
    return false;
  }
  return true;
}
