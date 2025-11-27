import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { LibraryPanel } from "./components/LibraryPanel";
import { ReaderPanel } from "./components/ReaderPanel";
import { ReaderAudioPlayer } from "./components/reader/ReaderAudioPlayer";
import { BookDetailDialog } from "./components/library/BookDetailDialog";
import { ConvertToAudiobookDialog } from "./components/library/ConvertToAudiobookDialog";
import { ConversionProgressDialog } from "./components/library/ConversionProgressDialog";
import { Toaster } from "./components/ui/sonner";
import { LoadingScreen } from "./components/app/LoadingScreen";
import { SettingsPanel } from "./components/SettingsPanel";
import { usePersistentLibrary } from "./hooks/usePersistentLibrary";
import { usePersistentSettings } from "./hooks/usePersistentSettings";
import { useBookConversion } from "./hooks/useBookConversion";
import { useAudioPlayer } from "./hooks/useAudioPlayer";
import { useAppNavigation } from "./hooks/useAppNavigation";
import { useBookProgress } from "./hooks/useBookProgress";
import { AppContextProvider, useAppContext } from "./contexts/AppContext";
import type { UITheme } from "./types/ui";
import type { ChapterSelectionOptions } from "./components/reader/types";
import { cn } from "./lib/utils";
import { animPatterns, viewTransition } from "./lib/animations";

