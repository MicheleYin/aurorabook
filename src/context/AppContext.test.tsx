import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { AppProvider, useAppContext } from "./AppContext";
import type { Book } from "../types/book";
import { invoke } from "../test/tauri-mocks";

function createBook(overrides: Partial<Book> = {}): Book {
  return {
    id: "book-1",
    title: "Book",
    author: "Author",
    chapters: [
      {
        id: "ch-1",
        bookId: "book-1",
        title: "Chapter 1",
        href: "ch1.xhtml",
        chapterOrder: 0,
      },
    ],
    sourcePath: "/tmp/a.epub",
    audioTracks: [],
    conversionStatus: "done",
    completedChapters: [],
    ...overrides,
  };
}

const deps = {
  saveChapterProgress: vi.fn(async () => undefined),
  restoreChapterProgress: vi.fn(async () => undefined),
  loadLastOpenedChapter: vi.fn(),
  calculateBookProgress: vi.fn(() => ({
    currentChapterId: "ch-1",
    currentChapterHref: "ch1.xhtml",
    currentChapterIndex: 0,
    currentChapterScrollTop: 0,
    currentChapterScrollHeight: 100,
    currentChapterClientHeight: 50,
    chapterProgressPercent: 10,
    bookProgressPercent: 10,
    updatedAt: new Date().toISOString(),
  })),
  loadLastOpenedAudioTrack: vi.fn(),
  loadAudioTrack: vi.fn(async () => undefined),
  calculateAudioProgress: vi.fn(() => ({
    currentTrackId: "t1",
    currentTrackHref: "ch1.xhtml",
    currentTrackIndex: 0,
    currentTimeSeconds: 12,
    updatedAt: new Date().toISOString(),
  })),
  saveAudioProgress: vi.fn(async () => undefined),
};

function wrapper({ children }: { children: ReactNode }) {
  return <AppProvider {...deps}>{children}</AppProvider>;
}

describe("AppProvider", () => {
  beforeEach(() => {
    Object.values(deps).forEach((fn) => fn.mockClear?.());
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "read_all_books") {
        return [createBook(), createBook({ id: "book-2", title: "Two" })];
      }
      throw new Error(`Unexpected invoke: ${cmd}`);
    });
  });

  it("throws outside the provider", () => {
    expect(() => renderHook(() => useAppContext())).toThrow(
      /must be used within AppProvider/
    );
  });

  it("loads the library on mount", async () => {
    const { result } = renderHook(() => useAppContext(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoadingLibrary).toBe(false);
      expect(result.current.library).toHaveLength(2);
    });
  });

  it("toasts when library load fails", async () => {
    invoke.mockRejectedValueOnce(new Error("db down"));
    const { result } = renderHook(() => useAppContext(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoadingLibrary).toBe(false);
    });
    expect(toast.error).toHaveBeenCalledWith("Failed to load books");
  });

  it("saves prior book audio before switching books", async () => {
    const { result } = renderHook(() => useAppContext(), { wrapper });

    await waitFor(() => {
      expect(result.current.library.length).toBeGreaterThan(0);
    });

    const first = createBook({ id: "book-1" });
    const second = createBook({ id: "book-2", title: "Two" });

    await act(async () => {
      await result.current.setCurrentBookWithLoading(first, false);
    });
    expect(deps.loadLastOpenedChapter).toHaveBeenCalledWith(first);
    expect(deps.loadLastOpenedAudioTrack).toHaveBeenCalledWith(first, false);

    await act(async () => {
      await result.current.setCurrentBookWithLoading(second, true);
    });

    expect(deps.saveAudioProgress).toHaveBeenCalledWith(first);
    expect(deps.loadLastOpenedAudioTrack).toHaveBeenCalledWith(second, true);
    expect(result.current.currentBook?.id).toBe("book-2");
  });

  it("persists progress into the library when changing tabs", async () => {
    const { result } = renderHook(() => useAppContext(), { wrapper });

    await waitFor(() => {
      expect(result.current.library.length).toBeGreaterThan(0);
    });

    const book = createBook();
    await act(async () => {
      await result.current.setCurrentBookWithLoading(book, false);
    });

    act(() => {
      result.current.setCurrentTab("reader");
    });

    expect(deps.saveChapterProgress).toHaveBeenCalledWith(book);
    expect(deps.saveAudioProgress).toHaveBeenCalledWith(book);
    expect(result.current.currentTab).toBe("reader");
    expect(result.current.currentBook).toMatchObject({
      id: "book-1",
      progress: expect.objectContaining({ bookProgressPercent: 10 }),
      audioState: expect.objectContaining({ currentTrackId: "t1" }),
    });
    expect(result.current.library[0]).toMatchObject({
      id: "book-1",
      progress: expect.objectContaining({ bookProgressPercent: 10 }),
      audioState: expect.objectContaining({ currentTrackId: "t1" }),
    });
  });
});
