import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { HiddenFileInput } from "./components/HiddenFileInput";
import { LibraryPanel } from "./components/LibraryPanel";
import type {
  LibraryFilterOption,
  LibraryViewMode,
} from "./components/library/types";
import { ReaderPanel } from "./components/ReaderPanel";
import { ReaderAudioPlayer } from "./components/reader/ReaderAudioPlayer";
import { BookDetailDialog } from "./components/library/BookDetailDialog";
import { Toaster } from "./components/ui/sonner";
import { LoadingScreen } from "./components/app/LoadingScreen";
import { SettingsPanel } from "./components/SettingsPanel";
import { usePersistentLibrary } from "./hooks/usePersistentLibrary";
import { usePersistentSettings } from "./hooks/usePersistentSettings";
import type { ReaderPreferences } from "./types/reader";
import type { UITheme } from "./types/ui";
import type {
  AudioProgressSnapshot,
  ChapterProgressSnapshot,
  ChapterSelectionOptions,
} from "./components/reader/types";
import { cn, getLibraryBookStatus } from "./lib/utils";
import { findChaptersForAudioTrack } from "./lib/epub";

const DEFAULT_READER_PREFERENCES: ReaderPreferences = {
  theme: "system",
  fontFamily: "merriweather",
  contentPadding: "comfortable",
  fontSize: "medium",
};

const PROGRESS_LOG_PREFIX = "[ReaderProgress]";

type AppView = "library" | "reader" | "settings";

