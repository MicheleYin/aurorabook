import { forwardRef, useEffect, useRef } from "react";

import type { Book, Chapter } from "../../types/book";
import type { ReaderSettings } from "./ReaderSettings";
import { cn } from "../../lib/utils";

interface ReaderContentProps {
  book: Book | null;
  isLoading: boolean;
  currentChapter: Chapter & { contentHtml?: string };
  onRestoreProgress: (book: Book | null) => void;
  onContentClick?: () => void;
  settings?: ReaderSettings;
}

export const ReaderContent = forwardRef<HTMLDivElement, ReaderContentProps>(
  (
    {
      book,
      isLoading,
      currentChapter,
      onRestoreProgress,
      onContentClick,
      settings,
    },
    scrollContainerRef
  ) => {
    const contentRef = useRef<HTMLDivElement>(null);

    // Restore progress when chapter content is loaded
    useEffect(() => {
      if (
        book &&
        currentChapter &&
        scrollContainerRef &&
        typeof scrollContainerRef !== "function" &&
        scrollContainerRef.current
      ) {
        const timeoutId = setTimeout(() => {
          onRestoreProgress(book);
        }, 200);
        return () => clearTimeout(timeoutId);
      }
    }, [book, currentChapter, onRestoreProgress, scrollContainerRef]);

    const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
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
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
      // Allow keyboard users to toggle header with Enter or Space
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onContentClick?.();
      }
    };

    // Apply settings styles - map backend string values to CSS
    const getThemeClass = () => {
      if (!settings?.theme) return "";
      if (settings.theme === "dark") return "dark";
      if (settings.theme === "system") {
        // Use system theme (respects OS preference)
        return "";
      }
      return "";
    };

    const getFontFamilyClass = () => {
      if (!settings?.fontFamily) return "font-serif";
      if (settings.fontFamily === "merriweather") return "font-serif";
      if (settings.fontFamily === "inter") return "font-sans";
      if (settings.fontFamily === "monospace") return "font-mono";
      return "font-serif";
    };

    const getFontSizeStyle = () => {
      if (!settings?.fontSize) return { fontSize: "16px" };
      const fontSizeMap: Record<string, string> = {
        small: "14px",
        medium: "16px",
        large: "18px",
        xlarge: "20px",
      };
      return { fontSize: fontSizeMap[settings.fontSize] ?? "16px" };
    };

    const getPaddingStyle = () => {
      if (!settings?.contentPadding)
        return { paddingLeft: "24px", paddingRight: "24px" };
      const paddingMap: Record<string, string> = {
        compact: "16px",
        comfortable: "24px",
        spacious: "48px",
      };
      const padding = paddingMap[settings.contentPadding] ?? "24px";
      return { paddingLeft: padding, paddingRight: padding };
    };

    const themeClass = getThemeClass();
    const fontFamilyClass = getFontFamilyClass();
    const fontSizeStyle = getFontSizeStyle();
    const paddingStyle = getPaddingStyle();

    if (isLoading) {
      return (
        <div className="flex h-full items-center justify-center">
          <div className="text-center space-y-2">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
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
);

ReaderContent.displayName = "ReaderContent";
