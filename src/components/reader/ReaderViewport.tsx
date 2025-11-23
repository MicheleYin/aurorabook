import { useEffect, useMemo } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";

import { cn } from "../../lib/utils";
import {
  contentPaddingConfigMap,
  fontClassMap,
  fontSizeClassMap,
  fontSizeTokenClassMap,
  lineHeightClassMap,
  themeClasses,
} from "./constants";
import type {
  ChapterProgressSnapshot,
  ChapterSelectionOptions,
  ReaderPanelBaseProps,
} from "./types";
import type { ReaderTheme } from "../../types/reader";
import { Button } from "../ui/button";
import { useReaderScrollManager } from "./hooks/useReaderScrollManager";

type ResolvedReaderTheme = Exclude<ReaderTheme, "system">;

type ReaderViewportProps = Pick<
  ReaderPanelBaseProps,
  | "activeBook"
  | "activeChapter"
  | "preferences"
  | "pendingFragment"
  | "onFragmentConsumed"
  | "onSelectChapter"
> & {
  chromeVisible: boolean;
  resolvedTheme: ResolvedReaderTheme;
  onToggleChrome: () => void;
  audioPlayerVisible?: boolean;
  scrollIntent?: "top" | "bottom" | null;
  onScrollIntentConsumed?: () => void;
  onChapterProgress?: (snapshot: ChapterProgressSnapshot) => void;
};

