import { useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import type { Book } from "./types/book";
import { FloatingAudioPlayer } from "./components/audio/FloatingAudioPlayer";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Library } from "./components/library/Library";
import { Reader } from "./components/reader/Reader";
import { Settings } from "./components/settings/SettingsPanel";
import { Toaster } from "./components/ui/sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import { AppProvider, TabValue, useAppContext } from "./context/AppContext";
import { useTranslation } from "./lib/i18n";
import {
  AudioProgressProvider,
  useAudioProgressContext,
} from "./context/AudioProgressContext";
import { AudioSyncProvider } from "./context/AudioSyncContext";
import {
  ChapterProgressProvider,
  useChapterProgressContext,
} from "./context/ChapterProgressContext";
import { AudioExportStateProvider } from "./context/AudioExportStateContext";
import { ConversionStateProvider } from "./context/ConversionStateContext";
import { SettingsProvider } from "./context/SettingsContext";
import { useBookConversion } from "./hooks/useBookConversion";
import { logger } from "./lib/logger";
import { normalizeBook } from "./lib/normalize-book";

function AppContent() {
  const { currentTab, setCurrentTab, currentBook } = useAppContext();
  const { t } = useTranslation();

  return (
    <div className="flex h-full flex-col relative">
      <Tabs
        value={currentTab}
        onValueChange={(value) => {
          setCurrentTab(value as TabValue);
        }}
        className="flex h-full flex-col"
      >
        <main className="flex-1 overflow-hidden">
          <TabsContent
            value="library"
            forceMount
            className="h-full overflow-auto m-0 data-[state=inactive]:hidden"
          >
            <Library />
          </TabsContent>
          <TabsContent
            value="reader"
            forceMount
            className="h-full overflow-auto m-0 data-[state=inactive]:hidden"
          >
            <Reader />
          </TabsContent>
          <TabsContent
            value="settings"
            forceMount
            className="h-full overflow-auto m-0 data-[state=inactive]:hidden"
          >
            <Settings />
          </TabsContent>
        </main>
        <div className="absolute bottom-0 left-0 right-0 flex justify-center pb-4 pointer-events-none z-10 select-none">
          <TabsList className="rounded-full bg-background/80 backdrop-blur-lg border shadow-lg px-1 py-2 gap-1 pointer-events-auto">
            <TabsTrigger
              value="library"
              className="rounded-full px-4 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground transition-all"
            >
              {t("library.title")}
            </TabsTrigger>
            <TabsTrigger
              value="reader"
              disabled={!currentBook}
              className="rounded-full px-4 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground transition-all"
            >
              {t("reader.title")}
            </TabsTrigger>
            <TabsTrigger
              value="settings"
              className="rounded-full px-4 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground transition-all"
            >
              {t("app.settings")}
            </TabsTrigger>
          </TabsList>
        </div>
      </Tabs>
      <FloatingAudioPlayer />
    </div>
  );
}

