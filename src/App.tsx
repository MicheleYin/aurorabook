
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { LibraryPanel } from "./components/LibraryPanel";
import { ReaderPanel } from "./components/ReaderPanel";
import { ReaderAudioPlayer } from "./components/reader/ReaderAudioPlayer";
import { BookDetailDialog } from "./components/library/BookDetailDialog";
import { ConvertToAudiobookDialog } from "./components/library/ConvertToAudiobookDialog";
import { Toaster } from "./components/ui/sonner";
import { LoadingScreen } from "./components/app/LoadingScreen";
import { SettingsPanel } from "./components/SettingsPanel";
import { useLibrary } from "./hooks/useLibrary";
import { LibraryProvider } from "./hooks/library/LibraryContext";
import { usePersistentSettings } from "./hooks/usePersistentSettings";
import { useBookConversion } from "./hooks/useBookConversion";
import { useAppNavigation } from "./hooks/useAppNavigation";
import { AppContextProvider, useAppContext } from "./contexts/AppContext";
import { useResolvedTheme } from "./hooks/useResolvedTheme";
import type { ChapterSelectionOptions, AudioProgressSnapshot } from "./components/reader/types";
import { cn } from "./lib/utils";
import { animPatterns, viewTransition } from "./lib/animations";
import { findChaptersForAudioTrack } from "./lib/epub";

