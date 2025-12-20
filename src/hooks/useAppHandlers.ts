import { useCallback, useRef } from "react";
import { toast } from "sonner";
import { logger } from "../lib/logger";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import {
  selectCurrentBookId,
  selectCurrentChapterId,
  selectIsReaderChromeVisible,
  selectDetailBookId,
  selectCurrentTab,
  selectIsChapterLoaded,
  selectIsAudioTrackLoaded,
  selectAutoScrollEnabled,
  selectDeletingBookId,
  selectAudioPlayerOpen,
  selectAudioPlayerDismissing,
  selectAudioPlayerTrackHref,
  selectAudioPlayerProgress,
} from "../store/selectors";
import {
  setCurrentBookId,
  setCurrentChapterId,
  setPendingFragment,
  setIsReaderChromeVisible,
  setDetailBookId,
  setAudioPlayerOpen,
  setAudioPlayerDismissing,
  setAudioPlayerTrackHref,
  setAudioPlayerProgress,
} from "../store/slices/readerSlice";
import { setAutoScrollEnabled, setDeletingBookId } from "../store/slices/uiSlice";
import { selectBook } from "../store/thunks/readerThunks";
import { cancelConversion } from "../store/thunks/conversionThunks";
import { setShowDialog, setPendingBook } from "../store/slices/conversionSlice";
import { removeBook } from "../store/slices/librarySlice";
import { importFromDialog } from "../store/thunks/libraryThunks";
import { findChaptersForAudioTrack } from "../lib/epub";
import type { Book } from "../types/reader";
import type { ChapterSelectionOptions, AudioProgressSnapshot, ChapterProgressSnapshot } from "../components/reader/types";

