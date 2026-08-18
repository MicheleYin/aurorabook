import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRef } from "react";

import { useAudioTextSync } from "./useAudioTextSync";
import type { Book, Chapter } from "../types/book";
import { HIGHLIGHT_ACTIVE_CLASS, HIGHLIGHT_CLASS, HIGHLIGHT_WORD_CLASS, AUTO_SCROLL_RESUME_MS } from "../lib/audio-sync-utils";
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

function seekAudio(audio: HTMLAudioElement, time: number, emitSeeked = true) {
  audio.currentTime = time;
  audio.dispatchEvent(new Event("seeking"));
  if (emitSeeked) {
    audio.dispatchEvent(new Event("seeked"));
  }
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
      seekAudio(audioRef.current as HTMLAudioElement, 1.0);
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
      seekAudio(audioRef.current as HTMLAudioElement, 1.0);
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
      seekAudio(audioRef.current as HTMLAudioElement, 1.0);
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
      seekAudio(audioRef.current as HTMLAudioElement, 1.0);
    });
    expect(span1.classList.contains(HIGHLIGHT_CLASS)).toBe(true);

    act(() => {
      seekAudio(audioRef.current as HTMLAudioElement, 6.0);
    });

    expect(span2.classList.contains(HIGHLIGHT_CLASS)).toBe(true);
    expect(scrollContainer.scrollTo).toHaveBeenCalled();
  });

  it("lets the user scroll and resumes follow-scroll after idle", () => {
    const { scrollContainer, span2 } = mountReaderDom();
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
      scrollContainer.dispatchEvent(new Event("wheel", { bubbles: true }));
      seekAudio(audioRef.current as HTMLAudioElement, 6.0);
    });

    expect(span2.classList.contains(HIGHLIGHT_CLASS)).toBe(true);
    expect(scrollContainer.scrollTo).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(AUTO_SCROLL_RESUME_MS);
    });

    expect(scrollContainer.scrollTo).toHaveBeenCalled();
  });

  it("does not follow-scroll while the pointer is selecting text", () => {
    const { scrollContainer, span2 } = mountReaderDom();
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
      scrollContainer.dispatchEvent(
        new PointerEvent("pointerdown", { button: 0, bubbles: true })
      );
      seekAudio(audioRef.current as HTMLAudioElement, 6.0);
    });

    expect(span2.classList.contains(HIGHLIGHT_CLASS)).toBe(true);
    expect(scrollContainer.scrollTo).not.toHaveBeenCalled();
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
      seekAudio(audioRef.current as HTMLAudioElement, 1.0);
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

  it("does not follow-scroll when the reader header is toggled", () => {
    const { scrollContainer, span2 } = mountReaderDom();
    scrollContainer.scrollTo = vi.fn();
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
      seekAudio(audioRef.current as HTMLAudioElement, 6.0);
    });
    expect(span2.classList.contains(HIGHLIGHT_CLASS)).toBe(true);
    expect(scrollContainer.scrollTo).toHaveBeenCalled();
    vi.mocked(scrollContainer.scrollTo).mockClear();

    rerender({ headerVisible: false });
    act(() => {
      scrollContainer.dispatchEvent(new Event("scroll"));
      vi.advanceTimersByTime(AUTO_SCROLL_RESUME_MS);
    });

    expect(scrollContainer.scrollTo).not.toHaveBeenCalled();
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
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      vi.advanceTimersByTime(250);
      seekAudio(audioRef.current as HTMLAudioElement, 1.5);
      await Promise.resolve();
      await Promise.resolve();
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
      vi.advanceTimersByTime(250);
      seekAudio(audioRef.current as HTMLAudioElement, 1.7);
      await Promise.resolve();
      await Promise.resolve();
      vi.advanceTimersByTime(100);
    });

    expect(span2.classList.contains(HIGHLIGHT_CLASS)).toBe(true);
  });

  it("highlights the spoken word while live streaming from clock time", async () => {
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
          textElementId: "f000001",
          chapterHref: "ch1.xhtml",
          sentenceIndex: 0,
          clipBegin: 0,
          clipEnd: 2,
          currentWordIndex: 0,
          sentenceText: "Hello world this is spoken",
          wordAlignments: [
            { word: "Hello", startSec: 0, endSec: 0.4 },
            { word: "world", startSec: 0.4, endSec: 0.8 },
            { word: "this", startSec: 0.8, endSec: 1.2 },
            { word: "is", startSec: 1.2, endSec: 1.5 },
            { word: "spoken", startSec: 1.5, endSec: 2 },
          ],
        };
      }
      throw new Error(`Unexpected invoke: ${cmd}`);
    });

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
    scrollContainer.scrollTo = vi.fn();

    const prose = document.createElement("div");
    prose.className = "prose";
    const paragraph = document.createElement("p");
    paragraph.textContent =
      "Once upon a time Hello world this is spoken and then more.";
    paragraph.getBoundingClientRect = () =>
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
    Object.defineProperty(paragraph, "offsetTop", { value: 200 });
    prose.appendChild(paragraph);
    scrollContainer.appendChild(prose);
    document.body.appendChild(scrollContainer);

    const audio = document.createElement("audio");
    Object.defineProperty(audio, "currentTime", {
      configurable: true,
      writable: true,
      value: 0,
    });
    audioRef.current = audio;

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
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      vi.advanceTimersByTime(250);
      seekAudio(audio, 1.35);
      await Promise.resolve();
      await Promise.resolve();
      vi.advanceTimersByTime(100);
    });

    expect(paragraph.classList.contains(HIGHLIGHT_CLASS)).toBe(true);
    expect(
      paragraph
        .querySelector('[data-sync-word="3"]')
        ?.classList.contains(HIGHLIGHT_WORD_CLASS)
    ).toBe(true);
    expect(
      paragraph.querySelector('[data-sync-word="0"]')?.classList.contains(
        HIGHLIGHT_WORD_CLASS
      )
    ).toBe(false);
  });

  it("updates highlight immediately while scrubbing without autoscroll", () => {
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
      seekAudio(audioRef.current as HTMLAudioElement, 6.0, false);
    });

    expect(span2.classList.contains(HIGHLIGHT_CLASS)).toBe(true);
    expect(scrollContainer.scrollTo).not.toHaveBeenCalled();
  });
});
