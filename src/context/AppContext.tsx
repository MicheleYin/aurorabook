import {
  createContext,
  Dispatch,
  ReactNode,
  SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
import type { AppTab } from "../types/settings";
import { logger } from "../lib/logger";
import { normalizeBooks } from "../lib/normalize-book";
import { normalizeAppTab } from "../lib/settings-utils";
import { useSettingsContext } from "./SettingsContext";

export type TabValue = AppTab;

export interface AppContextType {
  currentTab: TabValue;
  setCurrentTab: (tab: TabValue) => void;

  currentBook: Book | null;
  setCurrentBook: Dispatch<SetStateAction<Book | null>>;
  setCurrentBookWithLoading: (book: Book, autoPlayAudio: boolean) => Promise<void>;

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
  loadLastOpenedAudioTrack: (book: Book, autoPlayAudio: boolean) => void;
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
  const {
    settings,
    isLoading: isLoadingSettings,
    saveSettings,
  } = useSettingsContext();
  const [currentTab, setCurrentTabState] = useState<TabValue>("library");
  const [currentBook, setCurrentBook] = useState<Book | null>(null);
  const [isLoadingLibrary, setIsLoadingLibrary] = useState(true);
  const [library, setLibrary] = useState<Book[]>([]);
  const hasRestoredSessionRef = useRef(false);
  const currentBookRef = useRef<Book | null>(null);

  useEffect(() => {
    currentBookRef.current = currentBook;
  }, [currentBook]);

  const loadBooks = useCallback(async () => {
    try {
      setIsLoadingLibrary(true);
      const loadedBooks = await invoke<Book[]>("read_all_books", {
        filter: null,
      });
      setLibrary(normalizeBooks(loadedBooks));
    } catch (err) {
      logger.error("Failed to load books:", err);
      toast.error("Failed to load books");
    } finally {
      setIsLoadingLibrary(false);
    }
  }, []);

  const changeCurrentBook = useCallback(
    async (book: Book, autoPlayAudio: boolean) => {
      // FIX: Save the CURRENT book's audio progress BEFORE switching
      // This prevents corrupting the new book's audioState with the old book's data
      const previousBook = currentBookRef.current;
      if (previousBook && previousBook.id !== book.id) {
        await saveAudioProgress(previousBook);
      }

      setCurrentBook(book);

      // also load the chapter content
      loadLastOpenedChapter(book);
      // also load the audio track
      loadLastOpenedAudioTrack(book, autoPlayAudio);

      void invoke("update_book_last_opened_time", { bookId: book.id }).catch(
        (err) => {
          logger.error("Failed to update book last opened time:", err);
        }
      );
      // Persist book id before any follow-up tab save can race.
      await saveSettings({ lastOpenedBookId: book.id });
    },
    [loadLastOpenedChapter, loadLastOpenedAudioTrack, saveAudioProgress, saveSettings]
  );

  const changeCurrentTab = useCallback(
    (tab: TabValue) => {
      setCurrentTabState(tab);
      void saveSettings({ currentTab: tab });
      const activeBook = currentBookRef.current;
      if (activeBook) {
        const progress = calculateBookProgress(activeBook);
        const audioState = calculateAudioProgress(activeBook);
        void saveChapterProgress(activeBook);
        void saveAudioProgress(activeBook);
        let newBook = activeBook;
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
        setCurrentBook(newBook);
        setLibrary((prev) =>
          prev.map((book) => (book.id === activeBook.id ? newBook : book))
        );
      }
    },
    [
      calculateBookProgress,
      calculateAudioProgress,
      saveChapterProgress,
      saveAudioProgress,
      saveSettings,
    ]
  );

  // load books on mount
  useEffect(() => {
    loadBooks();
  }, [loadBooks]);

  // Restore last page + last book once settings and library are ready.
  useEffect(() => {
    if (hasRestoredSessionRef.current) return;
    if (isLoadingSettings || isLoadingLibrary || !settings) return;

    hasRestoredSessionRef.current = true;

    const savedTab = normalizeAppTab(settings.currentTab);
    const savedBookId = settings.lastOpenedBookId ?? null;
    const savedBook = savedBookId
      ? library.find((book) => book.id === savedBookId) ?? null
      : null;

    logger.info("Restoring session", {
      savedTab,
      savedBookId,
      foundBook: Boolean(savedBook),
    });

    if (savedBookId && !savedBook) {
      void saveSettings({
        lastOpenedBookId: null,
        currentTab: savedTab === "reader" ? "library" : savedTab,
      });
      setCurrentTabState(savedTab === "reader" ? "library" : savedTab);
      return;
    }

    if (savedBook) {
      void changeCurrentBook(savedBook, false);
    }

    if (savedTab === "reader" && !savedBook) {
      setCurrentTabState("library");
      void saveSettings({ currentTab: "library" });
      return;
    }

    setCurrentTabState(savedTab);
  }, [
    changeCurrentBook,
    isLoadingLibrary,
    isLoadingSettings,
    library,
    saveSettings,
    settings,
  ]);

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