export function useAppHandlers({
  library,
  updateBookProgress,
  updateBookAudioState: _updateBookAudioState,
  handleChapterProgress: _handleChapterProgress,
  flushProgressUpdate,
  flushAudioStateUpdate: _flushAudioStateUpdate,
  updateSettings,
  setActiveView,
  activeBook,
  activeChapterId,
  activeBookId,
}: {
  library: Book[];
  updateBookProgress: (bookId: string, progress: any) => void;
  updateBookAudioState: (bookId: string, snapshot: AudioProgressSnapshot) => Promise<void>;
  handleChapterProgress: (bookId: string, snapshot: ChapterProgressSnapshot) => void;
  flushProgressUpdate: () => Promise<void>;
  flushAudioStateUpdate: () => Promise<void>;
  updateSettings: (settings: Partial<any>) => void;
  setActiveView: (view: string) => void;
  activeBook: Book | null;
  activeChapterId: string | null;
  activeBookId: string | null;
}) {
  const dispatch = useAppDispatch();

  // Refs
  const saveProgressRef = useRef<(() => void) | null>(null);
  const trackChangeHandlerRef = useRef<((trackHref: string) => Promise<void>) | null>(null);
  const audioPlayerCloseTimeoutRef = useRef<number | null>(null);
  const fileOpenRetryTimeoutRef = useRef<number | null>(null);
  const chapterLoadAttemptedRef = useRef<string | null>(null);
  const trackLoadAttemptedRef = useRef<string | null>(null);
  const lastBookIdRef = useRef<string | null>(null);

  // State selectors
  const autoScrollEnabled = useAppSelector(selectAutoScrollEnabled);
  const isAudioPlayerOpen = useAppSelector(selectAudioPlayerOpen);
  const isAudioPlayerDismissing = useAppSelector(selectAudioPlayerDismissing);
  const currentAudioTrackHref = useAppSelector(selectAudioPlayerTrackHref);
  const currentAudioProgress = useAppSelector(selectAudioPlayerProgress);
  const deletingBookId = useAppSelector(selectDeletingBookId);
  const isReaderChromeVisible = useAppSelector(selectIsReaderChromeVisible);
  const detailBookId = useAppSelector(selectDetailBookId);
  const currentTab = useAppSelector(selectCurrentTab);
  const currentBookId = useAppSelector(selectCurrentBookId);
  const currentChapterId = useAppSelector(selectCurrentChapterId);
  const currentAudioTrackId = useAppSelector((state) => state.reader.currentAudioTrackId);
  const isChapterLoaded = useAppSelector(selectIsChapterLoaded);
  const isAudioTrackLoaded = useAppSelector(selectIsAudioTrackLoaded);
  const isImporting = useAppSelector((state) => state.library.isImporting);
  const isConverting = useAppSelector((state) => state.conversion.isConverting);

  // Basic handlers
  const setActiveBookId = useCallback(
    (id: string | undefined) => {
      dispatch(setCurrentBookId(id ?? null));
    },
    [dispatch]
  );

  const setActiveChapterId = useCallback(
    (id: string | undefined) => {
      dispatch(setCurrentChapterId(id ?? null));
    },
    [dispatch]
  );

  const setIsReaderChromeVisibleHandler = useCallback(
    (visible: boolean) => {
      dispatch(setIsReaderChromeVisible(visible));
    },
    [dispatch]
  );

  const setDetailBookIdHandler = useCallback(
    (id: string | null) => {
      dispatch(setDetailBookId(id));
    },
    [dispatch]
  );

  const handleSelectBookContext = useCallback(
    async (bookId: string) => {
      logger.debug("[App] handleSelectBook called", {
        bookId,
      });
      await dispatch(selectBook({ bookId }));
      dispatch(setPendingFragment(null));
    },
    [dispatch]
  );

  // Progress saving
  const saveProgress = useCallback(
    async (context: {
      toChapterId?: string;
      source: string;
      additionalData?: Record<string, unknown>;
    }) => {
      if (saveProgressRef.current && activeChapterId) {
        const currentProgress = activeBook?.progress;
        const savedScrollPosition =
          currentProgress?.currentChapterId === activeChapterId
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
        await flushProgressUpdate();
      }
    },
    [activeChapterId, activeBookId, activeBook, flushProgressUpdate]
  );

  // Chapter selection
  const handleSelectChapter = useCallback(
    async (chapterId: string, options?: ChapterSelectionOptions) => {
      if (!activeBookId) return;

      if (!saveProgressRef.current) {
        logger.debug("[App] No saveProgress function available", {
          bookId: activeBookId,
          chapterId,
        });
      }

      const hasAudioTracksForChapter = (activeBook?.audioTracks?.length ?? 0) > 0;
      if (options?.isManualSelection && autoScrollEnabled && hasAudioTracksForChapter) {
        logger.log("[App] Disabling auto-scroll due to manual chapter selection");
        dispatch(setAutoScrollEnabled(false));
        updateSettings({ autoScrollEnabled: false });
        toast.info("Auto-scroll disabled", {
          description: "Auto-scroll was disabled because you manually selected a chapter",
          duration: 3000,
        });
      }

      setActiveChapterId(chapterId);

      const requestedScrollPosition = options?.scrollPosition ?? "maintain";
      const progressUpdate: {
        chapterId: string;
        scrollTop?: number;
        scrollHeight?: number;
        clientHeight?: number;
        percent?: number;
      } = { chapterId };

      if (requestedScrollPosition === "top") {
        progressUpdate.scrollTop = 0;
        progressUpdate.scrollHeight = 0;
        progressUpdate.clientHeight = 0;
        progressUpdate.percent = 0;
      } else if (requestedScrollPosition === "bottom") {
        progressUpdate.percent = 1;
      } else if (requestedScrollPosition === "maintain") {
        if (activeBook?.progress && activeBook.progress.currentChapterId === chapterId) {
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
      }

      logger.log("[App] Updating progress for new chapter", {
        bookId: activeBookId,
        chapterId,
        scrollPosition: requestedScrollPosition,
        progressUpdate,
      });

      updateBookProgress(activeBookId, progressUpdate);

      const fragment =
        options?.fragment && requestedScrollPosition !== "top"
          ? options.fragment.replace(/^#/, "")
          : null;
      dispatch(setPendingFragment(fragment && fragment.length > 0 ? fragment : null));
      setActiveView("reader");
    },
    [
      activeBookId,
      activeChapterId,
      autoScrollEnabled,
      dispatch,
      updateSettings,
      setActiveChapterId,
      updateBookProgress,
      setActiveView,
      activeBook,
    ]
  );

  // Audio player handlers
  const handleAudioPlayerClose = useCallback(() => {
    if (audioPlayerCloseTimeoutRef.current) {
      clearTimeout(audioPlayerCloseTimeoutRef.current);
    }

    dispatch(setAudioPlayerDismissing(true));
    audioPlayerCloseTimeoutRef.current = window.setTimeout(() => {
      dispatch(setAudioPlayerOpen(false));
      dispatch(setAudioPlayerDismissing(false));
      audioPlayerCloseTimeoutRef.current = null;
    }, 500);
  }, [dispatch]);

  const handleProgress = useCallback(
    (snapshot: AudioProgressSnapshot) => {
      dispatch(setAudioPlayerTrackHref(snapshot.trackHref));
      dispatch(setAudioPlayerProgress(snapshot));
    },
    [dispatch]
  );

  const handleAutoScrollToggle = useCallback(
    (enabled: boolean) => {
      dispatch(setAutoScrollEnabled(enabled));
      updateSettings({ autoScrollEnabled: enabled });

      if (enabled && currentAudioTrackHref && activeBook) {
        const chapterHrefs = findChaptersForAudioTrack(
          activeBook.audioSyncMap,
          currentAudioTrackHref
        );
        if (chapterHrefs.length > 0) {
          const normalizedChapterHrefs = chapterHrefs.map((href) => href.split("#")[0]);

          const matchingChapter = activeBook.chapters.find((chapter) => {
            const chapterBaseHref = chapter.href.split("#")[0];
            return normalizedChapterHrefs.some((normalizedHref) => {
              return (
                chapterBaseHref === normalizedHref ||
                chapterBaseHref === normalizedHref.replace(/^OEBPS\//, "") ||
                chapterBaseHref === `OEBPS/${normalizedHref}` ||
                `OEBPS/${chapterBaseHref}` === normalizedHref
              );
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
    },
    [
      dispatch,
      updateSettings,
      currentAudioTrackHref,
      activeBook,
      activeChapterId,
      handleSelectChapter,
    ]
  );

  const handleTrackChange = useCallback(
    async (trackHref: string) => {
      if (trackChangeHandlerRef.current) {
        await trackChangeHandlerRef.current(trackHref);
      } else {
        logger.warn("[App] Track change handler not ready yet", { trackHref });
      }
    },
    []
  );

  const handleTrackChangeHandlerReady = useCallback(
    (handler: (trackHref: string) => Promise<void>) => {
      trackChangeHandlerRef.current = handler;
      logger.log("[App] Track change handler ready");
    },
    []
  );

  // Book handlers
  const handleSelectBook = useCallback(
    async (bookId: string) => {
      logger.debug("[useAppHandlers] handleSelectBook called", { bookId });
      try {
        await handleSelectBookContext(bookId);
        logger.debug("[useAppHandlers] handleSelectBookContext completed, setting view to reader");
      } catch (error) {
        logger.error("[useAppHandlers] handleSelectBookContext failed", { error, bookId });
      }
      // Always navigate to reader view, even if book selection fails
      logger.debug("[useAppHandlers] Setting view to reader");
      setActiveView("reader");
      logger.debug("[useAppHandlers] setActiveView('reader') called");
    },
    [handleSelectBookContext, setActiveView]
  );

  const handleAddEbook = useCallback(async () => {
    if (isImporting) return;

    const result = await dispatch(importFromDialog()).unwrap();
    if (!result || result === true) {
      return;
    }

    if (typeof result === "object" && "book" in result && "buffer" in result) {
      const { book } = result;
      if (book.audioTracks.length === 0) {
        if (!isConverting) {
          dispatch(setPendingBook({ book, buffer: result.buffer }));
          dispatch(setShowDialog(true));
        } else {
          toast.info("Ebook imported", {
            description: "You can convert it to an audiobook after the current conversion completes.",
          });
        }
      }
    }
  }, [dispatch, isImporting, isConverting]);

  const handleDeleteBook = useCallback(
    async (bookId: string) => {
      dispatch(setDeletingBookId(bookId));

      try {
        const cancelConversionForBook = async (bookId: string) => {
          await dispatch(cancelConversion({ bookId }));
        };
        await cancelConversionForBook(bookId);

        const bookToDelete = library.find((book) => book.id === bookId);

        const { deleteBook } = await import("../lib/book-service");
        await deleteBook(bookId);

        dispatch(removeBook(bookId));
        dispatch(setDetailBookId(null));

        if (bookToDelete) {
          try {
            const { clearBookCache } = await import("../lib/lazy-chapter-loader");
            clearBookCache(bookToDelete.sourcePath);
          } catch (error) {
            logger.warn("Failed to clear book cache:", error);
          }
        }

        if (activeBookId === bookId) {
          setActiveBookId(undefined);
          setActiveChapterId(undefined);
          dispatch(setPendingFragment(null));
          setActiveView("library");
        }
      } catch (error) {
        logger.error("Failed to delete book from Rust backend:", error);
        toast.error("Failed to delete book", {
          description: error instanceof Error ? error.message : "An error occurred",
        });
      } finally {
        dispatch(setDeletingBookId(null));
      }
    },
    [
      dispatch,
      library,
      setDetailBookIdHandler,
      activeBookId,
      setActiveBookId,
      setActiveChapterId,
      setActiveView,
    ]
  );

  // Navigation handlers
  const handleNavigateLibrary = useCallback(async () => {
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

  const handleThemeChange = useCallback(
    (theme: "light" | "dark" | "system") => {
      updateSettings({ theme });
    },
    [updateSettings]
  );

  const handleViewDetails = useCallback(
    (bookId: string) => {
      dispatch(setDetailBookId(bookId));
    },
    [dispatch]
  );

  return {
    // Refs
    saveProgressRef,
    trackChangeHandlerRef,
    audioPlayerCloseTimeoutRef,
    fileOpenRetryTimeoutRef,
    chapterLoadAttemptedRef,
    trackLoadAttemptedRef,
    lastBookIdRef,
    // Basic handlers
    setActiveBookId,
    setActiveChapterId,
    setIsReaderChromeVisibleHandler,
    setDetailBookIdHandler,
    // Progress
    saveProgress,
    // Chapter
    handleSelectChapter,
    // Audio player
    handleAudioPlayerClose,
    handleProgress,
    handleAutoScrollToggle,
    handleTrackChange,
    handleTrackChangeHandlerReady,
    // Book
    handleSelectBook,
    handleAddEbook,
    handleDeleteBook,
    // Navigation
    handleNavigateLibrary,
    handleOpenAudioPlayer,
    handleSaveProgress,
    handleThemeChange,
    handleViewDetails,
    // State
    autoScrollEnabled,
    isAudioPlayerOpen,
    isAudioPlayerDismissing,
    currentAudioTrackHref,
    currentAudioProgress,
    deletingBookId,
    isReaderChromeVisible,
    detailBookId,
    currentTab,
    currentBookId,
    currentChapterId,
    currentAudioTrackId,
    isChapterLoaded,
    isAudioTrackLoaded,
  };
}

