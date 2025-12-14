/**
 * ReaderViewport - Fully presentational component
 * All business logic is handled by ReaderWrapper
 * Only handles UI rendering and animations
 * No useEffects - all side effects handled via hooks and callbacks
 */

import { useCallback, useMemo, useRef, useEffect } from "react";
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
import { useFragmentNavigation } from "../../hooks/reader/useFragmentNavigation";
import { useChapterTransitions } from "../../hooks/chapter/useChapterTransitions";
import { useHighlighting } from "../../hooks/reader/useHighlighting";
import { useLinkHandling } from "../../hooks/reader/useLinkHandling";
// Virtualization disabled - using direct HTML rendering

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
  isScrolling?: boolean; // Scroll state from scroll management
};

type ElementIndexHook = {
  hasElement: (elementId: string) => boolean;
  getElementInfo: (elementId: string) => { elementId: string; approximateScrollTop: number; segmentIndex?: number } | undefined;
  getScrollPositionEstimate: (elementId: string) => number | undefined;
  getSegmentIndex: (elementId: string) => number | undefined;
};

type ReaderViewportProps = {
  config: ReaderViewportConfig;
  state: ReaderViewportState;
  callbacks: ReaderViewportCallbacks;
  contentRef?: React.RefObject<HTMLDivElement | null>;
  elementIndex?: ElementIndexHook;
};

export function ReaderViewport({
  config,
  state,
  callbacks,
  contentRef: externalContentRef,
  elementIndex,
}: ReaderViewportProps) {
  // Guard against missing required props before destructuring
  if (!config || !state || !callbacks) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-8">
          <p className="prose text-muted-foreground">
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
  
  // Track if content rendered callback has been called for current chapter
  const contentRenderedRef = useRef<string | null>(null);
  
  // Custom hooks (no useEffects)
  const fragmentNav = useFragmentNavigation(contentRef, onFragmentConsumed);
  const transitions = useChapterTransitions();
  // useHighlighting now processes the queue internally - no need to call it explicitly
  useHighlighting(contentRef, activeChapter?.id, elementIndex);
  const linkHandling = useLinkHandling(contentRef, activeBook, onSelectChapter);
  
  // Chapter loaded callback is handled when content div is rendered
  // Reset content rendered ref when chapter changes
  if (contentRenderedRef.current && contentRenderedRef.current !== activeChapter?.id) {
    contentRenderedRef.current = null;
  }

  // Handle fragment navigation (explicit call)
  if (pendingFragment) {
    fragmentNav.navigateToFragment(pendingFragment);
  }

  // Handle chapter transitions (explicit call)
  transitions.triggerTransition(activeChapter, activeBook);

  // Setup link handler when contentRef changes (explicit check)
  const lastBookIdRef = useRef<string | undefined>(undefined);
  if (activeBook?.id !== lastBookIdRef.current && contentRef.current) {
    lastBookIdRef.current = activeBook?.id;
    linkHandling.setupLinkHandler();
  }

  // Scroll handlers are now managed in setContentRef callback to avoid duplicates

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
          <p className="prose text-muted-foreground">
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

  // Set content ref callback with proper cleanup
  const scrollHandlerRef = useRef<(() => void) | null>(null);
  const scrollEndHandlerRef = useRef<(() => void) | null>(null);
  const scrollEndTimeoutRef = useRef<number | null>(null);
  
  const setContentRef = useCallback((node: HTMLDivElement | null) => {
    if (typeof contentRef === "object" && contentRef !== null && "current" in contentRef) {
      (contentRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
    }
    
    // Cleanup previous listeners if node is being removed or changed
    const prevNode = scrollHandlerRef.current ? contentRef.current : null;
    if (prevNode && prevNode !== node) {
      if (scrollHandlerRef.current) {
        prevNode.removeEventListener("scroll", scrollHandlerRef.current);
      }
      if (scrollEndHandlerRef.current) {
        prevNode.removeEventListener("scroll", scrollEndHandlerRef.current);
      }
      if (scrollEndTimeoutRef.current) {
        clearTimeout(scrollEndTimeoutRef.current);
        scrollEndTimeoutRef.current = null;
      }
    }
    
    if (node) {
      // Setup link handler
      linkHandling.setupLinkHandler();
      
      // Setup scroll handler (only once)
      if (!scrollHandlerRef.current) {
        const scrollHandler = () => {
          onScroll?.();
        };
        scrollHandlerRef.current = scrollHandler;
        node.addEventListener("scroll", scrollHandler, { passive: true });
      }
      
      // Setup scroll end handler for progress emission (only once)
      if (onScrollEnd && !scrollEndHandlerRef.current) {
        const scrollEndHandler = () => {
          if (scrollEndTimeoutRef.current) {
            clearTimeout(scrollEndTimeoutRef.current);
          }
          scrollEndTimeoutRef.current = window.setTimeout(() => {
            onScrollEnd();
            scrollEndTimeoutRef.current = null;
          }, 150);
        };
        scrollEndHandlerRef.current = scrollEndHandler;
        node.addEventListener("scroll", scrollEndHandler, { passive: true });
      }
    } else {
      // Cleanup on unmount
      if (scrollEndTimeoutRef.current) {
        clearTimeout(scrollEndTimeoutRef.current);
        scrollEndTimeoutRef.current = null;
      }
      scrollHandlerRef.current = null;
      scrollEndHandlerRef.current = null;
      linkHandling.cleanup();
    }
  }, [contentRef, linkHandling, onScroll, onScrollEnd]);

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
        data-reader-scrolling={callbacks.isScrolling ? "true" : "false"}
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
            "mx-auto flex w-full flex-col gap-8",
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
            style={{
              // CSS containment to limit layout calculations
              // This tells the browser to optimize rendering for this subtree
              contain: "layout style paint",
            }}
          >
            <h2 className="text-2xl font-semibold">{activeChapter.title}</h2>
            {isLoadingChapter ? (
              <div className="flex items-center justify-center py-12">
                <div className="text-muted-foreground">Loading chapter content...</div>
              </div>
            ) : activeChapter.contentHtml ? (
              <div
                ref={(node) => {
                  // Call onContentRendered when content is rendered (only once per chapter)
                  if (node && onChapterLoaded && contentRenderedRef.current !== activeChapter.id) {
                    contentRenderedRef.current = activeChapter.id;
                    // Use requestAnimationFrame to ensure DOM is ready
                    requestAnimationFrame(() => {
                      onChapterLoaded();
                    });
                  }
                }}
                data-reader-chapter-content="true"
                data-chapter-id={activeChapter.id}
                className="animate-in fade-in duration-300"
                style={{
                  // CSS containment to limit layout calculations for off-screen content
                  contain: "layout style paint",
                }}
                dangerouslySetInnerHTML={{ __html: activeChapter.contentHtml }}
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
