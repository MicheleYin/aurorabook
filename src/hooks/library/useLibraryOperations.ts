/**
 * Library operations: import, ingest, refresh
 */

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { open } from "@tauri-apps/plugin-dialog";
import { isIOS } from "../../lib/is-tauri";
import {
  readAllBooks,
  addBook,
  type LibraryFilter,
} from "../../lib/book-service";
import type { Book } from "../../types/reader";
import type { IngestParams } from "./types";
import { applyDerivedFields, normalizeBookProgressShape, getNumberValue, getPercentValue } from "./libraryHelpers";

export function useLibraryOperations(
  library: Book[],
  setLibrary: React.Dispatch<React.SetStateAction<Book[]>>,
) {
  const [isImporting, setIsImporting] = useState(false);

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
    [setLibrary],
  );

  const ingestEpub = useCallback(
    async ({
      filePath,
      sourcePath,
      progress: savedProgress,
      pageCountHint,
      audioState: savedAudioState,
    }: IngestParams) => {
      const { ingestEpub: ingestEpubCommand } = await import("../../lib/book-service");
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

          const chapterProgressPercent = getPercentValue(percentSource, 0);
          // Calculate overall book progress across all chapters
          const totalChapters = book.chapters.length;
          const bookProgressPercent = totalChapters > 0
            ? Math.min(Math.max((chapterIndex + chapterProgressPercent) / totalChapters, 0), 1)
            : 0;

          book = {
            ...book,
            progress: {
              currentChapterId: resolvedChapter.id,
              currentChapterHref: resolvedChapter.href,
              currentChapterIndex: chapterIndex,
              currentChapterScrollTop: storedScrollTop,
              currentChapterScrollHeight: storedScrollHeight,
              currentChapterClientHeight: storedClientHeight,
              chapterProgressPercent,
              bookProgressPercent,
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

      const { getEpubBuffer } = await import("../../lib/book-service");
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
  }, [ingestEpub, isImporting, library, refreshLibrary, setLibrary]);

  return {
    isImporting,
    importFromDialog,
    ingestEpub,
    refreshLibrary,
  };
}

