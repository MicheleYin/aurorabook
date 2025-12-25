import {
  createContext,
  Dispatch,
  ReactNode,
  SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";

import type {
  AudioTrack,
  Book,
  BookAudioState,
  BookProgress,
} from "../types/book";

export type TabValue = "library" | "reader" | "settings";

export interface AppContextType {
  currentTab: TabValue;
  setCurrentTab: (tab: TabValue) => void;

  currentBook: Book | null;
  setCurrentBook: Dispatch<SetStateAction<Book | null>>;
  setCurrentBookWithLoading: (book: Book) => void;

  library: Book[];
  setLibrary: Dispatch<SetStateAction<Book[]>>;

  isLoadingLibrary: boolean;
  setIsLoadingLibrary: Dispatch<SetStateAction<boolean>>;
  loadBooks: () => Promise<void>;
}

export const AppContext = createContext<AppContextType | undefined>(undefined);

export function useAppContext() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useAppContext must be used within AppProvider");
  }
  return context;
}

interface AppProviderProps {
  readonly children: ReactNode;
  saveChapterProgress: (book: Book) => Promise<void>;
  restoreChapterProgress: (book: Book) => Promise<void>;
  loadLastOpenedChapter: (book: Book) => void;
  calculateBookProgress: (book: Book) => BookProgress | null;
  // audio progress
  loadLastOpenedAudioTrack: (book: Book) => void;
  loadAudioTrack: (
    bookId: string,
    track: AudioTrack,
    book: Book
  ) => Promise<void>;
  calculateAudioProgress: (book: Book) => BookAudioState | null;
  saveAudioProgress: (book: Book) => Promise<void>;
}

export function AppProvider({
  children,
  saveChapterProgress,
  loadLastOpenedChapter,
  loadLastOpenedAudioTrack,
  calculateBookProgress,
  calculateAudioProgress,
  saveAudioProgress,
}: Readonly<AppProviderProps>) {
  const [currentTab, setCurrentTab] = useState<TabValue>("library");
  const [currentBook, setCurrentBook] = useState<Book | null>(null);
  const [isLoadingLibrary, setIsLoadingLibrary] = useState(true);
  const [library, setLibrary] = useState<Book[]>([]);

  const loadBooks = useCallback(async () => {
    try {
      setIsLoadingLibrary(true);
      const loadedBooks = await invoke<Book[]>("read_all_books", {
        filter: null,
      });
      setLibrary(loadedBooks);
    } catch (err) {
      console.error("Failed to load books:", err);
      toast.error("Failed to load books");
    } finally {
      setIsLoadingLibrary(false);
    }
  }, []);

  const changeCurrentBook = useCallback(
    (book: Book) => {
      setCurrentBook(book);

      // saving the audio progress
      saveAudioProgress(book);

      // also load the chapter content
      loadLastOpenedChapter(book);
      // also load the audio track
      loadLastOpenedAudioTrack(book);
    },
    [loadLastOpenedChapter, loadLastOpenedAudioTrack, saveAudioProgress]
  );
  const changeCurrentTab = useCallback(
    (tab: TabValue) => {
      setCurrentTab(tab);
      if (currentBook) {
        const progress = calculateBookProgress(currentBook);
        const audioState = calculateAudioProgress(currentBook);
        saveChapterProgress(currentBook);
        saveAudioProgress(currentBook);
        let newBook = currentBook;
        if (progress) {
          newBook = {
            ...newBook,
            progress: progress,
          };
        }
        if (audioState) {
          newBook = {
            ...newBook,
            audioState: audioState,
          };
        }
        setLibrary(
          library.map((book) => (book.id === currentBook.id ? newBook : book))
        );
      }
    },
    [
      currentBook,
      calculateBookProgress,
      calculateAudioProgress,
      saveChapterProgress,
      saveAudioProgress,
      library,
    ]
  );

  // load books on mount
  useEffect(() => {
    loadBooks();
  }, [loadBooks]);

  const contextValue = useMemo(
    () => ({
      currentTab,
      setCurrentTab: changeCurrentTab,
      currentBook,
      setCurrentBook,
      setCurrentBookWithLoading: changeCurrentBook,
      library,
      setLibrary,
      isLoadingLibrary,
      setIsLoadingLibrary,
      loadBooks,
    }),
    [
      currentTab,
      changeCurrentTab,
      currentBook,
      changeCurrentBook,
      library,
      isLoadingLibrary,
      setIsLoadingLibrary,
      loadBooks,
    ]
  );

  return (
    <AppContext.Provider value={contextValue}>{children}</AppContext.Provider>
  );
}
