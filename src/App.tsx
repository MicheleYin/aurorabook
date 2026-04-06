import { useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

import type { Book } from "./types/book";
import { FloatingAudioPlayer } from "./components/audio/FloatingAudioPlayer";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Library } from "./components/library/Library";
import { Reader } from "./components/reader/Reader";
import { Settings } from "./components/settings/SettingsPanel";
import { Toaster } from "./components/ui/sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import { AppProvider, TabValue, useAppContext } from "./context/AppContext";
import {
  AudioProgressProvider,
  useAudioProgressContext,
} from "./context/AudioProgressContext";
import { AudioSyncProvider } from "./context/AudioSyncContext";
import {
  ChapterProgressProvider,
  useChapterProgressContext,
} from "./context/ChapterProgressContext";
import { ConversionEventProvider } from "./context/ConversionEventContext";
import { ConversionStateProvider } from "./context/ConversionStateContext";
import { SettingsProvider } from "./context/SettingsContext";
import { useBookConversion } from "./hooks/useBookConversion";
import { logger } from "./lib/logger";

function AppContent() {
  const { currentTab, setCurrentTab, currentBook } = useAppContext();

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
            className="h-full overflow-auto m-0"
          >
            <Library />
          </TabsContent>
          <TabsContent value="reader" className="h-full overflow-auto m-0">
            <Reader />
          </TabsContent>
          <TabsContent value="settings" className="h-full overflow-auto m-0">
            <Settings />
          </TabsContent>
        </main>
        <div className="absolute bottom-0 left-0 right-0 flex justify-center pb-4 pointer-events-none z-10">
          <TabsList className="rounded-full bg-background/80 backdrop-blur-lg border shadow-lg px-1 py-2 gap-1 pointer-events-auto">
            <TabsTrigger
              value="library"
              className="rounded-full px-4 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground transition-all"
            >
              Library
            </TabsTrigger>
            <TabsTrigger
              value="reader"
              disabled={!currentBook}
              className="rounded-full px-4 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground transition-all"
            >
              Reader
            </TabsTrigger>
            <TabsTrigger
              value="settings"
              className="rounded-full px-4 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground transition-all"
            >
              Settings
            </TabsTrigger>
          </TabsList>
        </div>
      </Tabs>
      <FloatingAudioPlayer />
    </div>
  );
}

function ConversionCallbackHandler() {
  const { currentBook, setLibrary, setCurrentBookWithLoading, loadBooks } = useAppContext();
  const { saveAudioProgress } = useAudioProgressContext();
  const { registerCallbacks } = useBookConversion();

  // Refresh a single book from backend (for chapters/audio tracks)
  const refreshBookById = useCallback(
    async (bookId: string | null) => {
      if (!bookId) return;
      try {
        const updatedBook = await invoke<Book | null>("read_one_book", {
          bookId,
        });

        if (updatedBook) {
          // Update library state
          setLibrary((prevBooks) =>
            prevBooks.map((book) =>
              book.id === updatedBook.id ? updatedBook : book
            )
          );

          // Keep reader state in sync when book is currently open
          if (currentBook?.id === updatedBook.id) {
            const wasPlaying = true; // Reader will handle audio state
            saveAudioProgress(updatedBook);
            setCurrentBookWithLoading(updatedBook, wasPlaying);
            logger.log("Refreshed currently open book from completion event");
          }
        }
      } catch (err) {
        logger.error("Failed to refresh book from completion event:", err);
        // Fallback to reloading all books
        await loadBooks();
      }
    },
    [currentBook, setLibrary, setCurrentBookWithLoading, saveAudioProgress, loadBooks]
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
            saveAudioProgress(book);
            setCurrentBookWithLoading(book, false);
          }
        }
      },
      onChapterCompleted: refreshBookById,
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
  }, [registerCallbacks, refreshBookById, currentBook, setLibrary, setCurrentBookWithLoading, saveAudioProgress]);

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
      <ConversionCallbackHandler />
      <AppContent />
    </AppProvider>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ConversionEventProvider>
        <ConversionStateProvider>
          <SettingsProvider>
            <AudioSyncProvider>
              <ChapterProgressProvider>
                <AudioProgressProvider>
                  <AppWithProviders />
                </AudioProgressProvider>
              </ChapterProgressProvider>
            </AudioSyncProvider>
          </SettingsProvider>
        </ConversionStateProvider>
        <Toaster richColors position="top-center" className="max-w-sm" />
      </ConversionEventProvider>
    </ErrorBoundary>
  );
}

export default App;