function ConversionCallbackHandler() {
  const { currentBook, setCurrentBook, setLibrary, setCurrentBookWithLoading, loadBooks } = useAppContext();
  const { audioRef, saveAudioProgress } = useAudioProgressContext();
  const { registerCallbacks } = useBookConversion();

  const mergeOpenBookAdditively = useCallback(
    (openBook: Book, updatedBook: Book): Book => {
      return {
        ...openBook,
        ...updatedBook,
        // Keep in-session reader/player progress stable while adding new conversion output.
        progress: openBook.progress ?? updatedBook.progress,
        audioState: openBook.audioState ?? updatedBook.audioState,
        completedChapters: [
          ...new Set([
            ...(openBook.completedChapters || []),
            ...(updatedBook.completedChapters || []),
          ]),
        ],
      };
    },
    []
  );

  // Refresh a single book from backend (for chapters/audio tracks)
  const refreshBookById = useCallback(
    async (bookId: string | null, additiveOnly = false) => {
      if (!bookId) return;
      try {
        const updatedBook = await invoke<Book | null>("read_one_book", {
          bookId,
        });

        if (updatedBook) {
          const normalized = normalizeBook(updatedBook);
          // Update library state
          setLibrary((prevBooks) =>
            prevBooks.map((book) =>
              book.id === normalized.id ? normalized : book
            )
          );

          // Keep reader state in sync when book is currently open
          if (currentBook?.id === normalized.id) {
            if (additiveOnly) {
              setCurrentBook((openBook) => {
                if (!openBook || openBook.id !== normalized.id) {
                  return openBook;
                }
                return mergeOpenBookAdditively(openBook, normalized);
              });
              logger.log("Additively refreshed currently open book from chapter completion event");
            } else {
              const wasPlaying = Boolean(
                audioRef.current && !audioRef.current.paused
              );
              await saveAudioProgress(currentBook);
              setCurrentBookWithLoading(normalized, wasPlaying);
              logger.log("Refreshed currently open book from completion event");
            }
          }
        }
      } catch (err) {
        logger.error("Failed to refresh book from completion event:", err);
        // Fallback to reloading all books
        await loadBooks();
      }
    },
    [
      currentBook,
      setLibrary,
      setCurrentBook,
      setCurrentBookWithLoading,
      saveAudioProgress,
      loadBooks,
      mergeOpenBookAdditively,
    ]
  );

  // Register callbacks for conversion events - stays mounted even when Library tab is inactive
  useEffect(() => {
    const unregister = registerCallbacks({
      onConversionComplete: async (book: Book | null, bookId?: string | null) => {
        // Refresh the completed book to get updated chapters/audio tracks
        if (bookId) {
          await refreshBookById(bookId);
        } else if (book) {
          setLibrary((prevBooks) =>
            prevBooks.map((b) => (b.id === book.id ? book : b))
          );
          if (currentBook?.id === book.id) {
            const wasPlaying = Boolean(
              audioRef.current && !audioRef.current.paused
            );
            await saveAudioProgress(currentBook);
            setCurrentBookWithLoading(book, wasPlaying);
          }
        }
      },
      onChapterCompleted: (bookId: string | null) =>
        refreshBookById(bookId, true),
      onConversionCancelled: refreshBookById,
      onConversionStarted: (bookId: string | null) => {
        if (!bookId) return;
        setLibrary((prevBooks) =>
          prevBooks.map((book) =>
            book.id === bookId
              ? { ...book, conversionStatus: "started" as const }
              : book
          )
        );
      },
    });

    return unregister;
  }, [registerCallbacks, refreshBookById, currentBook, setLibrary, setCurrentBookWithLoading, audioRef, saveAudioProgress]);

  return null;
}

/** Flush chapter + audio progress when Rust emits `app-closing` on quit. */
function AppClosingHandler() {
  const { currentBook } = useAppContext();
  const { saveProgress } = useChapterProgressContext();
  const { saveAudioProgress } = useAudioProgressContext();
  const currentBookRef = useRef(currentBook);

  useEffect(() => {
    currentBookRef.current = currentBook;
  }, [currentBook]);

  useEffect(() => {
    const unlisten = listen("app-closing", async () => {
      const book = currentBookRef.current;
      if (!book) return;
      logger.info("[app-closing] flushing progress before quit", {
        bookId: book.id,
      });
      try {
        await Promise.all([saveProgress(book), saveAudioProgress(book)]);
      } catch (err) {
        logger.error("[app-closing] failed to save progress:", err);
      }
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [saveProgress, saveAudioProgress]);

  return null;
}

function AppWithProviders() {
  const {
    saveProgress,
    restoreProgress,
    loadLastOpenedChapter,
    calculateBookProgress,
  } = useChapterProgressContext();
  const {
    loadLastOpenedAudioTrack,
    loadAudioTrack,
    calculateAudioProgress,
    saveAudioProgress,
  } = useAudioProgressContext();

  // Wrap saveProgress to match AppProvider's expected signature
  const saveChapterProgress = useCallback(
    async (book: Book) => {
      await saveProgress(book);
    },
    [saveProgress]
  );

  // Wrap restoreProgress to match AppProvider's expected signature
  const restoreChapterProgress = useCallback(
    async (book: Book) => {
      restoreProgress(book);
    },
    [restoreProgress]
  );

  return (
    <AppProvider
      calculateBookProgress={calculateBookProgress}
      loadAudioTrack={loadAudioTrack}
      saveChapterProgress={saveChapterProgress}
      restoreChapterProgress={restoreChapterProgress}
      loadLastOpenedChapter={loadLastOpenedChapter}
      loadLastOpenedAudioTrack={loadLastOpenedAudioTrack}
      calculateAudioProgress={calculateAudioProgress}
      saveAudioProgress={saveAudioProgress}
    >
      <AppClosingHandler />
      <ConversionCallbackHandler />
      <AppContent />
    </AppProvider>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ConversionStateProvider>
        <AudioExportStateProvider>
          <SettingsProvider>
            <AudioSyncProvider>
              <ChapterProgressProvider>
                <AudioProgressProvider>
                  <AppWithProviders />
                </AudioProgressProvider>
              </ChapterProgressProvider>
            </AudioSyncProvider>
          </SettingsProvider>
        </AudioExportStateProvider>
      </ConversionStateProvider>
      <Toaster richColors position="top-center" className="max-w-sm" />
    </ErrorBoundary>
  );
}

export default App;