function App() {
  const {
    library,
    setLibrary,
    isHydrated,
    isImporting,
    importFromDialog,
    handleWebFileSelection,
  } = usePersistentLibrary();

  const [activeBookId, setActiveBookId] = useState<string | undefined>();
  const [activeChapterId, setActiveChapterId] = useState<string | undefined>();
  const [activeView, setActiveView] = useState<AppView>("library");
  const [librarySearchTerm, setLibrarySearchTerm] = useState("");
  const [libraryFilter, setLibraryFilter] = useState<LibraryFilterOption>("all");
  const [libraryViewMode, setLibraryViewMode] = useState<LibraryViewMode>("grid");
  const [readerPreferences, setReaderPreferences] = useState<ReaderPreferences>(
    DEFAULT_READER_PREFERENCES,
  );
  const [pendingFragment, setPendingFragment] = useState<string | null>(null);
  const [detailBookId, setDetailBookId] = useState<string | null>(null);
  const [isReaderChromeVisible, setIsReaderChromeVisible] = useState(true);
  const [isAudioPlayerOpen, setIsAudioPlayerOpen] = useState(false);
  const [isAudioPlayerDismissing, setIsAudioPlayerDismissing] = useState(false);
  const [currentAudioTime, setCurrentAudioTime] = useState<number | undefined>(undefined);
  const [currentAudioTrackHref, setCurrentAudioTrackHref] = useState<string | undefined>(undefined);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const lastAudioBookIdRef = useRef<string | null>(null);
  const previousViewRef = useRef<AppView>(activeView);
  const {
    settings,
    updateSettings,
    isHydrated: isSettingsHydrated,
  } = usePersistentSettings();
  const uiTheme = settings.theme;

  useEffect(() => {
    if (activeView !== "reader") {
      setIsReaderChromeVisible(true);
    }
  }, [activeView]);

  const resolveTheme = useCallback((theme: UITheme) => {
    if (theme === "system") {
      if (
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches
      ) {
        return "dark" as const;
      }
      return "light" as const;
    }
    return theme;
  }, []);

  const resolvedUiTheme = useMemo(
    () => resolveTheme(uiTheme),
    [uiTheme, resolveTheme],
  );

  useEffect(() => {
    if (typeof document === "undefined") return;

    const root = document.documentElement;
    const applyTheme = (theme: UITheme) => {
      const resolved = resolveTheme(theme);
      root.classList.toggle("dark", resolved === "dark");
    };

    applyTheme(uiTheme);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("ui-theme", uiTheme);
    }

    if (uiTheme !== "system" || typeof window === "undefined") {
      return;
    }

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = () => applyTheme("system");
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, [uiTheme, resolveTheme]);

  const activeBook = useMemo(() => {
    if (!activeBookId) return undefined;
    return library.find((book) => book.id === activeBookId);
  }, [library, activeBookId]);

  const activeChapter = useMemo(() => {
    if (!activeBook || !activeChapterId) return undefined;
    return activeBook.chapters.find((chapter) => chapter.id === activeChapterId);
  }, [activeBook, activeChapterId]);

  const audioTrackCount = activeBook?.audioTracks?.length ?? 0;
  const hasAudioTracks = audioTrackCount > 0;

  useEffect(() => {
    if (!activeBook?.id || audioTrackCount === 0) {
      setIsAudioPlayerOpen(false);
      setCurrentAudioTime(undefined);
      setCurrentAudioTrackHref(undefined);
      lastAudioBookIdRef.current = null;
      return;
    }

    if (lastAudioBookIdRef.current !== activeBook.id) {
      lastAudioBookIdRef.current = activeBook.id;
      setIsAudioPlayerOpen(true);
    }
  }, [activeBook?.id, audioTrackCount]);


  useEffect(() => {
    const previousView = previousViewRef.current;
    if (activeView === "reader" && previousView !== "reader" && hasAudioTracks) {
      setIsAudioPlayerOpen(true);
    }
    previousViewRef.current = activeView;
  }, [activeView, hasAudioTracks]);

  type ProgressUpdatePayload = {
    chapterId: string;
    scrollTop?: number;
    scrollHeight?: number;
    clientHeight?: number;
    percent?: number;
    elementId?: string | null;
    elementIndex?: number | null;
  };

  const updateBookProgress = useCallback(
    (bookId: string, payload: ProgressUpdatePayload) => {
      if (!payload?.chapterId) return;

      console.debug(`${PROGRESS_LOG_PREFIX} update requested`, { bookId, payload });

      setLibrary((prev) => {
        let updated = false;
        const timestamp = new Date().toISOString();

        const nextLibrary = prev.map((book) => {
          if (book.id !== bookId) {
            return book;
          }

          const chapterIndex = book.chapters.findIndex(
            (chapter) => chapter.id === payload.chapterId,
          );
          if (chapterIndex === -1) {
            return book;
          }

          const chapter = book.chapters[chapterIndex];
          const existingProgress = book.progress;
          const chapterMatchesExisting =
            existingProgress?.currentChapterId === chapter.id &&
            existingProgress.currentChapterIndex === chapterIndex;

          const previousScrollTop =
            typeof existingProgress?.currentChapterScrollTop === "number" &&
            Number.isFinite(existingProgress.currentChapterScrollTop)
              ? Math.max(existingProgress.currentChapterScrollTop, 0)
              : 0;
          const previousScrollHeight =
            typeof existingProgress?.currentChapterScrollHeight === "number" &&
            Number.isFinite(existingProgress.currentChapterScrollHeight)
              ? Math.max(existingProgress.currentChapterScrollHeight, 0)
              : 0;
          const previousClientHeight =
            typeof existingProgress?.currentChapterClientHeight === "number" &&
            Number.isFinite(existingProgress.currentChapterClientHeight)
              ? Math.max(existingProgress.currentChapterClientHeight, 0)
              : 0;
          const previousPercent =
            typeof existingProgress?.chapterProgressPercent === "number" &&
            Number.isFinite(existingProgress.chapterProgressPercent)
              ? existingProgress.chapterProgressPercent
              : 0;

          const previousElementId =
            typeof existingProgress?.currentChapterElementId === "string" &&
            existingProgress.currentChapterElementId.length > 0
              ? existingProgress.currentChapterElementId
              : null;
          const previousElementIndex =
            typeof existingProgress?.currentChapterElementIndex === "number" &&
            Number.isFinite(existingProgress.currentChapterElementIndex)
              ? Math.max(Math.round(existingProgress.currentChapterElementIndex), 0)
              : null;

          const resolvedScrollTop =
            typeof payload.scrollTop === "number" && Number.isFinite(payload.scrollTop)
              ? Math.max(payload.scrollTop, 0)
              : chapterMatchesExisting
                ? previousScrollTop
                : 0;

          const resolvedScrollHeight =
            typeof payload.scrollHeight === "number" && Number.isFinite(payload.scrollHeight)
              ? Math.max(payload.scrollHeight, 0)
              : chapterMatchesExisting
                ? previousScrollHeight
                : 0;

          const resolvedClientHeight =
            typeof payload.clientHeight === "number" && Number.isFinite(payload.clientHeight)
              ? Math.max(payload.clientHeight, 0)
              : chapterMatchesExisting
                ? previousClientHeight
                : 0;

          const percentSource =
            typeof payload.percent === "number" && Number.isFinite(payload.percent)
              ? payload.percent
              : chapterMatchesExisting
                ? previousPercent
                : 0;

          const percent = Number(Math.min(Math.max(percentSource ?? 0, 0), 1).toFixed(4));

          const resolvedElementId =
            payload.elementId === undefined
              ? (chapterMatchesExisting ? previousElementId : null)
              : payload.elementId && payload.elementId.length > 0
                ? payload.elementId
                : null;

          let resolvedElementIndex: number | null = null;
          if (payload.elementIndex === undefined) {
            resolvedElementIndex = chapterMatchesExisting ? previousElementIndex : null;
          } else if (payload.elementIndex === null) {
            resolvedElementIndex = null;
          } else if (typeof payload.elementIndex === "number" && Number.isFinite(payload.elementIndex)) {
            resolvedElementIndex = Math.max(Math.round(payload.elementIndex), 0);
          } else if (chapterMatchesExisting) {
            resolvedElementIndex = previousElementIndex;
          }

          const nextProgress = {
            currentChapterId: chapter.id,
            currentChapterHref: chapter.href,
            currentChapterIndex: chapterIndex,
            currentChapterElementId: resolvedElementId ?? null,
            currentChapterElementIndex: resolvedElementIndex ?? null,
            currentChapterScrollTop: resolvedScrollTop,
            currentChapterScrollHeight: resolvedScrollHeight,
            currentChapterClientHeight: resolvedClientHeight,
            chapterProgressPercent: percent,
            updatedAt: timestamp,
          };

          const isUnchanged =
            existingProgress &&
            existingProgress.currentChapterId === nextProgress.currentChapterId &&
            existingProgress.currentChapterIndex === nextProgress.currentChapterIndex &&
            Math.abs(
              (typeof existingProgress.currentChapterScrollTop === "number"
                ? existingProgress.currentChapterScrollTop
                : 0) - nextProgress.currentChapterScrollTop,
            ) < 1 &&
            Math.abs(
              (typeof existingProgress.currentChapterScrollHeight === "number"
                ? existingProgress.currentChapterScrollHeight
                : 0) - nextProgress.currentChapterScrollHeight,
            ) < 1 &&
            Math.abs(
              (typeof existingProgress.currentChapterClientHeight === "number"
                ? existingProgress.currentChapterClientHeight
                : 0) - nextProgress.currentChapterClientHeight,
            ) < 1 &&
            Math.abs(existingProgress.chapterProgressPercent - nextProgress.chapterProgressPercent) <
              0.002 &&
            ((existingProgress.currentChapterElementId ?? null) ===
              (nextProgress.currentChapterElementId ?? null)) &&
            ((existingProgress.currentChapterElementIndex ?? null) ===
              (nextProgress.currentChapterElementIndex ?? null));

          if (isUnchanged) {
            console.debug(`${PROGRESS_LOG_PREFIX} unchanged progress, skipping persist`, {
              bookId,
              chapterId: chapter.id,
            });
            return book;
          }

          updated = true;
          console.debug(`${PROGRESS_LOG_PREFIX} persisting progress`, {
            bookId,
            chapterId: chapter.id,
            progress: nextProgress,
          });
          return {
            ...book,
            progress: nextProgress,
          };
        });

        return updated ? nextLibrary : prev;
      });
    },
    [setLibrary],
  );

  const updateBookAudioState = useCallback(
    (bookId: string, snapshot: AudioProgressSnapshot) => {
      if (!bookId) {
        return;
      }
      if (
        typeof snapshot?.currentTimeSeconds !== "number" ||
        !Number.isFinite(snapshot.currentTimeSeconds) ||
        snapshot.currentTimeSeconds < 0
      ) {
        return;
      }

      setLibrary((prev) => {
        let updated = false;
        const timestamp = snapshot.updatedAt ?? new Date().toISOString();
        const nextLibrary = prev.map((book) => {
          if (book.id !== bookId || !book.audioTracks.length) {
            return book;
          }

          const resolvedTrack =
            book.audioTracks.find((track) => track.id === snapshot.trackId) ??
            book.audioTracks.find((track) => track.href === snapshot.trackHref) ??
            book.audioTracks[snapshot.trackIndex];

          if (!resolvedTrack) {
            return book;
          }

          const resolvedIndex = book.audioTracks.findIndex((track) => track.id === resolvedTrack.id);
          const normalizedSeconds = Number(snapshot.currentTimeSeconds.toFixed(3));
          const existing = book.audioState;

          if (
            existing &&
            existing.currentTrackId === resolvedTrack.id &&
            Math.abs(existing.currentTimeSeconds - normalizedSeconds) < 0.25
          ) {
            return book;
          }

          updated = true;
          return {
            ...book,
            audioState: {
              currentTrackId: resolvedTrack.id,
              currentTrackHref: resolvedTrack.href,
              currentTrackIndex: resolvedIndex === -1 ? snapshot.trackIndex : resolvedIndex,
              currentTimeSeconds: normalizedSeconds,
              updatedAt: timestamp,
            },
          };
        });

        return updated ? nextLibrary : prev;
      });
    },
    [setLibrary],
  );

  useEffect(() => {
    if (!library.length) {
      setActiveBookId(undefined);
      setActiveChapterId(undefined);
      return;
    }

    if (!activeBookId || !library.some((book) => book.id === activeBookId)) {
      const firstBook = library[0];
      setActiveBookId(firstBook.id);
      let fallbackChapterId =
        firstBook.progress?.currentChapterId ??
        firstBook.chapters[firstBook.progress?.currentChapterIndex ?? 0]?.id ??
        firstBook.chapters[0]?.id;
      if (
        fallbackChapterId &&
        !firstBook.chapters.some((chapter) => chapter.id === fallbackChapterId)
      ) {
        fallbackChapterId = firstBook.chapters[0]?.id;
      }
      setActiveChapterId(fallbackChapterId);
      if (fallbackChapterId) {
        updateBookProgress(firstBook.id, { chapterId: fallbackChapterId });
      }
      return;
    }

    const selectedBook = library.find((book) => book.id === activeBookId);
    if (!selectedBook) {
      setActiveBookId(undefined);
      setActiveChapterId(undefined);
      return;
    }

    const hasActiveChapter = activeChapterId
      ? selectedBook.chapters.some((chapter) => chapter.id === activeChapterId)
      : false;

    if (!hasActiveChapter) {
      let fallbackChapterId =
        selectedBook.progress?.currentChapterId ??
        selectedBook.chapters[selectedBook.progress?.currentChapterIndex ?? 0]?.id ??
        selectedBook.chapters[0]?.id;
      if (
        fallbackChapterId &&
        !selectedBook.chapters.some((chapter) => chapter.id === fallbackChapterId)
      ) {
        fallbackChapterId = selectedBook.chapters[0]?.id;
      }
      setActiveChapterId(fallbackChapterId);
      if (fallbackChapterId) {
        updateBookProgress(selectedBook.id, { chapterId: fallbackChapterId });
      }
    }
  }, [library, activeBookId, activeChapterId, updateBookProgress]);

  const updateReaderPreferences = useCallback(
    (update: Partial<ReaderPreferences>) => {
      setReaderPreferences((prev) => ({
        ...prev,
        ...update,
      }));
    },
    [],
  );

  const handleFragmentConsumed = useCallback(() => {
    setPendingFragment(null);
  }, []);

  const handleSelectBook = useCallback(
    (bookId: string) => {
      const selectedBook = library.find((book) => book.id === bookId);
      setActiveBookId(bookId);
      console.debug(`${PROGRESS_LOG_PREFIX} select book`, { bookId });
      let progressChapterId: string | undefined;
      if (selectedBook?.progress?.currentChapterId) {
        const candidate = selectedBook.progress.currentChapterId;
        if (selectedBook.chapters.some((chapter) => chapter.id === candidate)) {
          progressChapterId = candidate;
        }
      }
      const indexFallbackId =
        selectedBook?.chapters[selectedBook.progress?.currentChapterIndex ?? 0]?.id;
      const nextChapterId = progressChapterId ?? indexFallbackId ?? selectedBook?.chapters[0]?.id;
      setActiveChapterId(nextChapterId);
      if (nextChapterId) {
        updateBookProgress(bookId, { chapterId: nextChapterId });
      }
      setPendingFragment(null);
      setActiveView("reader");
    },
    [library, updateBookProgress],
  );

  const handleSelectChapter = useCallback(
    (chapterId: string, options?: ChapterSelectionOptions) => {
      if (!activeBookId) return;

      setActiveChapterId(chapterId);

      const requestedScrollPosition = options?.scrollPosition ?? "maintain";
      const progressUpdate: ProgressUpdatePayload = { chapterId };

      if (requestedScrollPosition === "top") {
        progressUpdate.scrollTop = 0;
        progressUpdate.scrollHeight = 0;
        progressUpdate.clientHeight = 0;
        progressUpdate.percent = 0;
      } else if (requestedScrollPosition === "bottom") {
        progressUpdate.percent = 1;
      }

      console.debug(`${PROGRESS_LOG_PREFIX} select chapter`, {
        bookId: activeBookId,
        chapterId,
        requestedScrollPosition,
        progressUpdate,
      });

      updateBookProgress(activeBookId, progressUpdate);

      const fragment = options?.fragment;
      setPendingFragment(fragment && fragment.length > 0 ? fragment.replace(/^#/, "") : null);
      setActiveView("reader");
    },
    [activeBookId, updateBookProgress],
  );

  const handleChapterProgress = useCallback(
    (bookId: string, snapshot: ChapterProgressSnapshot) => {
      console.debug(`${PROGRESS_LOG_PREFIX} received progress snapshot`, { bookId, snapshot });
      updateBookProgress(bookId, {
        chapterId: snapshot.chapterId,
        scrollTop: snapshot.scrollTop,
        scrollHeight: snapshot.scrollHeight,
        clientHeight: snapshot.clientHeight,
        percent: snapshot.percent,
        elementId: snapshot.activeElementId,
        elementIndex: snapshot.activeElementIndex,
      });
    },
    [updateBookProgress],
  );

  // Auto-switch chapter when audio track changes
  useEffect(() => {
    if (!activeBook || !currentAudioTrackHref || !activeBook.audioSyncMap) {
      return;
    }

    const chaptersForTrack = findChaptersForAudioTrack(
      activeBook.audioSyncMap,
      currentAudioTrackHref,
    );

    if (chaptersForTrack.length === 0) {
      return;
    }

    // Find the first chapter that matches one of the chapter hrefs for this track
    const matchingChapter = activeBook.chapters.find((chapter) => {
      const chapterHref = chapter.href.split("#")[0];
      return chaptersForTrack.includes(chapterHref);
    });

    if (matchingChapter && matchingChapter.id !== activeChapterId) {
      console.log("[Auto-Chapter] Switching to chapter for audio track:", {
        trackHref: currentAudioTrackHref,
        chapterId: matchingChapter.id,
        chapterTitle: matchingChapter.title,
        chapterHref: matchingChapter.href,
      });
      handleSelectChapter(matchingChapter.id, {
        scrollPosition: "top",
      });
    }
  }, [activeBook, currentAudioTrackHref, activeChapterId, handleSelectChapter]);

  const handleAddEbook = useCallback(async () => {
    if (isImporting) return;
    const handled = await importFromDialog();
    if (!handled) {
      fileInputRef.current?.click();
    }
  }, [importFromDialog, isImporting]);

  const handleDeleteBook = useCallback(
    (bookId: string) => {
      setLibrary((prev) => prev.filter((book) => book.id !== bookId));
      setDetailBookId(null);

      if (activeBookId === bookId) {
        setActiveBookId(undefined);
        setActiveChapterId(undefined);
        setPendingFragment(null);
        setActiveView("library");
      }
    },
    [activeBookId, setLibrary],
  );

  useEffect(() => {
    if (!library.length) {
      setActiveView("library");
    }
  }, [library.length]);

  const normalizedLibrarySearch = librarySearchTerm.trim().toLowerCase();
  const searchFilteredLibrary = useMemo(() => {
    if (!normalizedLibrarySearch) return library;
    return library.filter((book) => {
      const haystack = `${book.title} ${book.author}`.toLowerCase();
      return haystack.includes(normalizedLibrarySearch);
    });
  }, [library, normalizedLibrarySearch]);

  const filteredLibrary = useMemo(() => {
    switch (libraryFilter) {
      case "new":
        return searchFilteredLibrary.filter((book) => getLibraryBookStatus(book) === "new");
      case "resume":
        return searchFilteredLibrary.filter(
          (book) => getLibraryBookStatus(book) === "resume",
        );
      case "finished":
        return searchFilteredLibrary.filter(
          (book) => getLibraryBookStatus(book) === "finished",
        );
      case "recent":
        return [...searchFilteredLibrary].reverse();
      case "author":
        return [...searchFilteredLibrary].sort((a, b) =>
          a.author.localeCompare(b.author, undefined, { sensitivity: "base" }),
        );
      default:
        return searchFilteredLibrary;
    }
  }, [searchFilteredLibrary, libraryFilter]);

  const showAudioPlayer = hasAudioTracks && (isAudioPlayerOpen || isAudioPlayerDismissing);
  const audioPlayerChromeVisible = activeView === "reader" ? isReaderChromeVisible : true;

  const handleAudioPlayerClose = useCallback(() => {
    setIsAudioPlayerDismissing(true);
    // Wait for exit animation to complete before hiding
    setTimeout(() => {
      setIsAudioPlayerOpen(false);
      setIsAudioPlayerDismissing(false);
    }, 300);
  }, []);

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
    />
  );

  const detailBook = useMemo(() => {
    if (!detailBookId) return undefined;
    return library.find((book) => book.id === detailBookId);
  }, [detailBookId, library]);

  const canOpenReader = Boolean(activeBook);
  const navigationItems: Array<{ id: AppView; label: string; disabled?: boolean }> = [
    { id: "library", label: "Library" },
    { id: "reader", label: "Reader", disabled: !canOpenReader },
    { id: "settings", label: "Settings" },
  ];
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
      <HiddenFileInput
        ref={fileInputRef}
        accept=".epub,application/epub+zip"
        aria-label="Select an EPUB file to import"
        aria-hidden="true"
        tabIndex={-1}
        onChange={handleWebFileSelection}
      />
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6 pb-28 sm:px-6 lg:px-8">
        <div className="flex flex-1 min-h-0 flex-col">{currentView}</div>
      </div>
      {showAudioPlayer && activeBook ? (
        <ReaderAudioPlayer
          bookId={activeBook.id}
          tracks={activeBook.audioTracks}
          bookTitle={activeBook.title}
          initialAudioState={activeBook.audioState}
          onProgress={(snapshot) => {
            updateBookAudioState(activeBook.id, snapshot);
            setCurrentAudioTime(snapshot.currentTimeSeconds);
            setCurrentAudioTrackHref(snapshot.trackHref);
          }}
          chromeVisible={audioPlayerChromeVisible}
          onClose={handleAudioPlayerClose}
          autoScrollEnabled={autoScrollEnabled}
          onAutoScrollToggle={setAutoScrollEnabled}
        />
      ) : null}
      <div
        className={cn(
          "pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-6 sm:px-6 transition-all duration-200",
          hideNavigation && "translate-y-4 opacity-0",
        )}
      >
        <div
          className={cn(
            "pointer-events-auto inline-flex items-center gap-1 rounded-full border border-border bg-card/80 p-1 backdrop-blur-md shadow-lg ring-1 ring-black/5",
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
                  "rounded-full px-4 py-1.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
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
        />
      ) : null}
      <Toaster position="top-center" richColors />
    </div>
  );
}

export default App;
