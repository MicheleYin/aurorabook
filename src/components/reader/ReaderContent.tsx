import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";

import type { Book, ChapterWithContent } from "../../types/book";
import type { ReaderSettings } from "./ReaderSettings";
import { useAudioProgressContext } from "../../context/AudioProgressContext";
import { useAudioTextSync } from "../../hooks/useAudioTextSync";
import { useReaderDictionary } from "../../hooks/useReaderDictionary";
import { logger } from "../../lib/logger";
import { isDictionaryCardTarget } from "../../lib/reader-dictionary";
import {
  getPointerDistance,
  prepareChapterHtmlForReader,
  READER_CHROME_TOGGLE_DELAY_MS,
  scrollTopAfterChromeToggle,
  shouldToggleReaderHeaderOnClick,
} from "../../lib/reader-utils";
import { cn } from "../../lib/utils";
import { LoadingScreen } from "../app/LoadingScreen";
import { ReaderDictionaryCard } from "./ReaderDictionaryCard";

interface ReaderContentProps {
  book: Book;
  isLoading: boolean;
  currentChapter: ChapterWithContent;
  onRestoreProgress: (book: Book | null) => void;
  onContentClick?: () => void;
  settings?: ReaderSettings;
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>;
  headerRef: React.RefObject<HTMLDivElement | null> | undefined;
  isHeaderVisible?: boolean;
}

