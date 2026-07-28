import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRef } from "react";

import { useAudioTextSync } from "./useAudioTextSync";
import type { Book, Chapter } from "../types/book";
import { HIGHLIGHT_ACTIVE_CLASS, HIGHLIGHT_CLASS } from "../lib/audio-sync-utils";
import { invoke } from "../test/tauri-mocks";

const loadChapterContent = vi.fn(async () => undefined);

const audioRef = { current: null as HTMLAudioElement | null };
let currentAudioTrack: {
  id: string;
  bookId: string;
  chapterHref: string;
  filePath: string;
  href: string;
  title: string;
  order: number;
  duration: number;
  mimeType: string;
  isLiveStream?: boolean;
  liveChapterIndex?: number;
} = {
  id: "track-1",
  bookId: "book-1",
  chapterHref: "ch1.xhtml",
  filePath: "audio/01.mp3",
  href: "audio/01.mp3",
  title: "Intro",
  order: 0,
  duration: 120,
  mimeType: "audio/mpeg",
};

let isSyncEnabled = true;
let currentChapter: Chapter = {
  id: "ch-1",
  bookId: "book-1",
  title: "Chapter 1",
  href: "ch1.xhtml",
  chapterOrder: 0,
};

vi.mock("../context/AudioProgressContext", () => ({
  useAudioProgressContext: () => ({
    audioRef,
    currentAudioTrack,
  }),
}));

vi.mock("../context/AudioSyncContext", () => ({
  useAudioSyncContext: () => ({
    isSyncEnabled,
    toggleSync: vi.fn(),
  }),
}));

vi.mock("../context/ChapterProgressContext", () => ({
  useChapterProgressContext: () => ({
    currentChapter,
    loadChapterContent,
  }),
}));

function createBook(): Book {
  return {
    id: "book-1",
    title: "Test Book",
    author: "Author",
    chapters: [currentChapter],
    sourcePath: "/tmp/book.epub",
    audioTracks: [currentAudioTrack],
    conversionStatus: "done",
    completedChapters: [],
    audioSyncMap: {
      segments: [
        {
          textElementId: "w1",
          chapterHref: "ch1.xhtml",
          audioTrackHref: "audio/01.mp3",
          clipBegin: 0,
          clipEnd: 5,
        },
        {
          textElementId: "w2",
          chapterHref: "ch1.xhtml",
          audioTrackHref: "audio/01.mp3",
          clipBegin: 5,
          clipEnd: 10,
        },
      ],
    },
  };
}

