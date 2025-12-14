
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { listen } from "@tauri-apps/api/event";

import { logger } from "./lib/logger";
import { ErrorBoundary } from "./components/ErrorBoundary";
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
import { usePersistentSettings } from "./hooks/settings/usePersistentSettings";
import { useBookConversion } from "./hooks/useBookConversion";
import { useAppNavigation } from "./hooks/useAppNavigation";
import { AppContextProvider, useAppContext } from "./contexts/AppContext";
import { useResolvedTheme } from "./hooks/useResolvedTheme";
import { filterLibrary } from "./hooks/library/libraryHelpers";
import type { ChapterSelectionOptions, AudioProgressSnapshot } from "./components/reader/types";
import { cn } from "./lib/utils";
import { animPatterns, viewTransition } from "./lib/animations";
import { findChaptersForAudioTrack } from "./lib/epub";
import { ReaderCoordinatorProvider } from "./contexts/ReaderCoordinatorContext";

// Memory monitoring (development only)
if (import.meta.env.DEV) {
  import("./lib/memory-monitor").then(({ memoryMonitor }) => {
    // Start monitoring
    memoryMonitor.start(5000); // Check every 5 seconds
    
    // Log stats periodically - store interval ID for cleanup
    let statsLogIntervalId: number | null = null;
    statsLogIntervalId = window.setInterval(() => {
      memoryMonitor.logStats();
    }, 30000); // Every 30 seconds
    
    // Store cleanup function on window for manual cleanup if needed
    (window as any).__cleanupMemoryMonitoring = () => {
      if (statsLogIntervalId !== null) {
        clearInterval(statsLogIntervalId);
        statsLogIntervalId = null;
      }
      memoryMonitor.stop();
    };
    
    // Expose debug utilities to window
    import("./lib/dom-monitor").then(({ DOMMonitor }) => {
      import("./lib/blob-url-manager").then(({ blobURLManager }) => {
        (window as any).debugMemory = {
          // Get current memory
          getMemory: () => memoryMonitor.getStats().current,
          
          // Force GC (if available)
          forceGC: () => memoryMonitor.constructor.forceGC(),
          
          // Get DOM stats
          getDOMStats: () => DOMMonitor.countNodes(),
          
          // Get blob URL stats
          getBlobStats: () => blobURLManager.getStats(),
          
          // Get audio element info (if audio is playing)
          getAudioInfo: () => {
            const audioElements = document.querySelectorAll('audio');
            const info = Array.from(audioElements).map((audio, idx) => ({
              index: idx,
              src: audio.src,
              isBlob: audio.src.startsWith('blob:'),
              duration: audio.duration || 0,
              currentTime: audio.currentTime || 0,
              paused: audio.paused,
              readyState: audio.readyState,
              buffered: audio.buffered.length > 0 ? {
                start: audio.buffered.start(0),
                end: audio.buffered.end(audio.buffered.length - 1),
                ranges: audio.buffered.length
              } : null,
              networkState: audio.networkState,
            }));
            return {
              count: audioElements.length,
              elements: info,
            };
          },
          
          // Log everything
          logAll: () => {
            console.group('🔍 Memory Debug Info');
            const hasMemory = memoryMonitor.getStats().current !== null;
            if (hasMemory) {
              memoryMonitor.logStats();
            } else {
              console.log('📊 Memory API: Not available (WebKit/Safari limitation)');
              console.log('   Use WebKit Inspector or Activity Monitor for memory profiling');
            }
            DOMMonitor.logStats();
            blobURLManager.logStats();
            const audioInfo = (window as any).debugMemory.getAudioInfo();
            if (audioInfo.count > 0) {
              console.log('🎵 Audio Elements:', audioInfo);
            }
            console.groupEnd();
          },
          
          // Audio-specific diagnostic
          diagnoseAudio: () => {
            console.group('🎵 Audio Memory Diagnostic');
            
            const memory = memoryMonitor.getStats().current;
            const blob = blobURLManager.getStats();
            const dom = DOMMonitor.countNodes();
            const audio = (window as any).debugMemory.getAudioInfo();
            
            console.log('📊 Current State:');
            if (memory) {
              console.log('  Memory:', {
                used: (memory.usedJSHeapSize / 1024 / 1024).toFixed(2) + ' MB',
                total: (memory.totalJSHeapSize / 1024 / 1024).toFixed(2) + ' MB',
                limit: (memory.jsHeapSizeLimit / 1024 / 1024).toFixed(2) + ' MB',
                percent: ((memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100).toFixed(2) + '%'
              });
            } else {
              console.log('  Memory: Not available (WebKit/Safari limitation)');
              console.log('  💡 Use WebKit Inspector or Activity Monitor for memory info');
            }
            console.log('  Blob URLs:', blob);
            console.log('  DOM Nodes:', { total: dom.total, elements: dom.elements });
            console.log('  Audio Elements:', audio);
            
            console.log('\n⚠️  Potential Issues:');
            if (blob.total > 2) {
              console.warn('  ⚠️  Multiple blob URLs detected:', blob.total);
              console.warn('     Expected: 1-2 (current + maybe previous)');
            }
            if (memory && memory.usedJSHeapSize / memory.jsHeapSizeLimit > 0.8) {
              console.warn('  ⚠️  Memory usage > 80%');
            }
            if (dom.total > 10000) {
              console.warn('  ⚠️  High DOM node count:', dom.total);
            }
            if (audio.count > 1) {
              console.warn('  ⚠️  Multiple audio elements detected:', audio.count);
            }
            
            console.log('\n💡 Recommendations:');
            if (blob.total > 2) {
              console.log('  - Check if old blob URLs are being revoked');
              console.log('  - Verify blobURLManager.revokeForBook() is called on book switch');
            }
            if (memory && memory.usedJSHeapSize / memory.jsHeapSizeLimit > 0.7) {
              console.log('  - Consider reducing cache sizes');
              console.log('  - Check for memory leaks with heap snapshots');
            }
            if (!memory) {
              console.log('  - Use WebKit Inspector (Safari → Develop → Show Web Inspector) for memory profiling');
              console.log('  - Use Activity Monitor for overall app memory usage');
              console.log('  - Focus on blob URL count (should be 1-2) and DOM node count');
            }
            
            console.groupEnd();
          },
          
          // Check if memory API is available
          isMemoryAvailable: () => {
            return memoryMonitor.getStats().current !== null;
          },
          
          // Monitor instance
          monitor: memoryMonitor,
        };
        
        console.log('💡 Memory debugging available: window.debugMemory');
        console.log('   Try: debugMemory.logAll()');
      });
    });
  });
}

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
  } = useBookConversion(library, setLibrary);

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

  // Clear chapter cache when switching books to prevent memory accumulation
  useEffect(() => {
    if (activeBookId && activeBook) {
      // Clear cache for all books except the currently active one
      import("./lib/lazy-chapter-loader").then(({ clearAllCachesExcept }) => {
        clearAllCachesExcept(activeBook.sourcePath);
      });
      
      // Clear DOM query cache when switching books (memory optimization)
      import("./lib/dom-query-cache").then(({ clearAllCaches }) => {
        clearAllCaches();
      });
    }
  }, [activeBookId, activeBook?.sourcePath]);

  // Cleanup on app unmount (memory optimization)
  useEffect(() => {
    return () => {
      // Cleanup DOM query cache interval and clear caches
      import("./lib/dom-query-cache").then(({ cleanupDomQueryCache }) => {
        cleanupDomQueryCache();
      });
      
      // Cleanup memory monitoring (dev mode only)
      if (import.meta.env.DEV && typeof window !== "undefined" && (window as any).__cleanupMemoryMonitoring) {
        (window as any).__cleanupMemoryMonitoring();
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
    const activeBook = library.find(b => b.id === activeBookId);
    const hasAudioTracks = (activeBook?.audioTracks?.length ?? 0) > 0;
    if (options?.isManualSelection && autoScrollEnabled && hasAudioTracks) {
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
  }, [activeBookId, activeChapterId, autoScrollEnabled, setAutoScrollEnabled, updateSettings, setActiveChapterId, updateBookProgress, setPendingFragment, setActiveView, saveProgress]);

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
  }, [setAutoScrollEnabled, updateSettings, currentAudioTrackHref, activeBook, activeChapterId, handleSelectChapter]);

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
      setIsAudioPlayerOpen(true);
    }
  }, [activeView, hasAudioTracks]);

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
            setTimeout(() => {
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
            const book = await ingestEpub({
              filePath,
              sourcePath: filePath,
            });

            if (!book) {
              toast.error("Failed to import EPUB file");
              return;
            }

            // Update library
            setLibrary((prevLibrary) => {
              const existingIndex = prevLibrary.findIndex(
                (b) => b.id === book.id 
                  || b.sourcePath === book.sourcePath
                  || (book.contentHash && b.contentHash && b.contentHash === book.contentHash),
              );
              if (existingIndex !== -1) {
                const updated = [...prevLibrary];
                updated[existingIndex] = book;
                return updated;
              }
              return [...prevLibrary, book];
            });

            // Refresh library to ensure consistency
            await refreshLibrary();

            toast.success("EPUB imported successfully", {
              description: `"${book.title}" has been added to your library.`,
            });

            // Check if book needs conversion (no audio tracks)
            if (book.audioTracks.length === 0 && !isConverting) {
              // Get EPUB buffer for conversion
              const { getEpubBuffer } = await import("./lib/book-service");
              const buffer = (await getEpubBuffer(filePath)) ?? new ArrayBuffer(0);
              setPendingBookForConversion({ book, buffer });
              setShowConvertDialog(true);
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
    };
  }, [isHydrated, isImporting, ingestEpub, setLibrary, refreshLibrary, isConverting, setPendingBookForConversion, setShowConvertDialog]);

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
      setDeletingBookId(null);
    }
  };

  // Auto-scroll toast is now shown in handleAutoScrollToggle (in useAudioPlayer)

  // Filter library on the frontend - this is just a view, doesn't change the library state
  const filteredLibrary = useMemo(
    () => filterLibrary(library, libraryFilter, librarySearchTerm),
    [library, libraryFilter, librarySearchTerm],
  );

  const audioPlayerChromeVisible = activeView === "reader" ? isReaderChromeVisible : true;

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
    setIsAudioPlayerOpen(true);
  }, []);

  const handleSaveProgress = useCallback((saveFn: () => void) => {
    saveProgressRef.current = saveFn;
  }, []);

  const handleThemeChange = useCallback((theme: "light" | "dark" | "system") => {
    updateSettings({ theme });
  }, [updateSettings]);

  const handleViewDetails = useCallback((bookId: string) => {
    setDetailBookId(bookId);
  }, []);

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
          onChapterProgressRestore={async (bookId, chapterId, _withAutoScroll) => {
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
            currentAudioTrackHref={currentAudioTrackHref}
            onSaveProgress={handleSaveProgress}
            autoScrollEnabled={autoScrollEnabled}
            currentAudioProgress={currentAudioProgress}
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
