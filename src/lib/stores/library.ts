import { writable } from "svelte/store";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { Book } from "../types/reader";
import { readAllBooks, ingestEpub, addBook } from "../services/book-service";

function createLibraryStore() {
  const { subscribe, set, update } = writable<Book[]>([]);
  const { subscribe: subscribeHydrated, set: setHydrated } = writable(false);
  const { subscribe: subscribeImporting, set: setImporting } = writable(false);

  /**
   * Refresh library from backend
   */
  const refreshLibrary = async () => {
    try {
      const books = await readAllBooks();
      
      // Merge with existing library to preserve any in-memory updates
      update((prevLibrary) => {
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

        // Add any books from prevLibrary that have in-memory updates
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
    } catch (error) {
      console.warn("Failed to load books from Rust backend.", error);
    }
  };

  /**
   * Import EPUB from file dialog
   */
  const importFromDialog = async (): Promise<boolean | { book: Book; buffer: ArrayBuffer }> => {
    setImporting(true);
    try {
      const selected = await open({
        multiple: false,
        filters: [
          {
            name: "EPUB",
            extensions: ["epub"],
          },
        ],
      });

      if (!selected) {
        setImporting(false);
        return false;
      }

      // Read file as ArrayBuffer
      const file = await fetch(`file://${selected.path}`).then((res) => res.arrayBuffer());

      // Ingest the EPUB
      const book = await ingestEpub(selected.path, selected.path);

      setImporting(false);
      return { book, buffer: file };
    } catch (error) {
      console.error("Failed to import EPUB:", error);
      setImporting(false);
      throw error;
    }
  };

  /**
   * Ingest EPUB with optional saved progress and audio state
   */
  const ingestEpubWithState = async (params: {
    filePath: string;
    sourcePath: string;
    progress?: Book["progress"];
    pageCountHint?: number;
    audioState?: Book["audioState"];
  }): Promise<Book> => {
    const book = await ingestEpub(params.filePath, params.sourcePath);

    // If we have saved progress, restore it
    if (params.progress && book.chapters.length) {
      const maxIndex = book.chapters.length - 1;
      const storedIndex =
        typeof params.progress.currentChapterIndex === "number"
          ? params.progress.currentChapterIndex
          : 0;
      const normalizedIndex = Math.min(Math.max(storedIndex, 0), maxIndex);
      const candidateByHref = params.progress.currentChapterHref
        ? book.chapters.find(
            (chapter) =>
              chapter.href === params.progress.currentChapterHref ||
              chapter.href.split("#")[0] ===
                params.progress.currentChapterHref.split("#")[0],
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

        // Restore progress
        book.progress = {
          ...params.progress,
          currentChapterId: resolvedChapter.id,
          currentChapterHref: resolvedChapter.href,
          currentChapterIndex: chapterIndex,
        };
      }
    }

    // Restore page count hint if provided
    if (params.pageCountHint) {
      book.pageCount = params.pageCountHint;
    }

    // Restore audio state if provided
    if (params.audioState) {
      book.audioState = params.audioState;
    }

    // Add book to library
    const addedBook = await addBook(book);
    
    // Update library state
    update((books) => {
      const existingIndex = books.findIndex((b) => b.id === addedBook.id);
      if (existingIndex >= 0) {
        const updated = [...books];
        updated[existingIndex] = addedBook;
        return updated;
      }
      return [...books, addedBook];
    });

    return addedBook;
  };

  /**
   * Initialize library on mount
   */
  const loadLibrary = async () => {
    try {
      await refreshLibrary();
      setHydrated(true);
    } catch (error) {
      console.warn("Failed to load library from backend, using defaults:", error);
      setHydrated(true);
    }
  };

  // Initialize
  loadLibrary();

  return {
    subscribe,
    refreshLibrary,
    importFromDialog,
    ingestEpub: ingestEpubWithState,
    hydrated: { subscribe: subscribeHydrated },
    isImporting: { subscribe: subscribeImporting },
  };
}

export const libraryStore = createLibraryStore();





