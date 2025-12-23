import {
  createContext,
  Dispatch,
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
  Book,
  BookProgress,
  Chapter,
  ChapterWithContent,
} from "./types/book";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Library } from "./components/library/Library";
import { Reader } from "./components/reader/Reader";
import { Settings } from "./components/settings/SettingsPanel";
import { Toaster } from "./components/ui/sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import { calculateBookProgress } from "./lib/reader-utils";

type TabValue = "library" | "reader" | "settings";

interface AppContextType {
  currentTab: TabValue;
  setCurrentTab: (tab: TabValue) => void;

  currentBook: Book | null;
  setCurrentBook: (book: Book) => void;

  library: Book[];
  setLibrary: Dispatch<SetStateAction<Book[]>>;

  isLoadingLibrary: boolean;
  setIsLoadingLibrary: Dispatch<SetStateAction<boolean>>;
  loadBooks: () => Promise<void>;

  currentChapter: ChapterWithContent | null;
  setCurrentChapter: Dispatch<SetStateAction<ChapterWithContent | null>>;
  isLoadingChapter: boolean;
  setIsLoadingChapter: Dispatch<SetStateAction<boolean>>;
  loadChapterContent: (bookId: string, chapter: Chapter) => Promise<void>;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function useAppContext() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useAppContext must be used within App");
  }
  return context;
}

function App() {
  const [currentTab, setCurrentTab] = useState<TabValue>("library");
  const [currentBook, setCurrentBook] = useState<Book | null>(null);
  const [isLoadingLibrary, setIsLoadingLibrary] = useState(true);
  const [isLoadingChapter, setIsLoadingChapter] = useState(false);
  const [library, setLibrary] = useState<Book[]>([]);
  const [currentChapter, setCurrentChapter] =
    useState<ChapterWithContent | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
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

  const loadChapterContent = useCallback(
    async (bookId: string, chapter: Chapter) => {
      setIsLoadingChapter(true);
      try {
        const chapterWithContent = await invoke<ChapterWithContent>(
          "load_chapter_content",
          {
            bookId,
            chapterHref: chapter.href,
          }
        );

        if (chapterWithContent) {
          setCurrentChapter({
            ...chapter,
            contentHtml: chapterWithContent.contentHtml,
          });
        } else {
          toast.error("Failed to load chapter content");
        }
      } catch (err) {
        console.error("Failed to load chapter content:", err);
        toast.error("Failed to load chapter content");
      } finally {
        setIsLoadingChapter(false);
      }
    },
    [setCurrentChapter]
  );
  const saveProgress = useCallback(
    async (progress: BookProgress) => {
      // also save the progess in the current book
      if (currentBook) {
        setCurrentBook({
          ...currentBook,
          progress,
        });
      }
      // also update the library with the new progress
      if (library) {
        setLibrary((prevLibrary) =>
          prevLibrary.map((book) =>
            book.id === currentBook?.id ? { ...book, progress: progress } : book
          )
        );
      }
      await invoke("update_book_progress", {
        bookId: currentBook?.id,
        progress,
      });
    },
    [currentBook, setCurrentBook, library, setLibrary]
  );
  const changeCurrentTab = useCallback(
    (tab: TabValue) => {
      setCurrentTab(tab);
      if (currentBook && currentChapter) {
        const progress = calculateBookProgress(
          containerRef.current as HTMLDivElement,
          currentBook,
          currentChapter
        );
        saveProgress(progress);
      }
    },
    [setCurrentTab, saveProgress, currentBook, currentChapter, containerRef]
  );
  const changeCurrentBook = useCallback(
    (book: Book) => {
      setCurrentBook(book);

      // also load the chapter content

      // Determine which chapter to load
      let chapterToLoad: Chapter | null = null;

      if (book.progress?.currentChapterId) {
        // Load last opened chapter
        chapterToLoad =
          book.chapters.find(
            (ch) => ch.id === book.progress!.currentChapterId
          ) || null;
      }

      // If no progress or chapter not found, load first chapter
      if (!chapterToLoad && book.chapters.length > 0) {
        chapterToLoad = book.chapters[0];
      }

      if (chapterToLoad) {
        loadChapterContent(book.id, chapterToLoad);
      } else {
        toast.error("No chapters available in this book");
      }
    },
    [setCurrentBook, loadChapterContent]
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
      setCurrentBook: changeCurrentBook,
      library,
      setLibrary,
      isLoadingLibrary,
      setIsLoadingLibrary,
      loadBooks,
      currentChapter,
      setCurrentChapter,
      isLoadingChapter,
      setIsLoadingChapter,
      loadChapterContent,
      containerRef,
    }),
    [
      currentTab,
      currentBook,
      library,
      isLoadingLibrary,
      setIsLoadingLibrary,
      loadBooks,
      currentChapter,
      setCurrentChapter,
      isLoadingChapter,
      setIsLoadingChapter,
      loadChapterContent,
      changeCurrentTab,
      containerRef,
      changeCurrentBook,
    ]
  );

  return (
    <ErrorBoundary>
      <AppContext.Provider value={contextValue}>
        <div className="flex h-screen flex-col relative">
          <Tabs
            value={currentTab}
            onValueChange={(value) => {
              changeCurrentTab(value as TabValue);
            }}
            className="flex h-full flex-col"
          >
            <main className="flex-1 overflow-hidden">
              <TabsContent value="library" className="h-full overflow-auto m-0">
                <Library />
              </TabsContent>
              <TabsContent value="reader" className="h-full overflow-auto m-0">
                <Reader />
              </TabsContent>
              <TabsContent
                value="settings"
                className="h-full overflow-auto m-0"
              >
                <Settings />
              </TabsContent>
            </main>
            <div className="absolute bottom-0 left-0 right-0 flex justify-center pb-4 pointer-events-none z-10">
              <TabsList className="rounded-full bg-background/80 backdrop-blur-lg border shadow-lg px-1 py-2 gap-1 pointer-events-auto">
                <TabsTrigger
                  value="library"
                  className="rounded-full px-4 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground transition-all"
                >
                  Library
                </TabsTrigger>
                <TabsTrigger
                  value="reader"
                  className="rounded-full px-4 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground transition-all"
                >
                  Reader
                </TabsTrigger>
                <TabsTrigger
                  value="settings"
                  className="rounded-full px-4 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground transition-all"
                >
                  Settings
                </TabsTrigger>
              </TabsList>
            </div>
          </Tabs>
          <Toaster richColors position="top-center" />
        </div>
      </AppContext.Provider>
    </ErrorBoundary>
  );
}

export default App;
