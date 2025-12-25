import {
  createContext,
  Dispatch,
  ReactNode,
  SetStateAction,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";

import { calculateBookProgress } from "@/lib/reader-utils";

import type {
  Book,
  BookProgress,
  Chapter,
  ChapterWithContent,
} from "../types/book";

export interface ChapterProgressContextType {
  currentChapter: ChapterWithContent | null;
  setCurrentChapter: Dispatch<SetStateAction<ChapterWithContent | null>>;
  isLoadingChapter: boolean;
  setIsLoadingChapter: Dispatch<SetStateAction<boolean>>;
  saveProgress: (book: Book) => Promise<void>;
  loadChapterContent: (bookId: string, chapter: Chapter) => Promise<void>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  restoreProgress: (book: Book | null) => void;
  loadLastOpenedChapter: (book: Book) => Promise<void>;
  calculateBookProgress: (book: Book) => BookProgress | null;
}

export const ChapterProgressContext = createContext<
  ChapterProgressContextType | undefined
>(undefined);

export function useChapterProgressContext() {
  const context = useContext(ChapterProgressContext);
  if (!context) {
    throw new Error("useAppContext must be used within AppProvider");
  }
  return context;
}

interface ChapterProgressProviderProps {
  readonly children: ReactNode;
}

export function ChapterProgressProvider({
  children,
}: ChapterProgressProviderProps) {
  const [isLoadingChapter, setIsLoadingChapter] = useState(false);

  const [currentChapter, setCurrentChapter] =
    useState<ChapterWithContent | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

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
    []
  );

  const handleCalculateBookProgress = useCallback(
    (book: Book) => {
      if (!containerRef.current || !currentChapter) return null;
      return calculateBookProgress(containerRef.current, book, currentChapter);
    },
    [currentChapter]
  );

  const saveProgress = useCallback(
    async (book: Book) => {
      if (!currentChapter) return;
      const progressToSave = calculateBookProgress(
        containerRef.current as HTMLDivElement,
        book,
        currentChapter
      );
      await invoke("update_book_progress", {
        bookId: book.id,
        progress: progressToSave,
      });
    },
    [currentChapter, containerRef]
  );

  const restoreProgress = useCallback(
    (bookToRestore: Book | null) => {
      if (
        !bookToRestore?.progress ||
        !containerRef.current ||
        !currentChapter ||
        currentChapter.id !== bookToRestore.progress.currentChapterId
      )
        return null;

      const progress = bookToRestore.progress;

      // Restore scroll position
      if (progress?.currentChapterScrollTop !== undefined) {
        containerRef.current.scrollTop = progress.currentChapterScrollTop;
      }

      // Restore element position if available
      const contentRef = containerRef.current.querySelector(
        ".prose"
      ) as HTMLElement;
      if (progress?.currentChapterElementId && contentRef) {
        const element = contentRef.querySelector(
          `#${progress.currentChapterElementId}`
        );
        console.log(
          "Restoring element position:",
          progress.currentChapterElementId,
          element
        );
        if (element) {
          element.scrollIntoView({ behavior: "auto", block: "start" });
        }
      }
    },
    [currentChapter]
  );

  const loadLastOpenedChapter = useCallback(
    async (book: Book) => {
      // also load the chapter content

      // Determine which chapter to load
      let chapterToLoad: Chapter | null = null;

      console.log("Restoring progress for book:", book.id, book.progress);
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
        await loadChapterContent(book.id, chapterToLoad);
      } else {
        toast.error("No chapters available in this book");
      }
    },
    [loadChapterContent]
  );

  const contextValue = useMemo(
    () => ({
      currentChapter,
      setCurrentChapter,
      isLoadingChapter,
      setIsLoadingChapter,
      loadChapterContent,
      containerRef,
      restoreProgress,
      saveProgress,
      loadLastOpenedChapter,
      calculateBookProgress: handleCalculateBookProgress,
    }),
    [
      currentChapter,
      isLoadingChapter,
      loadChapterContent,
      containerRef,
      restoreProgress,
      saveProgress,
      loadLastOpenedChapter,
      handleCalculateBookProgress,
    ]
  );

  return (
    <ChapterProgressContext.Provider value={contextValue}>
      {children}
    </ChapterProgressContext.Provider>
  );
}
