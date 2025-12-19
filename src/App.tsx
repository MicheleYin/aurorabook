
import { useCallback, useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { listen } from "@tauri-apps/api/event";

import { logger } from "./lib/logger";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { LibraryPanel } from "./components/LibraryPanel";
import { ReaderPanel } from "./components/ReaderPanel";
import { lazy, Suspense } from "react";

// Lazy load heavy components for better code splitting and initial load performance
const ReaderAudioPlayer = lazy(() => import("./components/reader/ReaderAudioPlayer").then(module => ({ default: module.ReaderAudioPlayer })));
import { BookDetailDialog } from "./components/library/BookDetailDialog";
import { ConvertToAudiobookDialog } from "./components/library/ConvertToAudiobookDialog";
import { Toaster } from "./components/ui/sonner";
import { LoadingScreen } from "./components/app/LoadingScreen";
import { SettingsPanel } from "./components/SettingsPanel";
import { useLibrary } from "./hooks/useLibrary";
import { LibraryProvider } from "./hooks/library/LibraryContext";
import { usePersistentSettings } from "./hooks/settings/usePersistentSettings";
import { useAppNavigation } from "./hooks/useAppNavigation";
import { AppContextProvider, useAppContext } from "./contexts/AppContext";
import { useAppDispatch, useAppSelector } from "./store/hooks";
import { setLibrary, setIsHydrated, removeBook } from "./store/slices/librarySlice";
import {
  selectLibrary,
  selectIsHydrated,
  selectIsImporting,
  selectCurrentTab,
  selectCurrentBookId,
  selectIsChapterLoaded,
  selectIsAudioTrackLoaded,
  selectShowConvertDialog,
  selectPendingBookForConversion,
  selectIsConverting,
  selectBookConversionProgress,
  selectIsCancelling,
  selectCancellingBookId,
  selectConversionStartTime,
  selectAutoScrollEnabled,
  selectDeletingBookId,
  selectAudioPlayerOpen,
  selectAudioPlayerDismissing,
  selectAudioPlayerTrackHref,
  selectAudioPlayerProgress,
} from "./store/selectors";
import { loadProgressChapter, loadProgressAudioTrack } from "./store/thunks/readerThunks";
import {
  convertBook,
  cancelConversion,
} from "./store/thunks/conversionThunks";
import { setShowDialog, setPendingBook } from "./store/slices/conversionSlice";
import { setAutoScrollEnabled, setDeletingBookId } from "./store/slices/uiSlice";
import {
  setAudioPlayerOpen,
  setAudioPlayerDismissing,
  setAudioPlayerTrackHref,
  setAudioPlayerProgress,
  setDetailBookId,
} from "./store/slices/readerSlice";
import { importFromDialog, refreshLibrary as refreshLibraryThunk, ingestEpub as ingestEpubThunk } from "./store/thunks/libraryThunks";
import { useResolvedTheme } from "./hooks/useResolvedTheme";
import { filterLibrary } from "./hooks/library/libraryHelpers";
import type { ChapterSelectionOptions, AudioProgressSnapshot } from "./components/reader/types";
import type { Book } from "./types/reader";
import { cn } from "./lib/utils";
import { animPatterns, viewTransition } from "./lib/animations";
import { findChaptersForAudioTrack } from "./lib/epub";
import { ReaderCoordinatorProvider } from "./contexts/ReaderCoordinatorContext";

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

  // Redux conversion state
  const dispatch = useAppDispatch();
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
  const handleConvertToAudiobook = useCallback(async (voiceId: string) => {
    if (!pendingBookForConversion || isConverting || isCancelling) return;
    await dispatch(convertBook({ book: pendingBookForConversion.book, voiceId, closeDialog: true }));
    dispatch(setPendingBook(null));
  }, [dispatch, pendingBookForConversion, isConverting, isCancelling]);
  
  const handleConvertBookFromDetail = useCallback(async (book: Book, voiceId: string) => {
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
  }, [dispatch, isConverting, isCancelling]);
  
  const cancelConversionForBook = useCallback(async (bookId: string) => {
    await dispatch(cancelConversion({ bookId }));
  }, [dispatch]);

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
  } = useAppNavigation(async () => {
    await dispatch(refreshLibraryThunk()).unwrap();
  }, isHydrated);

  // Redux UI state
  const autoScrollEnabled = useAppSelector(selectAutoScrollEnabled);
  const deletingBookId = useAppSelector(selectDeletingBookId);

  const uiTheme = settings.theme;
  const resolvedUiTheme = useResolvedTheme(uiTheme);

  // Load auto-scroll setting from persistent settings
  useEffect(() => {
    if (isSettingsHydrated && settings.autoScrollEnabled !== undefined) {
      dispatch(setAutoScrollEnabled(settings.autoScrollEnabled));
    }
  }, [isSettingsHydrated, settings.autoScrollEnabled, dispatch]);

  // Load progress chapter and audio track when opening reader tab
  const currentTab = useAppSelector(selectCurrentTab);
  const currentBookId = useAppSelector(selectCurrentBookId);
  const currentChapterId = useAppSelector((state) => state.reader.currentChapterId);
  const currentAudioTrackId = useAppSelector((state) => state.reader.currentAudioTrackId);
  const isChapterLoaded = useAppSelector(selectIsChapterLoaded);
  const isAudioTrackLoaded = useAppSelector(selectIsAudioTrackLoaded);

  useEffect(() => {
    // Only load when reader tab is active and we have a book selected
    if (currentTab !== 'reader' || !currentBookId || !activeBook) return;

    // Load progress chapter if not already loaded
    if (currentChapterId && !isChapterLoaded && activeBook.progress?.currentChapterId === currentChapterId) {
      const chapter = activeBook.chapters.find((c) => c.id === currentChapterId);
      if (chapter && !chapter.contentHtml) {
        logger.debug('[App] Loading progress chapter when opening reader', { bookId: currentBookId, chapterId: currentChapterId });
        if (currentChapterId) {
          dispatch(loadProgressChapter({ bookId: currentBookId, chapterId: currentChapterId }));
        }
      }
    }

    // Load progress audio track if not already loaded
    if (currentAudioTrackId && !isAudioTrackLoaded && activeBook.audioState?.currentTrackId === currentAudioTrackId) {
      const track = activeBook.audioTracks.find((t) => t.id === currentAudioTrackId);
      if (track && !track.url) {
        logger.debug('[App] Loading progress audio track when opening reader', { bookId: currentBookId, trackId: currentAudioTrackId });
        dispatch(loadProgressAudioTrack({ bookId: currentBookId, trackId: currentAudioTrackId }));
      }
    }
  }, [currentTab, currentBookId, currentChapterId, currentAudioTrackId, isChapterLoaded, isAudioTrackLoaded, activeBook, dispatch]);

  // Refs to track pending dynamic import promises for cleanup
  const lazyChapterLoaderPromiseRef = useRef<Promise<unknown> | null>(null);
  const domQueryCachePromiseRef = useRef<Promise<unknown> | null>(null);

  // Clear chapter cache when switching books to prevent memory accumulation
  useEffect(() => {
    if (activeBookId && activeBook) {
      let isCancelled = false;
      
      // Clear cache for all books except the currently active one
      // This clears:
      // - lazy-chapter-loader chapterCache (LRU, max 5 chapters)
      // - lazy-chapter-loader audioTrackCache (LRU, max 1 track)
      // - Blob URLs for evicted books (via blobURLManager)
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
      
      // Note: useResourceLoader caches are per-hook-instance and are cleared
      // when hooks unmount or when clearCache is called explicitly.
      // The hooks (useAudioTrackLoader, useChapterLoader) should clear their
      // caches when book changes, but since they're used in ReaderWrapper which
      // unmounts when book changes, the caches are automatically cleared.
      
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
      Promise.all([
        lazyChapterLoaderPromiseRef.current,
        domQueryCachePromiseRef.current,
      ]).then(() => {
        // Cleanup DOM query cache interval and clear caches
        import("./lib/dom-query-cache").then(({ cleanupDomQueryCache }) => {
          cleanupDomQueryCache();
        });
      }).catch(() => {
        // If imports fail, still try to cleanup
        import("./lib/dom-query-cache").then(({ cleanupDomQueryCache }) => {
          cleanupDomQueryCache();
        }).catch(() => {
          // Ignore errors during cleanup
        });
      });
      
      // Cleanup timeouts
      if (audioPlayerCloseTimeoutRef.current) {
        clearTimeout(audioPlayerCloseTimeoutRef.current);
      }
      if (fileOpenRetryTimeoutRef.current) {
        clearTimeout(fileOpenRetryTimeoutRef.current);
      }
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

  // Ref to save progress from ReaderViewport
  const saveProgressRef = useRef<(() => void) | null>(null);
  const trackChangeHandlerRef = useRef<((trackHref: string) => Promise<void>) | null>(null);
  // Refs for timeout cleanup
  const audioPlayerCloseTimeoutRef = useRef<number | null>(null);
  const fileOpenRetryTimeoutRef = useRef<number | null>(null);

  // Inline progress saving logic (previously useProgressSaving hook)
  const saveProgress = useCallback(
    async (context: {
      toChapterId?: string;
      source: string;
      additionalData?: Record<string, unknown>;
    }) => {
      if (saveProgressRef.current && activeChapterId) {
        // Get current saved scroll position from library (single source of truth)
        const currentProgress = activeBook?.progress;
        const savedScrollPosition = currentProgress?.currentChapterId === activeChapterId
          ? {
              scrollTop: currentProgress.currentChapterScrollTop,
              scrollHeight: currentProgress.currentChapterScrollHeight,
              clientHeight: currentProgress.currentChapterClientHeight,
              percent: currentProgress.chapterProgressPercent,
            }
          : null;

        logger.log("[App] Saving progress", {
          bookId: activeBookId,
          fromChapterId: activeChapterId,
          toChapterId: context.toChapterId,
          source: context.source,
          savedScrollPosition,
          ...context.additionalData,
        });
        saveProgressRef.current();
        // Flush the debounced save immediately
        await flushProgressUpdate();
      }
    },
    [activeChapterId, activeBookId, activeBook, flushProgressUpdate]
  );

  const handleSelectChapter = useCallback(async (chapterId: string, options?: ChapterSelectionOptions) => {
    if (!activeBookId) return;

    // NOTE: Progress is NOT saved on chapter change - only saved when quitting reader
    // Progress will be saved automatically when ReaderWrapper unmounts (on navigation away)
    
    if (!saveProgressRef.current) {
      logger.debug("[App] No saveProgress function available", {
        bookId: activeBookId,
        chapterId,
      });
    }

    // Disable auto-scroll on manual selection (only for audiobooks)
    // Use activeBook from context instead of re-finding
    const hasAudioTracksForChapter = (activeBook?.audioTracks?.length ?? 0) > 0;
    if (options?.isManualSelection && autoScrollEnabled && hasAudioTracksForChapter) {
      logger.log("[App] Disabling auto-scroll due to manual chapter selection");
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
      // Use activeBook from context instead of re-finding
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

    logger.log("[App] Updating progress for new chapter", {
      bookId: activeBookId,
      chapterId,
      scrollPosition: requestedScrollPosition,
      progressUpdate,
    });

    updateBookProgress(activeBookId, progressUpdate);

    // Only set fragment if scrollPosition is not "top" (fragment navigation should respect scrollPosition)
    // When scrollPosition is "top", we want to scroll to top, not to a fragment
    const fragment = (options?.fragment && requestedScrollPosition !== "top") 
      ? options.fragment.replace(/^#/, "") 
      : null;
    setPendingFragment(fragment && fragment.length > 0 ? fragment : null);
    setActiveView("reader");
  }, [activeBookId, activeChapterId, autoScrollEnabled, setAutoScrollEnabled, updateSettings, setActiveChapterId, updateBookProgress, setPendingFragment, setActiveView, activeBook, library]);

  // Redux audio player state
  const isAudioPlayerOpen = useAppSelector(selectAudioPlayerOpen);
  const isAudioPlayerDismissing = useAppSelector(selectAudioPlayerDismissing);
  const currentAudioTrackHref = useAppSelector(selectAudioPlayerTrackHref);
  const currentAudioProgress = useAppSelector(selectAudioPlayerProgress);
  
  // Memoize hasAudioTracks
  const hasAudioTracks = useMemo(
    () => (activeBook?.audioTracks?.length ?? 0) > 0,
    [activeBook?.audioTracks?.length]
  );
  
  // Memoize showAudioPlayer
  const showAudioPlayer = useMemo(
    () => hasAudioTracks && (isAudioPlayerOpen || isAudioPlayerDismissing),
    [hasAudioTracks, isAudioPlayerOpen, isAudioPlayerDismissing]
  );

  const handleAudioPlayerClose = useCallback(() => {
    // Clear any existing timeout
    if (audioPlayerCloseTimeoutRef.current) {
      clearTimeout(audioPlayerCloseTimeoutRef.current);
    }
    
    // Start dismissal immediately for responsive UI
    dispatch(setAudioPlayerDismissing(true));
    // Wait for exit animation to complete before unmounting
    audioPlayerCloseTimeoutRef.current = window.setTimeout(() => {
      dispatch(setAudioPlayerOpen(false));
      dispatch(setAudioPlayerDismissing(false));
      audioPlayerCloseTimeoutRef.current = null;
    }, 500); // Match animation duration
  }, [dispatch]);

  const handleProgress = useCallback((snapshot: AudioProgressSnapshot) => {
    dispatch(setAudioPlayerTrackHref(snapshot.trackHref));
    dispatch(setAudioPlayerProgress(snapshot));
  }, [dispatch]);

  const handleAutoScrollToggle = useCallback((enabled: boolean) => {
    dispatch(setAutoScrollEnabled(enabled));
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
          logger.log("[App] Syncing chapter to current audio track", {
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
  }, [dispatch, updateSettings, currentAudioTrackHref, activeBook, activeChapterId, handleSelectChapter]);

  // Consolidated track change handler - now handled by useAudioPlayerProgress.handleAudioTrackChange
  // This is just a wrapper that calls the handler from ReaderWrapper
  const handleTrackChange = useCallback(async (trackHref: string) => {
    if (trackChangeHandlerRef.current) {
      await trackChangeHandlerRef.current(trackHref);
    } else {
      logger.warn("[App] Track change handler not ready yet", { trackHref });
    }
  }, []);

  // Callback to receive the track change handler from ReaderWrapper
  const handleTrackChangeHandlerReady = useCallback((handler: (trackHref: string) => Promise<void>) => {
    trackChangeHandlerRef.current = handler;
    logger.log("[App] Track change handler ready");
  }, []);

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
            // Clear any existing retry timeout
            if (fileOpenRetryTimeoutRef.current) {
              clearTimeout(fileOpenRetryTimeoutRef.current);
            }
            fileOpenRetryTimeoutRef.current = window.setTimeout(() => {
              fileOpenRetryTimeoutRef.current = null;
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
            const book = await dispatch(ingestEpubThunk({
              filePath,
              sourcePath: filePath,
            })).unwrap();

            if (!book) {
              toast.error("Failed to import EPUB file");
              return;
            }

            // Book is already added to Redux by ingestEpubThunk

            // Refresh library to ensure consistency
            await dispatch(refreshLibraryThunk());

            toast.success("EPUB imported successfully", {
              description: `"${book.title}" has been added to your library.`,
            });

            // Check if book needs conversion (no audio tracks)
            if (book.audioTracks.length === 0 && !isConverting) {
              // Get EPUB buffer for conversion
              const { getEpubBuffer } = await import("./lib/book-service");
              const buffer = (await getEpubBuffer(filePath)) ?? new ArrayBuffer(0);
              dispatch(setPendingBook({ book, buffer }));
              dispatch(setShowDialog(true));
            }
          } catch (error) {
            logger.error("[App] Failed to ingest EPUB from file-opened event", error);
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
      if (fileOpenRetryTimeoutRef.current) {
        clearTimeout(fileOpenRetryTimeoutRef.current);
      }
    };
  }, [isHydrated, isImporting, dispatch, isConverting]);

  const handleSelectBook = useCallback(async (bookId: string) => {
    await handleSelectBookContext(bookId);
    setActiveView("reader");
  }, [handleSelectBookContext, setActiveView]);

  const handleAddEbook = useCallback(async () => {
    if (isImporting) return;
    
    const result = await dispatch(importFromDialog()).unwrap();
    if (!result || result === true) {
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
          dispatch(setPendingBook({ book, buffer: result.buffer }));
          dispatch(setShowDialog(true));
        } else {
          // Book is imported, but conversion dialog is skipped while another conversion is in progress
          toast.info("Ebook imported", {
            description: "You can convert it to an audiobook after the current conversion completes.",
          });
        }
      }
    }
  }, [isImporting, dispatch, isConverting]);

  const handleDeleteBook = useCallback(async (bookId: string) => {
    // Set deleting state
    dispatch(setDeletingBookId(bookId));
    
    try {
      // If this book is currently being converted, cancel the conversion
      await cancelConversionForBook(bookId);
      
      // Find the book first to get its sourcePath for cache cleanup
      const bookToDelete = library.find((book) => book.id === bookId);
      
      // Delete from Rust backend
      const { deleteBook } = await import("./lib/book-service");
      await deleteBook(bookId);
      
      // Update local state
      dispatch(removeBook(bookId));
      dispatch(setDetailBookId(null));

      // Clear lazy loader cache
      if (bookToDelete) {
        try {
          const { clearBookCache } = await import("./lib/lazy-chapter-loader");
          clearBookCache(bookToDelete.sourcePath);
        } catch (error) {
          logger.warn("Failed to clear book cache:", error);
        }
      }

      if (activeBookId === bookId) {
        setActiveBookId(undefined);
        setActiveChapterId(undefined);
        setPendingFragment(null);
        setActiveView("library");
      }
    } catch (error) {
      logger.error("Failed to delete book from Rust backend:", error);
      toast.error("Failed to delete book", {
        description: error instanceof Error ? error.message : "An error occurred",
      });
    } finally {
      // Clear deleting state
      dispatch(setDeletingBookId(null));
    }
  }, [
    dispatch,
    library,
    cancelConversionForBook,
    setDetailBookId,
    activeBookId,
    setActiveBookId,
    setActiveChapterId,
    setPendingFragment,
    setActiveView
  ]);

  // Auto-scroll toast is now shown in handleAutoScrollToggle (in useAudioPlayer)

  // Filter library on the frontend - this is just a view, doesn't change the library state
  const filteredLibrary = useMemo(
    () => filterLibrary(library, libraryFilter, librarySearchTerm),
    [library, libraryFilter, librarySearchTerm],
  );

  // Memoize audioPlayerChromeVisible
  const audioPlayerChromeVisible = useMemo(
    () => activeView === "reader" ? isReaderChromeVisible : true,
    [activeView, isReaderChromeVisible]
  );

  // Memoize callbacks for reader view
  const handleNavigateLibrary = useCallback(async () => {
    // Save progress before navigating away
    // This ensures progress is saved even if unmount cleanup doesn't run reliably
    if (saveProgressRef.current && activeChapterId && activeBookId) {
      logger.log("[App] Saving progress before navigating to library", {
        bookId: activeBookId,
        chapterId: activeChapterId,
      });
      try {
        await saveProgress({
          source: "navigateToLibrary",
        });
        logger.log("[App] Progress saved before navigating to library", {
          bookId: activeBookId,
          chapterId: activeChapterId,
        });
      } catch (error) {
        logger.error("[App] Failed to save progress before navigating to library", {
          bookId: activeBookId,
          chapterId: activeChapterId,
          error,
        });
        // Continue navigation even if save fails
      }
    }
    setActiveView("library");
  }, [setActiveView, saveProgress, activeChapterId, activeBookId]);

  const handleOpenAudioPlayer = useCallback(() => {
    dispatch(setAudioPlayerOpen(true));
  }, [dispatch]);

  const handleSaveProgress = useCallback((saveFn: () => void) => {
    saveProgressRef.current = saveFn;
  }, []);

  const handleThemeChange = useCallback((theme: "light" | "dark" | "system") => {
    updateSettings({ theme });
  }, [updateSettings]);

  const handleViewDetails = useCallback((bookId: string) => {
    dispatch(setDetailBookId(bookId));
  }, [dispatch]);

  const libraryView = useMemo(
    () => (
      <ErrorBoundary>
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
          onViewDetails={handleViewDetails}
          bookConversionProgress={bookConversionProgress}
          conversionStartTimeRef={conversionStartTimeRef}
        />
      </ErrorBoundary>
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
      handleAddEbook,
      handleSelectBook,
      handleViewDetails,
      bookConversionProgress,
      conversionStartTimeRef,
    ]
  );

  const readerView = useMemo(
    () => (
      <ErrorBoundary>
        <ReaderCoordinatorProvider
          onChapterChange={async (_bookId, chapterId, options) => {
            // This will be handled by ReaderWrapper's handleChapterChange
            // The coordinator just coordinates the operation
            await handleSelectChapter(chapterId, options);
          }}
          onChapterRestore={async () => {
            // Chapter restore is handled by ReaderWrapper
          }}
          onChapterProgressRestore={async (bookId, chapterId) => {
            // Progress restore is coordinated through the coordinator
            // The actual restoration will happen in onChapterLoaded when DOM is ready
            // This handler just ensures the coordinator lock is set properly
            // The restoration logic in useChapterState.onChapterLoaded will check the lock and proceed
            logger.log("[App] onChapterProgressRestore called", { bookId, chapterId });
          }}
          onChapterSave={async () => {
            // Chapter save is handled by ReaderWrapper's saveProgress
          }}
          onChapterProgressSave={async (bookId, _chapterId, snapshot) => {
            // Progress save is handled by handleChapterProgress
            handleChapterProgress(bookId, snapshot);
          }}
          onAudioTrackLoad={async (bookId, trackId) => {
            // Audio track loading is handled by useAudioTrackLoader
            const { ensureAudioTrackLoaded } = await import("./lib/lazy-chapter-loader");
            const book = library.find(b => b.id === bookId);
            if (!book) return null;
            const track = book.audioTracks.find(t => t.id === trackId);
            if (!track) return null;
            const loaded = await ensureAudioTrackLoaded(bookId, track);
            return loaded.url || null;
          }}
          onAudioTimestampRestore={async () => {
            // Audio timestamp restore is handled by audio player
          }}
          onAudioTrackSave={async () => {
            // Flush audio state
            await flushAudioStateUpdate();
          }}
          onAudioTimestampSave={async (bookId, trackId, timestamp) => {
            // Update audio state
            const book = library.find(b => b.id === bookId);
            if (book) {
              const track = book.audioTracks.find(t => t.id === trackId);
              if (track) {
                await updateBookAudioState(bookId, {
                  currentTimeSeconds: timestamp,
                  trackId: trackId,
                  trackHref: track.href,
                  trackIndex: book.audioTracks.findIndex(t => t.id === trackId),
                  updatedAt: new Date().toISOString(),
                });
              }
            }
          }}
          onAudioTrackChange={async (bookId, trackId) => {
            // Audio track change is handled by handleTrackChange
            const book = library.find(b => b.id === bookId);
            if (book) {
              const track = book.audioTracks.find(t => t.id === trackId);
              if (track) {
                await handleTrackChange(track.href);
              }
            }
          }}
        >
          <ReaderPanel
            activeBook={activeBook}
            activeChapter={activeChapter}
            preferences={readerPreferences}
            onPreferencesChange={updateReaderPreferences}
            onSelectChapter={handleSelectChapter}
            onNavigateLibrary={handleNavigateLibrary}
            resolvedUiTheme={resolvedUiTheme}
            uiTheme={uiTheme}
            onThemeChange={handleThemeChange}
            onChapterProgress={handleChapterProgress}
            onChromeVisibilityChange={setIsReaderChromeVisible}
            audioPlayerVisible={Boolean(activeBook?.audioTracks?.length) && isAudioPlayerOpen}
            onOpenAudioPlayer={handleOpenAudioPlayer}
            currentAudioTrackHref={currentAudioTrackHref ?? undefined}
            onSaveProgress={handleSaveProgress}
            autoScrollEnabled={autoScrollEnabled}
            currentAudioProgress={currentAudioProgress ?? undefined}
            onTrackChangeHandlerReady={handleTrackChangeHandlerReady}
          />
        </ReaderCoordinatorProvider>
      </ErrorBoundary>
    ),
    [
      activeBook,
      activeChapter,
      readerPreferences,
      updateReaderPreferences,
      handleSelectChapter,
      handleNavigateLibrary,
      saveProgress,
      resolvedUiTheme,
      uiTheme,
      handleThemeChange,
      handleChapterProgress,
      setIsReaderChromeVisible,
      activeBook?.audioTracks?.length,
      isAudioPlayerOpen,
      handleOpenAudioPlayer,
      currentAudioTrackHref,
      handleSaveProgress,
      autoScrollEnabled,
      currentAudioProgress,
      library,
      handleChapterProgress,
      updateBookAudioState,
      flushAudioStateUpdate,
      handleTrackChange,
    ]
  );

  const detailBook = useMemo(() => {
    if (!detailBookId) return undefined;
    return library.find((book) => book.id === detailBookId);
  }, [detailBookId, library]);

  const settingsView = useMemo(
    () => <SettingsPanel settings={settings} onSettingsChange={updateSettings} />,
    [settings, updateSettings]
  );
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
      <div className="mx-auto flex w-full flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
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
        <Suspense fallback={<div className="flex items-center justify-center p-8"><div className="text-muted-foreground">Loading audio player...</div></div>}>
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
            handleProgress(snapshot);
          }}
          chromeVisible={audioPlayerChromeVisible}
          onClose={handleAudioPlayerClose}
          autoScrollEnabled={autoScrollEnabled}
          onAutoScrollToggle={handleAutoScrollToggle}
          onTrackChange={handleTrackChange}
          audioSyncMap={activeBook.audioSyncMap}
          chapters={activeBook.chapters}
          />
        </Suspense>
      ) : null}
      <div
        className={cn(
          "pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-6 sm:px-6",
          animPatterns.navBar,
          hideNavigation ? "nav-bar-exit" : "nav-bar-enter",
        )}
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
                  if (activeView === "reader" && item.id !== "reader") {
                    await saveProgress({
                      source: `navigation-to-${item.id}`,
                    });
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
                aria-label={item.id === "reader" && isDisabled ? "Open a book to enter the reader" : `Navigate to ${item.label}`}
                aria-current={isActive ? "page" : undefined}
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
          onClose={() => dispatch(setDetailBookId(null))}
          onOpenBook={() => {
            dispatch(setDetailBookId(null));
            handleSelectBook(detailBook.id);
          }}
          onDeleteBook={() => handleDeleteBook(detailBook.id)}
          isDeleting={Boolean(deletingBookId && deletingBookId === detailBook.id)}
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
              dispatch(setShowDialog(open));
              if (!open) {
                dispatch(setPendingBook(null));
              }
            }
          }}
          onConfirm={handleConvertToAudiobook}
          bookTitle={pendingBookForConversion.book.title}
        />
      ) : null}
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
    import('./store/thunks/conversionThunks').then(({ setupConversionListeners }) => {
      dispatch(setupConversionListeners());
    });
  }, [dispatch]);

  return (
    <AppContextProvider>
      <AppContent libraryHook={libraryHook} />
    </AppContextProvider>
  );
}

export default App;
