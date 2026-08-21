import { act, renderHook } from "@testing-library/react";
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
    conversionStatus: "done",
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

  it("restores scroll position when element id is missing", async () => {
    const { result } = renderHook(() => useChapterProgressContext(), {
      wrapper,
    });

    const container = document.createElement("div");
    Object.defineProperty(container, "scrollTop", {
      configurable: true,
      writable: true,
      value: 0,
    });
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
            currentChapterScrollTop: 88,
            currentChapterScrollHeight: 400,
            currentChapterClientHeight: 200,
            chapterProgressPercent: 22,
            bookProgressPercent: 11,
            updatedAt: new Date().toISOString(),
          },
        })
      );
    });

    expect(container.scrollTop).toBe(88);
  });

  it("does not restore progress when the saved chapter differs from the active one", async () => {
    const { result } = renderHook(() => useChapterProgressContext(), {
      wrapper,
    });

    const container = document.createElement("div");
    Object.defineProperty(container, "scrollTop", {
      configurable: true,
      writable: true,
      value: 5,
    });
    result.current.containerRef.current = container;

    await act(async () => {
      await result.current.loadChapterContent("book-1", createChapter());
    });

    act(() => {
      result.current.restoreProgress(
        createBook({
          progress: {
            currentChapterId: "ch-2",
            currentChapterHref: "ch2.xhtml",
            currentChapterIndex: 1,
            currentChapterScrollTop: 999,
            currentChapterScrollHeight: 500,
            currentChapterClientHeight: 200,
            chapterProgressPercent: 50,
            bookProgressPercent: 50,
            updatedAt: new Date().toISOString(),
          },
        })
      );
    });

    expect(container.scrollTop).toBe(5);
  });

  it("does not restore when book progress or container is missing", async () => {
    const { result } = renderHook(() => useChapterProgressContext(), {
      wrapper,
    });

    await act(async () => {
      await result.current.loadChapterContent("book-1", createChapter());
    });

    expect(() => {
      act(() => {
        result.current.restoreProgress(null);
        result.current.restoreProgress(createBook());
      });
    }).not.toThrow();
  });

  it("saves a complete wire-format progress payload for the current chapter", async () => {
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
    const prose = document.createElement("div");
    prose.className = "prose";
    container.appendChild(prose);
    result.current.containerRef.current = container;

    await act(async () => {
      await result.current.loadChapterContent("book-1", createChapter());
    });

    await act(async () => {
      await result.current.saveProgress(createBook());
    });

    expect(invoke).toHaveBeenCalledWith("update_book_progress", {
      bookId: "book-1",
      progress: expect.objectContaining({
        currentChapterId: "ch-1",
        currentChapterHref: "ch1.xhtml",
        currentChapterIndex: 0,
        currentChapterScrollTop: 10,
        currentChapterScrollHeight: 100,
        currentChapterClientHeight: 50,
        chapterProgressPercent: expect.any(Number),
        bookProgressPercent: expect.any(Number),
        updatedAt: expect.any(String),
      }),
    });

    const saveCall = invoke.mock.calls.find(
      (call) => call[0] === "update_book_progress"
    );
    const progress = (saveCall?.[1] as { progress: Record<string, unknown> })
      .progress;
    expect(progress.currentChapterId).toEqual(expect.any(String));
    expect(progress.currentChapterHref).toEqual(expect.any(String));
    expect(typeof progress.currentChapterIndex).toBe("number");
    expect(typeof progress.currentChapterScrollTop).toBe("number");
    expect(typeof progress.currentChapterScrollHeight).toBe("number");
    expect(typeof progress.currentChapterClientHeight).toBe("number");
    expect(typeof progress.chapterProgressPercent).toBe("number");
    expect(typeof progress.bookProgressPercent).toBe("number");
    expect(typeof progress.updatedAt).toBe("string");
  });

  it("does not save progress when no chapter is loaded", async () => {
    const { result } = renderHook(() => useChapterProgressContext(), {
      wrapper,
    });

    invoke.mockClear();
    await act(async () => {
      await result.current.saveProgress(createBook());
    });

    expect(invoke).not.toHaveBeenCalledWith(
      "update_book_progress",
      expect.anything()
    );
  });

  it("round-trips save then restore for the same chapter", async () => {
    const { result } = renderHook(() => useChapterProgressContext(), {
      wrapper,
    });

    const container = document.createElement("div");
    Object.defineProperties(container, {
      scrollTop: { configurable: true, writable: true, value: 40 },
      scrollHeight: { configurable: true, value: 200 },
      clientHeight: { configurable: true, value: 100 },
    });
    container.getBoundingClientRect = () =>
      ({
        top: 0,
        bottom: 100,
        left: 0,
        right: 100,
        width: 100,
        height: 100,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    const prose = document.createElement("div");
    prose.className = "prose";
    container.appendChild(prose);
    result.current.containerRef.current = container;

    await act(async () => {
      await result.current.loadChapterContent("book-1", createChapter());
    });

    await act(async () => {
      await result.current.saveProgress(createBook());
    });

    const saveCall = invoke.mock.calls.find(
      (call) => call[0] === "update_book_progress"
    );
    const savedProgress = (
      saveCall?.[1] as {
        progress: {
          currentChapterId: string;
          currentChapterHref: string;
          currentChapterIndex: number;
          currentChapterScrollTop: number;
          currentChapterScrollHeight: number;
          currentChapterClientHeight: number;
          chapterProgressPercent: number;
          bookProgressPercent: number;
          updatedAt: string;
        };
      }
    ).progress;

    container.scrollTop = 0;
    act(() => {
      result.current.restoreProgress(
        createBook({
          progress: {
            ...savedProgress,
            currentChapterScrollTop: 40,
          },
        })
      );
    });

    expect(container.scrollTop).toBe(40);
  });

  it("sets isLoadingChapter true while a chapter fetch is in flight", async () => {
    let resolveLoad: ((value: unknown) => void) | undefined;
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "load_chapter_content") {
        return new Promise((resolve) => {
          resolveLoad = resolve;
        });
      }
      throw new Error(`Unexpected invoke: ${cmd}`);
    });

    const { result } = renderHook(() => useChapterProgressContext(), {
      wrapper,
    });

    let loadPromise: Promise<void> | undefined;
    act(() => {
      loadPromise = result.current.loadChapterContent("book-1", createChapter());
    });

    expect(result.current.isLoadingChapter).toBe(true);

    await act(async () => {
      resolveLoad?.({ contentHtml: "<p>Hello</p>" });
      await loadPromise;
    });

    expect(result.current.isLoadingChapter).toBe(false);
  });

  it("ignores a stale chapter response and only clears loading for the latest request", async () => {
    const resolvers: Array<(value: unknown) => void> = [];
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "load_chapter_content") {
        return new Promise((resolve) => {
          resolvers.push(resolve);
        });
      }
      throw new Error(`Unexpected invoke: ${cmd}`);
    });

    const { result } = renderHook(() => useChapterProgressContext(), {
      wrapper,
    });

    const firstChapter = createChapter({ id: "ch-1", href: "ch1.xhtml" });
    const secondChapter = createChapter({
      id: "ch-2",
      href: "ch2.xhtml",
      chapterOrder: 1,
    });

    let firstPromise: Promise<void> | undefined;
    let secondPromise: Promise<void> | undefined;
    act(() => {
      firstPromise = result.current.loadChapterContent("book-1", firstChapter);
      secondPromise = result.current.loadChapterContent(
        "book-1",
        secondChapter
      );
    });

    expect(resolvers).toHaveLength(2);

    await act(async () => {
      resolvers[0]?.({ contentHtml: "<p>Stale first</p>" });
      await firstPromise;
    });

    // Stale response must not win; still loading until latest settles.
    expect(result.current.currentChapter?.id).not.toBe("ch-1");
    expect(result.current.isLoadingChapter).toBe(true);

    await act(async () => {
      resolvers[1]?.({ contentHtml: "<p>Latest second</p>" });
      await secondPromise;
    });

    expect(result.current.currentChapter?.id).toBe("ch-2");
    expect(
      (result.current.currentChapter?.contentHtml ?? "").includes("Latest second")
    ).toBe(true);
    expect(result.current.isLoadingChapter).toBe(false);
  });

  it("keeps previous non-empty HTML when a newer fetch returns empty for the same chapter", async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "load_chapter_content") {
        return { contentHtml: "<p>Original</p>" };
      }
      throw new Error(`Unexpected invoke: ${cmd}`);
    });

    const { result } = renderHook(() => useChapterProgressContext(), {
      wrapper,
    });
    const chapter = createChapter();

    await act(async () => {
      await result.current.loadChapterContent("book-1", chapter);
    });
    const preservedContent = result.current.currentChapter?.contentHtml;

    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "load_chapter_content") {
        return { contentHtml: "   " };
      }
      throw new Error(`Unexpected invoke: ${cmd}`);
    });

    await act(async () => {
      await result.current.loadChapterContent("book-1", chapter);
    });

    expect(result.current.currentChapter?.contentHtml).toBe(preservedContent);
    expect(result.current.isLoadingChapter).toBe(false);
  });
});
