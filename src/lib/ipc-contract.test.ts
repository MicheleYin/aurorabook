import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  normalizeBook,
  normalizeChapterWithContent,
} from "./normalize-book";
import type { Book, ChapterWithContent } from "../types/book";

const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../tests/fixtures/ipc"
);

function loadFixture<T>(name: string): T {
  const raw = readFileSync(path.join(fixturesDir, name), "utf8");
  return JSON.parse(raw) as T;
}

describe("IPC wire fixtures (frontend contract)", () => {
  it("accepts Rust-shaped Book JSON after normalizeBook", () => {
    const wire = loadFixture<Book>("book.wire.json");
    const book = normalizeBook(wire);

    expect(book.id).toBe("book-e2e-001");
    expect(book.chapters).toHaveLength(2);
    expect(book.chapters[0].chapterOrder).toBe(0);
    expect(book.chapters[1].chapterOrder).toBe(1);
    expect(book.audioTracks[0].filePath).toBe("Audio/chap1.mp3");
    expect(book.audioTracks[0].href).toBe("Audio/chap1.mp3");
    expect(book.progress?.currentChapterId).toBe("ch-1");
    expect(book.audioState?.currentTrackId).toBe("track-1");
    expect(book.conversionStatus).toBe("done");
  });

  it("accepts chapter content payload", () => {
    const wire = loadFixture<ChapterWithContent>("chapter-content.wire.json");
    const chapter = normalizeChapterWithContent(wire);

    expect(chapter.chapterOrder).toBe(0);
    expect(chapter.contentHtml).toContain("engines hummed");
  });

  it("rejects empty book id in fixture (sanity)", () => {
    const wire = loadFixture<Book>("book.wire.json");
    expect(wire.id.length).toBeGreaterThan(0);
    expect(wire.chapters.every((c) => c.href.length > 0)).toBe(true);
  });
});
