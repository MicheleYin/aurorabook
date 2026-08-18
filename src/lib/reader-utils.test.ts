import { describe, expect, it } from "vitest";

import type { Book, Chapter } from "../types/book";
import {
  calculateBookProgress,
  getPointerDistance,
  isNativeReaderContextMenuTarget,
  prepareChapterHtmlForReader,
  READER_CHROME_TOGGLE_DRAG_THRESHOLD_PX,
  scrollTopAfterChromeToggle,
  shouldToggleReaderHeaderOnClick,
} from "./reader-utils";

function createBook(chapters: Chapter[]): Book {
  return {
    id: "book-1",
    title: "Book",
    author: "Author",
    chapters,
    sourcePath: "/tmp/book.epub",
    audioTracks: [],
    conversionStatus: "notStarted",
    completedChapters: [],
  };
}

function setRect(element: Element, rect: Partial<DOMRect>): void {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      x: 0,
      y: 0,
      width: 100,
      height: 20,
      top: 0,
      right: 100,
      bottom: 20,
      left: 0,
      toJSON: () => ({}),
      ...rect,
    }),
  });
}

describe("calculateBookProgress", () => {
  it("calculates chapter and book progress from the nearest visible prose element", () => {
    const currentChapter: Chapter = {
      id: "chapter-2",
      bookId: "book-1",
      title: "Chapter 2",
      href: "chapter-2.xhtml",
      chapterOrder: 1,
    };
    const book = createBook([
      {
        id: "chapter-1",
        bookId: "book-1",
        title: "Chapter 1",
        href: "chapter-1.xhtml",
        chapterOrder: 0,
      },
      currentChapter,
      {
        id: "chapter-3",
        bookId: "book-1",
        title: "Chapter 3",
        href: "chapter-3.xhtml",
        chapterOrder: 2,
      },
    ]);

    const scrollContainer = document.createElement("div") as HTMLDivElement;
    Object.defineProperties(scrollContainer, {
      scrollTop: { configurable: true, value: 150, writable: true },
      scrollHeight: { configurable: true, value: 500 },
      clientHeight: { configurable: true, value: 200 },
    });
    setRect(scrollContainer, { top: 100, left: 0, right: 300, bottom: 400 });

    const prose = document.createElement("div");
    prose.className = "prose";
    const first = document.createElement("p");
    first.id = "first";
    const second = document.createElement("h2");
    const third = document.createElement("p");
    third.id = "third";
    prose.append(first, second, third);
    scrollContainer.appendChild(prose);

    setRect(first, { top: 80, bottom: 100 });
    setRect(second, { top: 130, bottom: 150 });
    setRect(third, { top: 250, bottom: 270 });

    const progress = calculateBookProgress(
      scrollContainer,
      book,
      currentChapter
    );

    expect(progress.currentChapterIndex).toBe(1);
    expect(progress.chapterProgressPercent).toBe(50);
    expect(progress.bookProgressPercent).toBe(50);
    expect(progress.currentChapterElementIndex).toBe(1);
    expect(progress.currentChapterElementId).toBe("element-1");
    expect(second.id).toBe("element-1");
    expect(progress.currentChapterScrollTop).toBe(150);
    expect(progress.updatedAt).toMatch(/T/);
  });

  it("prefers reader shadow DOM content and defaults chapter progress to complete when content does not scroll", () => {
    const currentChapter: Chapter = {
      id: "chapter-1",
      bookId: "book-1",
      title: "Chapter 1",
      href: "chapter-1.xhtml",
      chapterOrder: 0,
    };
    const book = createBook([currentChapter]);

    const scrollContainer = document.createElement("div") as HTMLDivElement;
    Object.defineProperties(scrollContainer, {
      scrollTop: { configurable: true, value: 0, writable: true },
      scrollHeight: { configurable: true, value: 100 },
      clientHeight: { configurable: true, value: 200 },
    });
    setRect(scrollContainer, { top: 50, left: 0, right: 300, bottom: 350 });

    const shadowHost = document.createElement("div");
    shadowHost.setAttribute("data-reader-chapter-shadow-host", "");
    const shadowRoot = shadowHost.attachShadow({ mode: "open" });
    const content = document.createElement("section");
    content.setAttribute("data-reader-chapter-content", "");
    const paragraph = document.createElement("p");
    paragraph.id = "shadow-paragraph";
    content.appendChild(paragraph);
    shadowRoot.appendChild(content);
    scrollContainer.appendChild(shadowHost);

    setRect(paragraph, { top: 55, bottom: 75 });

    const progress = calculateBookProgress(
      scrollContainer,
      book,
      currentChapter
    );

    expect(progress.chapterProgressPercent).toBe(100);
    expect(progress.bookProgressPercent).toBe(100);
    expect(progress.currentChapterElementId).toBe("shadow-paragraph");
    expect(progress.currentChapterElementIndex).toBe(0);
  });

  it("returns undefined element information when no readable block is found", () => {
    const currentChapter: Chapter = {
      id: "missing",
      bookId: "book-1",
      title: "Missing",
      href: "missing.xhtml",
      chapterOrder: 0,
    };
    const book = createBook([]);

    const scrollContainer = document.createElement("div") as HTMLDivElement;
    Object.defineProperties(scrollContainer, {
      scrollTop: { configurable: true, value: 40, writable: true },
      scrollHeight: { configurable: true, value: 300 },
      clientHeight: { configurable: true, value: 100 },
    });
    setRect(scrollContainer, { top: 0, left: 0, right: 200, bottom: 300 });

    const progress = calculateBookProgress(
      scrollContainer,
      book,
      currentChapter
    );

    expect(progress.currentChapterIndex).toBe(-1);
    expect(progress.currentChapterElementId).toBeUndefined();
    expect(progress.currentChapterElementIndex).toBeUndefined();
    expect(progress.bookProgressPercent).toBe(0);
    expect(progress.chapterProgressPercent).toBe(20);
  });
});

