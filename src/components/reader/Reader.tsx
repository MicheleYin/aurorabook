import { BookOpen } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAudioSyncContext } from "@/context/AudioSyncContext";
import { useChapterProgressContext } from "@/context/ChapterProgressContext";
import { useRegisterShortcutActions } from "@/context/KeyboardShortcutsContext";
import { useAppContext } from "../../context/AppContext";
import { useSettingsContext } from "../../context/SettingsContext";

import { useReaderSettings } from "../../hooks/useReaderSettings";
import { useTranslation } from "../../lib/i18n";
import { logger } from "../../lib/logger";
import { normalizeFontSize } from "../../lib/reader-settings-utils";
import { cn } from "../../lib/utils";
import type { Chapter } from "../../types/book";
import { Button } from "../ui/button";
import { ReaderContent } from "./ReaderContent";
import { ReaderHeader } from "./ReaderHeader";
import { ReaderNavigation } from "./ReaderNavigation";
import { ReaderSettings } from "./ReaderSettings";

export function Reader() {
  const { currentBook, setCurrentTab } = useAppContext();
  const { settings, saveSettings } = useSettingsContext();
  const { t } = useTranslation();
  const {
    currentChapter,
    isLoadingChapter,
    loadChapterContent,
    containerRef,
    restoreProgress,
  } = useChapterProgressContext();

  const [isTocOpen, setIsTocOpen] = useState(false);
  const [isHeaderVisible, setIsHeaderVisible] = useState(
    () => settings?.readerHeaderVisible ?? true
  );
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const { readerSettings, setReaderSettings } = useReaderSettings();
  const { isSyncEnabled, toggleSync } = useAudioSyncContext();
  const headerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (settings?.readerHeaderVisible == null) return;
    setIsHeaderVisible(settings.readerHeaderVisible);
  }, [settings?.readerHeaderVisible]);

  const handlePreviousChapter = useCallback(async () => {
    if (!currentBook || !currentChapter) return;

    const currentIndex = currentBook.chapters.findIndex(
      (ch) => ch.id === currentChapter.id
    );
    if (currentIndex > 0) {
      const previousChapter = currentBook.chapters[currentIndex - 1];
      await loadChapterContent(currentBook.id, previousChapter);
    }
  }, [currentBook, currentChapter, loadChapterContent]);

  const handleNextChapter = useCallback(async () => {
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
  }, [
    currentBook,
    currentChapter,
    isSyncEnabled,
    loadChapterContent,
    toggleSync,
  ]);

  const handleChapterSelect = async (chapter: Chapter) => {
    if (!currentBook) return;

    if (isSyncEnabled) {
      toggleSync();
    }

    await loadChapterContent(currentBook.id, chapter);
    setIsTocOpen(false);
  };

  const handleBack = useCallback(() => {
    if (!currentBook || !currentChapter || !containerRef.current) return;
    if (isSyncEnabled) {
      toggleSync();
    }
    setCurrentTab("library");
  }, [
    containerRef,
    currentBook,
    currentChapter,
    isSyncEnabled,
    setCurrentTab,
    toggleSync,
  ]);

  const handleContentClick = useCallback(() => {
    const next = !isHeaderVisible;
    setIsHeaderVisible(next);
    void saveSettings({ readerHeaderVisible: next });
  }, [isHeaderVisible, saveSettings]);

  const adjustFontSize = useCallback(
    (delta: number) => {
      const current = Number(normalizeFontSize(readerSettings.fontSize));
      const next = normalizeFontSize(String(current + delta));
      if (next === readerSettings.fontSize) return;
      setReaderSettings({ ...readerSettings, fontSize: next });
    },
    [readerSettings, setReaderSettings]
  );

  useRegisterShortcutActions({
    prevChapter: () => {
      if (!currentBook || !currentChapter) return false;
      void handlePreviousChapter();
    },
    nextChapter: () => {
      if (!currentBook || !currentChapter) return false;
      void handleNextChapter();
    },
    toggleToc: () => {
      if (!currentBook || !currentChapter) return false;
      setIsTocOpen((open) => !open);
    },
    toggleChrome: () => {
      if (!currentBook || !currentChapter) return false;
      handleContentClick();
    },
    backToLibrary: () => {
      if (!currentBook) return false;
      handleBack();
    },
    increaseFont: () => {
      if (!currentBook || !currentChapter) return false;
      adjustFontSize(1);
    },
    decreaseFont: () => {
      if (!currentBook || !currentChapter) return false;
      adjustFontSize(-1);
    },
    toggleSync: () => {
      if (!currentBook || !currentChapter) return false;
      toggleSync();
    },
    closeOverlays: () => {
      if (isSettingsOpen) {
        setIsSettingsOpen(false);
        return true;
      }
      if (isTocOpen) {
        setIsTocOpen(false);
        return true;
      }
      return false;
    },
  });

  if (!currentBook) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center space-y-4">
          <BookOpen className="size-12 text-muted-foreground mx-auto" />
          <p className="text-lg font-medium">{t("reader.no_book")}</p>
          <Button onClick={handleBack}>{t("reader.back_to_library")}</Button>
        </div>
      </div>
    );
  }

  // First open: chapter content is not available yet — show the loading state
  // instead of the empty "no book" placeholder while the fetch is in flight.
  if (!currentChapter) {
    if (isLoadingChapter) {
      return (
        <div
          className="flex h-full items-center justify-center"
          data-testid="reader-loading"
        >
          <div className="text-center space-y-2">
            <p className="text-sm text-muted-foreground">Loading chapter...</p>
          </div>
        </div>
      );
    }
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center space-y-4">
          <BookOpen className="size-12 text-muted-foreground mx-auto" />
          <p className="text-lg font-medium">{t("reader.no_book")}</p>
          <Button onClick={handleBack}>{t("reader.back_to_library")}</Button>
        </div>
      </div>
    );
  }

  logger.info("[reader] current chapter snapshot", {
    currentBookId: currentBook.id,
    currentChapterId: currentChapter.id,
    currentChapterOrder: currentChapter.chapterOrder,
    isLoadingChapter,
    contentLength:
      typeof currentChapter.contentHtml === "string"
        ? currentChapter.contentHtml.length
        : 0,
  });

  return (
    <div className="flex h-full flex-col">
      <div
        ref={headerRef}
        className={cn(
          // Opacity/transform only — animating height would make chrome-toggle
          // scroll compensation measure the wrong header size mid-transition.
          "transition-[opacity,transform] duration-300 ease-out",
          isHeaderVisible
            ? "opacity-100 translate-y-0 pointer-events-auto"
            : "opacity-0 -translate-y-full pointer-events-none h-0 overflow-hidden p-0 m-0"
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
          "relative transition-[opacity,transform] duration-300 ease-out",
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
