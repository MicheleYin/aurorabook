import { describe, expect, it } from "vitest";

import {
  normalizeAudioTrack,
  normalizeBook,
  normalizeChapter,
  normalizeBooks,
} from "./normalize-book";

describe("normalizeChapter", () => {
  it("prefers chapterOrder when both fields exist", () => {
    expect(
      normalizeChapter({
        id: "c1",
        title: "T",
        href: "a.xhtml",
        chapterOrder: 2,
        order: 9,
      } as never).chapterOrder
    ).toBe(2);
  });

  it("falls back to wire `order` (legacy Rust field name)", () => {
    expect(
      normalizeChapter({
        id: "c1",
        title: "T",
        href: "a.xhtml",
        order: 3,
      } as never).chapterOrder
    ).toBe(3);
  });
});

describe("normalizeAudioTrack", () => {
  it("fills filePath from href when filePath is missing", () => {
    const track = normalizeAudioTrack(
      {
        id: "t1",
        href: "Audio/a.mp3",
        order: 0,
        title: "A",
      } as never,
      "book-1"
    );
    expect(track.filePath).toBe("Audio/a.mp3");
    expect(track.href).toBe("Audio/a.mp3");
    expect(track.bookId).toBe("book-1");
  });
});

describe("normalizeBook", () => {
  it("normalizes nested chapters and tracks", () => {
    const book = normalizeBook({
      id: "b1",
      title: "Book",
      author: "Author",
      sourcePath: "/tmp/b.epub",
      chapters: [
        {
          id: "c1",
          title: "One",
          href: "1.xhtml",
          order: 0,
        } as never,
      ],
      audioTracks: [
        {
          id: "t1",
          href: "a.mp3",
          order: 0,
        } as never,
      ],
      conversionStatus: "notStarted",
      completedChapters: [],
    });

    expect(book.chapters[0].chapterOrder).toBe(0);
    expect(book.chapters[0].bookId).toBe("b1");
    expect(book.audioTracks[0].filePath).toBe("a.mp3");
  });

  it("normalizeBooks handles nullish", () => {
    expect(normalizeBooks(null)).toEqual([]);
    expect(normalizeBooks(undefined)).toEqual([]);
  });
});