function AppContent() {
  const {
    library,
    setLibrary,
    isHydrated,
    isImporting,
    importFromDialog,
    ingestEpub,
    refreshLibrary,
  } = usePersistentLibrary();

  const {
    settings,
    updateSettings,
    isHydrated: isSettingsHydrated,
  } = usePersistentSettings();

  const {
    activeBookId,
    setActiveBookId,
    activeChapterId,
    setActiveChapterId,
    activeBook,
    activeChapter,
    readerPreferences,
    updateReaderPreferences,
    pendingFragment,
    setPendingFragment,
    handleFragmentConsumed,
    isReaderChromeVisible,
    setIsReaderChromeVisible,
    detailBookId,
    setDetailBookId,
    handleSelectBook: handleSelectBookContext,
  } = useAppContext();

  const {
    updateBookProgress,
    updateBookAudioState,
    handleChapterProgress,
  } = useBookProgress(library, setLibrary);

  const {
    showConvertDialog,
    setShowConvertDialog,
    pendingBookForConversion,
    setPendingBookForConversion,
    isConverting,
    conversionProgress,
    bookConversionProgress,
    convertingBookIdRef,
    handleConvertToAudiobook,
    handleConvertBookFromDetail,
    cancelConversionForBook,
  } = useBookConversion(setLibrary, ingestEpub);

  const {
    activeView,
    setActiveView,
    librarySearchTerm,
    setLibrarySearchTerm,
    libraryFilter,
    setLibraryFilter,
    libraryViewMode,
    setLibraryViewMode,
    navigationItems,
    previousViewRef,
  } = useAppNavigation(library, refreshLibrary, isHydrated);

  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);

  const uiTheme = settings.theme;

  // Load auto-scroll setting from persistent settings
  useEffect(() => {
    if (isSettingsHydrated && settings.autoScrollEnabled !== undefined) {
      setAutoScrollEnabled(settings.autoScrollEnabled);
    }
  }, [isSettingsHydrated, settings.autoScrollEnabled]);

  useEffect(() => {
    if (activeView !== "reader") {
      setIsReaderChromeVisible(true);
    }
  }, [activeView, setIsReaderChromeVisible]);

  const resolveTheme = (theme: UITheme): "light" | "dark" => {
    if (theme === "system") {
      if (
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches
      ) {
        return "dark";
      }
      return "light";
    }
    return theme;
  };

  const resolvedUiTheme = useMemo(
    () => resolveTheme(uiTheme),
    [uiTheme],
  );

  useEffect(() => {
    if (typeof document === "undefined") return;

    const root = document.documentElement;
    const applyTheme = (theme: UITheme) => {
      const resolved = resolveTheme(theme);
      root.classList.toggle("dark", resolved === "dark");
    };

    applyTheme(uiTheme);

    if (uiTheme !== "system") {
      return;
    }

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = () => applyTheme("system");
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, [uiTheme]);

  const handleSelectChapter = useCallback((chapterId: string, options?: ChapterSelectionOptions) => {
    if (!activeBookId) return;

    // If this is a manual selection (e.g., from TOC), track it and disable auto-scroll
    if (options?.isManualSelection) {
      console.log("[Chapter Selection] Manual chapter selection detected:", {
        chapterId,
        currentAutoScrollEnabled: autoScrollEnabled,
      });
      
      // Track manual selection FIRST to prevent auto-switch from overriding it
      // Always update the ref, even if it was already set, to allow selecting different chapters
      if (manualChapterSelectionRef) {
        manualChapterSelectionRef.current = {
          chapterId,
          timestamp: Date.now(),
        };
      }
      
      // Disable auto-scroll if it's currently enabled (don't re-enable automatically)
      // This allows manual chapter selection to work regardless of auto-scroll state
      if (autoScrollEnabled) {
        console.log("[Chapter Selection] Disabling auto-scroll due to manual selection");
        setAutoScrollEnabled(false);
        // Persist the setting so it remains disabled
        updateSettings({ autoScrollEnabled: false });
      }
    }

    setActiveChapterId(chapterId);

    const requestedScrollPosition = options?.scrollPosition ?? "maintain";
    const progressUpdate: { chapterId: string; scrollTop?: number; scrollHeight?: number; clientHeight?: number; percent?: number } = { chapterId };

    if (requestedScrollPosition === "top") {
      progressUpdate.scrollTop = 0;
      progressUpdate.scrollHeight = 0;
      progressUpdate.clientHeight = 0;
      progressUpdate.percent = 0;
    } else if (requestedScrollPosition === "bottom") {
      progressUpdate.percent = 1;
    }

    console.debug("[ReaderProgress] select chapter", {
      bookId: activeBookId,
      chapterId,
      requestedScrollPosition,
      progressUpdate,
      isManualSelection: options?.isManualSelection,
    });

    updateBookProgress(activeBookId, progressUpdate);

    const fragment = options?.fragment;
    setPendingFragment(fragment && fragment.length > 0 ? fragment.replace(/^#/, "") : null);
    setActiveView("reader");
  }, [activeBookId, autoScrollEnabled, setAutoScrollEnabled, updateSettings, setActiveChapterId, updateBookProgress, setPendingFragment, setActiveView]);

  const {
    isAudioPlayerOpen,
    setIsAudioPlayerOpen,
    currentAudioTime,
    currentAudioTrackHref,
    isAudioRestoring,
    setIsAudioRestoring,
    showAudioPlayer,
    handleAudioPlayerClose,
    handleProgress,
    handleAutoScrollToggle,
    manualChapterSelectionRef,
  } = useAudioPlayer(
    activeBook,
    activeChapterId,
    autoScrollEnabled,
    setAutoScrollEnabled,
    updateSettings,
    handleSelectChapter,
    ingestEpub,
    activeView,
  );

  const handleSelectBook = async (bookId: string) => {
    await handleSelectBookContext(bookId);
    setActiveView("reader");
  };

  const handleAddEbook = async () => {
    if (isImporting) return;
    
    const result = await importFromDialog();
    if (!result) {
      // User cancelled or not in Tauri environment
      return;
    }
    
    // Check if result contains book info (for conversion check)
    if (typeof result === "object" && "book" in result && "buffer" in result) {
      const { book } = result;
      // Check if book needs conversion (no audio tracks)
      if (book.audioTracks.length === 0) {
        // Only show conversion dialog if not already converting
        if (!isConverting) {
          setPendingBookForConversion({ book, buffer: result.buffer });
          setShowConvertDialog(true);
        } else {
          // Book is imported, but conversion dialog is skipped while another conversion is in progress
          toast.info("Ebook imported", {
            description: "You can convert it to an audiobook after the current conversion completes.",
          });
        }
      }
    }
  };

  const [deletingBookId, setDeletingBookId] = useState<string | null>(null);

  const handleDeleteBook = async (bookId: string) => {
    // Set deleting state
    setDeletingBookId(bookId);
    
    try {
      // If this book is currently being converted, cancel the conversion
      cancelConversionForBook(bookId);
      
      // Find the book first to get its sourcePath for cache cleanup
      const bookToDelete = library.find((book) => book.id === bookId);
      
      // Delete from Rust backend
      const { deleteBook } = await import("./lib/book-service");
      await deleteBook(bookId);
      
      // Update local state
      setLibrary((prev) => prev.filter((book) => book.id !== bookId));
      setDetailBookId(null);

      // Clear lazy loader cache
      if (bookToDelete) {
        try {
          const { clearBookCache } = await import("./lib/lazy-chapter-loader");
          clearBookCache(bookToDelete.sourcePath);
        } catch (error) {
          console.warn("Failed to clear book cache:", error);
        }
      }

      if (activeBookId === bookId) {
        setActiveBookId(undefined);
        setActiveChapterId(undefined);
        setPendingFragment(null);
        setActiveView("library");
      }
    } catch (error) {
      console.error("Failed to delete book from Rust backend:", error);
      toast.error("Failed to delete book", {
        description: error instanceof Error ? error.message : "An error occurred",
      });
    } finally {
      // Clear deleting state
      setDeletingBookId(null);
    }
  };

  // Show toast when auto-scroll state changes
  const previousAutoScrollEnabledRef = useRef<boolean | null>(null);
  useEffect(() => {
    // Skip on initial mount
    if (previousAutoScrollEnabledRef.current === null) {
      previousAutoScrollEnabledRef.current = autoScrollEnabled;
      return;
    }

    // Only show toast if state actually changed
    if (previousAutoScrollEnabledRef.current !== autoScrollEnabled) {
      if (autoScrollEnabled) {
        toast.success("Auto-scroll enabled", {
          description: "The page will automatically scroll to follow the audio",
          duration: 2000,
        });
      } else {
        toast.info("Auto-scroll disabled", {
          description: "The page will no longer automatically scroll",
          duration: 2000,
        });
      }
      previousAutoScrollEnabledRef.current = autoScrollEnabled;
    }
  }, [autoScrollEnabled]);

  // Use library directly since filtering is done by backend
  const filteredLibrary = library;

  const audioPlayerChromeVisible = activeView === "reader" ? isReaderChromeVisible : true;

  const libraryView = (
    <LibraryPanel
      library={filteredLibrary}
      totalBooks={library.length}
      searchTerm={librarySearchTerm}
      onSearchChange={setLibrarySearchTerm}
      activeFilter={libraryFilter}
      onFilterChange={setLibraryFilter}
      viewMode={libraryViewMode}
      onViewModeChange={setLibraryViewMode}
      activeBookId={activeBookId}
      isImporting={isImporting}
      onAddEbook={handleAddEbook}
      onOpenBook={handleSelectBook}
      onViewDetails={(bookId) => setDetailBookId(bookId)}
      bookConversionProgress={bookConversionProgress}
    />
  );

  const readerView = (
    <ReaderPanel
      activeBook={activeBook}
      activeChapter={activeChapter}
      preferences={readerPreferences}
      onPreferencesChange={updateReaderPreferences}
      onSelectChapter={handleSelectChapter}
      pendingFragment={pendingFragment}
      onFragmentConsumed={handleFragmentConsumed}
      onNavigateLibrary={() => setActiveView("library")}
      resolvedUiTheme={resolvedUiTheme}
      onChapterProgress={handleChapterProgress}
      onChromeVisibilityChange={setIsReaderChromeVisible}
      audioPlayerVisible={Boolean(activeBook?.audioTracks?.length) && isAudioPlayerOpen}
      onOpenAudioPlayer={() => setIsAudioPlayerOpen(true)}
      currentAudioTime={currentAudioTime}
      currentAudioTrackHref={currentAudioTrackHref}
      autoScrollEnabled={autoScrollEnabled}
      isAudioRestoring={isAudioRestoring}
    />
  );

  const detailBook = useMemo(() => {
    if (!detailBookId) return undefined;
    return library.find((book) => book.id === detailBookId);
  }, [detailBookId, library]);

  const settingsView = <SettingsPanel settings={settings} onSettingsChange={updateSettings} />;
  const currentView =
    activeView === "settings"
      ? settingsView
      : activeView === "library"
        ? libraryView
        : readerView;
  const hideNavigation = activeView === "reader" && !isReaderChromeVisible;

  if (!isHydrated || !isSettingsHydrated) {
    return <LoadingScreen message="Loading your library…" />;
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8 safe-area-top">
        <div 
          className={cn(
            "flex flex-1 min-h-0 flex-col",
            viewTransition(previousViewRef.current, activeView)
          )}
          key={activeView}
        >
          {currentView}
        </div>
      </div>
      {showAudioPlayer && activeBook ? (
        <ReaderAudioPlayer
          bookId={activeBook.id}
          tracks={activeBook.audioTracks}
          bookTitle={activeBook.title}
          sourcePath={activeBook.sourcePath}
          initialAudioState={activeBook.audioState}
          onProgress={(snapshot) => {
            updateBookAudioState(activeBook.id, snapshot);
            handleProgress(snapshot);
          }}
          chromeVisible={audioPlayerChromeVisible}
          onClose={handleAudioPlayerClose}
          autoScrollEnabled={autoScrollEnabled}
          onAutoScrollToggle={handleAutoScrollToggle}
          onRestorationStateChange={setIsAudioRestoring}
        />
      ) : null}
      <div
        className={cn(
          "pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-6 sm:px-6 safe-area-bottom",
          animPatterns.navBar,
          hideNavigation ? "nav-bar-exit" : "nav-bar-enter",
        )}
        style={{
          paddingBottom: `calc(1.5rem + env(safe-area-inset-bottom))`,
        }}
      >
        <div
          className={cn(
            "pointer-events-auto inline-flex items-center gap-1 rounded-full border border-border bg-card/80 p-1 shadow-lg ring-1 ring-black/5",
            // Enhanced backdrop blur when visible
            hideNavigation ? "backdrop-blur-sm" : "backdrop-blur-xl",
            // Smooth transition for backdrop blur
            "transition-[backdrop-filter] duration-300 ease-in-out",
            hideNavigation && "pointer-events-none",
          )}
        >
          {navigationItems.map((item) => {
            const isActive = activeView === item.id;
            const isDisabled = Boolean(item.disabled);
            return (
              <button
                key={item.id}
                type="button"
                disabled={isDisabled}
                onClick={() => {
                  if (isDisabled) return;
                  setActiveView(item.id);
                }}
                className={cn(
                  "rounded-full px-4 py-1.5 text-sm font-medium",
                  animPatterns.buttonHover,
                  isActive
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-muted",
                  isDisabled && "cursor-not-allowed opacity-50 hover:bg-transparent",
                )}
                title={item.id === "reader" && isDisabled ? "Open a book to enter the reader" : undefined}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </div>
      {detailBook ? (
        <BookDetailDialog
          book={detailBook}
          open
          onClose={() => setDetailBookId(null)}
          onOpenBook={() => {
            setDetailBookId(null);
            handleSelectBook(detailBook.id);
          }}
          onDeleteBook={() => handleDeleteBook(detailBook.id)}
          isDeleting={deletingBookId === detailBook.id}
          conversionProgress={bookConversionProgress[detailBook.id]}
          onConvertToAudiobook={handleConvertBookFromDetail}
        />
      ) : null}
      {pendingBookForConversion ? (
        <>
          <ConvertToAudiobookDialog
            open={showConvertDialog && !isConverting}
            onOpenChange={(open) => {
              if (!isConverting) {
                setShowConvertDialog(open);
                if (!open) {
                  setPendingBookForConversion(null);
                }
              }
            }}
            onConfirm={handleConvertToAudiobook}
            bookTitle={pendingBookForConversion.book.title}
          />
          <ConversionProgressDialog
            open={isConverting && convertingBookIdRef.current === pendingBookForConversion.book.id}
            progress={conversionProgress}
            bookTitle={pendingBookForConversion.book.title}
          />
        </>
      ) : null}
      <Toaster position="top-center" richColors />
    </div>
  );
}

function App() {
  const {
    library,
    setLibrary,
  } = usePersistentLibrary();

  const { updateBookProgress } = useBookProgress(library, setLibrary);

  return (
    <AppContextProvider
      library={library}
      setLibrary={setLibrary}
      updateBookProgress={updateBookProgress}
    >
      <AppContent />
    </AppContextProvider>
  );
}

export default App;
