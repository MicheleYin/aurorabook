import { useCallback, useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { isIOS } from "../lib/is-tauri";
import {
  readAllBooks,
  addBook,
  type LibraryFilter,
} from "../lib/book-service";

import type {
  Book,
  BookAudioState,
  BookProgress,
} from "../types/reader";
import {
  estimatePagesFromWords,
  getChapterPageCount,
  getChapterWordCount,
} from "../lib/utils";


type IngestParams = {
  filePath: string;
  sourcePath: string;
  fallbackTitle?: string;
  progress?: BookProgress;
  pageCountHint?: number;
  audioState?: BookAudioState;
};

type PersistentLibrary = {
  library: Book[];
  setLibrary: React.Dispatch<React.SetStateAction<Book[]>>;
  isHydrated: boolean;
  isImporting: boolean;
  importFromDialog: () => Promise<boolean | { book: Book; buffer: ArrayBuffer }>;
  ingestEpub: (params: IngestParams) => Promise<Book | null>;
  refreshLibrary: (filter?: LibraryFilter) => Promise<void>;
};


const applyDerivedFields = (book: Book): Book => {
  let chaptersChanged = false;

  const normalizedChapters = book.chapters.map((chapter) => {
    const normalizedWordCount = getChapterWordCount(chapter);
    const normalizedPageCount = getChapterPageCount({
      ...chapter,
      wordCount: normalizedWordCount,
    });

    const needsWordCountUpdate =
      typeof chapter.wordCount !== "number" || chapter.wordCount !== normalizedWordCount;
    const needsPageCountUpdate =
      normalizedPageCount !== undefined && chapter.estimatedPageCount !== normalizedPageCount;

    if (!needsWordCountUpdate && !needsPageCountUpdate) {
      return chapter;
    }

    chaptersChanged = true;
    return {
      ...chapter,
      wordCount: normalizedWordCount,
      estimatedPageCount: normalizedPageCount ?? chapter.estimatedPageCount,
    };
  });

  const totalWords = normalizedChapters.reduce(
    (sum, chapter) => sum + getChapterWordCount(chapter),
    0,
  );
  const derivedPageCount = estimatePagesFromWords(totalWords);
  const normalizedPageCount =
    derivedPageCount !== undefined ? Math.max(1, Math.round(derivedPageCount)) : undefined;

  const existingPageCount =
    typeof book.pageCount === "number" && Number.isFinite(book.pageCount)
      ? Math.max(1, Math.round(book.pageCount))
      : undefined;
  const needsBookPageUpdate =
    normalizedPageCount !== undefined && normalizedPageCount !== existingPageCount;

  if (!chaptersChanged && !needsBookPageUpdate) {
    return book;
  }

  const nextBook: Book = {
    ...book,
    chapters: chaptersChanged ? normalizedChapters : book.chapters,
  };

  if (normalizedPageCount !== undefined) {
    nextBook.pageCount = normalizedPageCount;
  }

  return nextBook;
};

type LegacyProgressFields = {
  currentChapterPageIndex?: number;
  currentChapterPageCount?: number;
};

const LIBRARY_LOG_PREFIX = "[LibraryPersistence]";

const normalizeBookProgressShape = (book: Book): Book => {
  if (!book.progress) {
    console.debug(`${LIBRARY_LOG_PREFIX} normalize skipped (no progress)`, {
      bookId: book.id,
      title: book.title,
    });
    return book;
  }

  const progress = book.progress as BookProgress & LegacyProgressFields;

  const normalizedIndex =
    typeof progress.currentChapterIndex === "number" && Number.isFinite(progress.currentChapterIndex)
      ? Math.max(Math.round(progress.currentChapterIndex), 0)
      : 0;

  const elementId =
    typeof progress.currentChapterElementId === "string" &&
    progress.currentChapterElementId.length > 0
      ? progress.currentChapterElementId
      : null;
  const elementIndex =
    typeof progress.currentChapterElementIndex === "number" &&
    Number.isFinite(progress.currentChapterElementIndex)
      ? Math.max(Math.round(progress.currentChapterElementIndex), 0)
      : null;

  const scrollTop =
    typeof progress.currentChapterScrollTop === "number" &&
    Number.isFinite(progress.currentChapterScrollTop)
      ? Math.max(progress.currentChapterScrollTop, 0)
      : 0;
  const scrollHeight =
    typeof progress.currentChapterScrollHeight === "number" &&
    Number.isFinite(progress.currentChapterScrollHeight)
      ? Math.max(progress.currentChapterScrollHeight, 0)
      : 0;
  const clientHeight =
    typeof progress.currentChapterClientHeight === "number" &&
    Number.isFinite(progress.currentChapterClientHeight)
      ? Math.max(progress.currentChapterClientHeight, 0)
      : 0;

  let percent =
    typeof progress.chapterProgressPercent === "number" && Number.isFinite(progress.chapterProgressPercent)
      ? progress.chapterProgressPercent
      : undefined;

  if (
    (percent === undefined || percent === 0) &&
    scrollHeight > 0 &&
    clientHeight >= 0 &&
    scrollTop > 0
  ) {
    const maxScroll = Math.max(scrollHeight - clientHeight, 0);
    if (maxScroll > 0) {
      percent = Math.min(Math.max(scrollTop / maxScroll, 0), 1);
    }
  }

  if (percent === undefined) {
    if (
      typeof progress.currentChapterPageIndex === "number" &&
      Number.isFinite(progress.currentChapterPageIndex) &&
      typeof progress.currentChapterPageCount === "number" &&
      Number.isFinite(progress.currentChapterPageCount) &&
      progress.currentChapterPageCount > 1
    ) {
      percent = Math.min(
        Math.max(
          Math.round(progress.currentChapterPageIndex) /
            Math.max(Math.round(progress.currentChapterPageCount) - 1, 1),
          0,
        ),
        1,
      );
    } else {
      percent = 0;
    }
  }

  const normalizedPercent = Number(Math.min(Math.max(percent ?? 0, 0), 1).toFixed(4));

  const normalizedBook = {
    ...book,
    progress: {
      currentChapterId: progress.currentChapterId,
      currentChapterHref: progress.currentChapterHref,
      currentChapterIndex: normalizedIndex,
      currentChapterElementId: elementId,
      currentChapterElementIndex: elementIndex,
      currentChapterScrollTop: scrollTop,
      currentChapterScrollHeight: scrollHeight,
      currentChapterClientHeight: clientHeight,
      chapterProgressPercent: normalizedPercent,
      updatedAt: progress.updatedAt ?? new Date().toISOString(),
    },
  };

  console.debug(`${LIBRARY_LOG_PREFIX} normalized progress`, {
    bookId: book.id,
    title: book.title,
    progress: normalizedBook.progress,
  });

  return normalizedBook;
};

export function usePersistentLibrary(): PersistentLibrary {
  const [library, setLibrary] = useState<Book[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  // Library is now managed by Rust backend - no need for local persistence
  // Updates are handled via Rust commands

  const refreshLibrary = useCallback(async (filter?: LibraryFilter) => {
    try {
      // Load books from Rust backend with optional filtering
      const books = await readAllBooks(filter);
      
      console.debug(`${LIBRARY_LOG_PREFIX} loaded books from Rust backend`, {
        bookCount: books.length,
        filter,
      });
      
      setLibrary(books);
    } catch (error) {
      console.warn("Reader library: failed to load books from Rust backend.", error);
    }
  }, []);

  const ingestEpub = useCallback(
    async ({
      filePath,
      sourcePath,
      progress: savedProgress,
      pageCountHint,
      audioState: savedAudioState,
    }: IngestParams) => {
      // Call Rust backend to ingest EPUB from file path
      const { ingestEpub: ingestEpubCommand } = await import("../lib/book-service");
      let book = await ingestEpubCommand(filePath, sourcePath);
      
      // Apply frontend-specific restoration (progress, audio state, etc.)
      if (savedProgress && book.chapters.length) {
        const maxIndex = book.chapters.length - 1;
        const storedIndex =
          typeof savedProgress.currentChapterIndex === "number"
            ? savedProgress.currentChapterIndex
            : 0;
        const normalizedIndex = Math.min(Math.max(storedIndex, 0), maxIndex);
        const candidateByHref = savedProgress.currentChapterHref
          ? book.chapters.find(
              (chapter) =>
                chapter.href === savedProgress.currentChapterHref ||
                chapter.href.split("#")[0] === savedProgress.currentChapterHref.split("#")[0],
            )
          : undefined;
        const resolvedChapter =
          candidateByHref ??
          book.chapters[normalizedIndex] ??
          book.chapters[Math.min(normalizedIndex, maxIndex)];

        if (resolvedChapter) {
          const resolvedIndex = book.chapters.findIndex(
            (chapter) => chapter.id === resolvedChapter.id,
          );
          const chapterIndex = resolvedIndex === -1 ? 0 : resolvedIndex;

          const storedScrollTop =
            typeof savedProgress.currentChapterScrollTop === "number" &&
            Number.isFinite(savedProgress.currentChapterScrollTop)
              ? Math.max(savedProgress.currentChapterScrollTop, 0)
              : 0;
          const storedScrollHeight =
            typeof savedProgress.currentChapterScrollHeight === "number" &&
            Number.isFinite(savedProgress.currentChapterScrollHeight)
              ? Math.max(savedProgress.currentChapterScrollHeight, 0)
              : 0;
          const storedClientHeight =
            typeof savedProgress.currentChapterClientHeight === "number" &&
            Number.isFinite(savedProgress.currentChapterClientHeight)
              ? Math.max(savedProgress.currentChapterClientHeight, 0)
              : 0;

          let percentSource =
            typeof savedProgress.chapterProgressPercent === "number" &&
            Number.isFinite(savedProgress.chapterProgressPercent)
              ? savedProgress.chapterProgressPercent
              : undefined;

          if (
            (percentSource === undefined || percentSource === 0) &&
            storedScrollHeight > 0 &&
            storedClientHeight >= 0 &&
            storedScrollTop > 0
          ) {
            const savedMaxScroll = Math.max(storedScrollHeight - storedClientHeight, 0);
            if (savedMaxScroll > 0) {
              percentSource = Math.min(Math.max(storedScrollTop / savedMaxScroll, 0), 1);
            }
          }

          if (percentSource === undefined) {
            percentSource = 0;
          }

          book = {
            ...book,
            progress: {
              currentChapterId: resolvedChapter.id,
              currentChapterHref: resolvedChapter.href,
              currentChapterIndex: chapterIndex,
              currentChapterScrollTop: storedScrollTop,
              currentChapterScrollHeight: storedScrollHeight,
              currentChapterClientHeight: storedClientHeight,
              chapterProgressPercent: Number(Math.min(Math.max(percentSource ?? 0, 0), 1).toFixed(4)),
              updatedAt: savedProgress.updatedAt ?? new Date().toISOString(),
            },
          };
        }
      }

      if (savedAudioState && book.audioTracks.length) {
        const resolvedTrack =
          book.audioTracks.find((track) => track.href === savedAudioState.currentTrackHref) ??
          book.audioTracks[savedAudioState.currentTrackIndex] ??
          book.audioTracks.find((track) => track.id === savedAudioState.currentTrackId);
        if (resolvedTrack) {
          const resolvedIndex = book.audioTracks.findIndex((track) => track.id === resolvedTrack.id);
          const normalizedSeconds =
            typeof savedAudioState.currentTimeSeconds === "number" &&
            Number.isFinite(savedAudioState.currentTimeSeconds)
              ? Math.max(savedAudioState.currentTimeSeconds, 0)
              : 0;
          book = {
            ...book,
            audioState: {
              currentTrackId: resolvedTrack.id,
              currentTrackHref: resolvedTrack.href,
              currentTrackIndex: resolvedIndex === -1 ? 0 : resolvedIndex,
              currentTimeSeconds: Number(normalizedSeconds.toFixed(3)),
              updatedAt: savedAudioState.updatedAt ?? new Date().toISOString(),
            },
          };
        }
      }

      if (pageCountHint && typeof pageCountHint === "number" && Number.isFinite(pageCountHint) && pageCountHint > 0) {
        book = {
          ...book,
          pageCount: Math.max(1, Math.round(pageCountHint)),
        };
      }

      const normalizedBook = normalizeBookProgressShape(applyDerivedFields(book));

      // Update book in backend with restored state
      if (normalizedBook.progress || normalizedBook.audioState || normalizedBook.pageCount) {
        try {
          await addBook(normalizedBook, undefined);
        } catch (error) {
          console.warn("Failed to update book with restored state", error);
        }
      }

      // Refresh library from backend to get updated state
      await refreshLibrary();
      
      return normalizedBook;
    },
    [refreshLibrary],
  );

  useEffect(() => {
    let cancelled = false;

    const hydrateLibrary = async () => {
      try {
        // Load all books from Rust backend (no filter on initial load)
        await refreshLibrary();
        if (cancelled) return;
      } catch (error) {
        console.warn("Reader library: failed to load books from Rust backend.", error);
      } finally {
        if (!cancelled) {
          setIsHydrated(true);
        }
      }
    };

    void hydrateLibrary();

    return () => {
      cancelled = true;
    };
  }, [refreshLibrary]);

  const importFromDialog = useCallback(async (): Promise<boolean | { book: Book; buffer: ArrayBuffer }> => {
    if (isImporting) return false;

    try {
      setIsImporting(true);

      // On iOS, we need to allow all file types to access the Files app
      // The filters might restrict it to only showing photos
      const dialogOptions: Parameters<typeof open>[0] = isIOS()
        ? {
            multiple: false,
            // On iOS, don't use filters as they may restrict to photos only
            // Instead, allow all file types and filter manually
          }
        : {
            multiple: false,
            filters: [{ name: "EPUB files", extensions: ["epub"] }],
          };

      const selection = await open(dialogOptions);

      const filePath = Array.isArray(selection) ? selection[0] : selection ?? undefined;

      if (!filePath) return true;

      if (!filePath.toLowerCase().endsWith(".epub")) {
        toast.error("Please choose an EPUB (.epub) file.");
        return true;
      }

      if (library.some((book) => book.sourcePath === filePath)) {
        toast.error("This ebook is already in your library.");
        return true;
      }

      // Ingest EPUB from file path (backend will read the file)
      const book = await ingestEpub({
        filePath: filePath,
        sourcePath: filePath,
      });
      
      if (!book) {
        return true;
      }
      
      // Return book and buffer for potential conversion (read buffer for conversion if needed)
      const { getEpubBuffer } = await import("../lib/book-service");
      const buffer = await getEpubBuffer(filePath) ?? new ArrayBuffer(0);
      return { book, buffer };
    } catch (error) {
      console.error(error);
      const message =
        error instanceof Error
          ? error.message
          : "Something went wrong while importing that ebook.";
      toast.error(message);
      return true;
    } finally {
      setIsImporting(false);
    }
  }, [ingestEpub, isImporting, library]);

  return {
    library,
    setLibrary,
    isHydrated,
    isImporting,
    importFromDialog,
    ingestEpub,
    refreshLibrary,
  };
}


