import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import { FloatingAudioPlayer } from "./FloatingAudioPlayer";
import type { AudioTrack, Book } from "../../types/book";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

const loadAudioTrack = vi.fn(async () => undefined);
const restoreAudioProgress = vi.fn();
const loadChapterContent = vi.fn(async () => undefined);
const setCurrentAudioTrack = vi.fn();
const calculateAudioProgress = vi.fn(() => null);
const saveAudioProgress = vi.fn(async () => undefined);
const closeAudioPlayer = vi.fn(async () => undefined);
const queueLivePlaybackRequest = vi.fn();
const registerCallbacks = vi.fn(() => () => undefined);
const refreshCurrentConvertingChapter = vi.fn(async () => null);
const getCurrentConvertingChapter = vi.fn(() => 1);

const state: {
  currentBook: Book | null;
  currentAudioTrack: (AudioTrack & {
    isLiveStream?: boolean;
    liveChapterIndex?: number;
  }) | null;
  isLoadingAudio: boolean;
  setCurrentBook: (book: Book | null) => void;
  setLibrary: (books: Book[]) => void;
} = {
  currentBook: null,
  currentAudioTrack: null,
  isLoadingAudio: false,
  setCurrentBook: vi.fn(),
  setLibrary: vi.fn(),
};

vi.mock("@/context/AppContext", () => ({
  useAppContext: () => ({
    currentBook: state.currentBook,
    setCurrentBook: state.setCurrentBook,
    library: state.currentBook ? [state.currentBook] : [],
    setLibrary: state.setLibrary,
  }),
}));

vi.mock("@/context/AudioProgressContext", () => ({
  useAudioProgressContext: () => ({
    currentAudioTrack: state.currentAudioTrack,
    setCurrentAudioTrack,
    isLoadingAudio: state.isLoadingAudio,
    audioRef: { current: document.createElement("audio") },
    loadAudioTrack,
    restoreAudioProgress,
    calculateAudioProgress,
    saveAudioProgress,
    closeAudioPlayer,
    queueLivePlaybackRequest,
    livePlaybackRequestRef: { current: { resumeTime: 0, autoPlay: false } },
    livePlaybackRequestVersion: 0,
    playbackRate: 1,
    setPlaybackRate: vi.fn(),
  }),
}));

vi.mock("@/context/ChapterProgressContext", () => ({
  useChapterProgressContext: () => ({
    loadChapterContent,
  }),
}));

vi.mock("@/context/ConversionStateContext", () => ({
  useConversionState: () => ({
    isConverting: true,
    convertingBookId: "book-1",
    getCurrentConvertingChapter,
    refreshCurrentConvertingChapter,
    registerCallbacks,
  }),
}));

vi.mock("@/context/AudioSyncContext", () => ({
  useAudioSyncContext: () => ({
    isSyncEnabled: false,
    toggleSync: vi.fn(),
  }),
}));

vi.mock("./AudioTracksDrawer", () => ({
  AudioTracksDrawer: () => null,
  AudioTracksButton: () => null,
}));

function createLiveBook(overrides: Partial<Book> = {}): Book {
  return {
    id: "book-1",
    title: "Live Book",
    author: "Author",
    chapters: [
      {
        id: "ch-1",
        bookId: "book-1",
        title: "One",
        href: "Text/ch1.xhtml",
        chapterOrder: 0,
      },
      {
        id: "ch-2",
        bookId: "book-1",
        title: "Two",
        href: "Text/ch2.xhtml",
        chapterOrder: 1,
      },
    ],
    sourcePath: "/tmp/a.epub",
    audioTracks: [],
    conversionStatus: "started",
    completedChapters: [],
    ...overrides,
  };
}

function Wrapper({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

describe("FloatingAudioPlayer live → completed handoff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.isLoadingAudio = false;
    state.currentBook = createLiveBook();
    state.currentAudioTrack = {
      id: "live-book-1-1",
      bookId: "book-1",
      chapterHref: "Text/ch2.xhtml",
      filePath: "Text/ch2.xhtml",
      href: "Text/ch2.xhtml",
      title: "Two",
      order: 1,
      isLiveStream: true,
      liveChapterIndex: 1,
    };
    getCurrentConvertingChapter.mockReturnValue(1);
  });

  it("switches from the live track to the completed library track and restores progress", async () => {
    const { rerender } = render(
      <Wrapper>
        <FloatingAudioPlayer />
      </Wrapper>
    );

    await waitFor(() => {
      expect(
        document.querySelector('[data-testid="floating-audio-player"]')
      ).toBeTruthy();
    });

    const completedTrack: AudioTrack = {
      id: "track-ch2",
      bookId: "book-1",
      chapterHref: "Text/ch2.xhtml",
      filePath: "Audio/ch2.mp3",
      href: "Audio/ch2.mp3",
      title: "Two",
      order: 1,
      duration: 40,
    };

    state.currentBook = createLiveBook({
      completedChapters: ["Text/ch2.xhtml"],
      audioTracks: [completedTrack],
      conversionStatus: "started",
    });

    await act(async () => {
      rerender(
        <Wrapper>
          <FloatingAudioPlayer />
        </Wrapper>
      );
    });

    await waitFor(() => {
      expect(loadAudioTrack).toHaveBeenCalledWith(
        "book-1",
        expect.objectContaining({ id: "track-ch2" }),
        expect.objectContaining({ id: "book-1" })
      );
    });

    expect(restoreAudioProgress).toHaveBeenCalledWith(
      expect.objectContaining({ id: "book-1" }),
      expect.objectContaining({ id: "track-ch2" }),
      expect.any(Boolean)
    );
    expect(loadChapterContent).toHaveBeenCalledWith(
      "book-1",
      expect.objectContaining({ href: "Text/ch2.xhtml" })
    );
  });

  it("disables play controls and shows spinner while audio is loading", async () => {
    state.isLoadingAudio = true;
    render(
      <Wrapper>
        <FloatingAudioPlayer />
      </Wrapper>
    );

    await waitFor(() => {
      expect(
        document.querySelector('[data-testid="floating-audio-player"]')
      ).toBeTruthy();
    });

    const player = document.querySelector(
      '[data-testid="floating-audio-player"]'
    ) as HTMLElement;
    const playPause = document.querySelector(
      '[data-testid="audio-play-pause"]'
    ) as HTMLButtonElement;
    const spinner = document.querySelector(
      '[data-testid="audio-loading-spinner"]'
    );

    expect(player.getAttribute("data-loading-audio")).toBe("true");
    expect(Boolean(spinner)).toBe(true);
    expect(playPause.disabled).toBe(true);
  });
});
