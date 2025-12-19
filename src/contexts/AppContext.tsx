import { createContext, useContext, useCallback, useEffect, useRef } from "react";
import { logger } from "../lib/logger";
import type { Book } from "../types/reader";
import type { ReaderPreferences } from "../types/reader";
import { usePersistentReaderPreferences } from "../hooks/settings/usePersistentReaderPreferences";
import { useAppSelector, useAppDispatch } from "../store/hooks";
import {
  selectCurrentBookId,
  selectCurrentChapterId,
  selectCurrentBook,
  selectCurrentChapter,
  selectPendingFragment,
  selectIsReaderChromeVisible,
  selectDetailBookId,
  selectLibrary,
} from "../store/selectors";
import {
  setCurrentBookId,
  setCurrentChapterId,
  setPendingFragment,
  setIsReaderChromeVisible,
  setDetailBookId,
} from "../store/slices/readerSlice";
import { selectBook } from "../store/thunks/readerThunks";

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
}: {
  children: React.ReactNode;
}) {
  const dispatch = useAppDispatch();
  const library = useAppSelector(selectLibrary);
  const activeBookId = useAppSelector(selectCurrentBookId);
  const activeChapterId = useAppSelector(selectCurrentChapterId);
  const activeBook = useAppSelector(selectCurrentBook);
  const activeChapter = useAppSelector(selectCurrentChapter);
  const pendingFragment = useAppSelector(selectPendingFragment);
  const isReaderChromeVisible = useAppSelector(selectIsReaderChromeVisible);
  const detailBookId = useAppSelector(selectDetailBookId);
  
  const {
    preferences: readerPreferences,
    setPreferences: setReaderPreferences,
    updatePreferences: updateReaderPreferences,
  } = usePersistentReaderPreferences();

  const handleFragmentConsumed = useCallback(() => {
    dispatch(setPendingFragment(null));
  }, [dispatch]);

  const handleSelectBook = useCallback(
    async (bookId: string) => {
      logger.debug("[AppContext] handleSelectBook called", { 
        bookId, 
        librarySize: library.length,
        libraryBookIds: library.map(b => b.id),
      });
      
      // Use Redux thunk to select book and load progress chapter/audio track
      await dispatch(selectBook({ bookId }));
      dispatch(setPendingFragment(null));
    },
    [dispatch, library],
  );

  // Auto-select first book/chapter when library changes
  const manualSelectionRef = useRef<string | null>(null);
  
  useEffect(() => {
    if (!library.length) {
      dispatch(setCurrentBookId(null));
      dispatch(setCurrentChapterId(null));
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
      dispatch(selectBook({ bookId: selectedBook.id }));
    }
  }, [library, activeBookId, dispatch]);

  const value: AppContextType = {
    activeBookId: activeBookId ?? undefined,
    setActiveBookId: (id: string | undefined) => {
      dispatch(setCurrentBookId(id ?? null));
    },
    activeChapterId: activeChapterId ?? undefined,
    setActiveChapterId: (id: string | undefined) => {
      dispatch(setCurrentChapterId(id ?? null));
    },
    activeBook,
    activeChapter,
    readerPreferences,
    setReaderPreferences,
    updateReaderPreferences,
    pendingFragment,
    setPendingFragment: (fragment: string | null) => {
      dispatch(setPendingFragment(fragment));
    },
    handleFragmentConsumed,
    isReaderChromeVisible,
    setIsReaderChromeVisible: (visible: boolean) => {
      dispatch(setIsReaderChromeVisible(visible));
    },
    detailBookId,
    setDetailBookId: (id: string | null) => {
      dispatch(setDetailBookId(id));
    },
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

