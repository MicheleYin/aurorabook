import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Book, ChapterWithContent } from "../../types/book";
import { ReaderContent } from "./ReaderContent";

vi.mock("../../context/AudioProgressContext", () => ({
  useAudioProgressContext: () => ({ currentAudioTrack: null }),
}));

vi.mock("../../hooks/useAudioTextSync", () => ({
  useAudioTextSync: () => ({ beginChromeToggle: vi.fn() }),
}));

vi.mock("../../hooks/useReaderDictionary", () => ({
  useReaderDictionary: () => ({
    dictionary: null,
    close: vi.fn(),
    consumeChromeToggleSuppression: () => false,
  }),
}));

vi.mock("../app/LoadingScreen", () => ({ LoadingScreen: () => null }));
vi.mock("./ReaderDictionaryCard", () => ({ ReaderDictionaryCard: () => null }));

describe("ReaderContent", () => {
  it("mounts the unchanged chapter after the loading screen is dismissed", () => {
    const currentChapter = {
      id: "chapter-1",
      bookId: "book-1",
      title: "Chapter 1",
      href: "chapter-1.xhtml",
      chapterOrder: 0,
      contentHtml: '<p id="chapter-reopen-marker">Chapter text</p>',
    } as ChapterWithContent;
    const book = {
      id: "book-1",
      chapters: [currentChapter],
    } as Book;
    const props = {
      book,
      currentChapter,
      onRestoreProgress: vi.fn(),
      headerRef: undefined,
    };

    const { container, rerender } = render(
      <ReaderContent {...props} isLoading />
    );
    rerender(<ReaderContent {...props} isLoading={false} />);

    const host = container.querySelector(
      ".reader-chapter-shadow-host"
    ) as HTMLDivElement | null;
    expect(
      host?.shadowRoot?.querySelector("#chapter-reopen-marker")?.textContent
    ).toBe("Chapter text");
  });
});