describe("reader chrome and native selection helpers", () => {
  it("computes pointer travel from a start point", () => {
    expect(getPointerDistance(null, { x: 10, y: 10 })).toBe(0);
    expect(getPointerDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });

  it("does not allow the native context menu on reader chapter text", () => {
    const prose = document.createElement("div");
    prose.className = "reader-prose";
    const word = document.createElement("span");
    prose.appendChild(word);

    expect(isNativeReaderContextMenuTarget(word)).toBe(false);
    expect(isNativeReaderContextMenuTarget(document.createElement("div"))).toBe(
      false
    );
    expect(isNativeReaderContextMenuTarget(null)).toBe(false);
  });

  it("toggles the header only for a tap that did not select text", () => {
    const paragraph = document.createElement("p");

    expect(
      shouldToggleReaderHeaderOnClick({
        target: paragraph,
        selectedText: "",
        pointerDistancePx: 2,
      })
    ).toBe(true);

    expect(
      shouldToggleReaderHeaderOnClick({
        target: paragraph,
        selectedText: "dictionary",
        pointerDistancePx: 2,
      })
    ).toBe(false);

    expect(
      shouldToggleReaderHeaderOnClick({
        target: paragraph,
        selectedText: "",
        pointerDistancePx: READER_CHROME_TOGGLE_DRAG_THRESHOLD_PX + 1,
      })
    ).toBe(false);

    const button = document.createElement("button");
    expect(
      shouldToggleReaderHeaderOnClick({
        target: button,
        selectedText: "",
        pointerDistancePx: 0,
      })
    ).toBe(false);
  });
});

describe("prepareChapterHtmlForReader", () => {
  it("keeps fragment HTML unchanged", () => {
    const html =
      '<p><span id="f000001">Alpha paragraph one is long enough.</span></p>';
    expect(prepareChapterHtmlForReader(html)).toBe(html);
  });

  it("extracts body content and highlight spans from a wrapped chapter document", () => {
    const html = `<html><body>
      <p><span id="f000001">First spoken sentence is long enough to keep.</span></p>
      <p><span id="f000002">Second spoken sentence is long enough to keep.</span></p>
    </body></html>`;
    const prepared = prepareChapterHtmlForReader(html);
    expect(prepared).toContain('id="f000001"');
    expect(prepared).toContain('id="f000002"');
    expect(prepared.toLowerCase()).not.toContain("<html");
    expect(prepared.toLowerCase()).not.toContain("<body");
  });

  it("preserves chapter styles from head when unwrapping xhtml", () => {
    const html = `<html xmlns="http://www.w3.org/1999/xhtml">
      <head><style>.chapter { color: red; }</style></head>
      <body><p><span id="f000001">Spoken sentence is long enough to keep.</span></p></body>
    </html>`;
    const prepared = prepareChapterHtmlForReader(html);
    expect(prepared).toContain(".chapter { color: red; }");
    expect(prepared).toContain('id="f000001"');
  });
});

describe("scrollTopAfterChromeToggle", () => {
  it("decreases scrollTop when the header hides so content stays on screen", () => {
    expect(scrollTopAfterChromeToggle(500, 64, 0)).toBe(436);
  });

  it("increases scrollTop when the header returns", () => {
    expect(scrollTopAfterChromeToggle(436, 0, 64)).toBe(500);
  });

  it("does not scroll above the top of the chapter", () => {
    expect(scrollTopAfterChromeToggle(20, 64, 0)).toBe(0);
  });
});
