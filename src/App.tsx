import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { HiddenFileInput } from "./components/HiddenFileInput";
import { ThemeSwitcher } from "./components/ThemeSwitcher";
import { LibraryPanel } from "./components/LibraryPanel";
import type {
  LibraryFilterOption,
  LibraryViewMode,
} from "./components/library/types";
import { ReaderPanel } from "./components/ReaderPanel";
import { BookDetailDialog } from "./components/library/BookDetailDialog";
import { Toaster } from "./components/ui/sonner";
import { LoadingScreen } from "./components/app/LoadingScreen";
import { usePersistentLibrary } from "./hooks/usePersistentLibrary";
import type { ReaderPreferences } from "./types/reader";
import type { UITheme } from "./types/ui";

const DEFAULT_READER_PREFERENCES: ReaderPreferences = {
  theme: "system",
  fontFamily: "merriweather",
  contentPadding: "comfortable",
  fontSize: "medium",
};

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
  const [activeView, setActiveView] = useState<"library" | "reader">("library");
  const [librarySearchTerm, setLibrarySearchTerm] = useState("");
  const [libraryFilter, setLibraryFilter] = useState<LibraryFilterOption>("all");
  const [libraryViewMode, setLibraryViewMode] = useState<LibraryViewMode>("grid");
  const [readerPreferences, setReaderPreferences] = useState<ReaderPreferences>(
    DEFAULT_READER_PREFERENCES,
  );
  const [pendingFragment, setPendingFragment] = useState<string | null>(null);
  const [detailBookId, setDetailBookId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [uiTheme, setUiTheme] = useState<UITheme>(() => {
    if (typeof window !== "undefined") {
      const stored = window.localStorage.getItem("ui-theme");
      if (stored === "light" || stored === "dark" || stored === "system") {
        return stored;
      }
    }
    return "system";
  });

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

  useEffect(() => {
    if (!library.length) {
      setActiveBookId(undefined);
      setActiveChapterId(undefined);
      return;
    }

    if (!activeBookId || !library.some((book) => book.id === activeBookId)) {
      const firstBook = library[0];
      setActiveBookId(firstBook.id);
      setActiveChapterId(firstBook.chapters[0]?.id);
      return;
    }

    const selectedBook = library.find((book) => book.id === activeBookId);
    if (
      selectedBook &&
      (!activeChapterId ||
        !selectedBook.chapters.some((chapter) => chapter.id === activeChapterId))
    ) {
      setActiveChapterId(selectedBook.chapters[0]?.id);
    }
  }, [library, activeBookId, activeChapterId]);

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
      setActiveChapterId(selectedBook?.chapters[0]?.id);
      setPendingFragment(null);
      setActiveView("reader");
    },
    [library],
  );

  const handleSelectChapter = useCallback(
    (chapterId: string, fragment?: string) => {
      if (!activeBookId) return;
      setActiveChapterId(chapterId);
      setPendingFragment(fragment && fragment.length > 0 ? fragment : null);
      setActiveView("reader");
    },
    [activeBookId],
  );

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
    />
  );

  const detailBook = useMemo(() => {
    if (!detailBookId) return undefined;
    return library.find((book) => book.id === detailBookId);
  }, [detailBookId, library]);

  const isLibraryView = activeView === "library";

  if (!isHydrated) {
    return <LoadingScreen message="Loading your library…" />;
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <HiddenFileInput
        ref={fileInputRef}
        accept=".epub,application/epub+zip"
        aria-label="Select an EPUB file to import"
        aria-hidden="true"
        tabIndex={-1}
        onChange={handleWebFileSelection}
      />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex justify-end">
          <ThemeSwitcher value={uiTheme} onChange={setUiTheme} />
        </div>

        <div className="flex-1 space-y-6">
          {isLibraryView ? (
            <div className="flex flex-col">{libraryView}</div>
          ) : (
            <div className="flex flex-col">{readerView}</div>
          )}
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
