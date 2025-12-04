/**
 * ReaderViewport - Fully presentational component
 * All business logic is handled by ReaderWrapper
 * Only handles UI rendering and animations
 * No useEffects - all side effects handled via hooks and callbacks
 */

import { useCallback, useMemo, useRef } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";

import { cn } from "../../lib/utils";
import { anim, animPatterns } from "../../lib/animations";
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
} from "./types";
import type { Book, Chapter, ReaderPreferences, ReaderTheme } from "../../types/reader";
import { Button } from "../ui/button";
import { useScrollTracking } from "../../hooks/reader/useScrollTracking";
import { useFragmentNavigation } from "../../hooks/reader/useFragmentNavigation";
import { useChapterTransitions } from "../../hooks/reader/useChapterTransitions";
import { useHighlighting } from "../../hooks/reader/useHighlighting";
import { useLinkHandling } from "../../hooks/reader/useLinkHandling";
import { useChapterLoadedCallback } from "../../hooks/reader/useChapterLoadedCallback";

type ResolvedReaderTheme = Exclude<ReaderTheme, "system">;

type ReaderViewportConfig = {
  preferences: ReaderPreferences;
  theme: ResolvedReaderTheme;
  chromeVisible: boolean;
  audioPlayerVisible?: boolean;
  autoScrollEnabled?: boolean;
};

type ReaderViewportState = {
  book?: Book;
  chapter?: Chapter;
  isLoading?: boolean;
  animationState?: "entering" | "entered" | null;
  highlightedElementId?: string | null;
  pendingFragment?: string | null;
};

type ReaderViewportCallbacks = {
  onSelectChapter: (chapterId: string, options?: ChapterSelectionOptions) => void;
  onChapterLoaded?: () => void;
  onToggleChrome: () => void;
  onSyncToAudio?: () => void;
  onChapterProgress?: (snapshot: ChapterProgressSnapshot) => void;
  onFragmentConsumed?: () => void;
  onPreferencesChange?: (update: Partial<ReaderPreferences>) => void;
  onScroll?: () => void;
  onScrollEnd?: () => void;
};

type ReaderViewportProps = {
  config: ReaderViewportConfig;
  state: ReaderViewportState;
  callbacks: ReaderViewportCallbacks;
  contentRef?: React.RefObject<HTMLDivElement | null>;
};

