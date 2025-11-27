import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { Loader2 } from "lucide-react";

import { cn } from "../../lib/utils";
import { anim, animPatterns } from "../../lib/animations";
import { findCurrentAudioSegment } from "../../lib/epub";
import { ensureChapterLoaded } from "../../lib/lazy-chapter-loader";
import { computeScrollMetrics, restoreScrollPosition, scrollToElement } from "../../lib/scroll-utils";
import { usePrevious } from "../../hooks/usePrevious";
import { useChapterProgress } from "../../hooks/useChapterProgress";
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
import type { Chapter, ReaderTheme } from "../../types/reader";
import { Button } from "../ui/button";

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
  currentAudioTime?: number;
  currentAudioTrackHref?: string;
  autoScrollEnabled?: boolean;
  isAudioRestoring?: boolean;
  onSaveProgress?: (saveFn: () => void) => void;
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
  currentAudioTime,
  currentAudioTrackHref,
  autoScrollEnabled = true,
  isAudioRestoring = false,
  onSaveProgress,
}: ReaderViewportProps) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  
  // Consolidated scroll state
  const scrollStateRef = useRef({
    rafId: null as number | null,
    activityTimeout: null as number | null,
  });
  
  // Consolidated highlight state
  const highlightStateRef = useRef({
    lastHighlightedElement: null as string | null,
    lastScrolledElement: null as string | null,
    enterTimeout: null as number | null,
  });
  
  // Consolidated scroll restoration state
  const scrollRestoreStateRef = useRef({
    isRestoring: false,
    restoredChapterId: null as string | null,
  });
  
  const [isScrolling, setIsScrolling] = useState(false);
  const [highlightedElementId, setHighlightedElementId] = useState<string | null>(null);
  const [chapterTransitionDirection, setChapterTransitionDirection] = useState<"left" | "right" | "fade" | null>(null);
  const [loadedChapter, setLoadedChapter] = useState<Chapter | null>(null);
  const [isLoadingChapter, setIsLoadingChapter] = useState(false);
  
  // Lazy load chapter content
  useEffect(() => {
    if (!activeBook || !activeChapter) {
      setLoadedChapter(null);
      return;
    }

    if (activeChapter.contentHtml && activeChapter.plainText) {
      setLoadedChapter(activeChapter);
      return;
    }

    setIsLoadingChapter(true);
    ensureChapterLoaded(activeBook.sourcePath, activeChapter)
      .then((loaded) => {
        setLoadedChapter(loaded);
        setIsLoadingChapter(false);
      })
      .catch((error) => {
        console.error("Failed to load chapter", error);
        setIsLoadingChapter(false);
        setLoadedChapter(activeChapter);
      });
  }, [activeBook?.sourcePath, activeChapter?.id, activeChapter?.href]);

  const displayChapter = loadedChapter || activeChapter || null;

  // Use usePrevious hook for chapter tracking
  const previousChapterId = usePrevious(activeChapter?.id);

  // Use consolidated progress tracking hook
  const {
    saveProgress: _saveProgress, // Exposed via onSaveProgress callback
    updateMetricsOnScroll,
  } = useChapterProgress({
    activeChapter: displayChapter,
    contentRef: contentRef as React.RefObject<HTMLElement>,
    onProgress: onChapterProgress ? (snapshot: ChapterProgressSnapshot) => {
      onChapterProgress(snapshot);
    } : undefined,
    onSaveProgress,
    isRestoringScroll: scrollRestoreStateRef.current.isRestoring,
  });

  if (!displayChapter || !activeChapter) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="text-muted-foreground">No chapter selected</div>
      </div>
    );
  }

  // Progress tracking is now handled by useChapterProgress hook

  // Handle scroll events (only for UI state, not progress tracking)
  const handleScroll = useCallback(() => {
    setIsScrolling(true);
    
    // Update metrics on scroll (handled by hook)
    updateMetricsOnScroll();
    
    // Cancel previous scroll activity timeout
    if (scrollStateRef.current.activityTimeout !== null) {
      clearTimeout(scrollStateRef.current.activityTimeout);
    }
    
    // Track scroll activity state (for UI purposes only)
    scrollStateRef.current.activityTimeout = window.setTimeout(() => {
      scrollStateRef.current.activityTimeout = null;
      setIsScrolling(false);
    }, 200);
  }, [updateMetricsOnScroll]);

  // Unified scroll management: listener setup, restoration, and intent handling
  useEffect(() => {
    const node = contentRef.current;
    if (!node) return;

    // Setup scroll listener for UI state tracking
    node.addEventListener("scroll", handleScroll, { passive: true });

    // Handle scroll intent (top/bottom) - takes priority over restoration
    if (scrollIntent) {
      const rafId = requestAnimationFrame(() => {
        const metrics = computeScrollMetrics(node);
        if (!metrics) {
          onScrollIntentConsumed?.();
          return;
        }

        const target = scrollIntent === "bottom" ? metrics.maxScroll : 0;
        node.scrollTo({ top: target, behavior: "smooth" });

        const checkComplete = () => {
          const currentMetrics = computeScrollMetrics(node);
          if (currentMetrics && Math.abs(currentMetrics.scrollTop - target) <= 5) {
            onScrollIntentConsumed?.();
          } else {
            requestAnimationFrame(checkComplete);
          }
        };

        setTimeout(() => checkComplete(), 100);
      });
      scrollStateRef.current.rafId = rafId;
    }

    // Restore scroll position when chapter loads (only if no scroll intent)
    if (!scrollIntent && activeChapter && activeBook?.progress) {
      if (scrollRestoreStateRef.current.restoredChapterId !== activeChapter.id) {
        const progress = activeBook.progress;
        if (progress.currentChapterId === activeChapter.id) {
          scrollRestoreStateRef.current.isRestoring = true;

          const attemptRestore = () => {
            const metrics = computeScrollMetrics(node);
            if (!metrics || metrics.scrollHeight <= 0) {
              requestAnimationFrame(attemptRestore);
              return;
            }

            if (metrics.maxScroll <= 0) {
              scrollRestoreStateRef.current.isRestoring = false;
              scrollRestoreStateRef.current.restoredChapterId = activeChapter.id;
              return;
            }

            restoreScrollPosition(node, {
              scrollTop: progress.currentChapterScrollTop,
              scrollHeight: progress.currentChapterScrollHeight,
              clientHeight: progress.currentChapterClientHeight,
              percent: progress.chapterProgressPercent,
            });

            scrollRestoreStateRef.current.isRestoring = false;
            scrollRestoreStateRef.current.restoredChapterId = activeChapter.id;
          };

          requestAnimationFrame(attemptRestore);
        }
      }
    } else if (!activeChapter || scrollIntent) {
      scrollRestoreStateRef.current.restoredChapterId = null;
    }

    return () => {
      node.removeEventListener("scroll", handleScroll);
      
      // Cleanup timeouts and RAF
      if (scrollStateRef.current.activityTimeout !== null) {
        clearTimeout(scrollStateRef.current.activityTimeout);
        scrollStateRef.current.activityTimeout = null;
      }
      if (scrollStateRef.current.rafId !== null) {
        cancelAnimationFrame(scrollStateRef.current.rafId);
        scrollStateRef.current.rafId = null;
      }
      
      setIsScrolling(false);
    };
  }, [
    handleScroll,
    scrollIntent,
    activeChapter?.id,
    activeBook?.id,
    activeBook?.progress?.updatedAt,
    displayChapter?.id,
    displayChapter?.contentHtml,
    onScrollIntentConsumed,
  ]);

  // Handle fragment navigation
  useEffect(() => {
    if (!pendingFragment) return;

    const node = contentRef.current;
    if (!node) {
      onFragmentConsumed();
      return;
    }

    const fragment = pendingFragment.replace(/^#/, "");
    const rafId = requestAnimationFrame(() => {
      scrollToElement(node, fragment, "smooth");
      onFragmentConsumed();
    });

    return () => cancelAnimationFrame(rafId);
  }, [pendingFragment, activeChapter?.id, onFragmentConsumed]);

  // Chapter change progress saving is now handled by useChapterProgress hook

  // Handle chapter transitions
  useEffect(() => {
    if (!activeChapter?.id || !previousChapterId) {
      return;
    }

    if (previousChapterId !== activeChapter.id) {
      if (activeBook) {
        const prevIndex = activeBook.chapters.findIndex(ch => ch.id === previousChapterId);
        const currentIndex = activeBook.chapters.findIndex(ch => ch.id === activeChapter.id);
        
        if (prevIndex !== -1 && currentIndex !== -1) {
          setChapterTransitionDirection(currentIndex > prevIndex ? "left" : "right");
        } else {
          setChapterTransitionDirection("fade");
        }
      } else {
        setChapterTransitionDirection("fade");
      }

      const timer = setTimeout(() => setChapterTransitionDirection(null), 300);
      return () => clearTimeout(timer);
    }
  }, [activeChapter?.id, previousChapterId, activeBook]);

  // Handle audio sync highlighting
  useEffect(() => {
    if (isAudioRestoring) return;

    if (
      !activeBook?.audioSyncMap ||
      !currentAudioTrackHref ||
      typeof currentAudioTime !== "number" ||
      !activeChapter
    ) {
      setHighlightedElementId(null);
      highlightStateRef.current.lastHighlightedElement = null;
      highlightStateRef.current.lastScrolledElement = null;
      return;
    }

    const segment = findCurrentAudioSegment(
      activeBook.audioSyncMap,
      currentAudioTrackHref,
      currentAudioTime,
    );

    if (!segment) {
      setHighlightedElementId(null);
      highlightStateRef.current.lastHighlightedElement = null;
      highlightStateRef.current.lastScrolledElement = null;
      return;
    }

    const chapterHref = activeChapter.href.split("#")[0];
    if (segment.chapterHref !== chapterHref) {
      setHighlightedElementId(null);
      highlightStateRef.current.lastHighlightedElement = null;
      highlightStateRef.current.lastScrolledElement = null;
      return;
    }

    const elementId = segment.textElementId;
    
    if (highlightStateRef.current.lastHighlightedElement !== elementId) {
      console.warn("[Audio Sync] Highlighted SMIL segment changed:", {
        previousElementId: highlightStateRef.current.lastHighlightedElement,
        newElementId: elementId,
        currentTime: currentAudioTime,
      });
    }
    
    setHighlightedElementId(elementId);
    highlightStateRef.current.lastHighlightedElement = elementId;

    // Auto-scroll to highlighted element
    const root = contentRef.current;
    if (!root) return;

    const shouldScroll = elementId && autoScrollEnabled && highlightStateRef.current.lastScrolledElement !== elementId;
    if (!shouldScroll) return;

    const element = root.querySelector<HTMLElement>(
      typeof CSS !== "undefined" && CSS.escape
        ? `#${CSS.escape(elementId)}`
        : `#${elementId}`
    );

    if (element) {
      const elementRect = element.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const visibleThreshold = viewportHeight * 0.7;
      const isInBottomPortion = elementRect.top >= 0 && 
                                 elementRect.top <= visibleThreshold &&
                                 elementRect.bottom <= viewportHeight;
      
      if (isInBottomPortion) {
        highlightStateRef.current.lastScrolledElement = elementId;
        return;
      }
      
      highlightStateRef.current.lastScrolledElement = elementId;
      element.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [
    activeBook?.audioSyncMap,
    currentAudioTrackHref,
    currentAudioTime,
    activeChapter?.id,
    activeChapter?.href,
    autoScrollEnabled,
    isAudioRestoring,
    audioPlayerVisible,
  ]);

  // Apply highlighting styles
  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;

    if (highlightStateRef.current.enterTimeout !== null) {
      clearTimeout(highlightStateRef.current.enterTimeout);
      highlightStateRef.current.enterTimeout = null;
    }

    const previousHighlightedId = highlightStateRef.current.lastHighlightedElement;
    const isNewHighlight = highlightedElementId !== previousHighlightedId;
    const exitTimeouts: number[] = [];

    // Remove existing highlights
    const allHighlighted = root.querySelectorAll(".audio-highlight, .audio-highlight-enter, .audio-highlight-active");
    allHighlighted.forEach((el) => {
      const element = el as HTMLElement;
      if (highlightedElementId && element.id === highlightedElementId) {
        return;
      }
      
      element.classList.remove("audio-highlight-enter", "audio-highlight-active");
      if (!element.classList.contains("audio-highlight")) {
        element.classList.add("audio-highlight");
      }
      element.classList.add("audio-highlight-exit");
      
      const exitTimeout = window.setTimeout(() => {
        element.classList.remove("audio-highlight", "audio-highlight-exit");
      }, 200);
      exitTimeouts.push(exitTimeout);
    });

    // Apply new highlighting
    if (highlightedElementId) {
      const selector =
        typeof CSS !== "undefined" && CSS.escape
          ? `#${CSS.escape(highlightedElementId)}`
          : `#${highlightedElementId}`;
      const element = root.querySelector<HTMLElement>(selector);
      
      if (element) {
        element.classList.remove("audio-highlight-exit");
        element.classList.remove("audio-highlight-enter", "audio-highlight-active");
        element.classList.add("audio-highlight");
        
        if (isNewHighlight) {
          requestAnimationFrame(() => {
            element.classList.add("audio-highlight-enter");
            highlightStateRef.current.enterTimeout = window.setTimeout(() => {
              element.classList.remove("audio-highlight-enter");
              element.classList.add("audio-highlight-active");
            }, 200);
          });
        } else {
          element.classList.add("audio-highlight-active");
        }
      }
    }

    highlightStateRef.current.lastHighlightedElement = highlightedElementId;

    return () => {
      if (highlightStateRef.current.enterTimeout !== null) {
        clearTimeout(highlightStateRef.current.enterTimeout);
        highlightStateRef.current.enterTimeout = null;
      }
      exitTimeouts.forEach(timeout => clearTimeout(timeout));
    };
  }, [highlightedElementId]);

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
    requestChapterChange(previousChapter.id, {
      preserveChrome: true,
      scrollPosition: "bottom",
      isManualSelection: true,
    });
  };

  const handleNext = () => {
    if (!nextChapter) return;
    requestChapterChange(nextChapter.id, {
      preserveChrome: true,
      scrollPosition: "top",
      isManualSelection: true,
    });
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

  // Handle link clicks
  useEffect(() => {
    const root = contentRef.current;
    if (!root || !activeBook) return;

    const handler = (event: MouseEvent) => {
      const element = (event.target as HTMLElement | null)?.closest("a");
      if (!(element instanceof HTMLAnchorElement)) return;

      const href = element.getAttribute("href");
      if (!href || href.startsWith("http") || href.startsWith("mailto:")) {
        return;
      }

      event.preventDefault();

      if (href.startsWith("#")) {
        const fragment = href.slice(1);
        scrollToElement(root, fragment, "smooth");
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
  }, [activeBook, onSelectChapter, activeChapter?.id]);

  if (!activeBook || !activeChapter) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        <div
          className={cn(
            "flex-1 overflow-y-auto",
            anim("normal", "colors"),
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
        data-reader-scrolling={isScrolling ? "true" : "false"}
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
            id={displayChapter.id}
            data-chapter-id={displayChapter.id}
            data-reader-chapter-root="true"
            key={displayChapter.id}
            className={cn(
              "prose reader-prose max-w-none space-y-4",
              anim("normal", "colors"),
              proseColorClass,
              fontSizeClass,
              lineHeightClass,
              fontSizeTokenClass,
              chapterTransitionDirection === "left" && animPatterns.chapterSlideLeft,
              chapterTransitionDirection === "right" && animPatterns.chapterSlideRight,
              chapterTransitionDirection === "fade" && animPatterns.chapterCrossFade,
            )}
          >
            <h2 className="text-2xl font-semibold">{displayChapter.title}</h2>
            {isLoadingChapter ? (
              <div className="flex flex-col items-center justify-center py-24">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                <p className="mt-4 text-sm text-muted-foreground">Loading chapter…</p>
              </div>
            ) : displayChapter.contentHtml ? (
              <div
                data-reader-chapter-content="true"
                data-chapter-id={displayChapter.id}
                className="animate-in fade-in duration-300"
                dangerouslySetInnerHTML={{
                  __html: displayChapter.contentHtml,
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
