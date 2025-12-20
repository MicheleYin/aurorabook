import { memo, useEffect, useRef } from "react";
import { ErrorBoundary } from "../../ErrorBoundary";
import type { Book, Chapter } from "../../../types/reader";
import type { SettingsState } from "../../../store/slices/settingsSlice";

type ReaderViewProps = {
  currentBook: Book | null;
  currentChapter: Chapter | null;
  scrollPosition: number | null;
  onChapterChange: (chapterId: string) => Promise<void>; // For future chapter navigation - currently unused
  onScrollPositionChange: (position: number) => void;
  settings: SettingsState;
};

export const ReaderView = memo(function ReaderView({
  currentBook,
  currentChapter,
  scrollPosition,
  onChapterChange: _onChapterChange, // For future chapter navigation
  onScrollPositionChange,
  settings,
}: ReaderViewProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  // Restore scroll position when chapter loads
  useEffect(() => {
    if (contentRef.current && scrollPosition !== null && currentChapter) {
      contentRef.current.scrollTop = scrollPosition;
    }
  }, [scrollPosition, currentChapter]);

  // Save scroll position (debounced)
  useEffect(() => {
    const element = contentRef.current;
    if (!element) return;

    let timeout: NodeJS.Timeout;
    const handleScroll = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        onScrollPositionChange(element.scrollTop);
      }, 500);
    };

    element.addEventListener("scroll", handleScroll);
    return () => {
      element.removeEventListener("scroll", handleScroll);
      clearTimeout(timeout);
    };
  }, [onScrollPositionChange]);

  if (!currentBook || !currentChapter) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">No book selected</p>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div
        ref={contentRef}
        className="h-full overflow-auto p-8"
        style={{
          fontSize: `${settings.fontSize}px`,
          fontFamily: settings.fontFamily,
          lineHeight: settings.lineHeight,
        }}
      >
        <div
          dangerouslySetInnerHTML={{
            __html: currentChapter.contentHtml || "<p>Loading...</p>",
          }}
        />
      </div>
    </ErrorBoundary>
  );
});
