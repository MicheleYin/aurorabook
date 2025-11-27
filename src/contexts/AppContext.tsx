import { createContext, useContext, useMemo, useState, useCallback, useEffect, useRef } from "react";
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
  setLibrary,
  updateBookProgress,
}: {
  children: React.ReactNode;
  library: Book[];
  setLibrary: React.Dispatch<React.SetStateAction<Book[]>>;
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
  const manualSelectionRef = useRef<string | null>(null);
  // Store fetched books temporarily until they're in the library
  const fetchedBooksRef = useRef<Map<string, Book>>(new Map());

  const activeBook = useMemo(() => {
    if (!activeBookId) return undefined;
    // First check the library
    const bookInLibrary = library.find((book) => book.id === activeBookId);
    if (bookInLibrary) return bookInLibrary;
    // Fallback to fetched books ref (for books just fetched but not yet in library state)
    return fetchedBooksRef.current.get(activeBookId);
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
      console.debug("[AppContext] handleSelectBook called", { 
        bookId, 
        librarySize: library.length,
        libraryBookIds: library.map(b => b.id),
      });
      
      let selectedBook = library.find((book) => book.id === bookId);
      
      // If book is not in library array, try fetching it from backend
      // This can happen if the book was just added and the library state hasn't updated yet
      if (!selectedBook) {
        console.debug("[AppContext] Book not found in library, fetching from backend", { bookId });
        try {
          const { readOneBook } = await import("../lib/book-service");
          const fetchedBook = await readOneBook(bookId);
          if (fetchedBook) {
            selectedBook = fetchedBook;
            // Store in ref immediately so activeBook can find it right away
            fetchedBooksRef.current.set(bookId, fetchedBook);
            // Add the fetched book to the library state so it persists
            setLibrary((prevLibrary) => {
              // Check if book already exists to avoid duplicates
              const existingIndex = prevLibrary.findIndex(
                (b) => b.id === fetchedBook.id || b.sourcePath === fetchedBook.sourcePath
              );
              if (existingIndex !== -1) {
                // Update existing book
                const updated = [...prevLibrary];
                updated[existingIndex] = fetchedBook;
                // Remove from ref since it's now in library
                fetchedBooksRef.current.delete(bookId);
                return updated;
              }
              // Add new book
              // Remove from ref once it's in library (on next render)
              setTimeout(() => {
                fetchedBooksRef.current.delete(bookId);
              }, 0);
              return [...prevLibrary, fetchedBook];
            });
            console.debug("[AppContext] Successfully fetched book from backend and added to library", { bookId });
          } else {
            console.warn(`[AppContext] Book ${bookId} not found in library or backend`);
            return;
          }
        } catch (error) {
          console.error(`[AppContext] Failed to fetch book ${bookId} from backend:`, error);
          return;
        }
      } else {
        console.debug("[AppContext] Book found in library", { bookId, title: selectedBook.title });
      }
      
      // Mark this as a manual selection to prevent auto-selection from overriding it
      manualSelectionRef.current = bookId;
      
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
    [library, setLibrary, updateBookProgress],
  );

  // Auto-select first book/chapter when library changes (but not when activeBookId changes)
  useEffect(() => {
    if (!library.length) {
      setActiveBookId(undefined);
      setActiveChapterId(undefined);
      manualSelectionRef.current = null;
      return;
    }

    // Only auto-select if no book is currently selected or the selected book doesn't exist
    if (!activeBookId || !library.some((book) => book.id === activeBookId)) {
      // Don't auto-select if there's a pending manual selection
      if (manualSelectionRef.current) {
        return;
      }
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
    }
  }, [library, updateBookProgress]); // Only depend on library, not activeBookId

  // Validate activeBookId and activeChapterId when they change
  useEffect(() => {
    // Skip validation if this is a manual selection
    if (manualSelectionRef.current === activeBookId) {
      // Clear the ref after validation to allow future validations
      const timer = setTimeout(() => {
        manualSelectionRef.current = null;
      }, 200);
      return () => clearTimeout(timer);
    }

    if (!library.length) {
      return;
    }

    if (!activeBookId) {
      return;
    }

    const selectedBook = library.find((book) => book.id === activeBookId);
    if (!selectedBook) {
      // Book was deleted, clear selection
      setActiveBookId(undefined);
      setActiveChapterId(undefined);
      return;
    }

    // Validate that the active chapter exists in the selected book
    const hasActiveChapter = activeChapterId
      ? selectedBook.chapters.some((chapter) => chapter.id === activeChapterId)
      : false;

    if (!hasActiveChapter && activeChapterId) {
      // Chapter doesn't exist, find a valid one
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
  }, [activeBookId, activeChapterId, library, updateBookProgress]);

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

