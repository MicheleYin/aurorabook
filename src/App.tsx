import { useEffect, useMemo, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { lazy, Suspense } from "react";

import { logger } from "./lib/logger";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Button } from "./components/ui/button";
import { Toaster } from "./components/ui/sonner";
import { LoadingScreen } from "./components/app/LoadingScreen";

// Lazy load heavy components for better code splitting and initial load performance
const ReaderAudioPlayer = lazy(() =>
  import("./components/reader/ReaderAudioPlayer").then((module) => ({
    default: module.ReaderAudioPlayer,
  }))
);

// Extracted view components
import { LibraryView } from "./components/app/views/LibraryView";
import { ReaderView } from "./components/app/views/ReaderView";
import { SettingsView } from "./components/app/views/SettingsView";
import { AppNavigation } from "./components/app/AppNavigation";
import { AppDialogs } from "./components/app/AppDialogs";

import { useLibrary } from "./hooks/useLibrary";
import { LibraryProvider } from "./hooks/library/LibraryContext";
import { usePersistentSettings } from "./hooks/settings/usePersistentSettings";
import { useAppNavigation } from "./hooks/useAppNavigation";
import { usePersistentReaderPreferences } from "./hooks/settings/usePersistentReaderPreferences";
import { useAppHandlers } from "./hooks/useAppHandlers";
import { useAppDispatch, useAppSelector } from "./store/hooks";
import { store } from "./store";
import { setLibrary, setIsHydrated } from "./store/slices/librarySlice";
import {
  selectLibrary,
  selectIsHydrated,
  selectIsImporting,
  selectCurrentBookId,
  selectCurrentBook,
  selectShowConvertDialog,
  selectPendingBookForConversion,
  selectIsConverting,
  selectBookConversionProgress,
  selectIsCancelling,
  selectCancellingBookId,
  selectConversionStartTime,
  selectFilteredLibrary,
} from "./store/selectors";
import { loadProgressChapter, loadProgressAudioTrack, selectBook } from "./store/thunks/readerThunks";
import { ingestEpub as ingestEpubThunk } from "./store/thunks/libraryThunks";
import { refreshLibrary as refreshLibraryThunk } from "./store/thunks/libraryThunks";
import { setAutoScrollEnabled } from "./store/slices/uiSlice";
import { setAudioPlayerOpen, setCurrentBookId, setCurrentChapterId } from "./store/slices/readerSlice";
import { setCurrentTab } from "./store/slices/navigationSlice";
import { useResolvedTheme } from "./hooks/useResolvedTheme";
import { cn } from "./lib/utils";
import { viewTransition } from "./lib/animations";