export function ReaderContent({
  book,
  isLoading,
  currentChapter,
  onRestoreProgress,
  onContentClick,
  settings,
  scrollContainerRef,
  headerRef,
  isHeaderVisible,
}: Readonly<ReaderContentProps>) {
  const contentRef = useRef<HTMLDivElement>(null);
  const scrollPositionRef = useRef<number>(0);
  const pendingChromeScrollRef = useRef<{
    scrollTop: number;
    headerHeight: number;
  } | null>(null);
  const restoredChapterKeyRef = useRef<string | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const chromeToggleTimeoutRef = useRef<number | null>(null);
  const { currentAudioTrack } = useAudioProgressContext();
  const previousAudioTrackRef =
    useRef<typeof currentAudioTrack>(currentAudioTrack);
  const {
    dictionary,
    close: closeDictionary,
    consumeChromeToggleSuppression,
  } = useReaderDictionary(contentRef);

  // Preserve scroll position when audio player opens/closes
  useEffect(() => {
    if (!scrollContainerRef?.current) return;

    const container = scrollContainerRef.current;
    const audioTrackChanged =
      previousAudioTrackRef.current !== currentAudioTrack;

    if (audioTrackChanged) {
      // Save current scroll position before audio player state changes
      scrollPositionRef.current = container.scrollTop;

      // Restore scroll position after a short delay to allow re-render to complete
      const timeoutId = setTimeout(() => {
        if (container && scrollPositionRef.current !== undefined) {
          container.scrollTop = scrollPositionRef.current;
        }
      }, 50); // Small delay to allow DOM to update

      previousAudioTrackRef.current = currentAudioTrack;

      return () => clearTimeout(timeoutId);
    }
  }, [currentAudioTrack, scrollContainerRef]);

  // Audio-text sync
  logger.log("[ReaderContent] Calling useAudioTextSync", {
    hasBook: !!book,
    bookId: book?.id,
    hasScrollContainerRef: !!scrollContainerRef,
  });
  const { beginChromeToggle } = useAudioTextSync(
    book,
    scrollContainerRef ?? null,
    headerRef,
    isHeaderVisible
  );

  const captureChromeScroll = useCallback(() => {
    const container = scrollContainerRef?.current;
    const header = headerRef?.current;
    pendingChromeScrollRef.current = {
      scrollTop: container?.scrollTop ?? 0,
      headerHeight: isHeaderVisible
        ? (header?.getBoundingClientRect().height ?? 0)
        : 0,
    };
    beginChromeToggle();
  }, [beginChromeToggle, headerRef, isHeaderVisible, scrollContainerRef]);

  useLayoutEffect(() => {
    const pending = pendingChromeScrollRef.current;
    const container = scrollContainerRef?.current;
    if (!pending || !container) {
      return;
    }
    pendingChromeScrollRef.current = null;
    const nextHeaderHeight = isHeaderVisible
      ? (headerRef?.current?.getBoundingClientRect().height ?? 0)
      : 0;
    container.scrollTop = scrollTopAfterChromeToggle(
      pending.scrollTop,
      pending.headerHeight,
      nextHeaderHeight
    );
  }, [headerRef, isHeaderVisible, scrollContainerRef]);

  // Restore progress when chapter content is loaded
  useEffect(() => {
    const chapterKey = `${book.id}:${currentChapter.id}`;
    if (
      book &&
      currentChapter &&
      scrollContainerRef &&
      !isLoading &&
      typeof scrollContainerRef !== "function" &&
      scrollContainerRef.current
    ) {
      if (restoredChapterKeyRef.current === chapterKey) {
        return;
      }

      restoredChapterKeyRef.current = chapterKey;
      const timeoutId = setTimeout(() => {
        onRestoreProgress(book);
      }, 200);
      return () => clearTimeout(timeoutId);
    }
  }, [
    book,
    currentChapter,
    onRestoreProgress,
    scrollContainerRef,
    isLoading,
  ]);

  // Disable all links in reader content
  useEffect(() => {
    if (!contentRef.current) return;

    const handleLinkClick = (e: Event) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "A" || target.closest("a")) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    const container = contentRef.current;
    container.addEventListener("click", handleLinkClick, true);

    return () => {
      container.removeEventListener("click", handleLinkClick, true);
    };
  }, [currentChapter]);

  useEffect(() => {
    closeDictionary();
  }, [closeDictionary, currentChapter.id, isLoading]);

  const cancelPendingChromeToggle = useCallback(() => {
    if (chromeToggleTimeoutRef.current !== null) {
      window.clearTimeout(chromeToggleTimeoutRef.current);
      chromeToggleTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      cancelPendingChromeToggle();
    };
  }, [cancelPendingChromeToggle]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      pointerStartRef.current = { x: e.clientX, y: e.clientY };
    },
    []
  );

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (
        isDictionaryCardTarget(e.target) ||
        consumeChromeToggleSuppression()
      ) {
        cancelPendingChromeToggle();
        return;
      }

      const selectedText = window.getSelection()?.toString() ?? "";
      const pointerDistancePx = getPointerDistance(pointerStartRef.current, {
        x: e.clientX,
        y: e.clientY,
      });

      if (
        !shouldToggleReaderHeaderOnClick({
          target: e.target,
          selectedText,
          pointerDistancePx,
        })
      ) {
        cancelPendingChromeToggle();
        return;
      }

      cancelPendingChromeToggle();
      chromeToggleTimeoutRef.current = window.setTimeout(() => {
        chromeToggleTimeoutRef.current = null;
        const stillSelected = window.getSelection()?.toString().trim() ?? "";
        if (stillSelected.length > 0) {
          return;
        }
        captureChromeScroll();
        onContentClick?.();
      }, READER_CHROME_TOGGLE_DELAY_MS);
    },
    [
      cancelPendingChromeToggle,
      captureChromeScroll,
      consumeChromeToggleSuppression,
      onContentClick,
    ]
  );

  const handleDoubleClick = useCallback(() => {
    cancelPendingChromeToggle();
  }, [cancelPendingChromeToggle]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      // Allow keyboard users to toggle header with Enter or Space
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        captureChromeScroll();
        onContentClick?.();
      }
    },
    [captureChromeScroll, onContentClick]
  );

  // Apply settings styles - map backend string values to CSS
  const themeClass = useMemo(() => {
    if (!settings?.theme) return "";
    if (settings.theme === "dark") return "dark";
    if (settings.theme === "system") {
      // Use system theme (respects OS preference)
      return "";
    }
    return "";
  }, [settings]);

  const fontFamilyClass = useMemo(() => {
    if (!settings?.fontFamily) return "font-serif";
    if (settings.fontFamily === "merriweather") return "font-serif";
    if (settings.fontFamily === "inter") return "font-sans";
    if (settings.fontFamily === "monospace") return "font-mono";
    return "font-serif";
  }, [settings]);

  const fontSizeStyle = useMemo(() => {
    const parsed = Number(settings?.fontSize);
    const fontSize = Number.isFinite(parsed)
      ? Math.min(28, Math.max(12, parsed))
      : 16;
    const lineHeight =
      fontSize >= 20 ? 1.7 : fontSize >= 18 ? 1.65 : 1.6;
    return {
      fontSize: `${fontSize}px`,
      // Drive .reader-prose !important rules via CSS variables.
      ["--reader-font-size" as string]: `${fontSize}px`,
      ["--reader-line-height" as string]: String(lineHeight),
      lineHeight,
    };
  }, [settings]);

  const paddingStyle = useMemo(() => {
    const parsed = Number(settings?.contentPadding);
    const padding = Number.isFinite(parsed)
      ? Math.min(64, Math.max(8, parsed))
      : 24;
    return { paddingLeft: padding, paddingRight: padding };
  }, [settings]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center space-y-2">
          <LoadingScreen />
          <p className="text-sm text-muted-foreground">Loading chapter...</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={scrollContainerRef}
      className={cn("flex-1 overflow-y-auto select-none", themeClass)}
      onPointerDown={handlePointerDown}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      onSelectStart={(event) => event.preventDefault()}
      title="Tap to toggle header visibility"
    >
      <div className="reader-content-selectable mx-auto py-8 select-none" style={paddingStyle}>
        <div
          ref={contentRef}
          className={cn(
            "prose prose-slate dark:prose-invert reader-prose max-w-none cursor-default select-none",
            fontFamilyClass
          )}
          style={fontSizeStyle}
          dangerouslySetInnerHTML={{
            __html: prepareChapterHtmlForReader(currentChapter.contentHtml || ""),
          }}
        />
      </div>
      {dictionary ? (
        <ReaderDictionaryCard
          dictionary={dictionary}
          onClose={closeDictionary}
          themeClass={themeClass}
        />
      ) : null}
    </div>
  );
}
