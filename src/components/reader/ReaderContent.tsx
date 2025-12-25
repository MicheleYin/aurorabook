import { useCallback, useEffect, useMemo, useRef } from "react";

import type { Book, ChapterWithContent } from "../../types/book";
import type { ReaderSettings } from "./ReaderSettings";
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
    if (
      book &&
      currentChapter &&
      scrollContainerRef &&
      !isLoading &&
      typeof scrollContainerRef !== "function" &&
      scrollContainerRef.current
    ) {
      const timeoutId = setTimeout(() => {
        onRestoreProgress(book);
      }, 200);
      return () => clearTimeout(timeoutId);
    }
  }, [book, currentChapter, onRestoreProgress, scrollContainerRef, isLoading]);

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
    if (!settings?.fontSize) return { fontSize: "16px" };
    const fontSizeMap: Record<string, string> = {
      small: "14px",
      medium: "16px",
      large: "18px",
      xlarge: "20px",
    };
    return { fontSize: fontSizeMap[settings.fontSize] ?? "16px" };
  }, [settings]);

  const paddingStyle = useMemo(() => {
    if (!settings?.contentPadding)
      return { paddingLeft: "24px", paddingRight: "24px" };
    const paddingMap: Record<string, string> = {
      compact: "16px",
      comfortable: "24px",
      spacious: "48px",
    };
    const padding = paddingMap[settings.contentPadding] ?? "24px";
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
            "prose prose-slate dark:prose-invert max-w-none",
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