function AppContent({ libraryHook }: { libraryHook: ReturnType<typeof useLibrary> }) {
  // Get library state from Redux
  const library = useAppSelector(selectLibrary);
  const isHydrated = useAppSelector(selectIsHydrated);
  const isImporting = useAppSelector(selectIsImporting);

  // Keep library operations from hook for now (will migrate fully later)
  const {
    updateBookProgress,
    updateBookAudioState,
    handleChapterProgress,
    flushProgressUpdate,
    flushAudioStateUpdate,
  } = libraryHook;

  const {
    settings,
    updateSettings,
    isHydrated: isSettingsHydrated,
  } = usePersistentSettings();

  // Get state directly from Redux
  const dispatch = useAppDispatch();
  const activeBookId = useAppSelector(selectCurrentBookId);
  const activeBook = useAppSelector(selectCurrentBook);
  const activeChapter = useAppSelector((state) => {
    if (!activeBookId) return null;
    const book = state.library.books.find((b) => b.id === activeBookId);
    if (!book) return null;
    const chapterId = state.reader.currentChapterId;
    if (!chapterId) return null;
    return book.chapters.find((c) => c.id === chapterId) ?? null;
  });

  const {
    preferences: readerPreferences,
    updatePreferences: updateReaderPreferences,
  } = usePersistentReaderPreferences();

  // Auto-select first book/chapter when library changes
  useEffect(() => {
    if (!library.length) {
      dispatch(setCurrentBookId(null));
      dispatch(setCurrentChapterId(null));
      return;
    }

    // Only auto-select if no book is currently selected or the selected book doesn't exist
    if (!activeBookId || !library.some((book) => book.id === activeBookId)) {
      // Sort books by last opened time (most recent first), then fallback to first book
      const sortedBooks = [...library].sort((a, b) => {
        const aTime = a.lastOpenedTime ? new Date(a.lastOpenedTime).getTime() : 0;
        const bTime = b.lastOpenedTime ? new Date(b.lastOpenedTime).getTime() : 0;
        return bTime - aTime; // Descending order (most recent first)
      });
      const selectedBook = sortedBooks[0] || library[0]; // Fallback to first if no last opened time
      void dispatch(selectBook({ bookId: selectedBook.id }));
    }
  }, [library, activeBookId, dispatch]);

  const showConvertDialog = useAppSelector(selectShowConvertDialog);
  const pendingBookForConversion = useAppSelector(selectPendingBookForConversion);
  const isConverting = useAppSelector(selectIsConverting);
  const bookConversionProgress = useAppSelector(selectBookConversionProgress);
  const isCancelling = useAppSelector(selectIsCancelling);
  const cancellingBookId = useAppSelector(selectCancellingBookId);
  const conversionStartTime = useAppSelector(selectConversionStartTime);
  const conversionStartTimeRef = useRef(conversionStartTime);

  // Update ref when Redux state changes
  useEffect(() => {
    conversionStartTimeRef.current = conversionStartTime;
  }, [conversionStartTime]);

  // Conversion handlers
  const handleConvertToAudiobook = async (voiceId: string) => {
    if (!pendingBookForConversion || isConverting || isCancelling) return;
    const { convertBook } = await import("./store/thunks/conversionThunks");
    await dispatch(convertBook({ book: pendingBookForConversion.book, voiceId, closeDialog: true }));
    const { setPendingBook } = await import("./store/slices/conversionSlice");
    dispatch(setPendingBook(null));
  };

  const handleConvertBookFromDetail = async (book: any, voiceId: string) => {
    const { convertBook } = await import("./store/thunks/conversionThunks");
    const { toast } = await import("sonner");
    const conversionStatus = book.conversionStatus ?? "notStarted";
    if (book.audioTracks.length > 0 && conversionStatus === "notStarted") {
      return;
    }
    if (isConverting || isCancelling) {
      toast.warning("Conversion in progress", {
        description: isCancelling
          ? "Please wait for the cancellation to complete before starting a new conversion."
          : "Please wait for the current conversion to complete before starting another one.",
      });
      return;
    }
    await dispatch(convertBook({ book, voiceId }));
  };

  const cancelConversionForBook = async (bookId: string) => {
    const { cancelConversion } = await import("./store/thunks/conversionThunks");
    await dispatch(cancelConversion({ bookId }));
  };

  const {
    activeView,
    librarySearchTerm,
    setLibrarySearchTerm,
    libraryFilter,
    setLibraryFilter,
    libraryViewMode,
    setLibraryViewMode,
    navigationItems,
    previousViewRef,
  } = useAppNavigation(async () => {
    await dispatch(refreshLibraryThunk()).unwrap();
  }, isHydrated);

  const uiTheme = settings.theme;
  const resolvedUiTheme = useResolvedTheme(uiTheme);

  // Load auto-scroll setting from persistent settings
  useEffect(() => {
    if (isSettingsHydrated && settings.autoScrollEnabled !== undefined) {
      dispatch(setAutoScrollEnabled(settings.autoScrollEnabled));
    }
  }, [isSettingsHydrated, settings.autoScrollEnabled, dispatch]);

  // Load progress chapter and audio track when opening reader tab
  const currentTab = useAppSelector((state) => state.navigation.currentTab);
  const currentBookId = useAppSelector((state) => state.reader.currentBookId);
  const currentChapterId = useAppSelector((state) => state.reader.currentChapterId);
  const currentAudioTrackId = useAppSelector((state) => state.reader.currentAudioTrackId);
  const isChapterLoaded = useAppSelector((state) => {
    if (!currentBookId || !currentChapterId) return false;
    const book = state.library.books.find((b) => b.id === currentBookId);
    if (!book) return false;
    const chapter = book.chapters.find((c) => c.id === currentChapterId);
    return chapter?.contentHtml !== undefined;
  });
  const isAudioTrackLoaded = useAppSelector((state) => {
    if (!currentBookId || !currentAudioTrackId) return false;
    const book = state.library.books.find((b) => b.id === currentBookId);
    if (!book) return false;
    const track = book.audioTracks.find((t) => t.id === currentAudioTrackId);
    return track?.url !== undefined;
  });

  // Use refs to track loading state and prevent duplicate loads
  const chapterLoadAttemptedRef = useRef<string | null>(null);
  const trackLoadAttemptedRef = useRef<string | null>(null);
  const lastBookIdRef = useRef<string | null>(null);

  // Reset refs when book changes
  useEffect(() => {
    if (lastBookIdRef.current !== currentBookId) {
      chapterLoadAttemptedRef.current = null;
      trackLoadAttemptedRef.current = null;
      lastBookIdRef.current = currentBookId;
    }
  }, [currentBookId]);

  useEffect(() => {
    // Only load when reader tab is active and we have a book selected
    if (currentTab !== "reader" || !currentBookId) return;

    // Get book from Redux store directly to avoid object reference issues
    const state = store.getState();
    const book = state.library.books.find((b) => b.id === currentBookId);
    if (!book) return;

    // Load progress chapter if not already loaded and not already attempted
    if (currentChapterId && !isChapterLoaded && book.progress?.currentChapterId === currentChapterId) {
      const chapter = book.chapters.find((c) => c.id === currentChapterId);
      const loadKey = `${currentBookId}-${currentChapterId}`;

      if (chapter && !chapter.contentHtml && chapterLoadAttemptedRef.current !== loadKey) {
        logger.debug("[App] Loading progress chapter when opening reader", {
          bookId: currentBookId,
          chapterId: currentChapterId,
        });
        chapterLoadAttemptedRef.current = loadKey;
        dispatch(loadProgressChapter({ bookId: currentBookId, chapterId: currentChapterId }));
      }
    }

    // Load progress audio track if not already loaded and not already attempted
    if (currentAudioTrackId && !isAudioTrackLoaded && book.audioState?.currentTrackId === currentAudioTrackId) {
      const track = book.audioTracks.find((t) => t.id === currentAudioTrackId);
      const loadKey = `${currentBookId}-${currentAudioTrackId}`;

      if (track && !track.url && trackLoadAttemptedRef.current !== loadKey) {
        logger.debug("[App] Loading progress audio track when opening reader", {
          bookId: currentBookId,
          trackId: currentAudioTrackId,
        });
        trackLoadAttemptedRef.current = loadKey;
        dispatch(loadProgressAudioTrack({ bookId: currentBookId, trackId: currentAudioTrackId }));
      }
    }
  }, [currentTab, currentBookId, currentChapterId, currentAudioTrackId, isChapterLoaded, isAudioTrackLoaded, dispatch]);

  // Refs to track pending dynamic import promises for cleanup
  const lazyChapterLoaderPromiseRef = useRef<Promise<unknown> | null>(null);
  const domQueryCachePromiseRef = useRef<Promise<unknown> | null>(null);

  // Clear chapter cache when switching books to prevent memory accumulation
  useEffect(() => {
    if (activeBookId && activeBook) {
      let isCancelled = false;

      // Clear cache for all books except the currently active one
      const chapterLoaderPromise = import("./lib/lazy-chapter-loader").then(({ clearAllCachesExcept }) => {
        if (!isCancelled) {
          clearAllCachesExcept(activeBook.sourcePath);
        }
      });
      lazyChapterLoaderPromiseRef.current = chapterLoaderPromise;

      // Clear DOM query cache when switching books (memory optimization)
      const domCachePromise = import("./lib/dom-query-cache").then(({ clearAllCaches }) => {
        if (!isCancelled) {
          clearAllCaches();
        }
      });
      domQueryCachePromiseRef.current = domCachePromise;

      return () => {
        isCancelled = true;
        lazyChapterLoaderPromiseRef.current = null;
        domQueryCachePromiseRef.current = null;
      };
    }
  }, [activeBookId, activeBook?.sourcePath]);

  // Cleanup on app unmount (memory optimization)
  useEffect(() => {
    return () => {
      // Wait for any pending dynamic imports to complete before cleanup
      Promise.all([lazyChapterLoaderPromiseRef.current, domQueryCachePromiseRef.current])
        .then(() => {
          // Cleanup DOM query cache interval and clear caches
          import("./lib/dom-query-cache").then(({ cleanupDomQueryCache }) => {
            cleanupDomQueryCache();
          });
        })
        .catch(() => {
          // If imports fail, still try to cleanup
          import("./lib/dom-query-cache")
            .then(({ cleanupDomQueryCache }) => {
              cleanupDomQueryCache();
            })
            .catch(() => {
              // Ignore errors during cleanup
            });
        });
    };
  }, []);

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

  // Use the extracted handlers hook
  const handlers = useAppHandlers({
    library,
    updateBookProgress,
    updateBookAudioState,
    handleChapterProgress,
    flushProgressUpdate,
    flushAudioStateUpdate,
    updateSettings,
    setActiveView: (view: string) => {
      dispatch(setCurrentTab(view as "library" | "reader" | "settings"));
    },
    activeBook: activeBook ?? null,
    activeChapterId: useAppSelector((state) => state.reader.currentChapterId),
    activeBookId: activeBookId ?? null,
  });

  // Memoize hasAudioTracks
  const hasAudioTracks = useMemo(() => (activeBook?.audioTracks?.length ?? 0) > 0, [activeBook?.audioTracks?.length]);

  // Memoize showAudioPlayer
  const showAudioPlayer = useMemo(
    () => hasAudioTracks && (handlers.isAudioPlayerOpen || handlers.isAudioPlayerDismissing),
    [hasAudioTracks, handlers.isAudioPlayerOpen, handlers.isAudioPlayerDismissing]
  );

  // Auto-open audio player when switching to reader view
  useEffect(() => {
    if (activeView === "reader" && hasAudioTracks) {
      dispatch(setAudioPlayerOpen(true));
    }
  }, [activeView, hasAudioTracks, dispatch]);

  // Listen for file-opened events (when app is opened with an EPUB file)
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setupFileOpenListener = async () => {
      try {
        unlisten = await listen<string>("file-opened", async (event) => {
          const filePath = event.payload;
          logger.log("[App] File opened event received", { filePath });

          if (!filePath || !filePath.toLowerCase().endsWith(".epub")) {
            logger.warn("[App] Invalid file path in file-opened event", { filePath });
            return;
          }

          // Wait for library to be hydrated before ingesting
          if (!isHydrated) {
            logger.log("[App] Library not hydrated yet, waiting...");
            // Retry after a short delay
            if (handlers.fileOpenRetryTimeoutRef.current) {
              clearTimeout(handlers.fileOpenRetryTimeoutRef.current);
            }
            handlers.fileOpenRetryTimeoutRef.current = window.setTimeout(() => {
              handlers.fileOpenRetryTimeoutRef.current = null;
              setupFileOpenListener();
            }, 500);
            return;
          }

          if (isImporting) {
            logger.log("[App] Already importing, skipping file-opened event");
            return;
          }

          try {
            logger.log("[App] Ingesting EPUB from file-opened event", { filePath });
            const book = await dispatch(
              ingestEpubThunk({
                filePath,
                sourcePath: filePath,
              })
            ).unwrap();

            if (!book) {
              const { toast } = await import("sonner");
              toast.error("Failed to import EPUB file");
              return;
            }

            // Book is already added to Redux by ingestEpubThunk

            // Refresh library to ensure consistency
            await dispatch(refreshLibraryThunk());

            const { toast } = await import("sonner");
            toast.success("EPUB imported successfully", {
              description: `"${book.title}" has been added to your library.`,
            });

            // Check if book needs conversion (no audio tracks)
            if (book.audioTracks.length === 0 && !isConverting) {
              // Get EPUB buffer for conversion
              const { getEpubBuffer } = await import("./lib/book-service");
              const buffer = (await getEpubBuffer(filePath)) ?? new ArrayBuffer(0);
              const { setPendingBook } = await import("./store/slices/conversionSlice");
              const { setShowDialog } = await import("./store/slices/conversionSlice");
              dispatch(setPendingBook({ book, buffer }));
              dispatch(setShowDialog(true));
            }
          } catch (error) {
            logger.error("[App] Failed to ingest EPUB from file-opened event", error);
            const { toast } = await import("sonner");
            toast.error("Failed to import EPUB file", {
              description: error instanceof Error ? error.message : String(error),
            });
          }
        });
      } catch (error) {
        logger.warn("[App] Failed to set up file-opened listener", error);
      }
    };

    void setupFileOpenListener();

    return () => {
      if (unlisten) {
        unlisten();
      }
      if (handlers.fileOpenRetryTimeoutRef.current) {
        clearTimeout(handlers.fileOpenRetryTimeoutRef.current);
      }
    };
  }, [isHydrated, isImporting, dispatch, isConverting, handlers.fileOpenRetryTimeoutRef]);

  // Use memoized selector for filtered library (optimized with createSelector)
  const filteredLibrary = useAppSelector(selectFilteredLibrary);

  // Memoize audioPlayerChromeVisible
  const audioPlayerChromeVisible = useMemo(
    () => (activeView === "reader" ? handlers.isReaderChromeVisible : true),
    [activeView, handlers.isReaderChromeVisible]
  );

  // Memoize views
  const libraryView = useMemo(
    () => (
      <LibraryView
        library={filteredLibrary}
        totalBooks={library.length}
        searchTerm={librarySearchTerm}
        onSearchChange={setLibrarySearchTerm}
        activeFilter={libraryFilter}
        onFilterChange={setLibraryFilter}
        viewMode={libraryViewMode}
        onViewModeChange={setLibraryViewMode}
        activeBookId={activeBookId ?? undefined}
        isImporting={isImporting}
        onAddEbook={handlers.handleAddEbook}
        onOpenBook={handlers.handleSelectBook}
        onViewDetails={handlers.handleViewDetails}
        bookConversionProgress={bookConversionProgress}
        conversionStartTimeRef={conversionStartTimeRef}
      />
    ),
    [
      filteredLibrary,
      library.length,
      librarySearchTerm,
      setLibrarySearchTerm,
      libraryFilter,
      setLibraryFilter,
      libraryViewMode,
      setLibraryViewMode,
      activeBookId,
      isImporting,
      handlers.handleAddEbook,
      handlers.handleSelectBook,
      handlers.handleViewDetails,
      bookConversionProgress,
      conversionStartTimeRef,
    ]
  );

  const readerView = useMemo(
    () => (
      <ReaderView
        activeBook={activeBook ?? null}
        activeChapter={activeChapter}
        readerPreferences={readerPreferences}
        onPreferencesChange={updateReaderPreferences}
        onSelectChapter={handlers.handleSelectChapter}
        onNavigateLibrary={handlers.handleNavigateLibrary}
        resolvedUiTheme={resolvedUiTheme}
        uiTheme={uiTheme}
        onThemeChange={handlers.handleThemeChange}
        onChapterProgress={handleChapterProgress}
        onChromeVisibilityChange={handlers.setIsReaderChromeVisibleHandler}
        audioPlayerVisible={Boolean(activeBook?.audioTracks?.length) && handlers.isAudioPlayerOpen}
        onOpenAudioPlayer={handlers.handleOpenAudioPlayer}
        currentAudioTrackHref={handlers.currentAudioTrackHref ?? undefined}
        onSaveProgress={handlers.handleSaveProgress}
        autoScrollEnabled={handlers.autoScrollEnabled}
        currentAudioProgress={handlers.currentAudioProgress ?? undefined}
        onTrackChangeHandlerReady={handlers.handleTrackChangeHandlerReady}
        library={library}
        updateBookAudioState={updateBookAudioState}
        flushAudioStateUpdate={flushAudioStateUpdate}
        handleTrackChange={handlers.handleTrackChange}
      />
    ),
    [
      activeBook,
      activeChapter,
      readerPreferences,
      updateReaderPreferences,
      handlers.handleSelectChapter,
      handlers.handleNavigateLibrary,
      resolvedUiTheme,
      uiTheme,
      handlers.handleThemeChange,
      handleChapterProgress,
      handlers.setIsReaderChromeVisibleHandler,
      activeBook?.audioTracks?.length,
      handlers.isAudioPlayerOpen,
      handlers.handleOpenAudioPlayer,
      handlers.currentAudioTrackHref,
      handlers.handleSaveProgress,
      handlers.autoScrollEnabled,
      handlers.currentAudioProgress,
      handlers.handleTrackChangeHandlerReady,
      library,
      updateBookAudioState,
      flushAudioStateUpdate,
      handlers.handleTrackChange,
    ]
  );

  const detailBook = useMemo(() => {
    if (!handlers.detailBookId) return undefined;
    return library.find((book) => book.id === handlers.detailBookId);
  }, [handlers.detailBookId, library]);

  const settingsView = useMemo(
    () => <SettingsView settings={settings} onSettingsChange={updateSettings} />,
    [settings, updateSettings]
  );

  const currentView =
    activeView === "settings" ? settingsView : activeView === "library" ? libraryView : readerView;
  const hideNavigation = activeView === "reader" && !handlers.isReaderChromeVisible;

  if (!isHydrated || !isSettingsHydrated) {
    return <LoadingScreen message="Loading your library…" />;
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <div className="mx-auto flex w-full flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <div
          className={cn("flex flex-1 min-h-0 flex-col", viewTransition(previousViewRef.current, activeView))}
          key={activeView}
        >
          {currentView}
        </div>
      </div>
      {showAudioPlayer && activeBook ? (
        <Suspense
          fallback={
            <div className="flex items-center justify-center p-8">
              <div className="text-muted-foreground">Loading audio player...</div>
            </div>
          }
        >
          <ErrorBoundary
            fallback={
              <div className="flex flex-col items-center justify-center p-8 min-h-[200px] bg-card border border-border rounded-lg m-4">
                <h3 className="text-lg font-semibold mb-2">Audio Player Error</h3>
                <p className="text-sm text-muted-foreground mb-4 text-center">
                  The audio player encountered an error. You can continue reading without audio.
                </p>
                <Button onClick={() => dispatch(setAudioPlayerOpen(false))} variant="outline">
                  Close Audio Player
                </Button>
              </div>
            }
          >
            <ReaderAudioPlayer
              key={activeBook.id}
              bookId={activeBook.id}
              tracks={activeBook.audioTracks}
              bookTitle={activeBook.title}
              bookAuthor={activeBook.author}
              coverUrl={activeBook.coverUrl}
              sourcePath={activeBook.sourcePath}
              onProgress={(snapshot) => {
                updateBookAudioState(activeBook.id, snapshot);
                handlers.handleProgress(snapshot);
              }}
              chromeVisible={audioPlayerChromeVisible}
              onClose={handlers.handleAudioPlayerClose}
              autoScrollEnabled={handlers.autoScrollEnabled}
              onAutoScrollToggle={handlers.handleAutoScrollToggle}
              onTrackChange={handlers.handleTrackChange}
              audioSyncMap={activeBook.audioSyncMap}
              chapters={activeBook.chapters}
            />
          </ErrorBoundary>
        </Suspense>
      ) : null}
      <AppNavigation
        navigationItems={navigationItems}
        activeView={activeView}
        hideNavigation={hideNavigation}
        onNavigate={async (viewId) => {
          // Save progress before navigating away from reader
          if (activeView === "reader" && viewId !== "reader") {
            await handlers.saveProgress({
              source: `navigation-to-${viewId}`,
            });
          }
          dispatch(setCurrentTab(viewId as "library" | "reader" | "settings"));
        }}
      />
      <AppDialogs
        detailBook={detailBook}
        detailBookId={handlers.detailBookId}
        deletingBookId={handlers.deletingBookId}
        pendingBookForConversion={pendingBookForConversion}
        showConvertDialog={showConvertDialog}
        isConverting={isConverting}
        isCancelling={isCancelling}
        cancellingBookId={cancellingBookId}
        bookConversionProgress={bookConversionProgress}
        conversionStartTimeRef={conversionStartTimeRef}
        onSelectBook={handlers.handleSelectBook}
        onDeleteBook={handlers.handleDeleteBook}
        onConvertBookFromDetail={handleConvertBookFromDetail}
        onCancelConversion={cancelConversionForBook}
        onConvertToAudiobook={handleConvertToAudiobook}
      />
      <Toaster position="top-center" richColors style={{ top: "max(env(safe-area-inset-top), 1rem)" }} />
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
  const dispatch = useAppDispatch();
  const reduxLibrary = useAppSelector(selectLibrary);

  // Sync library state from LibraryContext to Redux
  useEffect(() => {
    if (libraryHook.library.length > 0 || reduxLibrary.length === 0) {
      dispatch(setLibrary(libraryHook.library));
    }
  }, [libraryHook.library, reduxLibrary.length, dispatch]);

  useEffect(() => {
    dispatch(setIsHydrated(libraryHook.isHydrated));
  }, [libraryHook.isHydrated, dispatch]);

  // Set up conversion listeners once on mount
  useEffect(() => {
    import("./store/thunks/conversionThunks").then(({ setupConversionListeners }) => {
      dispatch(setupConversionListeners());
    });
  }, [dispatch]);

  return <AppContent libraryHook={libraryHook} />;
}

export default App;