export function ReaderViewport({
  config,
  state,
  callbacks,
  contentRef: externalContentRef,
}: ReaderViewportProps) {
  // Guard against missing required props before destructuring
  if (!config || !state || !callbacks) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-8">
          <p className="prose max-w-3xl text-muted-foreground">
            Loading reader...
          </p>
        </div>
      </div>
    );
  }

  const {
    preferences,
    theme: resolvedTheme,
    chromeVisible,
    audioPlayerVisible = false,
    autoScrollEnabled = true,
  } = config;

  const {
    book: activeBook,
    chapter: activeChapter,
    isLoading: isLoadingChapter = false,
    animationState: chapterAnimationState,
    highlightedElementId,
    pendingFragment,
  } = state;

  const {
    onSelectChapter,
    onChapterLoaded,
    onToggleChrome,
    onFragmentConsumed,
    onScroll,
    onScrollEnd,
  } = callbacks;

  // Use external contentRef if provided, otherwise create own
  const internalContentRef = useRef<HTMLDivElement | null>(null);
  const contentRef = externalContentRef || internalContentRef;

  // Custom hooks (no useEffects)
  const scrollTracking = useScrollTracking();
  const fragmentNav = useFragmentNavigation(contentRef, onFragmentConsumed);
  const transitions = useChapterTransitions();
  const highlighting = useHighlighting(contentRef);
  const linkHandling = useLinkHandling(contentRef, activeBook, onSelectChapter);
  useChapterLoadedCallback(activeChapter, onChapterLoaded);

  // Handle fragment navigation (explicit call)
  if (pendingFragment) {
    fragmentNav.navigateToFragment(pendingFragment);
  }

  // Handle chapter transitions (explicit call)
  transitions.triggerTransition(activeChapter, activeBook);

  // Handle highlighting (explicit call)
  if (highlightedElementId !== undefined) {
    highlighting.applyHighlight(highlightedElementId);
  }

  // Setup link handler when contentRef changes (explicit check)
  const lastBookIdRef = useRef<string | undefined>(undefined);
  if (activeBook?.id !== lastBookIdRef.current && contentRef.current) {
    lastBookIdRef.current = activeBook?.id;
    linkHandling.setupLinkHandler();
  }

  // Setup scroll handler when contentRef is available (explicit check)
  const scrollHandler = useCallback(() => {
    scrollTracking.scrollHandler();
    onScroll?.();
  }, [scrollTracking, onScroll]);
  
  const lastScrollHandlerRef = useRef<typeof scrollHandler | undefined>(undefined);
    if (scrollHandler !== lastScrollHandlerRef.current && contentRef.current) {
      if (lastScrollHandlerRef.current) {
        contentRef.current.removeEventListener("scroll", lastScrollHandlerRef.current as EventListener);
      }
    lastScrollHandlerRef.current = scrollHandler;
    const node = contentRef.current;
    node.addEventListener("scroll", scrollHandler, { passive: true });
    
    // Also set up scroll end handler for progress emission
    if (onScrollEnd) {
      let scrollEndTimeout: number | null = null;
      const scrollEndHandler = () => {
        if (scrollEndTimeout) clearTimeout(scrollEndTimeout);
        scrollEndTimeout = window.setTimeout(() => {
          onScrollEnd();
          scrollEndTimeout = null;
        }, 150);
      };
      node.addEventListener("scroll", scrollEndHandler, { passive: true });
    }
  }

  // Navigation helpers
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

  // Theme and style classes
  const proseColorClass = resolvedTheme === "dark" ? "prose-invert" : "prose-neutral";
  const navButtonClass =
    resolvedTheme === "dark"
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

  // Navigation handlers (always go to top, no restore)
  const handlePrevious = useCallback(() => {
    if (!previousChapter) return;
    onSelectChapter(previousChapter.id, {
      preserveChrome: true,
      scrollPosition: "top",
      isManualSelection: true,
    });
  }, [previousChapter, onSelectChapter]);

  const handleNext = useCallback(() => {
    if (!nextChapter) return;
    onSelectChapter(nextChapter.id, {
      preserveChrome: true,
      scrollPosition: "top",
      isManualSelection: true,
    });
  }, [nextChapter, onSelectChapter]);

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

  if (!activeBook || !activeChapter) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        <div
          className={cn(
            "flex-1 overflow-y-auto",
            anim("normal", "colors"),
            themeClasses[resolvedTheme || "light"],
            fontSizeClass,
            lineHeightClass,
            fontClassMap[preferences?.fontFamily || "serif"],
            paddingConfig?.outer || "p-8",
          )}
        >
          <p className="prose max-w-3xl text-muted-foreground">
            Once you import an EPUB, pick a chapter to start reading.
          </p>
        </div>
      </div>
    );
  }

  // Determine chapter animation class
  const chapterAnimationClass = 
    chapterAnimationState === "entering" || chapterAnimationState === "entered"
      ? (transitions.direction === "left" 
          ? animPatterns.chapterSlideLeft 
          : transitions.direction === "right"
          ? animPatterns.chapterSlideRight
          : animPatterns.chapterCrossFade)
      : null;

  // Set content ref callback
  const setContentRef = useCallback((node: HTMLDivElement | null) => {
    if (typeof contentRef === "object" && contentRef !== null && "current" in contentRef) {
      (contentRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
    }
    if (node) {
      // Setup link handler
      linkHandling.setupLinkHandler();
      // Setup scroll handler
      const scrollHandler = () => {
        scrollTracking.scrollHandler();
        onScroll?.();
      };
      node.addEventListener("scroll", scrollHandler, { passive: true });
      
      // Setup scroll end handler for progress emission
      if (onScrollEnd) {
        let scrollEndTimeout: number | null = null;
        const scrollEndHandler = () => {
          if (scrollEndTimeout) clearTimeout(scrollEndTimeout);
          scrollEndTimeout = window.setTimeout(() => {
            onScrollEnd();
            scrollEndTimeout = null;
          }, 150);
        };
        node.addEventListener("scroll", scrollEndHandler, { passive: true });
      }
    } else {
      // Cleanup
      linkHandling.cleanup();
    }
  }, [contentRef, linkHandling, scrollTracking, onScroll, onScrollEnd]);

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
      <div
        ref={setContentRef}
        className={cn(
          "flex-1 min-h-0 overflow-y-auto",
          anim("normal", "colors"),
          themeClasses[resolvedTheme],
          fontSizeClass,
          lineHeightClass,
          fontClassMap[preferences.fontFamily],
          paddingConfig.outer,
          autoScrollEnabled && "auto-scroll-active",
          "transition-all duration-300 ease-in-out",
        )}
        data-reader-scrolling={scrollTracking.isScrolling ? "true" : "false"}
        data-auto-scroll-enabled={autoScrollEnabled ? "true" : "false"}
        onClick={(event: ReactMouseEvent<HTMLDivElement>) => {
          if ((event.target as HTMLElement)?.closest("a,button")) {
            return;
          }
          onToggleChrome();
        }}
      >
        <div
          className={cn(
            "mx-auto flex w-full max-w-3xl flex-col gap-8",
            anim("normal", "padding"),
            paddingConfig.innerBase,
            innerVerticalPaddingClass,
            audioPlayerVisible && "pb-32",
          )}
        >
          {renderNavigation()}
          <article
            id={activeChapter.id}
            data-chapter-id={activeChapter.id}
            data-reader-chapter-root="true"
            key={activeChapter.id}
            className={cn(
              "prose reader-prose max-w-none space-y-4",
              anim("normal", "colors"),
              proseColorClass,
              fontSizeClass,
              lineHeightClass,
              fontSizeTokenClass,
              chapterAnimationClass,
            )}
          >
            <h2 className="text-2xl font-semibold">{activeChapter.title}</h2>
            {isLoadingChapter ? (
              <div className="flex items-center justify-center py-12">
                <div className="text-muted-foreground">Loading chapter content...</div>
              </div>
            ) : activeChapter.contentHtml ? (
              <div
                data-reader-chapter-content="true"
                data-chapter-id={activeChapter.id}
                className="animate-in fade-in duration-300"
                dangerouslySetInnerHTML={{
                  __html: activeChapter.contentHtml,
                }}
              />
            ) : (
              <div className="flex items-center justify-center py-12">
                <div className="text-muted-foreground">Chapter content not available</div>
              </div>
            )}
          </article>
          {renderNavigation()}
        </div>
      </div>
    </div>
  );
}
