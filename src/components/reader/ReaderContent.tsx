import { useCallback, useEffect, useMemo, useRef } from "react";

import type { Book, ChapterWithContent } from "../../types/book";
import type { ReaderSettings } from "./ReaderSettings";
import { useAudioProgressContext } from "../../context/AudioProgressContext";
import { useAudioTextSync } from "../../hooks/useAudioTextSync";
import { logger } from "../../lib/logger";
import { cn } from "../../lib/utils";
import { LoadingScreen } from "../app/LoadingScreen";

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
  const previousHeaderVisibleRef = useRef<boolean | undefined>(isHeaderVisible);
  const scrollPositionRef = useRef<number>(0);
  const restoredChapterKeyRef = useRef<string | null>(null);
  const { currentAudioTrack } = useAudioProgressContext();
  const previousAudioTrackRef =
    useRef<typeof currentAudioTrack>(currentAudioTrack);

  // Preserve scroll position when header visibility changes
  useEffect(() => {
    if (!scrollContainerRef?.current) return;

    const container = scrollContainerRef.current;
    const headerVisibleChanged =
      previousHeaderVisibleRef.current !== isHeaderVisible;

    if (headerVisibleChanged) {
      // Save current scroll position before header changes
      scrollPositionRef.current = container.scrollTop;

      // Wait for transition to complete, then restore scroll position
      const timeoutId = setTimeout(() => {
        if (container && scrollPositionRef.current !== undefined) {
          // Get the header height difference
          let previousHeaderHeight = 0;
          if (headerRef?.current && previousHeaderVisibleRef.current) {
            previousHeaderHeight =
              headerRef.current.getBoundingClientRect().height;
          }

          let currentHeaderHeight = 0;
          if (headerRef?.current && isHeaderVisible) {
            currentHeaderHeight =
              headerRef.current.getBoundingClientRect().height;
          }

          const headerHeightDiff = currentHeaderHeight - previousHeaderHeight;

          // Adjust scroll position by the header height difference
          const adjustedScrollTop =
            scrollPositionRef.current + headerHeightDiff;

          container.scrollTop = Math.max(0, adjustedScrollTop);
        }
      }, 350); // Wait for transition (300ms) + small buffer

      previousHeaderVisibleRef.current = isHeaderVisible;

      return () => clearTimeout(timeoutId);
    }
  }, [isHeaderVisible, scrollContainerRef, headerRef]);

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
  useAudioTextSync(
    book,
    scrollContainerRef ?? null,
    headerRef,
    isHeaderVisible
  );

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

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Only trigger if clicking directly on the content area, not on links or interactive elements
      const target = e.target as HTMLElement;
      if (
        target.tagName === "A" ||
        target.tagName === "BUTTON" ||
        target.closest("a") ||
        target.closest("button")
      ) {
        return;
      }
      onContentClick?.();
    },
    [onContentClick]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      // Allow keyboard users to toggle header with Enter or Space
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onContentClick?.();
      }
    },
    [onContentClick]
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
      className={cn("flex-1 overflow-y-auto cursor-pointer", themeClass)}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
      title="Tap to toggle header visibility"
    >
      <div className="mx-auto py-8" style={paddingStyle}>
        <div
          ref={contentRef}
          className={cn(
            "prose prose-slate dark:prose-invert reader-prose max-w-none",
            fontFamilyClass
          )}
          style={fontSizeStyle}
          dangerouslySetInnerHTML={{
            __html: currentChapter.contentHtml || "",
          }}
        />
      </div>
    </div>
  );
}
