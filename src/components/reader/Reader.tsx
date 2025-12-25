import { useRef, useState } from "react";
import { BookOpen } from "lucide-react";

import { useAudioSyncContext } from "@/context/AudioSyncContext";
import { useChapterProgressContext } from "@/context/ChapterProgressContext";

import type { Chapter } from "../../types/book";
import { useAppContext } from "../../context/AppContext";
import { useReaderSettings } from "../../hooks/useReaderSettings";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { ReaderContent } from "./ReaderContent";
import { ReaderHeader } from "./ReaderHeader";
import { ReaderNavigation } from "./ReaderNavigation";
import { ReaderSettings } from "./ReaderSettings";

export function Reader() {
  const { currentBook, setCurrentTab } = useAppContext();
  const {
    currentChapter,
    isLoadingChapter,
    loadChapterContent,
    containerRef,
    restoreProgress,
  } = useChapterProgressContext();

  const [isTocOpen, setIsTocOpen] = useState(false);
  const [isHeaderVisible, setIsHeaderVisible] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const { readerSettings, setReaderSettings } = useReaderSettings();
  const { isSyncEnabled, toggleSync } = useAudioSyncContext();
  const headerRef = useRef<HTMLDivElement>(null);

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
    if (isSyncEnabled) {
      toggleSync();
    }
    const currentIndex = currentBook.chapters.findIndex(
      (ch) => ch.id === currentChapter.id
    );

    const nextChapter = currentBook.chapters[currentIndex + 1];
    if (nextChapter) {
      await loadChapterContent(currentBook.id, nextChapter);
    }
  };

  const handleChapterSelect = async (chapter: Chapter) => {
    if (!currentBook) return;

    if (isSyncEnabled) {
      toggleSync();
    }

    // Load selected chapter
    await loadChapterContent(currentBook.id, chapter);
    setIsTocOpen(false);
  };

  const handleBack = () => {
    if (!currentBook || !currentChapter || !containerRef.current) return;
    if (isSyncEnabled) {
      toggleSync();
    }
    setCurrentTab("library");
  };

  const handleContentClick = () => {
    setIsHeaderVisible((prev) => !prev);
  };

  // // Sav

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
  console.warn(
    "currentChapter",
    currentChapter,
    "currentBook",
    currentBook.id,
    "isLoadingChapter",
    isLoadingChapter
  );

  return (
    <div className="flex h-full flex-col">
      <div
        ref={headerRef}
        className={cn(
          "transition-all duration-300 ease-out",
          isHeaderVisible
            ? "opacity-100 translate-y-0 pointer-events-auto"
            : "opacity-0 -translate-y-full pointer-events-none h-0 p-0 m-0"
        )}
      >
        <ReaderHeader
          book={currentBook}
          currentChapter={currentChapter}
          isTocOpen={isTocOpen}
          onTocOpenChange={setIsTocOpen}
          onChapterSelect={handleChapterSelect}
          onBack={handleBack}
          onSettingsClick={() => setIsSettingsOpen(true)}
        />
      </div>
      <ReaderContent
        scrollContainerRef={containerRef}
        headerRef={headerRef}
        isHeaderVisible={isHeaderVisible}
        book={currentBook}
        isLoading={isLoadingChapter}
        currentChapter={currentChapter}
        onRestoreProgress={restoreProgress}
        onContentClick={handleContentClick}
        settings={readerSettings}
      />
      <div
        className={cn(
          "relative transition-all duration-300 ease-out",
          isHeaderVisible
            ? "opacity-100 translate-y-0 pointer-events-auto"
            : "opacity-0 translate-y-full pointer-events-none"
        )}
      >
        <ReaderNavigation
          book={currentBook}
          currentChapter={currentChapter}
          onPrevious={handlePreviousChapter}
          onNext={handleNextChapter}
        />
      </div>
      <ReaderSettings
        settings={readerSettings}
        onSettingsChange={setReaderSettings}
        isOpen={isSettingsOpen}
        onOpenChange={setIsSettingsOpen}
      />
    </div>
  );
}
