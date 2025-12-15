import { createContext, useContext, useMemo, useState, useCallback, useEffect, useRef } from "react";
import { logger } from "../lib/logger";
import type { Book } from "../types/reader";
import type { ReaderPreferences } from "../types/reader";
import { usePersistentReaderPreferences } from "../hooks/settings/usePersistentReaderPreferences";

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
  const {
    preferences: readerPreferences,
    setPreferences: setReaderPreferences,
    updatePreferences: updateReaderPreferences,
  } = usePersistentReaderPreferences();
  const [pendingFragment, setPendingFragment] = useState<string | null>(null);
  const [isReaderChromeVisible, setIsReaderChromeVisible] = useState(true);
  const [detailBookId, setDetailBookId] = useState<string | null>(null);
  const manualSelectionRef = useRef<string | null>(null);
  // Store fetched books temporarily until they're in the library
  const fetchedBooksRef = useRef<Map<string, Book>>(new Map());
  const fetchedBooksCleanupTimeoutsRef = useRef<Map<string, number>>(new Map());

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


  const handleFragmentConsumed = useCallback(() => {
    setPendingFragment(null);
  }, []);

  // Helper to validate and get a valid chapter ID for a book
  const getValidChapterId = useCallback((book: Book): string | undefined => {
    let fallbackChapterId =
      book.progress?.currentChapterId ??
      book.chapters[book.progress?.currentChapterIndex ?? 0]?.id ??
      book.chapters[0]?.id;
    
    // Validate the chapter exists
    if (
      fallbackChapterId &&
      !book.chapters.some((chapter) => chapter.id === fallbackChapterId)
    ) {
      fallbackChapterId = book.chapters[0]?.id;
    }
    
    return fallbackChapterId;
  }, []);

  // Helper to validate active book/chapter selection
  const validateActiveSelection = useCallback(() => {
    if (!library.length || !activeBookId) {
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
      const validChapterId = getValidChapterId(selectedBook);
      setActiveChapterId(validChapterId);
      if (validChapterId) {
        updateBookProgress(selectedBook.id, { chapterId: validChapterId });
      }
    }
  }, [library, activeBookId, activeChapterId, getValidChapterId, updateBookProgress]);

  const handleSelectBook = useCallback(
    async (bookId: string) => {
      logger.debug("[AppContext] handleSelectBook called", { 
        bookId, 
        librarySize: library.length,
        libraryBookIds: library.map(b => b.id),
      });
      
      let selectedBook = library.find((book) => book.id === bookId);
      
      // If book is not in library array, try fetching it from backend
      // This can happen if the book was just added and the library state hasn't updated yet
      if (!selectedBook) {
        logger.debug("[AppContext] Book not found in library, fetching from backend", { bookId });
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
              // Clear any existing timeout for this book
              const existingTimeout = fetchedBooksCleanupTimeoutsRef.current.get(bookId);
              if (existingTimeout) {
                clearTimeout(existingTimeout);
              }
              const timeoutId = window.setTimeout(() => {
                fetchedBooksRef.current.delete(bookId);
                fetchedBooksCleanupTimeoutsRef.current.delete(bookId);
              }, 0);
              fetchedBooksCleanupTimeoutsRef.current.set(bookId, timeoutId);
              return [...prevLibrary, fetchedBook];
            });
            logger.debug("[AppContext] Successfully fetched book from backend and added to library", { bookId });
          } else {
            logger.warn(`[AppContext] Book ${bookId} not found in library or backend`);
            return;
          }
        } catch (error) {
          logger.error(`[AppContext] Failed to fetch book ${bookId} from backend:`, error);
          return;
        }
      } else {
        logger.debug("[AppContext] Book found in library", { bookId, title: selectedBook.title });
      }
      
      // Mark this as a manual selection to prevent auto-selection from overriding it
      manualSelectionRef.current = bookId;
      
      // Check if this book is already active BEFORE setting activeBookId
      // This allows us to preserve the current chapter if the book is already active
      const wasAlreadyActive = activeBookId === bookId;
      
      setActiveBookId(bookId);
      logger.debug("[ReaderProgress] select book", { bookId });
      
      // If this book is already active, preserve the current chapter if it's still valid
      // Otherwise, use the saved progress or fallback to first chapter
      let nextChapterId: string | undefined;
      
      if (wasAlreadyActive && activeChapterId) {
        // Check if current chapter is still valid for this book
        const currentChapterValid = selectedBook.chapters.some(
          (chapter) => chapter.id === activeChapterId
        );
        if (currentChapterValid) {
          nextChapterId = activeChapterId;
          logger.debug("[AppContext] Preserving current chapter for already-active book", {
            bookId,
            chapterId: nextChapterId,
          });
          // Don't update progress - preserve existing scroll position
          setActiveChapterId(nextChapterId);
          setPendingFragment(null);
          return;
        }
      }
      
      // If no valid current chapter, get from saved progress or fallback
      if (!nextChapterId) {
        nextChapterId = getValidChapterId(selectedBook);
      }
      
      setActiveChapterId(nextChapterId);
      
      // Update last opened time when book is selected
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("update_book_last_opened_time", { bookId });
        // Update local state to reflect the change
        setLibrary((prevLibrary) =>
          prevLibrary.map((book) =>
            book.id === bookId
              ? { ...book, lastOpenedTime: new Date().toISOString() }
              : book
          )
        );
      } catch (error) {
        logger.warn("[AppContext] Failed to update last opened time:", error);
      }
      
      // Only update progress if chapter is different from existing progress
      // This prevents overwriting saved scroll position when just selecting the same book/chapter
      if (nextChapterId) {
        const existingChapterId = selectedBook.progress?.currentChapterId;
        if (existingChapterId !== nextChapterId) {
          // Chapter changed or no existing progress - update progress
          await updateBookProgress(bookId, { chapterId: nextChapterId });
        } else {
          // Same chapter - don't update progress to preserve scroll position
          logger.debug("[AppContext] Same chapter, preserving existing progress", {
            bookId,
            chapterId: nextChapterId,
          });
        }
      }
      setPendingFragment(null);
    },
    [library, setLibrary, updateBookProgress, getValidChapterId, activeBookId, activeChapterId],
  );

  // Auto-select first book/chapter when library changes
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
      // Sort books by last opened time (most recent first), then fallback to first book
      const sortedBooks = [...library].sort((a, b) => {
        const aTime = a.lastOpenedTime ? new Date(a.lastOpenedTime).getTime() : 0;
        const bTime = b.lastOpenedTime ? new Date(b.lastOpenedTime).getTime() : 0;
        return bTime - aTime; // Descending order (most recent first)
      });
      const selectedBook = sortedBooks[0] || library[0]; // Fallback to first if no last opened time
      setActiveBookId(selectedBook.id);
      const fallbackChapterId = getValidChapterId(selectedBook);
      setActiveChapterId(fallbackChapterId);
      if (fallbackChapterId) {
        updateBookProgress(selectedBook.id, { chapterId: fallbackChapterId });
      }
    } else {
      // Validate existing selection when library changes
      validateActiveSelection();
    }
  }, [library, activeBookId, getValidChapterId, updateBookProgress, validateActiveSelection]);

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

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      fetchedBooksCleanupTimeoutsRef.current.forEach((timeoutId) => {
        clearTimeout(timeoutId);
      });
      fetchedBooksCleanupTimeoutsRef.current.clear();
    };
  }, []);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useAppContext must be used within AppContextProvider");
  }
  return context;
}

