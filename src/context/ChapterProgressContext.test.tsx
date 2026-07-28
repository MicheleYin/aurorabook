import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { toast } from "sonner";

import {
  ChapterProgressProvider,
  useChapterProgressContext,
} from "./ChapterProgressContext";
import type { Book, Chapter } from "../types/book";
import { invoke } from "../test/tauri-mocks";

function createChapter(overrides: Partial<Chapter> = {}): Chapter {
  return {
    id: "ch-1",
    bookId: "book-1",
    title: "Chapter 1",
    href: "ch1.xhtml",
    chapterOrder: 0,
    ...overrides,
  };
}

function createBook(overrides: Partial<Book> = {}): Book {
  const chapter = createChapter();
  return {
    id: "book-1",
    title: "Book",
    author: "Author",
    chapters: [chapter, createChapter({ id: "ch-2", href: "ch2.xhtml", chapterOrder: 1 })],
    sourcePath: "/tmp/a.epub",
    audioTracks: [],
    conversionStatus: "completed",
    completedChapters: [],
    ...overrides,
  };
}

function wrapper({ children }: { children: ReactNode }) {
  return <ChapterProgressProvider>{children}</ChapterProgressProvider>;
}

describe("ChapterProgressProvider", () => {
  beforeEach(() => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "load_chapter_content") {
        return { contentHtml: "<p>Hello</p>" };
      }
      if (cmd === "update_book_progress") {
        return undefined;
      }
      throw new Error(`Unexpected invoke: ${cmd}`);
    });
  });

  it("throws outside the provider", () => {
    expect(() => renderHook(() => useChapterProgressContext())).toThrow(
      /must be used within/
    );
  });

  it("loads chapter content via invoke", async () => {
    const { result } = renderHook(() => useChapterProgressContext(), {
      wrapper,
    });

    await act(async () => {
      await result.current.loadChapterContent("book-1", createChapter());
    });

    expect(result.current.currentChapter).toMatchObject({
      id: "ch-1",
      contentHtml: "<p>Hello</p>",
    });
    expect(result.current.isLoadingChapter).toBe(false);
  });

  it("toasts when chapter content is missing", async () => {
    invoke.mockResolvedValueOnce(null);
    const { result } = renderHook(() => useChapterProgressContext(), {
      wrapper,
    });

    await act(async () => {
      await result.current.loadChapterContent("book-1", createChapter());
    });

    expect(toast.error).toHaveBeenCalledWith("Failed to load chapter content");
  });

  it("loads the last opened chapter from book progress", async () => {
    const book = createBook({
      progress: {
        currentChapterId: "ch-2",
        currentChapterHref: "ch2.xhtml",
        currentChapterIndex: 1,
        currentChapterScrollTop: 0,
        currentChapterScrollHeight: 100,
        currentChapterClientHeight: 50,
        chapterProgressPercent: 0,
        bookProgressPercent: 50,
        updatedAt: new Date().toISOString(),
      },
    });

    const { result } = renderHook(() => useChapterProgressContext(), {
      wrapper,
    });

    await act(async () => {
      await result.current.loadLastOpenedChapter(book);
    });

    expect(invoke).toHaveBeenCalledWith("load_chapter_content", {
      bookId: "book-1",
      chapterHref: "ch2.xhtml",
    });
    expect(result.current.currentChapter?.id).toBe("ch-2");
  });

  it("falls back to the first chapter when progress is missing", async () => {
    const { result } = renderHook(() => useChapterProgressContext(), {
      wrapper,
    });

    await act(async () => {
      await result.current.loadLastOpenedChapter(createBook());
    });

    expect(result.current.currentChapter?.id).toBe("ch-1");
  });

  it("toasts when a book has no chapters", async () => {
    const { result } = renderHook(() => useChapterProgressContext(), {
      wrapper,
    });

    await act(async () => {
      await result.current.loadLastOpenedChapter(createBook({ chapters: [] }));
    });

    expect(toast.error).toHaveBeenCalledWith(
      "No chapters available in this book"
    );
  });

  it("restores scroll and element position for the current chapter", async () => {
    const { result } = renderHook(() => useChapterProgressContext(), {
      wrapper,
    });

    const container = document.createElement("div");
    Object.defineProperty(container, "scrollTop", {
      configurable: true,
      writable: true,
      value: 0,
    });
    const prose = document.createElement("div");
    prose.className = "prose";
    const target = document.createElement("p");
    target.id = "el-1";
    target.scrollIntoView = vi.fn();
    prose.appendChild(target);
    container.appendChild(prose);
    result.current.containerRef.current = container;

    await act(async () => {
      await result.current.loadChapterContent("book-1", createChapter());
    });

    act(() => {
      result.current.restoreProgress(
        createBook({
          progress: {
            currentChapterId: "ch-1",
            currentChapterHref: "ch1.xhtml",
            currentChapterIndex: 0,
            currentChapterScrollTop: 120,
            currentChapterScrollHeight: 500,
            currentChapterClientHeight: 200,
            currentChapterElementId: "el-1",
            chapterProgressPercent: 20,
            bookProgressPercent: 10,
            updatedAt: new Date().toISOString(),
          },
        })
      );
    });

    expect(container.scrollTop).toBe(120);
    expect(target.scrollIntoView).toHaveBeenCalled();
  });

  it("saves progress for the current chapter", async () => {
    const { result } = renderHook(() => useChapterProgressContext(), {
      wrapper,
    });

    const container = document.createElement("div");
    Object.defineProperties(container, {
      scrollTop: { configurable: true, value: 10 },
      scrollHeight: { configurable: true, value: 100 },
      clientHeight: { configurable: true, value: 50 },
    });
    container.getBoundingClientRect = () =>
      ({
        top: 0,
        bottom: 50,
        left: 0,
        right: 100,
        width: 100,
        height: 50,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    result.current.containerRef.current = container;

    await act(async () => {
      await result.current.loadChapterContent("book-1", createChapter());
    });

    await act(async () => {
      await result.current.saveProgress(createBook());
    });

    expect(invoke).toHaveBeenCalledWith(
      "update_book_progress",
      expect.objectContaining({ bookId: "book-1" })
    );
  });
});