export function ReaderViewport({
  activeBook,
  activeChapter,
  preferences,
  pendingFragment,
  onFragmentConsumed,
  onSelectChapter,
  chromeVisible,
  resolvedTheme,
  onToggleChrome,
  audioPlayerVisible = false,
  scrollIntent,
  onScrollIntentConsumed,
  onChapterProgress,
}: ReaderViewportProps) {
  const { contentRef, handleScroll, requestNavigationIntent } = useReaderScrollManager({
    activeBook,
    activeChapter,
    preferences,
    chromeVisible,
    audioPlayerVisible,
    pendingFragment,
    onFragmentConsumed,
    scrollIntent,
    onScrollIntentConsumed,
    onChapterProgress,
  });

  const showAudioPlayer = audioPlayerVisible;

  const { previousChapter, nextChapter } = useMemo(() => {
    if (!activeBook || !activeChapter) {
      return { previousChapter: undefined, nextChapter: undefined };
    }

    const index = activeBook.chapters.findIndex(
      (chapter) => chapter.id === activeChapter.id,
    );

    if (index === -1) {
      return { previousChapter: undefined, nextChapter: undefined };
    }

    return {
      previousChapter: index > 0 ? activeBook.chapters[index - 1] : undefined,
      nextChapter:
        index < activeBook.chapters.length - 1
          ? activeBook.chapters[index + 1]
          : undefined,
    };
  }, [activeBook, activeChapter]);

  const appliedTheme = resolvedTheme;
  const proseColorClass = appliedTheme === "dark" ? "prose-invert" : "prose-neutral";
  const navButtonClass =
    appliedTheme === "dark"
      ? "border-zinc-700 text-zinc-100 hover:text-zinc-100 hover:bg-zinc-900"
      : "";
  const fontSizeClass =
    fontSizeClassMap[preferences.fontSize] ?? fontSizeClassMap.medium;
  const lineHeightClass =
    lineHeightClassMap[preferences.fontSize] ?? lineHeightClassMap.medium;
  const fontSizeTokenClass =
    fontSizeTokenClassMap[preferences.fontSize] ?? fontSizeTokenClassMap.medium;
  const paddingConfig =
    contentPaddingConfigMap[preferences.contentPadding] ??
    contentPaddingConfigMap.comfortable;
  const innerVerticalPaddingClass = chromeVisible
    ? paddingConfig.innerChrome
    : paddingConfig.innerImmersive;

  const requestChapterChange = (chapterId: string, options?: ChapterSelectionOptions) => {
    onSelectChapter(chapterId, options);
  };

  const handlePrevious = () => {
    if (!previousChapter) return;
    requestNavigationIntent("bottom");
    requestChapterChange(previousChapter.id, { preserveChrome: true, scrollPosition: "bottom" });
  };

  const handleNext = () => {
    if (!nextChapter) return;
    requestNavigationIntent("top");
    requestChapterChange(nextChapter.id, { preserveChrome: true, scrollPosition: "top" });
  };

  const renderNavigation = () => (
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
      {previousChapter ? (
        <Button
          variant="ghost"
          size="sm"
          className={cn(navButtonClass)}
          onClick={(event) => {
            event.stopPropagation();
            handlePrevious();
          }}
        >
          ← Previous chapter
        </Button>
      ) : (
        <span className="text-muted-foreground">Beginning of book</span>
      )}
      {nextChapter ? (
        <Button
          variant="ghost"
          size="sm"
          className={cn(navButtonClass)}
          onClick={(event) => {
            event.stopPropagation();
            handleNext();
          }}
        >
          Next chapter →
        </Button>
      ) : (
        <span className="text-muted-foreground">End of book</span>
      )}
    </div>
  );

  useEffect(() => {
    const root = contentRef.current;
    if (!root || !activeBook) return;

    const handler = (event: MouseEvent) => {
      const element = (event.target as HTMLElement | null)?.closest("a");
      if (!(element instanceof HTMLAnchorElement)) return;

      const href = element.getAttribute("href");
      if (!href) return;

      if (href.startsWith("http") || href.startsWith("mailto:")) {
        return;
      }

      event.preventDefault();

      if (href.startsWith("#")) {
        const fragment = href.slice(1);
        const selector =
          typeof CSS !== "undefined" && CSS.escape
            ? `#${CSS.escape(fragment)}`
            : `#${fragment}`;
        const target =
          root.querySelector<HTMLElement>(selector) ??
          root.querySelector<HTMLElement>(`a[name="${fragment}"]`);
        if (target) {
          target.scrollIntoView({ behavior: "smooth", block: "start" });
        }
        return;
      }

      const [pathPart, fragmentPart] = href.split("#");
      const normalized = pathPart.replace(/^\.\//, "");

      const match = activeBook.chapters.find((chapter) => {
        const chapterPath = chapter.href.split("#")[0];
        return (
          chapterPath === normalized ||
          chapterPath.endsWith(normalized) ||
          normalized.endsWith(chapterPath)
        );
      });

      if (match) {
        onSelectChapter(match.id, { fragment: fragmentPart });
      }
    };

    root.addEventListener("click", handler);
    return () => root.removeEventListener("click", handler);
  }, [activeBook, onSelectChapter, activeChapter?.id, contentRef]);

  if (!activeBook || !activeChapter) {
     return (
      <div className="flex flex-1 flex-col overflow-hidden">
        <div
          className={cn(
            "flex-1 overflow-y-auto transition-colors",
            themeClasses[resolvedTheme],
            fontSizeClass,
            lineHeightClass,
            fontClassMap[preferences.fontFamily],
            paddingConfig.outer,
          )}
        >
          <p className="prose max-w-3xl text-muted-foreground">
            Once you import an EPUB, pick a chapter to start reading.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
      <div
        ref={contentRef}
        className={cn(
          "flex-1 min-h-0 overflow-y-auto transition-colors",
          themeClasses[resolvedTheme],
          fontSizeClass,
          lineHeightClass,
          fontClassMap[preferences.fontFamily],
          paddingConfig.outer,
        )}
        onScroll={handleScroll}
        onClick={(event: ReactMouseEvent<HTMLDivElement>) => {
          if ((event.target as HTMLElement)?.closest("a,button")) {
            return;
          }
          onToggleChrome();
        }}
      >
        <div
          className={cn(
            "mx-auto flex w-full max-w-3xl flex-col gap-8 transition-[padding]",
            paddingConfig.innerBase,
            innerVerticalPaddingClass,
            showAudioPlayer && "pb-32",
          )}
        >
          {renderNavigation()}
          <article
            id={activeChapter.id}
            data-chapter-id={activeChapter.id}
            className={cn(
              "prose reader-prose max-w-none space-y-4 transition-colors",
              proseColorClass,
              fontSizeClass,
              lineHeightClass,
              fontSizeTokenClass,
            )}
          >
            <h2 className="text-2xl font-semibold">{activeChapter.title}</h2>
            <div
              dangerouslySetInnerHTML={{
                __html: activeChapter.contentHtml,
              }}
            />
          </article>
          {renderNavigation()}
        </div>
      </div>
    </div>
  );
}

