import { describe, expect, it } from "vitest";

import type { AudioTrack, Book, Chapter } from "../types/book";
import {
  audioTrackChapterIndex,
  completedAudioChapterIndices,
  resolveUnfinishedChapterIndex,
  sumAudioTrackDurationSeconds,
  totalBookAudioDurationSeconds,
} from "./book-audio-duration";

function createChapter(index: number): Chapter {
  return {
    id: `c${index}`,
    bookId: "book-1",
    title: `Chapter ${index + 1}`,
    href: `ch${index + 1}.xhtml`,
    chapterOrder: index,
  };
}

function createTrack(
  index: number,
  overrides: Partial<AudioTrack> = {}
): AudioTrack {
  return {
    id: `t${index}`,
    bookId: "book-1",
    chapterHref: `ch${index + 1}.xhtml`,
    filePath: `audio/${index}.mp3`,
    href: `audio/${index}.mp3`,
    title: `Chapter ${index + 1}`,
    duration: 60,
    order: index,
    ...overrides,
  };
}

function createBook(overrides: Partial<Book> = {}): Book {
  return {
    id: "book-1",
    title: "Title",
    author: "Author",
    sourcePath: "/tmp/book.epub",
    chapters: [createChapter(0), createChapter(1), createChapter(2)],
    audioTracks: [createTrack(0)],
    conversionStatus: "started",
    completedChapters: ["ch1.xhtml"],
    ...overrides,
  };
}

describe("audioTrackChapterIndex", () => {
  it("uses the audio sync map when a segment matches the track href", () => {
    const book = createBook({
      audioSyncMap: {
        segments: [
          {
            textElementId: "p1",
            chapterHref: "ch2.xhtml",
            audioTrackHref: "audio/0.mp3",
            clipBegin: 0,
            clipEnd: 10,
          },
        ],
      },
    });

    expect(audioTrackChapterIndex(book.audioTracks[0], book)).toBe(1);
  });

  it("falls back to track order when no sync map match exists", () => {
    const book = createBook();
    expect(audioTrackChapterIndex(book.audioTracks[0], book)).toBe(0);
  });
});

describe("completedAudioChapterIndices", () => {
  it("includes chapters from completed tracks and completedChapters", () => {
    const book = createBook({
      audioTracks: [createTrack(0)],
      completedChapters: ["ch1.xhtml", "ch2.xhtml"],
    });

    expect([...completedAudioChapterIndices(book)].sort()).toEqual([0, 1]);
  });
});

describe("resolveUnfinishedChapterIndex", () => {
  it("returns the converting chapter when it is not completed yet", () => {
    expect(resolveUnfinishedChapterIndex(createBook(), 1)).toBe(1);
  });

  it("skips a converting chapter that already has a completed track", () => {
    const book = createBook({
      audioTracks: [createTrack(0), createTrack(1)],
      completedChapters: ["ch1.xhtml", "ch2.xhtml"],
    });

    expect(resolveUnfinishedChapterIndex(book, 1)).toBe(2);
  });

  it("falls back to the first chapter without audio when converting is unknown", () => {
    expect(resolveUnfinishedChapterIndex(createBook(), null)).toBe(1);
  });

  it("returns null when every chapter is complete", () => {
    const book = createBook({
      audioTracks: [createTrack(0), createTrack(1), createTrack(2)],
      completedChapters: ["ch1.xhtml", "ch2.xhtml", "ch3.xhtml"],
      conversionStatus: "done",
    });

    expect(resolveUnfinishedChapterIndex(book, null)).toBeNull();
  });
});

describe("sumAudioTrackDurationSeconds", () => {
  it("sums positive finite track durations", () => {
    expect(
      sumAudioTrackDurationSeconds([
        createTrack(0, { duration: 120 }),
        createTrack(1, { duration: 15.5 }),
        createTrack(2, { duration: 0 }),
        createTrack(3, { duration: undefined }),
      ])
    ).toBe(135.5);
  });

  it("returns 0 for missing tracks", () => {
    expect(sumAudioTrackDurationSeconds(undefined)).toBe(0);
    expect(sumAudioTrackDurationSeconds([])).toBe(0);
  });
});

describe("totalBookAudioDurationSeconds", () => {
  it("adds unfinished live or paused chapter time to completed tracks", () => {
    expect(totalBookAudioDurationSeconds(120, 33)).toBe(153);
  });

  it("ignores missing or non-positive unfinished duration", () => {
    expect(totalBookAudioDurationSeconds(120, 0)).toBe(120);
    expect(totalBookAudioDurationSeconds(120, null)).toBe(120);
    expect(totalBookAudioDurationSeconds(0, 45)).toBe(45);
  });
});