function mountReaderDom() {
  const scrollContainer = document.createElement("div");
  Object.defineProperties(scrollContainer, {
    scrollTop: { configurable: true, writable: true, value: 0 },
    scrollHeight: { configurable: true, value: 1000 },
    offsetTop: { configurable: true, value: 0 },
  });
  scrollContainer.getBoundingClientRect = () =>
    ({
      top: 0,
      bottom: 500,
      left: 0,
      right: 300,
      width: 300,
      height: 500,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;

  const prose = document.createElement("div");
  prose.className = "prose";
  const span1 = document.createElement("span");
  span1.id = "w1";
  span1.textContent = "Hello";
  span1.getBoundingClientRect = () =>
    ({
      top: 200,
      bottom: 220,
      left: 10,
      right: 100,
      width: 90,
      height: 20,
      x: 10,
      y: 200,
      toJSON: () => ({}),
    }) as DOMRect;
  Object.defineProperty(span1, "offsetTop", { value: 200 });

  const span2 = document.createElement("span");
  span2.id = "w2";
  span2.textContent = "World";
  span2.getBoundingClientRect = () =>
    ({
      top: 600,
      bottom: 620,
      left: 10,
      right: 100,
      width: 90,
      height: 20,
      x: 10,
      y: 600,
      toJSON: () => ({}),
    }) as DOMRect;
  Object.defineProperty(span2, "offsetTop", { value: 600 });

  prose.append(span1, span2);
  scrollContainer.appendChild(prose);
  document.body.appendChild(scrollContainer);

  const audio = document.createElement("audio");
  Object.defineProperty(audio, "currentTime", {
    configurable: true,
    writable: true,
    value: 0,
  });
  audioRef.current = audio;

  return { scrollContainer, span1, span2, audio };
}

describe("useAudioTextSync", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    isSyncEnabled = true;
    loadChapterContent.mockClear();
    currentAudioTrack = {
      id: "track-1",
      bookId: "book-1",
      chapterHref: "ch1.xhtml",
      filePath: "audio/01.mp3",
      href: "audio/01.mp3",
      title: "Intro",
      order: 0,
      duration: 120,
      mimeType: "audio/mpeg",
    };
    currentChapter = {
      id: "ch-1",
      bookId: "book-1",
      title: "Chapter 1",
      href: "ch1.xhtml",
      chapterOrder: 0,
    };
  });

  afterEach(() => {
    document.body.innerHTML = "";
    audioRef.current = null;
    vi.useRealTimers();
  });

  it("highlights the matching sync segment as audio time advances", () => {
    const { scrollContainer, span1 } = mountReaderDom();
    const book = createBook();

    const { result: refs } = renderHook(() => {
      const scrollContainerRef = useRef<HTMLDivElement | null>(scrollContainer);
      return { scrollContainerRef };
    });

    renderHook(() =>
      useAudioTextSync(book, refs.current.scrollContainerRef, undefined, true)
    );

    act(() => {
      if (audioRef.current) audioRef.current.currentTime = 1.0;
      vi.advanceTimersByTime(250);
    });

    expect(span1.classList.contains(HIGHLIGHT_CLASS)).toBe(true);
    expect(span1.classList.contains(HIGHLIGHT_ACTIVE_CLASS)).toBe(false);

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(span1.classList.contains(HIGHLIGHT_ACTIVE_CLASS)).toBe(true);
  });

  it("does not highlight when sync is disabled", () => {
    isSyncEnabled = false;
    const { scrollContainer, span1 } = mountReaderDom();
    const book = createBook();

    const { result: refs } = renderHook(() => {
      const scrollContainerRef = useRef<HTMLDivElement | null>(scrollContainer);
      return { scrollContainerRef };
    });

    renderHook(() =>
      useAudioTextSync(book, refs.current.scrollContainerRef, undefined, true)
    );

    act(() => {
      if (audioRef.current) audioRef.current.currentTime = 1.0;
      vi.advanceTimersByTime(250);
    });

    expect(span1.classList.contains(HIGHLIGHT_CLASS)).toBe(false);
  });

  it("requests a chapter load when the segment points at another chapter", () => {
    const { scrollContainer } = mountReaderDom();
    const book = createBook();
    book.audioSyncMap!.segments[0] = {
      textElementId: "w1",
      chapterHref: "ch2.xhtml",
      audioTrackHref: "audio/01.mp3",
      clipBegin: 0,
      clipEnd: 5,
    };
    book.chapters.push({
      id: "ch-2",
      bookId: "book-1",
      title: "Chapter 2",
      href: "ch2.xhtml",
      chapterOrder: 1,
    });

    const { result: refs } = renderHook(() => {
      const scrollContainerRef = useRef<HTMLDivElement | null>(scrollContainer);
      return { scrollContainerRef };
    });

    renderHook(() =>
      useAudioTextSync(book, refs.current.scrollContainerRef, undefined, true)
    );

    act(() => {
      if (audioRef.current) audioRef.current.currentTime = 1.0;
      vi.advanceTimersByTime(250);
    });

    expect(loadChapterContent).toHaveBeenCalledWith(
      "book-1",
      expect.objectContaining({ href: "ch2.xhtml" })
    );
  });

  it("advances highlight to the next segment and scrolls when offscreen", () => {
    const { scrollContainer, span1, span2 } = mountReaderDom();
    scrollContainer.scrollTo = vi.fn();
    const book = createBook();

    const { result: refs } = renderHook(() => {
      const scrollContainerRef = useRef<HTMLDivElement | null>(scrollContainer);
      return { scrollContainerRef };
    });

    renderHook(() =>
      useAudioTextSync(book, refs.current.scrollContainerRef, undefined, true)
    );

    act(() => {
      if (audioRef.current) audioRef.current.currentTime = 1.0;
      vi.advanceTimersByTime(250);
    });
    expect(span1.classList.contains(HIGHLIGHT_CLASS)).toBe(true);

    act(() => {
      if (audioRef.current) audioRef.current.currentTime = 6.0;
      vi.advanceTimersByTime(250);
    });

    expect(span2.classList.contains(HIGHLIGHT_CLASS)).toBe(true);
    expect(scrollContainer.scrollTo).toHaveBeenCalled();
  });

  it("preserves scroll position when sync is toggled", () => {
    const { scrollContainer } = mountReaderDom();
    scrollContainer.scrollTop = 240;
    const book = createBook();

    const { result: refs } = renderHook(() => {
      const scrollContainerRef = useRef<HTMLDivElement | null>(scrollContainer);
      return { scrollContainerRef };
    });

    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => {
        isSyncEnabled = enabled;
        return useAudioTextSync(
          book,
          refs.current.scrollContainerRef,
          undefined,
          true
        );
      },
      { initialProps: { enabled: true } }
    );

    rerender({ enabled: false });
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(scrollContainer.scrollTop).toBe(240);
  });

  it("re-applies the active highlight when header visibility changes", () => {
    const { scrollContainer, span1 } = mountReaderDom();
    const book = createBook();

    const { result: refs } = renderHook(() => {
      const scrollContainerRef = useRef<HTMLDivElement | null>(scrollContainer);
      return { scrollContainerRef };
    });

    const { rerender } = renderHook(
      ({ headerVisible }: { headerVisible: boolean }) =>
        useAudioTextSync(
          book,
          refs.current.scrollContainerRef,
          undefined,
          headerVisible
        ),
      { initialProps: { headerVisible: true } }
    );

    act(() => {
      if (audioRef.current) audioRef.current.currentTime = 1.0;
      vi.advanceTimersByTime(250);
      vi.advanceTimersByTime(100);
    });
    expect(span1.classList.contains(HIGHLIGHT_ACTIVE_CLASS)).toBe(true);

    // Simulate a layout flash that clears highlight classes (e.g. header hide/show).
    span1.classList.remove(HIGHLIGHT_CLASS, HIGHLIGHT_ACTIVE_CLASS);

    rerender({ headerVisible: false });
    act(() => {
      vi.advanceTimersByTime(350);
    });

    expect(span1.classList.contains(HIGHLIGHT_CLASS)).toBe(true);
    expect(span1.classList.contains(HIGHLIGHT_ACTIVE_CLASS)).toBe(true);
  });

  it("polls live sync markers and highlights the returned element", async () => {
    currentAudioTrack = {
      ...currentAudioTrack,
      id: "live-book-1-0",
      href: "ch1.xhtml",
      filePath: "ch1.xhtml",
      isLiveStream: true,
      liveChapterIndex: 0,
    };

    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_live_sync_marker") {
        return {
          textElementId: "w2",
          chapterHref: "ch1.xhtml",
          sentenceIndex: 1,
        };
      }
      throw new Error(`Unexpected invoke: ${cmd}`);
    });

    const { scrollContainer, span2 } = mountReaderDom();
    Object.defineProperty(scrollContainer, "scrollTo", {
      configurable: true,
      value: vi.fn(),
    });
    const book = createBook();
    book.audioSyncMap = { segments: [] };

    const { result: refs } = renderHook(() => {
      const scrollContainerRef = useRef<HTMLDivElement | null>(scrollContainer);
      return { scrollContainerRef };
    });

    renderHook(() =>
      useAudioTextSync(book, refs.current.scrollContainerRef, undefined, true)
    );

    await act(async () => {
      if (audioRef.current) audioRef.current.currentTime = 1.5;
      vi.advanceTimersByTime(250);
      await Promise.resolve();
      await Promise.resolve();
      vi.advanceTimersByTime(250);
    });

    expect(invoke).toHaveBeenCalledWith(
      "get_live_sync_marker",
      expect.objectContaining({
        bookId: "book-1",
        chapterIndex: 0,
        currentTimeSeconds: 1.5,
      })
    );

    await act(async () => {
      if (audioRef.current) audioRef.current.currentTime = 1.7;
      vi.advanceTimersByTime(250);
      await Promise.resolve();
      await Promise.resolve();
      vi.advanceTimersByTime(100);
    });

    expect(span2.classList.contains(HIGHLIGHT_CLASS)).toBe(true);
  });
});
