import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { BookOpen } from "lucide-react";
import { toast } from "sonner";

import type { Book, BookProgress, Chapter } from "../../types/book";
import type { ReaderSettings as ReaderSettingsType } from "./ReaderSettings";
import { useAppContext } from "../../App";
import { Button } from "../ui/button";
import { ReaderContent } from "./ReaderContent";
import { ReaderHeader } from "./ReaderHeader";
import { ReaderNavigation } from "./ReaderNavigation";
import { ReaderSettings } from "./ReaderSettings";

interface ChapterWithContent extends Chapter {
  contentHtml?: string;
}

export function Reader() {
  const { currentBook, setCurrentTab } = useAppContext();

  const [currentChapter, setCurrentChapter] =
    useState<ChapterWithContent | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [isTocOpen, setIsTocOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isHeaderVisible, setIsHeaderVisible] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [readerSettings, setReaderSettings] = useState<ReaderSettingsType>({
    theme: "system",
    fontFamily: "merriweather",
    fontSize: "medium",
    contentPadding: "comfortable",
  });
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [isSettingsLoaded, setIsSettingsLoaded] = useState(false);

  // Load settings from backend on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const preferences = await invoke<ReaderSettingsType>(
          "get_reader_preferences"
        );
        setReaderSettings(preferences);
        setIsSettingsLoaded(true);
      } catch (err) {
        console.error("Failed to load reader preferences:", err);
        toast.error("Failed to load reader preferences");
        setIsSettingsLoaded(true);
      }
    };

    loadSettings();
  }, []);

  // Save settings to backend when they change
  useEffect(() => {
    if (!isSettingsLoaded) return;

    const saveSettings = async () => {
      try {
        await invoke("update_reader_preferences", {
          preferences: readerSettings,
        });
      } catch (err) {
        console.error("Failed to save reader preferences:", err);
        toast.error("Failed to save reader preferences");
      }
    };

    saveSettings();
  }, [readerSettings, isSettingsLoaded]);

  const loadChapterContent = useCallback(
    async (bookId: string, chapter: Chapter) => {
      setIsLoading(true);
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
        setIsLoading(false);
      }
    },
    []
  );

  const restoreProgress = useCallback((bookToRestore: Book | null) => {
    if (!bookToRestore?.progress || !scrollContainerRef.current) return;

    const progress = bookToRestore.progress;

    // Restore scroll position
    if (progress?.currentChapterScrollTop !== undefined) {
      scrollContainerRef.current.scrollTop = progress.currentChapterScrollTop;
    }

    // Restore element position if available
    const contentRef = scrollContainerRef.current.querySelector(
      ".prose"
    ) as HTMLElement;
    if (progress?.currentChapterElementId && contentRef) {
      const element = contentRef.querySelector(
        `#${progress.currentChapterElementId}`
      );
      if (element) {
        element.scrollIntoView({ behavior: "auto", block: "start" });
      }
    }
  }, []);

  const saveProgress = useCallback(async () => {
    if (!currentBook || !currentChapter || !scrollContainerRef.current) return;

    try {
      setIsSaving(true);

      const scrollTop = scrollContainerRef.current.scrollTop;
      const scrollHeight = scrollContainerRef.current.scrollHeight;
      const clientHeight = scrollContainerRef.current.clientHeight;

      // Calculate chapter progress
      const chapterProgress =
        scrollHeight > clientHeight
          ? Math.min(100, (scrollTop / (scrollHeight - clientHeight)) * 100)
          : 100;

      // Find current chapter index
      const chapterIndex = currentBook.chapters.findIndex(
        (ch) => ch.id === currentChapter.id
      );

      // Calculate book progress
      const bookProgress =
        currentBook.chapters.length > 0
          ? ((chapterIndex + chapterProgress / 100) /
              currentBook.chapters.length) *
            100
          : 0;

      // Find current element (if any)
      let elementId: string | undefined;
      let elementIndex: number | undefined;

      const contentRef = scrollContainerRef.current.querySelector(
        ".prose"
      ) as HTMLElement;
      if (contentRef && scrollContainerRef.current) {
        const elements = contentRef.querySelectorAll(
          "p, h1, h2, h3, h4, h5, h6"
        );
        let closestElement: HTMLElement | null = null;
        let closestDistance = Infinity;
        let foundIndex: number | undefined;

        elements.forEach((el, index) => {
          const htmlEl = el as HTMLElement;
          const rect = htmlEl.getBoundingClientRect();
          const containerRect =
            scrollContainerRef.current!.getBoundingClientRect();
          const distance = Math.abs(rect.top - containerRect.top);

          if (distance < closestDistance && rect.top >= containerRect.top) {
            closestDistance = distance;
            closestElement = htmlEl;
            foundIndex = index;
          }
        });

        if (closestElement && foundIndex !== undefined) {
          elementIndex = foundIndex;
          const htmlElement = closestElement as HTMLElement;
          elementId = htmlElement.id || `element-${foundIndex}`;
          if (!htmlElement.id) {
            htmlElement.id = elementId;
          }
        }
      }

      const progress: BookProgress = {
        currentChapterId: currentChapter.id,
        currentChapterHref: currentChapter.href,
        currentChapterIndex: chapterIndex,
        currentChapterElementId: elementId,
        currentChapterElementIndex: elementIndex,
        currentChapterScrollTop: scrollTop,
        currentChapterScrollHeight: scrollHeight,
        currentChapterClientHeight: clientHeight,
        chapterProgressPercent: chapterProgress,
        bookProgressPercent: bookProgress,
        updatedAt: new Date().toISOString(),
      };

      await invoke<Book>("update_book_progress", {
        bookId: currentBook.id,
        progress,
      });
    } catch (err) {
      console.error("Failed to save progress:", err);
      toast.error("Failed to save progress");
    } finally {
      setIsSaving(false);
    }
  }, [currentBook, currentChapter]);

  const handlePreviousChapter = async () => {
    if (!currentBook || !currentChapter) return;

    // Find previous chapter
    const currentIndex = currentBook.chapters.findIndex(
      (ch) => ch.id === currentChapter.id
    );
    if (currentIndex > 0) {
      const previousChapter = currentBook.chapters[currentIndex - 1];
      await loadChapterContent(currentBook.id, previousChapter);
    }
  };

  const handleNextChapter = async () => {
    if (!currentBook || !currentChapter) return;

    // Find next chapter
    const currentIndex = currentBook.chapters.findIndex(
      (ch) => ch.id === currentChapter.id
    );
    if (currentIndex < currentBook.chapters.length - 1) {
      const nextChapter = currentBook.chapters[currentIndex + 1];
      await loadChapterContent(currentBook.id, nextChapter);
    }
  };

  const handleChapterSelect = async (chapter: Chapter) => {
    if (!currentBook) return;

    // Load selected chapter
    await loadChapterContent(currentBook.id, chapter);
    setIsTocOpen(false);
  };

  const handleBack = () => {
    if (currentBook && currentChapter) {
      saveProgress();
    }
    setCurrentTab("library");
  };

  const handleContentClick = () => {
    setIsHeaderVisible((prev) => !prev);
  };

  // Load initial chapter when book changes
  useEffect(() => {
    if (!currentBook) {
      setCurrentTab("library");
      return;
    }

    // Determine which chapter to load
    let chapterToLoad: Chapter | null = null;

    if (currentBook.progress?.currentChapterId) {
      // Load last opened chapter
      chapterToLoad =
        currentBook.chapters.find(
          (ch) => ch.id === currentBook.progress!.currentChapterId
        ) || null;
    }

    // If no progress or chapter not found, load first chapter
    if (!chapterToLoad && currentBook.chapters.length > 0) {
      chapterToLoad = currentBook.chapters[0];
    }

    if (chapterToLoad) {
      loadChapterContent(currentBook.id, chapterToLoad);
    } else {
      toast.error("No chapters available in this book");
    }
  }, [currentBook, loadChapterContent, setCurrentTab]);

  // Save progress when leaving reader
  useEffect(() => {
    return () => {
      if (currentBook && currentChapter && !isSaving) {
        saveProgress();
      }
    };
  }, [currentBook, currentChapter, isSaving, saveProgress]);

  // Debounced auto-save on scroll
  useEffect(() => {
    if (
      !scrollContainerRef.current ||
      !currentBook ||
      !currentChapter ||
      isSaving
    ) {
      return;
    }

    const container = scrollContainerRef.current;
    let timeoutId: NodeJS.Timeout;

    const handleScroll = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        if (!isSaving) {
          saveProgress();
        }
      }, 1000);
    };

    container.addEventListener("scroll", handleScroll);

    return () => {
      container.removeEventListener("scroll", handleScroll);
      clearTimeout(timeoutId);
    };
  }, [currentBook, currentChapter, isSaving, saveProgress]);

  if (!currentBook || !currentChapter) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center space-y-4">
          <BookOpen className="h-12 w-12 text-muted-foreground mx-auto" />
          <p className="text-lg font-medium">No book selected</p>
          <Button onClick={handleBack}>Back to Library</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {isHeaderVisible && (
        <ReaderHeader
          book={currentBook}
          currentChapter={currentChapter}
          isTocOpen={isTocOpen}
          onTocOpenChange={setIsTocOpen}
          onChapterSelect={handleChapterSelect}
          onBack={handleBack}
          onSettingsClick={() => setIsSettingsOpen(true)}
        />
      )}
      <ReaderContent
        ref={scrollContainerRef}
        book={currentBook}
        isLoading={isLoading}
        currentChapter={currentChapter}
        onRestoreProgress={restoreProgress}
        onContentClick={handleContentClick}
        settings={readerSettings}
      />
      {isHeaderVisible && (
        <ReaderNavigation
          book={currentBook}
          currentChapter={currentChapter}
          onPrevious={handlePreviousChapter}
          onNext={handleNextChapter}
        />
      )}
      <ReaderSettings
        settings={readerSettings}
        onSettingsChange={setReaderSettings}
        isOpen={isSettingsOpen}
        onOpenChange={setIsSettingsOpen}
      />
    </div>
  );
}
