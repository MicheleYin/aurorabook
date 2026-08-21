import type {
  AudioTrack,
  Book,
  Chapter,
  ChapterWithContent,
} from "../types/book";

/**
 * Wire-format chapter may use `order` (legacy Rust) or `chapterOrder` (current).
 * Normalize to the frontend `Chapter` shape.
 */
export function normalizeChapter(
  raw: Partial<Chapter> & { order?: number; bookId?: string }
): Chapter {
  const chapterOrder =
    typeof raw.chapterOrder === "number"
      ? raw.chapterOrder
      : typeof raw.order === "number"
        ? raw.order
        : 0;

  return {
    id: raw.id ?? "",
    bookId: raw.bookId ?? "",
    title: raw.title ?? "",
    href: raw.href ?? "",
    chapterOrder,
    wordCount: raw.wordCount,
    estimatedPageCount: raw.estimatedPageCount,
  };
}

export function normalizeChapterWithContent(
  raw: Partial<ChapterWithContent> & { order?: number; bookId?: string }
): ChapterWithContent {
  return {
    ...normalizeChapter(raw),
    contentHtml: raw.contentHtml,
  };
}

/**
 * Rust `AudioTrack` exposes `href`; the frontend historically used `filePath`.
 * Accept either and populate both for callers that still expect `filePath`.
 */
export function normalizeAudioTrack(
  raw: Partial<AudioTrack> & { bookId?: string },
  bookId?: string
): AudioTrack {
  const href = raw.href ?? raw.filePath ?? "";
  return {
    id: raw.id ?? "",
    bookId: raw.bookId ?? bookId ?? "",
    chapterHref: raw.chapterHref ?? "",
    filePath: raw.filePath ?? href,
    href,
    title: raw.title,
    duration: raw.duration,
    fileSizeBytes: raw.fileSizeBytes,
    order: typeof raw.order === "number" ? raw.order : 0,
  };
}

/** Normalize a book payload as returned by Tauri IPC into frontend types. */
export function normalizeBook(raw: Book): Book {
  const id = raw.id ?? "";
  return {
    ...raw,
    chapters: (raw.chapters ?? []).map((chapter) =>
      normalizeChapter({ ...chapter, bookId: id })
    ),
    audioTracks: (raw.audioTracks ?? []).map((track) =>
      normalizeAudioTrack(track, id)
    ),
    completedChapters: raw.completedChapters ?? [],
    conversionStatus: raw.conversionStatus ?? "notStarted",
  };
}

export function normalizeBooks(raw: Book[] | null | undefined): Book[] {
  if (!raw) return [];
  return raw.map(normalizeBook);
}
