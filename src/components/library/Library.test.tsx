import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Library } from "./Library";
import type { Book } from "../../types/book";

const appState = {
  isLoadingLibrary: false,
  library: [] as Book[],
  currentBook: null as Book | null,
};

const conversionState = {
  convertingBookId: null as string | null,
  conversionProgress: null as null | {
    currentChapter: number;
    totalChapters: number;
    wordsProcessed: number;
    totalWords: number;
    wordsInCurrentChapter: number;
    currentStep: string;
    message: string;
  },
  eta: null as string | null,
  convertBook: vi.fn(),
  cancelConversion: vi.fn(),
  registerCallbacks: vi.fn(() => () => undefined),
};

vi.mock("../../context/AppContext", () => ({
  useAppContext: () => ({
    library: appState.library,
    setLibrary: vi.fn(),
    isLoadingLibrary: appState.isLoadingLibrary,
    setCurrentBookWithLoading: vi.fn(),
    currentBook: appState.currentBook,
    setCurrentBook: vi.fn(),
    setCurrentTab: vi.fn(),
  }),
}));

vi.mock("../../context/SettingsContext", () => ({
  useSettingsContext: () => ({
    settings: {
      theme: "system",
      language: "en",
      ttsLanguage: "en",
      ttsVoiceId: "F1",
      libraryViewMode: "grid",
    },
    saveSettings: vi.fn(),
  }),
}));

vi.mock("../../hooks/useBookConversion", () => ({
  useBookConversion: () => conversionState,
}));

vi.mock("@/context/AudioProgressContext", () => ({
  useAudioProgressContext: () => ({
    closeAudioPlayer: vi.fn(),
  }),
}));

vi.mock("../../hooks/useUnfinishedChapterDuration", () => ({
  useUnfinishedChapterDuration: () => 0,
}));

vi.mock("./BookDetailDialog", () => ({
  BookDetailDialog: () => null,
}));

function createBook(overrides: Partial<Book> = {}): Book {
  return {
    id: "book-1",
    title: "Voyage",
    author: "Ada",
    chapters: [
      {
        id: "ch-1",
        bookId: "book-1",
        title: "One",
        href: "ch1.xhtml",
        chapterOrder: 0,
      },
    ],
    sourcePath: "/tmp/a.epub",
    audioTracks: [],
    conversionStatus: "started",
    completedChapters: [],
    progress: {
      currentChapterId: "ch-1",
      currentChapterHref: "ch1.xhtml",
      currentChapterIndex: 0,
      currentChapterScrollTop: 0,
      currentChapterScrollHeight: 100,
      currentChapterClientHeight: 50,
      chapterProgressPercent: 0,
      bookProgressPercent: 5,
      updatedAt: new Date().toISOString(),
    },
    ...overrides,
  };
}

describe("Library UI states", () => {
  beforeEach(() => {
    appState.isLoadingLibrary = false;
    appState.library = [createBook()];
    appState.currentBook = null;
    conversionState.convertingBookId = null;
    conversionState.conversionProgress = null;
    conversionState.eta = null;
  });

  it("shows the library loading indicator", () => {
    appState.isLoadingLibrary = true;
    render(<Library />);
    expect(screen.getByTestId("library-loading")).toBeInTheDocument();
    expect(screen.getByText("Loading library...")).toBeInTheDocument();
  });

  it("shows conversion progress on the active book card", () => {
    conversionState.convertingBookId = "book-1";
    conversionState.conversionProgress = {
      currentChapter: 1,
      totalChapters: 2,
      wordsProcessed: 40,
      totalWords: 200,
      wordsInCurrentChapter: 40,
      currentStep: "tts",
      message: "Synthesizing chapter 1",
    };
    conversionState.eta = "2 minutes";

    render(<Library />);

    expect(
      screen.getByTestId("library-conversion-progress-book-1")
    ).toBeInTheDocument();
    expect(screen.getByText("Synthesizing chapter 1")).toBeInTheDocument();
    expect(screen.getByText(/ETA: 2 minutes/)).toBeInTheDocument();
  });
});
