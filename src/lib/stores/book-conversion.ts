import { writable } from "svelte/store";
import { listen } from "@tauri-apps/api/event";
import type { Book } from "../types/reader";
import type { ConversionProgress } from "../types/conversion";
import { readOneBook, readAllBooks } from "../services/book-service";

function createBookConversionStore() {
  const { subscribe: subscribeProgress, set: setProgress, update: updateProgress } = writable<Record<string, ConversionProgress>>({});
  const { subscribe: subscribeConverting, set: setConverting } = writable(false);
  const { subscribe: subscribeCancelling, set: setCancelling } = writable<string | null>(null);
  const { subscribe: subscribeStartTime, set: setStartTime } = writable<number | null>(null);

  let listenerSetup = false;
  let libraryRef: Book[] = [];

  /**
   * Set library reference for use in event listeners
   */
  const setLibraryRef = (library: Book[]) => {
    libraryRef = library;
  };

  /**
   * Setup event listeners for conversion progress
   */
  const setupListeners = async (refreshLibrary: () => Promise<void>) => {
    if (listenerSetup) return;
    listenerSetup = true;

    // Listen for chapter completion events
    await listen<{
      source_path: string;
      chapter_index: number;
      total_chapters: number;
      chapter_title: string;
      audio_generated: boolean;
    }>("chapter-completed", async () => {
      // Refresh library to get updated book state
      await refreshLibrary();
    });

    // Listen for conversion cancellation
    await listen<{ source_path: string }>("conversion-cancelled", async (event) => {
      const { source_path } = event.payload;
      const book = libraryRef.find((b) => b.sourcePath === source_path);
      if (book) {
        updateProgress((progress) => {
          const updated = { ...progress };
          delete updated[book.id];
          return updated;
        });
        setCancelling(null);
      }
    });
  };

  return {
    progress: { subscribe: subscribeProgress, set: setProgress, update: updateProgress },
    isConverting: { subscribe: subscribeConverting, set: setConverting },
    cancellingBookId: { subscribe: subscribeCancelling, set: setCancelling },
    startTime: { subscribe: subscribeStartTime, set: setStartTime },
    setLibraryRef,
    setupListeners,
  };
}

export const bookConversionStore = createBookConversionStore();

