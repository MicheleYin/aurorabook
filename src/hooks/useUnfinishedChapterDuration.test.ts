import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { invoke } from "../test/tauri-mocks";
import type { Book, Chapter } from "../types/book";
import { useUnfinishedChapterDuration } from "./useUnfinishedChapterDuration";

const conversionState = {
  convertingBookId: null as string | null,
  getCurrentConvertingChapter: vi.fn((bookId: string) =>
    bookId === "book-1" ? 1 : null
  ),
  refreshCurrentConvertingChapter: vi.fn(async (bookId: string) =>
    bookId === "book-1" ? 1 : null
  ),
};

vi.mock("../context/ConversionStateContext", () => ({
  useConversionState: () => conversionState,
}));

function createChapter(index: number): Chapter {
  return {
    id: `c${index}`,
    bookId: "book-1",
    title: `Chapter ${index + 1}`,
    href: `ch${index + 1}.xhtml`,
    chapterOrder: index,
  };
}

function createBook(overrides: Partial<Book> = {}): Book {
  return {
    id: "book-1",
    title: "Title",
    author: "Author",
    sourcePath: "/tmp/book.epub",
    chapters: [createChapter(0), createChapter(1), createChapter(2)],
    audioTracks: [
      {
        id: "t0",
        bookId: "book-1",
        chapterHref: "ch1.xhtml",
        filePath: "audio/0.mp3",
        href: "audio/0.mp3",
        title: "Chapter 1",
        duration: 120,
        order: 0,
      },
    ],
    conversionStatus: "started",
    completedChapters: ["ch1.xhtml"],
    ...overrides,
  };
}

describe("useUnfinishedChapterDuration", () => {
  beforeEach(() => {
    conversionState.convertingBookId = null;
    conversionState.getCurrentConvertingChapter.mockClear();
    conversionState.refreshCurrentConvertingChapter.mockClear();
    conversionState.getCurrentConvertingChapter.mockImplementation(
      (bookId: string) => (bookId === "book-1" ? 1 : null)
    );
    conversionState.refreshCurrentConvertingChapter.mockImplementation(
      async (bookId: string) => (bookId === "book-1" ? 1 : null)
    );
    invoke.mockReset();
    invoke.mockResolvedValue(45);
  });

  it("loads paused/in-progress chapter duration once", async () => {
    const { result } = renderHook(() =>
      useUnfinishedChapterDuration(createBook(), true)
    );

    await waitFor(() => {
      expect(result.current).toBe(45);
    });

    expect(invoke).toHaveBeenCalledWith("get_live_chapter_duration", {
      bookId: "book-1",
      chapterIndex: 1,
    });
    expect(conversionState.refreshCurrentConvertingChapter).toHaveBeenCalledWith(
      "book-1"
    );
  });

  it("returns 0 when the dialog is closed", async () => {
    const { result } = renderHook(() =>
      useUnfinishedChapterDuration(createBook(), false)
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current).toBe(0);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("polls duration while the unfinished chapter is live", async () => {
    vi.useFakeTimers();
    conversionState.convertingBookId = "book-1";
    invoke.mockResolvedValue(12);

    const { result } = renderHook(() =>
      useUnfinishedChapterDuration(createBook(), true)
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current).toBe(12);
    const callsAfterStart = invoke.mock.calls.length;
    invoke.mockResolvedValue(20);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(result.current).toBe(20);
    expect(invoke.mock.calls.length).toBeGreaterThan(callsAfterStart);

    vi.useRealTimers();
  });
});
