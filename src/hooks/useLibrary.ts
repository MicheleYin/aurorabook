/**
 * Unified library hook that consolidates all library, progress, and audio functionality.
 * 
 * This single hook provides:
 * - Library management (persistent storage to backend)
 * - Chapter progress tracking
 * - Audio state synchronization
 * - All library operations
 * 
 * One file, one hook, one source of truth.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { toast } from "sonner";
import { open } from "@tauri-apps/plugin-dialog";
import { isIOS } from "../lib/is-tauri";
import {
  readAllBooks,
  addBook,
  updateBookProgress as updateBookProgressBackend,
  updateBookAudioState as updateBookAudioStateBackend,
  type LibraryFilter,
} from "../lib/book-service";
import {
  estimatePagesFromWords,
  getChapterPageCount,
  getChapterWordCount,
} from "../lib/utils";
import { findChaptersForAudioTrack } from "../lib/epub";
import {
  getCurrentScrollMetrics,
  createProgressSnapshot,
  isProgressUnchanged as isProgressSnapshotUnchanged,
} from "../lib/progress-utils";
import { createDebounce } from "../lib/debounce-utils";
import { usePrevious } from "./usePrevious";
import type {
  Book,
  BookAudioState,
  BookProgress,
  Chapter,
  AudioTrack,
} from "../types/reader";
import type {
  ChapterProgressSnapshot,
  AudioProgressSnapshot,
  ChapterSelectionOptions,
} from "../components/reader/types";

// ============================================================================
// Types
// ============================================================================

type IngestParams = {
  filePath: string;
  sourcePath: string;
  fallbackTitle?: string;
  progress?: BookProgress;
  pageCountHint?: number;
  audioState?: BookAudioState;
};

type UseChapterProgressParams = {
  activeChapter: Chapter | null;
  contentRef?: RefObject<HTMLElement>;
  onProgress?: (snapshot: ChapterProgressSnapshot) => void;
  onSaveProgress?: (saveFn: () => void) => void;
  isRestoringScroll?: boolean;
};

type UseAudioStateSyncParams = {
  bookId?: string;
  tracks: AudioTrack[];
  initialAudioState?: BookAudioState;
  onProgress?: (snapshot: AudioProgressSnapshot) => void;
};

type UseLibraryReturn = {
  // Library state
  library: Book[];
  setLibrary: React.Dispatch<React.SetStateAction<Book[]>>;
  isHydrated: boolean;
  isImporting: boolean;

  // Library operations
  importFromDialog: () => Promise<boolean | { book: Book; buffer: ArrayBuffer }>;
  ingestEpub: (params: IngestParams) => Promise<Book | null>;
  refreshLibrary: (filter?: LibraryFilter) => Promise<void>;

  // Progress operations
  updateBookProgress: (
    bookId: string,
    payload: {
      chapterId: string;
      scrollTop?: number;
      scrollHeight?: number;
      clientHeight?: number;
      percent?: number;
      elementId?: string | null;
      elementIndex?: number | null;
    },
  ) => Promise<void>;
  updateBookAudioState: (
    bookId: string,
    snapshot: {
      currentTimeSeconds: number;
      trackId?: string;
      trackHref?: string;
      trackIndex?: number;
      updatedAt?: string;
    },
  ) => Promise<void>;
  handleChapterProgress: (bookId: string, snapshot: ChapterProgressSnapshot) => void;

  // Chapter progress tracking hook
  useChapterProgress: (params: UseChapterProgressParams) => {
    emitChapterProgress: () => void;
    saveProgress: () => void;
    updateMetricsOnScroll: () => void;
  };

  // Audio state sync hook
  useAudioStateSync: (params: UseAudioStateSyncParams) => {
    currentIndex: number;
    setCurrentIndex: (index: number) => void;
    restoreTime: number | null;
    isRestoring: boolean;
    onTrackLoaded: (audioElement: HTMLAudioElement) => void;
    onTrackChanged: (newTrackId: string) => void;
    emitProgress: (timeSeconds: number) => void;
  };
};

// ============================================================================
// Helper Functions
// ============================================================================

function getNumberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(value, 0)
    : fallback;
}

function getPercentValue(value: unknown, fallback: number): number {
  const num =
    typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Number(Math.min(Math.max(num, 0), 1).toFixed(4));
}

function getElementId(value: unknown, fallback: string | null): string | null {
  if (value === undefined) return fallback;
  if (value === null) return null;
  if (typeof value === "string" && value.length > 0) return value;
  return null;
}

function getElementIndex(value: unknown, fallback: number | null): number | null {
  if (value === undefined) return fallback;
  if (value === null) return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(Math.round(value), 0);
  }
  return fallback;
}

function isProgressUnchanged(
  existing: Book["progress"],
  next: NonNullable<Book["progress"]>,
): boolean {
  if (!existing) return false;

  if (existing.currentChapterId !== next.currentChapterId) return false;
  if (existing.currentChapterIndex !== next.currentChapterIndex) return false;

  return (
    Math.abs(
      getNumberValue(existing.currentChapterScrollTop, 0) -
        next.currentChapterScrollTop,
    ) < 1 &&
    Math.abs(
      getNumberValue(existing.currentChapterScrollHeight, 0) -
        next.currentChapterScrollHeight,
    ) < 1 &&
    Math.abs(
      getNumberValue(existing.currentChapterClientHeight, 0) -
        next.currentChapterClientHeight,
    ) < 1 &&
    Math.abs((existing.chapterProgressPercent ?? 0) - next.chapterProgressPercent) <
      0.002 &&
    (existing.currentChapterElementId ?? null) ===
      (next.currentChapterElementId ?? null) &&
    (existing.currentChapterElementIndex ?? null) ===
      (next.currentChapterElementIndex ?? null)
  );
}

const applyDerivedFields = (book: Book): Book => {
  let chaptersChanged = false;

  const normalizedChapters = book.chapters.map((chapter) => {
    const normalizedWordCount = getChapterWordCount(chapter);
    const normalizedPageCount = getChapterPageCount({
      ...chapter,
      wordCount: normalizedWordCount,
    });

    const needsWordCountUpdate =
      typeof chapter.wordCount !== "number" ||
      chapter.wordCount !== normalizedWordCount;
    const needsPageCountUpdate =
      normalizedPageCount !== undefined &&
      chapter.estimatedPageCount !== normalizedPageCount;

    if (!needsWordCountUpdate && !needsPageCountUpdate) {
      return chapter;
    }

    chaptersChanged = true;
    return {
      ...chapter,
      wordCount: normalizedWordCount,
      estimatedPageCount:
        normalizedPageCount ?? chapter.estimatedPageCount,
    };
  });

  const totalWords = normalizedChapters.reduce(
    (sum, chapter) => sum + getChapterWordCount(chapter),
    0,
  );
  const derivedPageCount = estimatePagesFromWords(totalWords);
  const normalizedPageCount =
    derivedPageCount !== undefined
      ? Math.max(1, Math.round(derivedPageCount))
      : undefined;

  const existingPageCount =
    typeof book.pageCount === "number" && Number.isFinite(book.pageCount)
      ? Math.max(1, Math.round(book.pageCount))
      : undefined;
  const needsBookPageUpdate =
    normalizedPageCount !== undefined &&
    normalizedPageCount !== existingPageCount;

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

const normalizeBookProgressShape = (book: Book): Book => {
  if (!book.progress) return book;

  const progress = book.progress as BookProgress & LegacyProgressFields;

  const normalizedIndex =
    typeof progress.currentChapterIndex === "number" &&
    Number.isFinite(progress.currentChapterIndex)
      ? Math.max(Math.round(progress.currentChapterIndex), 0)
      : 0;

  const elementId = getElementId(progress.currentChapterElementId, null);
  const elementIndex = getElementIndex(
    progress.currentChapterElementIndex,
    null,
  );

  const scrollTop = getNumberValue(progress.currentChapterScrollTop, 0);
  const scrollHeight = getNumberValue(
    progress.currentChapterScrollHeight,
    0,
  );
  const clientHeight = getNumberValue(
    progress.currentChapterClientHeight,
    0,
  );

  let percent =
    typeof progress.chapterProgressPercent === "number" &&
    Number.isFinite(progress.chapterProgressPercent)
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

  return {
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
};

const PROGRESS_ECHO_TOLERANCE_SECONDS = 0.5;

// ============================================================================
// Main Hook
// ============================================================================

export function useLibrary(): UseLibraryReturn {
  const [library, setLibrary] = useState<Book[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  // Progress update debouncers
  const progressUpdateDebouncerRef = useRef<
    ReturnType<typeof createDebounce> | null
  >(null);
  const audioUpdateDebouncerRef = useRef<
    ReturnType<typeof createDebounce> | null
  >(null);

  // Initialize debouncers
  useEffect(() => {
    progressUpdateDebouncerRef.current = createDebounce(() => {}, 200);
    audioUpdateDebouncerRef.current = createDebounce(() => {}, 150);
    return () => {
      progressUpdateDebouncerRef.current?.cancel();
      audioUpdateDebouncerRef.current?.cancel();
    };
  }, []);

  // ============================================================================
  // Library Management
  // ============================================================================

  const refreshLibrary = useCallback(
    async (filter?: LibraryFilter) => {
      try {
        const books = await readAllBooks(filter);
        
        // If a filter is applied, replace the library entirely with filtered results
        // Otherwise, merge with existing library to preserve any in-memory updates
        if (filter?.filter || filter?.search) {
          // Filter is active - replace library with filtered results
          setLibrary(books);
        } else {
          // No filter - merge to preserve any in-memory updates (like loaded chapter content)
          setLibrary((prevLibrary) => {
            const backendBooksMap = new Map<string, Book>();
            books.forEach((book) => {
              backendBooksMap.set(book.id, book);
              backendBooksMap.set(book.sourcePath, book);
            });

            const mergedBooks: Book[] = [];
            const processedIds = new Set<string>();
            const processedPaths = new Set<string>();

            // Start with backend books (source of truth)
            books.forEach((book) => {
              mergedBooks.push(book);
              processedIds.add(book.id);
              processedPaths.add(book.sourcePath);
            });

            // Add any books from prevLibrary that have in-memory updates (like loaded chapters)
            // but aren't in the backend results (shouldn't happen, but safe to check)
            prevLibrary.forEach((book) => {
              if (
                !processedIds.has(book.id) &&
                !processedPaths.has(book.sourcePath)
              ) {
                mergedBooks.push(book);
                processedIds.add(book.id);
                processedPaths.add(book.sourcePath);
              }
            });

            return mergedBooks;
          });
        }
      } catch (error) {
        console.warn("Failed to load books from Rust backend.", error);
      }
    },
    [],
  );

  const ingestEpub = useCallback(
    async ({
      filePath,
      sourcePath,
      progress: savedProgress,
      pageCountHint,
      audioState: savedAudioState,
    }: IngestParams) => {
      const { ingestEpub: ingestEpubCommand } = await import("../lib/book-service");
      let book = await ingestEpubCommand(filePath, sourcePath);

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
                chapter.href.split("#")[0] ===
                  savedProgress.currentChapterHref.split("#")[0],
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

          const storedScrollTop = getNumberValue(
            savedProgress.currentChapterScrollTop,
            0,
          );
          const storedScrollHeight = getNumberValue(
            savedProgress.currentChapterScrollHeight,
            0,
          );
          const storedClientHeight = getNumberValue(
            savedProgress.currentChapterClientHeight,
            0,
          );

          let percentSource = getPercentValue(
            savedProgress.chapterProgressPercent,
            0,
          );

          if (
            (percentSource === undefined || percentSource === 0) &&
            storedScrollHeight > 0 &&
            storedClientHeight >= 0 &&
            storedScrollTop > 0
          ) {
            const savedMaxScroll = Math.max(
              storedScrollHeight - storedClientHeight,
              0,
            );
            if (savedMaxScroll > 0) {
              percentSource = Math.min(
                Math.max(storedScrollTop / savedMaxScroll, 0),
                1,
              );
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
              chapterProgressPercent: getPercentValue(percentSource, 0),
              updatedAt: savedProgress.updatedAt ?? new Date().toISOString(),
            },
          };
        }
      }

      if (savedAudioState && book.audioTracks.length) {
        const resolvedTrack =
          book.audioTracks.find(
            (track) => track.href === savedAudioState.currentTrackHref,
          ) ??
          book.audioTracks[savedAudioState.currentTrackIndex] ??
          book.audioTracks.find(
            (track) => track.id === savedAudioState.currentTrackId,
          );
        if (resolvedTrack) {
          const resolvedIndex = book.audioTracks.findIndex(
            (track) => track.id === resolvedTrack.id,
          );
          const normalizedSeconds = getNumberValue(
            savedAudioState.currentTimeSeconds,
            0,
          );
          book = {
            ...book,
            audioState: {
              currentTrackId: resolvedTrack.id,
              currentTrackHref: resolvedTrack.href,
              currentTrackIndex: resolvedIndex === -1 ? 0 : resolvedIndex,
              currentTimeSeconds: Number(normalizedSeconds.toFixed(3)),
              updatedAt:
                savedAudioState.updatedAt ?? new Date().toISOString(),
            },
          };
        }
      }

      if (
        pageCountHint &&
        typeof pageCountHint === "number" &&
        Number.isFinite(pageCountHint) &&
        pageCountHint > 0
      ) {
        book = {
          ...book,
          pageCount: Math.max(1, Math.round(pageCountHint)),
        };
      }

      const normalizedBook = normalizeBookProgressShape(
        applyDerivedFields(book),
      );

      if (
        normalizedBook.progress ||
        normalizedBook.audioState ||
        normalizedBook.pageCount
      ) {
        try {
          await addBook(normalizedBook, undefined);
        } catch (error) {
          console.warn("Failed to update book with restored state", error);
        }
      }

      return normalizedBook;
    },
    [],
  );

  const importFromDialog = useCallback(async (): Promise<
    boolean | { book: Book; buffer: ArrayBuffer }
  > => {
    if (isImporting) return false;

    try {
      setIsImporting(true);

      const dialogOptions: Parameters<typeof open>[0] = isIOS()
        ? { multiple: false }
        : {
            multiple: false,
            filters: [{ name: "EPUB files", extensions: ["epub"] }],
          };

      const selection = await open(dialogOptions);
      const filePath = Array.isArray(selection)
        ? selection[0]
        : selection ?? undefined;

      if (!filePath) return true;

      if (!filePath.toLowerCase().endsWith(".epub")) {
        toast.error("Please choose an EPUB (.epub) file.");
        return true;
      }

      if (library.some((book) => book.sourcePath === filePath)) {
        toast.error("This ebook is already in your library.");
        return true;
      }

      const book = await ingestEpub({
        filePath: filePath,
        sourcePath: filePath,
      });

      if (!book) {
        return true;
      }

      setLibrary((prevLibrary) => {
        const existingIndex = prevLibrary.findIndex(
          (b) => b.id === book.id || b.sourcePath === book.sourcePath,
        );
        if (existingIndex !== -1) {
          const updated = [...prevLibrary];
          updated[existingIndex] = book;
          return updated;
        }
        return [...prevLibrary, book];
      });

      requestAnimationFrame(() => {
        refreshLibrary().catch((error) => {
          console.warn("Failed to refresh library after adding book:", error);
        });
      });

      const { getEpubBuffer } = await import("../lib/book-service");
      const buffer = (await getEpubBuffer(filePath)) ?? new ArrayBuffer(0);
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
  }, [ingestEpub, isImporting, library, refreshLibrary]);

  // ============================================================================
  // Progress Management
  // ============================================================================

  const updateBookProgress = useCallback(
    async (
      bookId: string,
      payload: {
        chapterId: string;
        scrollTop?: number;
        scrollHeight?: number;
        clientHeight?: number;
        percent?: number;
        elementId?: string | null;
        elementIndex?: number | null;
      },
    ) => {
      if (!payload?.chapterId) return;

      const book = library.find((b) => b.id === bookId);
      if (!book) return;

      const chapterIndex = book.chapters.findIndex(
        (chapter) => chapter.id === payload.chapterId,
      );
      if (chapterIndex === -1) return;

      const chapter = book.chapters[chapterIndex];
      const existingProgress = book.progress;
      const chapterMatchesExisting =
        existingProgress?.currentChapterId === chapter.id &&
        existingProgress.currentChapterIndex === chapterIndex;

      const nextProgress: NonNullable<Book["progress"]> = {
        currentChapterId: chapter.id,
        currentChapterHref: chapter.href,
        currentChapterIndex: chapterIndex,
        currentChapterElementId: getElementId(
          payload.elementId,
          chapterMatchesExisting
            ? getElementId(existingProgress?.currentChapterElementId, null)
            : null,
        ),
        currentChapterElementIndex: getElementIndex(
          payload.elementIndex,
          chapterMatchesExisting
            ? getElementIndex(
                existingProgress?.currentChapterElementIndex,
                null,
              )
            : null,
        ),
        currentChapterScrollTop: getNumberValue(
          payload.scrollTop,
          chapterMatchesExisting
            ? getNumberValue(existingProgress?.currentChapterScrollTop, 0)
            : 0,
        ),
        currentChapterScrollHeight: getNumberValue(
          payload.scrollHeight,
          chapterMatchesExisting
            ? getNumberValue(existingProgress?.currentChapterScrollHeight, 0)
            : 0,
        ),
        currentChapterClientHeight: getNumberValue(
          payload.clientHeight,
          chapterMatchesExisting
            ? getNumberValue(existingProgress?.currentChapterClientHeight, 0)
            : 0,
        ),
        chapterProgressPercent: getPercentValue(
          payload.percent,
          chapterMatchesExisting
            ? getPercentValue(existingProgress?.chapterProgressPercent, 0)
            : 0,
        ),
        updatedAt: new Date().toISOString(),
      };

      if (isProgressUnchanged(existingProgress, nextProgress)) {
        return;
      }

      setLibrary((prev) =>
        prev.map((b) => (b.id === bookId ? { ...b, progress: nextProgress } : b)),
      );

      const debouncer = progressUpdateDebouncerRef.current;
      if (debouncer) {
        debouncer.cancel();
        debouncer.call(async () => {
          try {
            const updatedBook = await updateBookProgressBackend(
              bookId,
              nextProgress,
            );
            setLibrary((prev) =>
              prev.map((b) => (b.id === bookId ? updatedBook : b)),
            );
          } catch (error) {
            console.error("Failed to sync progress to backend", {
              bookId,
              chapterId: chapter.id,
              error,
            });
            setLibrary((prev) =>
              prev.map((b) => (b.id === bookId ? book : b)),
            );
          }
        });
      }
    },
    [library],
  );

  const updateBookAudioState = useCallback(
    async (
      bookId: string,
      snapshot: {
        currentTimeSeconds: number;
        trackId?: string;
        trackHref?: string;
        trackIndex?: number;
        updatedAt?: string;
      },
    ) => {
      if (
        !bookId ||
        typeof snapshot?.currentTimeSeconds !== "number" ||
        !Number.isFinite(snapshot.currentTimeSeconds) ||
        snapshot.currentTimeSeconds < 0
      ) {
        return;
      }

      const book = library.find((b) => b.id === bookId);
      if (!book?.audioTracks.length) return;

      const resolvedTrack =
        book.audioTracks.find((track) => track.id === snapshot.trackId) ??
        book.audioTracks.find((track) => track.href === snapshot.trackHref) ??
        book.audioTracks[snapshot.trackIndex ?? 0];

      if (!resolvedTrack) return;

      const resolvedIndex = book.audioTracks.findIndex(
        (track) => track.id === resolvedTrack.id,
      );
      const normalizedSeconds = Number(snapshot.currentTimeSeconds.toFixed(3));
      const existing = book.audioState;

      if (
        existing &&
        existing.currentTrackId === resolvedTrack.id &&
        Math.abs(existing.currentTimeSeconds - normalizedSeconds) < 0.25
      ) {
        return;
      }

      const nextAudioState = {
        currentTrackId: resolvedTrack.id,
        currentTrackHref: resolvedTrack.href,
        currentTrackIndex: resolvedIndex === -1 ? snapshot.trackIndex ?? 0 : resolvedIndex,
        currentTimeSeconds: normalizedSeconds,
        updatedAt: snapshot.updatedAt ?? new Date().toISOString(),
      };

      setLibrary((prev) =>
        prev.map((b) =>
          b.id === bookId ? { ...b, audioState: nextAudioState } : b
        ),
      );

      const debouncer = audioUpdateDebouncerRef.current;
      if (debouncer) {
        debouncer.cancel();
        debouncer.call(async () => {
          try {
            const updatedBook = await updateBookAudioStateBackend(
              bookId,
              nextAudioState,
            );
            setLibrary((prev) =>
              prev.map((b) => (b.id === bookId ? updatedBook : b)),
            );
          } catch (error) {
            console.error("Failed to sync audio state to backend", error);
            setLibrary((prev) =>
              prev.map((b) => (b.id === bookId ? book : b)),
            );
          }
        });
      }
    },
    [library],
  );

  const handleChapterProgress = useCallback(
    (bookId: string, snapshot: ChapterProgressSnapshot) => {
      updateBookProgress(bookId, {
        chapterId: snapshot.chapterId,
        scrollTop: snapshot.scrollTop,
        scrollHeight: snapshot.scrollHeight,
        clientHeight: snapshot.clientHeight,
        percent: snapshot.percent,
        elementId: snapshot.activeElementId,
        elementIndex: snapshot.activeElementIndex,
      });
    },
    [updateBookProgress],
  );

  // ============================================================================
  // Chapter Progress Hook
  // ============================================================================

  const useChapterProgress = useCallback(
    (params: UseChapterProgressParams) => {
      const {
        activeChapter,
        contentRef,
        onProgress,
        onSaveProgress,
        isRestoringScroll = false,
      } = params;

      const progressStateRef = useRef({
        lastProgress: null as ChapterProgressSnapshot | null,
        lastKnownMetrics: null as {
          scrollTop: number;
          scrollHeight: number;
          clientHeight: number;
          maxScroll: number;
        } | null,
      });

      const scrollStateRef = useRef({
        rafId: null as number | null,
        debounceTimeout: null as number | null,
      });

      const isRestoringRef = useRef(isRestoringScroll);
      const previousChapterId = usePrevious(activeChapter?.id);

      useEffect(() => {
        isRestoringRef.current = isRestoringScroll;
      }, [isRestoringScroll]);

      const emitChapterProgress = useCallback(() => {
        if (!activeChapter || !onProgress || isRestoringRef.current) {
          return;
        }

        const containerElement = contentRef?.current ?? null;
        const metrics = getCurrentScrollMetrics(
          progressStateRef.current.lastKnownMetrics,
          containerElement,
        );

        if (metrics.maxScroll > 0 || metrics.scrollTop > 0) {
          progressStateRef.current.lastKnownMetrics = metrics;
        }

        const snapshot = createProgressSnapshot(activeChapter.id, metrics);

        if (
          isProgressSnapshotUnchanged(
            progressStateRef.current.lastProgress,
            snapshot,
          )
        ) {
          return;
        }

        progressStateRef.current.lastProgress = snapshot;
        onProgress(snapshot);
      }, [activeChapter, onProgress, contentRef]);

      const saveProgress = useCallback(() => {
        if (!activeChapter || !onProgress || isRestoringRef.current) {
          return;
        }

        if (scrollStateRef.current.debounceTimeout !== null) {
          clearTimeout(scrollStateRef.current.debounceTimeout);
          scrollStateRef.current.debounceTimeout = null;
        }
        if (scrollStateRef.current.rafId !== null) {
          cancelAnimationFrame(scrollStateRef.current.rafId);
          scrollStateRef.current.rafId = null;
        }

        const containerElement = contentRef?.current ?? null;
        const metrics = getCurrentScrollMetrics(
          progressStateRef.current.lastKnownMetrics,
          containerElement,
        );

        if (metrics.maxScroll > 0 || metrics.scrollTop > 0) {
          progressStateRef.current.lastKnownMetrics = metrics;
        }

        const snapshot = createProgressSnapshot(activeChapter.id, metrics);
        progressStateRef.current.lastProgress = snapshot;
        onProgress(snapshot);
      }, [activeChapter, onProgress, contentRef]);

      const updateMetricsOnScroll = useCallback(() => {
        const containerElement = contentRef?.current ?? null;
        const metrics = getCurrentScrollMetrics(
          progressStateRef.current.lastKnownMetrics,
          containerElement,
        );
        if (metrics.maxScroll > 0 || metrics.scrollTop > 0) {
          progressStateRef.current.lastKnownMetrics = metrics;
        }
      }, [contentRef]);

      useEffect(() => {
        if (onSaveProgress) {
          onSaveProgress(saveProgress);
        }
      }, [saveProgress, onSaveProgress]);

      useEffect(() => {
        const currentChapterId = activeChapter?.id;
        if (previousChapterId && previousChapterId !== currentChapterId) {
          const timer = setTimeout(() => {
            saveProgress();
          }, 50);
          return () => clearTimeout(timer);
        }
      }, [activeChapter?.id, previousChapterId, saveProgress]);

      return {
        emitChapterProgress,
        saveProgress,
        updateMetricsOnScroll,
      };
    },
    [],
  );

  // ============================================================================
  // Audio State Sync Hook
  // ============================================================================

  const useAudioStateSync = useCallback(
    (params: UseAudioStateSyncParams) => {
      const { bookId, tracks, initialAudioState, onProgress } = params;

      const [currentIndex, setCurrentIndexState] = useState(0);
      const [restoreTime, setRestoreTime] = useState<number | null>(null);
      const [isRestoring, setIsRestoring] = useState(false);

      const currentIndexRef = useRef(0);
      const previousTrackIdRef = useRef<string | null>(null);
      const lastProgressSnapshotRef = useRef<{
        trackId?: string;
        trackHref?: string;
        trackIndex?: number;
        currentTimeSeconds?: number;
        updatedAt?: string;
        timestamp: number;
      }>({ timestamp: 0 });
      const lastAppliedAudioStateSignatureRef = useRef<string | undefined>(
        undefined,
      );
      const onProgressRef = useRef(onProgress);
      const tracksRef = useRef(tracks);
      const isRestoringRef = useRef(false);
      const restorationAppliedRef = useRef<string | null>(null);
      const restoreTimeRef = useRef<number | null>(null);

      useEffect(() => {
        onProgressRef.current = onProgress;
      }, [onProgress]);

      useEffect(() => {
        tracksRef.current = tracks;
      }, [tracks]);

      useEffect(() => {
        currentIndexRef.current = currentIndex;
      }, [currentIndex]);

      useEffect(() => {
        isRestoringRef.current = isRestoring;
      }, [isRestoring]);

      useEffect(() => {
        restoreTimeRef.current = restoreTime;
      }, [restoreTime]);

      const findTrackIndex = useCallback((): number => {
        if (!tracks.length || !initialAudioState) {
          return 0;
        }

        if (initialAudioState.currentTrackId) {
          const matchById = tracks.findIndex(
            (track) => track.id === initialAudioState.currentTrackId,
          );
          if (matchById >= 0) {
            return matchById;
          }
        }

        if (initialAudioState.currentTrackHref) {
          const matchByHref = tracks.findIndex(
            (track) => track.href === initialAudioState.currentTrackHref,
          );
          if (matchByHref >= 0) {
            return matchByHref;
          }
        }

        if (
          typeof initialAudioState.currentTrackIndex === "number" &&
          Number.isFinite(initialAudioState.currentTrackIndex) &&
          initialAudioState.currentTrackIndex >= 0 &&
          initialAudioState.currentTrackIndex < tracks.length
        ) {
          return initialAudioState.currentTrackIndex;
        }

        return 0;
      }, [tracks, initialAudioState]);

      const isProgressEcho = useCallback((): boolean => {
        const state = initialAudioState;
        if (!state) {
          return false;
        }

        const snapshot = lastProgressSnapshotRef.current;
        if (
          !snapshot.trackId &&
          !snapshot.trackHref &&
          typeof snapshot.trackIndex !== "number"
        ) {
          return false;
        }

        const nextTrackIndex =
          typeof state.currentTrackIndex === "number" &&
          Number.isFinite(state.currentTrackIndex)
            ? state.currentTrackIndex
            : undefined;
        const nextTimeSeconds =
          typeof state.currentTimeSeconds === "number" &&
          Number.isFinite(state.currentTimeSeconds)
            ? state.currentTimeSeconds
            : undefined;

        const trackMatches =
          Boolean(snapshot.trackId && snapshot.trackId === state.currentTrackId) ||
          Boolean(
            snapshot.trackHref && snapshot.trackHref === state.currentTrackHref,
          ) ||
          (typeof snapshot.trackIndex === "number" &&
            typeof nextTrackIndex === "number" &&
            snapshot.trackIndex === nextTrackIndex);

        if (!trackMatches) {
          return false;
        }

        const timeMatches =
          (snapshot.updatedAt && snapshot.updatedAt === state.updatedAt) ||
          (typeof snapshot.currentTimeSeconds === "number" &&
            typeof nextTimeSeconds === "number" &&
            Math.abs(snapshot.currentTimeSeconds - nextTimeSeconds) <=
              PROGRESS_ECHO_TOLERANCE_SECONDS);

        return timeMatches;
      }, [initialAudioState]);

      useEffect(() => {
        if (!bookId) {
          lastAppliedAudioStateSignatureRef.current = undefined;
          previousTrackIdRef.current = null;
          setRestoreTime(null);
          setIsRestoring(false);
          return;
        }

        const state = initialAudioState;
        const signatureComponents = [
          bookId,
          state?.currentTrackId ?? "no-track",
          state?.updatedAt ?? "no-updated-at",
          Number.isFinite(state?.currentTimeSeconds)
            ? String(state?.currentTimeSeconds)
            : "0",
          String(tracks.length),
        ];
        const signature = signatureComponents.join("|");

        if (lastAppliedAudioStateSignatureRef.current === signature) {
          return;
        }

        if (isProgressEcho()) {
          lastAppliedAudioStateSignatureRef.current = signature;
          return;
        }

        lastAppliedAudioStateSignatureRef.current = signature;

        const nextIndex = findTrackIndex();
        previousTrackIdRef.current = null;
        setCurrentIndexState(nextIndex);
        currentIndexRef.current = nextIndex;

        const restoredTime =
          typeof initialAudioState?.currentTimeSeconds === "number" &&
          Number.isFinite(initialAudioState.currentTimeSeconds)
            ? Math.max(initialAudioState.currentTimeSeconds, 0)
            : null;

        setRestoreTime(restoredTime);
        setIsRestoring(true);
        restorationAppliedRef.current = null;
        lastProgressSnapshotRef.current = { timestamp: 0 };
      }, [bookId, initialAudioState, tracks, findTrackIndex, isProgressEcho]);

      const onTrackChanged = useCallback(
        (newTrackId: string) => {
          const currentTrack = tracksRef.current[currentIndexRef.current];
          if (!currentTrack || currentTrack.id === newTrackId) {
            return;
          }

          if (isRestoringRef.current) {
            previousTrackIdRef.current = newTrackId;
            return;
          }

          if (
            previousTrackIdRef.current !== null &&
            previousTrackIdRef.current !== newTrackId
          ) {
            setRestoreTime(null);
            restorationAppliedRef.current = null;
            previousTrackIdRef.current = newTrackId;
          } else if (previousTrackIdRef.current === null) {
            previousTrackIdRef.current = newTrackId;
          }
        },
        [],
      );

      const emitProgress = useCallback(
        (timeSeconds: number) => {
          const track = tracksRef.current[currentIndexRef.current];
          const listener = onProgressRef.current;
          if (!track || !listener) {
            return;
          }

          const normalizedSeconds = Number(Math.max(timeSeconds, 0).toFixed(3));
          const updatedAt = new Date().toISOString();

          lastProgressSnapshotRef.current = {
            trackId: track.id,
            trackHref: track.href,
            trackIndex: currentIndexRef.current,
            currentTimeSeconds: normalizedSeconds,
            updatedAt,
            timestamp: Date.now(),
          };

          listener({
            trackId: track.id,
            trackHref: track.href,
            trackIndex: currentIndexRef.current,
            currentTimeSeconds: normalizedSeconds,
            updatedAt,
          });
        },
        [],
      );

      const onTrackLoaded = useCallback(
        (audioElement: HTMLAudioElement) => {
          const currentTrack = tracksRef.current[currentIndexRef.current];
          if (!currentTrack || !audioElement) {
            return;
          }

          const shouldRestore = isRestoringRef.current;
          const timeToRestore = restoreTimeRef.current;
          const currentTrackId = currentTrack.id;
          const alreadyApplied =
            restorationAppliedRef.current === currentTrackId;

          if (
            shouldRestore &&
            timeToRestore !== null &&
            Number.isFinite(timeToRestore) &&
            !alreadyApplied
          ) {
            try {
              audioElement.currentTime = timeToRestore;
              const appliedTime = audioElement.currentTime || timeToRestore;
              restorationAppliedRef.current = currentTrackId;
              emitProgress(appliedTime);
              setIsRestoring(false);
              setRestoreTime(null);
            } catch (error) {
              console.warn("Failed to apply restore time:", error);
              setIsRestoring(false);
              setRestoreTime(null);
            }
          } else if (shouldRestore && timeToRestore === null) {
            setIsRestoring(false);
            setRestoreTime(null);
            restorationAppliedRef.current = currentTrackId;
          } else if (!shouldRestore && timeToRestore === null && !alreadyApplied) {
            if (previousTrackIdRef.current !== null) {
              audioElement.currentTime = 0;
            }
            restorationAppliedRef.current = null;
          }
        },
        [emitProgress],
      );

      const setCurrentIndex = useCallback(
        (index: number) => {
          const newTrack = tracksRef.current[index];
          if (newTrack) {
            onTrackChanged(newTrack.id);
          }
          setCurrentIndexState(index);
          currentIndexRef.current = index;
        },
        [onTrackChanged],
      );

      useEffect(() => {
        if (tracks.length && currentIndex >= tracks.length) {
          setCurrentIndexState(0);
          currentIndexRef.current = 0;
        }
      }, [tracks.length, currentIndex]);

      return {
        currentIndex,
        setCurrentIndex,
        restoreTime,
        isRestoring,
        onTrackLoaded,
        onTrackChanged,
        emitProgress,
      };
    },
    [],
  );

  // ============================================================================
  // Hydration
  // ============================================================================

  useEffect(() => {
    let cancelled = false;

    const hydrateLibrary = async () => {
      try {
        await refreshLibrary();
        if (cancelled) return;
      } catch (error) {
        console.warn("Failed to load books from Rust backend.", error);
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

  // ============================================================================
  // Return
  // ============================================================================

  return {
    library,
    setLibrary,
    isHydrated,
    isImporting,
    importFromDialog,
    ingestEpub,
    refreshLibrary,
    updateBookProgress,
    updateBookAudioState,
    handleChapterProgress,
    useChapterProgress,
    useAudioStateSync,
  };
}