function AppContent({ libraryHook }: { libraryHook: ReturnType<typeof useLibrary> }) {
  const {
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
    flushProgressUpdate,
  } = libraryHook;

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
    
    setPendingFragment,
    
    isReaderChromeVisible,
    setIsReaderChromeVisible,
    detailBookId,
    setDetailBookId,
    handleSelectBook: handleSelectBookContext,
  } = useAppContext();

  const {
    showConvertDialog,
    setShowConvertDialog,
    pendingBookForConversion,
    setPendingBookForConversion,
    isConverting,
    bookConversionProgress,
    isCancelling,
    cancellingBookId,
    conversionStartTimeRef,
    handleConvertToAudiobook,
    handleConvertBookFromDetail,
    cancelConversionForBook,
  } = useBookConversion(setLibrary, ingestEpub, refreshLibrary);

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
  const resolvedUiTheme = useResolvedTheme(uiTheme);

  // Load auto-scroll setting from persistent settings
  useEffect(() => {
    if (isSettingsHydrated && settings.autoScrollEnabled !== undefined) {
      setAutoScrollEnabled(settings.autoScrollEnabled);
    }
  }, [isSettingsHydrated, settings.autoScrollEnabled]);


  // Apply theme to document
  useEffect(() => {
    if (typeof document === "undefined") return;

    const root = document.documentElement;
    root.classList.toggle("dark", resolvedUiTheme === "dark");

    if (uiTheme !== "system") {
      return;
    }

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = () => {
      const systemResolved = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
      root.classList.toggle("dark", systemResolved === "dark");
    };
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, [uiTheme, resolvedUiTheme]);

  // Ref to save progress from ReaderViewport
  const saveProgressRef = useRef<(() => void) | null>(null);

  const handleSelectChapter = useCallback(async (chapterId: string, options?: ChapterSelectionOptions) => {
    if (!activeBookId) return;

    // Save progress before changing chapters
    if (saveProgressRef.current && activeChapterId) {
      console.log("[App] Saving progress before chapter change", {
        bookId: activeBookId,
        fromChapterId: activeChapterId,
        toChapterId: chapterId,
        source: options?.isManualSelection ? "manual" : "navigation",
      });
      saveProgressRef.current();
      // Flush the debounced save immediately
      await flushProgressUpdate();
    } else if (!saveProgressRef.current) {
      console.debug("[App] No saveProgress function available", {
        bookId: activeBookId,
        chapterId,
      });
    }

    // Disable auto-scroll on manual selection
    if (options?.isManualSelection && autoScrollEnabled) {
      console.log("[App] Disabling auto-scroll due to manual chapter selection");
      setAutoScrollEnabled(false);
      updateSettings({ autoScrollEnabled: false });
      toast.info("Auto-scroll disabled", {
        description: "Auto-scroll was disabled because you manually selected a chapter",
        duration: 3000,
      });
    }

    setActiveChapterId(chapterId);

    
  
    // Update progress based on scroll position request
    const requestedScrollPosition = options?.scrollPosition ?? "maintain";
    const progressUpdate: { chapterId: string; scrollTop?: number; scrollHeight?: number; clientHeight?: number; percent?: number } = { chapterId };

    if (requestedScrollPosition === "top") {
      progressUpdate.scrollTop = 0;
      progressUpdate.scrollHeight = 0;
      progressUpdate.clientHeight = 0;
      progressUpdate.percent = 0;
    } else if (requestedScrollPosition === "bottom") {
      progressUpdate.percent = 1;
    } else if (requestedScrollPosition === "maintain") {
      // When maintaining scroll position, check if this chapter has saved progress
      // If it does, preserve the saved scroll position values
      // This is important for restoration - we don't want to reset progress when restoring
      const activeBook = library.find(b => b.id === activeBookId);
      if (activeBook?.progress && activeBook.progress.currentChapterId === chapterId) {
        // Chapter has saved progress - preserve it
        if (activeBook.progress.currentChapterScrollTop !== undefined) {
          progressUpdate.scrollTop = activeBook.progress.currentChapterScrollTop;
        }
        if (activeBook.progress.currentChapterScrollHeight !== undefined) {
          progressUpdate.scrollHeight = activeBook.progress.currentChapterScrollHeight;
        }
        if (activeBook.progress.currentChapterClientHeight !== undefined) {
          progressUpdate.clientHeight = activeBook.progress.currentChapterClientHeight;
        }
        if (activeBook.progress.chapterProgressPercent !== undefined) {
          progressUpdate.percent = activeBook.progress.chapterProgressPercent;
        }
      }
      // If chapter doesn't have saved progress, don't set these values
      // updateBookProgress will handle it appropriately
    }

    console.log("[App] Updating progress for new chapter", {
      bookId: activeBookId,
      chapterId,
      scrollPosition: requestedScrollPosition,
      progressUpdate,
    });

    updateBookProgress(activeBookId, progressUpdate);

    const fragment = options?.fragment;
    setPendingFragment(fragment && fragment.length > 0 ? fragment.replace(/^#/, "") : null);
    setActiveView("reader");
  }, [activeBookId, activeChapterId, autoScrollEnabled, setAutoScrollEnabled, updateSettings, setActiveChapterId, updateBookProgress, setPendingFragment, setActiveView, flushProgressUpdate]);

  // Inline useAudioPlayer functionality (UI state management)
  const [isAudioPlayerOpen, setIsAudioPlayerOpen] = useState(false);
  const [isAudioPlayerDismissing, setIsAudioPlayerDismissing] = useState(false);
  const [currentAudioTrackHref, setCurrentAudioTrackHref] = useState<string | undefined>(undefined);
  const [currentAudioProgress, setCurrentAudioProgress] = useState<AudioProgressSnapshot | undefined>(undefined);
  const hasAudioTracks = (activeBook?.audioTracks?.length ?? 0) > 0;
  const showAudioPlayer = hasAudioTracks && (isAudioPlayerOpen || isAudioPlayerDismissing);

  const handleAudioPlayerClose = useCallback(() => {
    // Start dismissal immediately for responsive UI
    setIsAudioPlayerDismissing(true);
    // Wait for exit animation to complete before unmounting
    // The audio player component also has its own timeout, but we need this
    // to update the showAudioPlayer condition after animation completes
    setTimeout(() => {
      setIsAudioPlayerOpen(false);
      setIsAudioPlayerDismissing(false);
    }, 500); // Match animation duration
  }, []);

  const handleProgress = useCallback((snapshot: AudioProgressSnapshot) => {
    setCurrentAudioTrackHref(snapshot.trackHref);
    setCurrentAudioProgress(snapshot);
  }, []);

  const handleAutoScrollToggle = useCallback((enabled: boolean) => {
    setAutoScrollEnabled(enabled);
    updateSettings({ autoScrollEnabled: enabled });
    
    // When enabling sync, sync the chapter to the current audio track
    if (enabled && currentAudioTrackHref && activeBook) {
      // Find chapters that use this audio track
      const chapterHrefs = findChaptersForAudioTrack(activeBook.audioSyncMap, currentAudioTrackHref);
      if (chapterHrefs.length > 0) {
        // Find the first matching chapter by comparing hrefs
        // Normalize hrefs by removing fragment identifiers for comparison
        const normalizedChapterHrefs = chapterHrefs.map(href => href.split("#")[0]);
        
        const matchingChapter = activeBook.chapters.find((chapter) => {
          const chapterBaseHref = chapter.href.split("#")[0];
          return normalizedChapterHrefs.some(normalizedHref => {
            // Compare with and without OEBPS prefix
            return chapterBaseHref === normalizedHref ||
                   chapterBaseHref === normalizedHref.replace(/^OEBPS\//, "") ||
                   chapterBaseHref === `OEBPS/${normalizedHref}` ||
                   `OEBPS/${chapterBaseHref}` === normalizedHref;
          });
        });

        if (matchingChapter && matchingChapter.id !== activeChapterId) {
          console.log("[App] Syncing chapter to current audio track", {
            trackHref: currentAudioTrackHref,
            chapterId: matchingChapter.id,
            chapterTitle: matchingChapter.title,
          });
          handleSelectChapter(matchingChapter.id, {
            scrollPosition: "top",
            isManualSelection: false,
          });
        }
      }
    }
    
    if (enabled) {
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
  }, [setAutoScrollEnabled, updateSettings, currentAudioTrackHref, activeBook, activeChapterId, handleSelectChapter]);

  const handleTrackChange = useCallback((trackHref: string) => {
    // Only change chapters if auto-scroll (sync) is enabled
    // When auto-scroll is disabled (e.g., after manual chapter selection),
    // audio should continue playing without changing chapters
    if (!autoScrollEnabled || !activeBook) {
      console.debug("[App] Track change ignored - auto-scroll disabled or no active book", {
        trackHref,
        autoScrollEnabled,
        hasActiveBook: !!activeBook,
      });
      return;
    }

    // Find chapters that use this audio track
    const chapterHrefs = findChaptersForAudioTrack(activeBook.audioSyncMap, trackHref);
    if (chapterHrefs.length === 0) {
      console.debug("[App] No chapters found for audio track", { trackHref });
      return;
    }

    // Find the first matching chapter by comparing hrefs
    // Normalize hrefs by removing fragment identifiers for comparison
    const normalizedChapterHrefs = chapterHrefs.map(href => href.split("#")[0]);
    
    const matchingChapter = activeBook.chapters.find((chapter) => {
      const chapterBaseHref = chapter.href.split("#")[0];
      return normalizedChapterHrefs.some(normalizedHref => {
        // Compare with and without OEBPS prefix
        return chapterBaseHref === normalizedHref ||
               chapterBaseHref === normalizedHref.replace(/^OEBPS\//, "") ||
               chapterBaseHref === `OEBPS/${normalizedHref}` ||
               `OEBPS/${chapterBaseHref}` === normalizedHref;
      });
    });

    if (matchingChapter && matchingChapter.id !== activeChapterId) {
      console.log("[App] Changing chapter to match audio track", {
        trackHref,
        chapterId: matchingChapter.id,
        chapterTitle: matchingChapter.title,
      });
      handleSelectChapter(matchingChapter.id, {
        scrollPosition: "top",
        isManualSelection: false,
      });
    }
  }, [autoScrollEnabled, activeBook, activeChapterId, handleSelectChapter]);

  // Auto-open audio player when switching to reader view
  useEffect(() => {
    if (activeView === "reader" && hasAudioTracks) {
      setIsAudioPlayerOpen(true);
    }
  }, [activeView, hasAudioTracks]);

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

  // Auto-scroll toast is now shown in handleAutoScrollToggle (in useAudioPlayer)

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
      conversionStartTimeRef={conversionStartTimeRef}
    />
  );

  const readerView = (
    <ReaderPanel
      activeBook={activeBook}
      activeChapter={activeChapter}
      preferences={readerPreferences}
      onPreferencesChange={updateReaderPreferences}
      onSelectChapter={handleSelectChapter}
      onNavigateLibrary={async () => {
        // Save progress before navigating away
        if (saveProgressRef.current && activeChapterId) {
          console.log("[App] Saving progress before navigating to library", {
            bookId: activeBookId,
            fromChapterId: activeChapterId,
            toChapterId: undefined,
            source: "navigation",
          });
          saveProgressRef.current();
          // Flush the debounced save immediately
          await flushProgressUpdate();
        }
        setActiveView("library");
      }}
      resolvedUiTheme={resolvedUiTheme}
      onChapterProgress={handleChapterProgress}
      onChromeVisibilityChange={setIsReaderChromeVisible}
      audioPlayerVisible={Boolean(activeBook?.audioTracks?.length) && isAudioPlayerOpen}
      onOpenAudioPlayer={() => setIsAudioPlayerOpen(true)}
      currentAudioTrackHref={currentAudioTrackHref}
      onSaveProgress={(saveFn) => {
        saveProgressRef.current = saveFn;
      }}
      autoScrollEnabled={autoScrollEnabled}
      currentAudioProgress={currentAudioProgress}
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
      <div className="mx-auto flex w-full flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8 safe-area-top">
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
          key={activeBook.id}
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
          onTrackChange={handleTrackChange}
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
                onClick={async () => {
                  if (isDisabled) return;
                  // Save progress before navigating away from reader
                  if (activeView === "reader" && item.id !== "reader" && saveProgressRef.current && activeChapterId) {
                    console.log("[App] Saving progress before navigating to", item.id, "from", saveProgressRef.current,activeChapterId);
                    saveProgressRef.current();
                    // Flush the debounced save immediately
                    await flushProgressUpdate();
                  }
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
          onCancelConversion={cancelConversionForBook}
          conversionStartTimeRef={conversionStartTimeRef}
          isCancelling={isCancelling && cancellingBookId === detailBook.id}
        />
      ) : null}
      {pendingBookForConversion ? (
        <ConvertToAudiobookDialog
          open={showConvertDialog && !isConverting && !isCancelling}
          onOpenChange={(open) => {
            if (!isConverting && !isCancelling) {
              setShowConvertDialog(open);
              if (!open) {
                setPendingBookForConversion(null);
              }
            }
          }}
          onConfirm={handleConvertToAudiobook}
          bookTitle={pendingBookForConversion.book.title}
        />
      ) : null}
      <Toaster position="top-center" richColors />
    </div>
  );
}

function App() {
  return (
    <LibraryProvider>
      <AppWithLibrary />
    </LibraryProvider>
  );
}

function AppWithLibrary() {
  const libraryHook = useLibrary();

  return (
    <AppContextProvider
      library={libraryHook.library}
      setLibrary={libraryHook.setLibrary}
      updateBookProgress={libraryHook.updateBookProgress}
    >
      <AppContent libraryHook={libraryHook} />
    </AppContextProvider>
  );
}

export default App;
