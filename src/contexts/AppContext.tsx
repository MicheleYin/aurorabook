import { createContext, useContext, useMemo, useState, useCallback, useEffect } from "react";
import type { Book } from "../types/reader";
import type { ReaderPreferences } from "../types/reader";
import { clearAllCachesExcept } from "../lib/lazy-chapter-loader";

const DEFAULT_READER_PREFERENCES: ReaderPreferences = {
  theme: "system",
  fontFamily: "merriweather",
  contentPadding: "comfortable",
  fontSize: "medium",
};

type AppContextType = {
  // Active book and chapter
  activeBookId: string | undefined;
  setActiveBookId: (id: string | undefined) => void;
  activeChapterId: string | undefined;
  setActiveChapterId: (id: string | undefined) => void;
  activeBook: Book | undefined;
  activeChapter: Book["chapters"][number] | undefined;
  
  // Reader preferences
  readerPreferences: ReaderPreferences;
  setReaderPreferences: (prefs: ReaderPreferences) => void;
  updateReaderPreferences: (update: Partial<ReaderPreferences>) => void;
  
  // Fragment handling
  pendingFragment: string | null;
  setPendingFragment: (fragment: string | null) => void;
  handleFragmentConsumed: () => void;
  
  // Reader chrome visibility
  isReaderChromeVisible: boolean;
  setIsReaderChromeVisible: (visible: boolean) => void;
  
  // Detail dialog
  detailBookId: string | null;
  setDetailBookId: (id: string | null) => void;
  
  // Book selection handler
  handleSelectBook: (bookId: string) => Promise<void>;
};

const AppContext = createContext<AppContextType | null>(null);

export function AppContextProvider({
  children,
  library,
  updateBookProgress,
}: {
  children: React.ReactNode;
  library: Book[];
  updateBookProgress: (bookId: string, payload: { chapterId: string }) => Promise<void>;
}) {
  const [activeBookId, setActiveBookId] = useState<string | undefined>();
  const [activeChapterId, setActiveChapterId] = useState<string | undefined>();
  const [readerPreferences, setReaderPreferences] = useState<ReaderPreferences>(
    DEFAULT_READER_PREFERENCES,
  );
  const [pendingFragment, setPendingFragment] = useState<string | null>(null);
  const [isReaderChromeVisible, setIsReaderChromeVisible] = useState(true);
  const [detailBookId, setDetailBookId] = useState<string | null>(null);

  const activeBook = useMemo(() => {
    if (!activeBookId) return undefined;
    return library.find((book) => book.id === activeBookId);
  }, [library, activeBookId]);

  const activeChapter = useMemo(() => {
    if (!activeBook || !activeChapterId) return undefined;
    return activeBook.chapters.find((chapter) => chapter.id === activeChapterId);
  }, [activeBook, activeChapterId]);

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
    async (bookId: string) => {
      const selectedBook = library.find((book) => book.id === bookId);
      if (!selectedBook) return;
      
      // Clear cache for all books except the one being opened
      try {
        clearAllCachesExcept(selectedBook.sourcePath);
      } catch (error) {
        console.warn("Failed to clear book caches", error);
      }
      
      setActiveBookId(bookId);
      console.debug("[ReaderProgress] select book", { bookId });
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
        await updateBookProgress(bookId, { chapterId: nextChapterId });
      }
      setPendingFragment(null);
    },
    [library, updateBookProgress],
  );

  // Auto-select first book/chapter when library changes
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

  const value: AppContextType = {
    activeBookId,
    setActiveBookId,
    activeChapterId,
    setActiveChapterId,
    activeBook,
    activeChapter,
    readerPreferences,
    setReaderPreferences,
    updateReaderPreferences,
    pendingFragment,
    setPendingFragment,
    handleFragmentConsumed,
    isReaderChromeVisible,
    setIsReaderChromeVisible,
    detailBookId,
    setDetailBookId,
    handleSelectBook,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useAppContext must be used within AppContextProvider");
  }
  return context;
}

