import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { Loader2 } from "lucide-react";

import { cn } from "../../lib/utils";
import { anim, animPatterns } from "../../lib/animations";
import { findCurrentAudioSegment } from "../../lib/epub";
import { ensureChapterLoaded } from "../../lib/lazy-chapter-loader";
import { computeScrollMetrics, calculateProgress, restoreScrollPosition, scrollToElement } from "../../lib/scroll-utils";
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
}: ReaderViewportProps) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const progressRafRef = useRef<number | null>(null);
  const progressDebounceTimeoutRef = useRef<number | null>(null);
  const scrollActivityTimeoutRef = useRef<number | null>(null);
  const [isScrolling, setIsScrolling] = useState(false);
  const [highlightedElementId, setHighlightedElementId] = useState<string | null>(null);
  const [chapterTransitionDirection, setChapterTransitionDirection] = useState<"left" | "right" | "fade" | null>(null);
  const [loadedChapter, setLoadedChapter] = useState<Chapter | null>(null);
  const [isLoadingChapter, setIsLoadingChapter] = useState(false);
  
  // Refs for tracking state
  const lastHighlightedElementRef = useRef<string | null>(null);
  const lastScrolledElementRef = useRef<string | null>(null);
  const previousChapterIdRef = useRef<string | undefined>(activeChapter?.id);
  const highlightEnterTimeoutRef = useRef<number | null>(null);
  const isRestoringScrollRef = useRef(false);
  const restoredChapterIdRef = useRef<string | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const lastProgressRef = useRef<ChapterProgressSnapshot | null>(null);

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

  const displayChapter = loadedChapter || activeChapter;

  if (!displayChapter || !activeChapter) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="text-muted-foreground">No chapter selected</div>
      </div>
    );
  }

  // Emit progress snapshot
  const emitChapterProgress = useCallback(() => {
    if (!displayChapter || !onChapterProgress || isRestoringScrollRef.current) {
      return;
    }

    const metrics = computeScrollMetrics(contentRef.current);
    if (!metrics) return;

    const percent = calculateProgress(metrics);
    const snapshot: ChapterProgressSnapshot = {
      chapterId: displayChapter.id,
      scrollTop: metrics.scrollTop,
      scrollHeight: metrics.scrollHeight,
      clientHeight: metrics.clientHeight,
      percent: Number(percent.toFixed(4)),
      activeElementId: null,
      activeElementIndex: null,
    };

    // Skip if unchanged
    const last = lastProgressRef.current;
    if (
      last &&
      last.chapterId === snapshot.chapterId &&
      Math.abs(last.scrollTop - snapshot.scrollTop) < 1 &&
      Math.abs(last.scrollHeight - snapshot.scrollHeight) < 1 &&
      Math.abs(last.clientHeight - snapshot.clientHeight) < 1 &&
      Math.abs(last.percent - snapshot.percent) < 0.002
    ) {
      return;
    }

    lastProgressRef.current = snapshot;
    onChapterProgress(snapshot);
  }, [displayChapter, onChapterProgress]);

  // Schedule progress emission with debouncing
  const scheduleProgressEmit = useCallback(() => {
    if (!activeChapter || !onChapterProgress) return;

    if (progressDebounceTimeoutRef.current !== null) {
      clearTimeout(progressDebounceTimeoutRef.current);
    }

    progressDebounceTimeoutRef.current = window.setTimeout(() => {
      progressDebounceTimeoutRef.current = null;
      if (progressRafRef.current !== null) {
        cancelAnimationFrame(progressRafRef.current);
      }
      progressRafRef.current = requestAnimationFrame(() => {
        progressRafRef.current = null;
        emitChapterProgress();
      });
    }, 150);
  }, [activeChapter, emitChapterProgress, onChapterProgress]);

  // Handle scroll events
  const handleScroll = useCallback(() => {
    setIsScrolling(true);
    if (scrollActivityTimeoutRef.current !== null) {
      clearTimeout(scrollActivityTimeoutRef.current);
    }
    scrollActivityTimeoutRef.current = window.setTimeout(() => {
      scrollActivityTimeoutRef.current = null;
      setIsScrolling(false);
    }, 200);
    scheduleProgressEmit();
  }, [scheduleProgressEmit]);

  // Setup scroll listener and resize observer
  useEffect(() => {
    const node = contentRef.current;
    if (!node) return;

    node.addEventListener("scroll", handleScroll, { passive: true });

    if (typeof ResizeObserver !== "undefined") {
      resizeObserverRef.current = new ResizeObserver(() => {
        scheduleProgressEmit();
      });
      resizeObserverRef.current.observe(node);
    }

    return () => {
      node.removeEventListener("scroll", handleScroll);
      if (scrollActivityTimeoutRef.current !== null) {
        clearTimeout(scrollActivityTimeoutRef.current);
        scrollActivityTimeoutRef.current = null;
      }
      setIsScrolling(false);
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }
    };
  }, [handleScroll, scheduleProgressEmit]);

  // Restore scroll position when chapter loads
  useEffect(() => {
    if (!activeChapter || scrollIntent || !activeBook?.progress) {
      restoredChapterIdRef.current = null;
      return;
    }

    if (restoredChapterIdRef.current === activeChapter.id) {
      return;
    }

    const node = contentRef.current;
    if (!node) return;

    const progress = activeBook.progress;
    if (progress.currentChapterId !== activeChapter.id) {
      return;
    }

    isRestoringScrollRef.current = true;

    const attemptRestore = () => {
      const metrics = computeScrollMetrics(node);
      if (!metrics || metrics.scrollHeight <= 0) {
        requestAnimationFrame(attemptRestore);
        return;
      }

      if (metrics.maxScroll <= 0) {
        isRestoringScrollRef.current = false;
        restoredChapterIdRef.current = activeChapter.id;
        setTimeout(() => scheduleProgressEmit(), 100);
        return;
      }

      const restored = restoreScrollPosition(node, {
        scrollTop: progress.currentChapterScrollTop,
        scrollHeight: progress.currentChapterScrollHeight,
        clientHeight: progress.currentChapterClientHeight,
        percent: progress.chapterProgressPercent,
      });

      isRestoringScrollRef.current = false;
      restoredChapterIdRef.current = activeChapter.id;

      if (restored) {
        setTimeout(() => scheduleProgressEmit(), 100);
      } else {
        scheduleProgressEmit();
      }
    };

    requestAnimationFrame(attemptRestore);
  }, [
    activeBook?.id,
    activeBook?.progress?.updatedAt,
    displayChapter?.id,
    displayChapter?.contentHtml,
    scheduleProgressEmit,
    scrollIntent,
    activeChapter?.id,
  ]);

  // Handle scroll intent (top/bottom)
  useEffect(() => {
    if (!scrollIntent) return;

    const node = contentRef.current;
    if (!node) {
      onScrollIntentConsumed?.();
      return;
    }

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
          scheduleProgressEmit();
          onScrollIntentConsumed?.();
        } else {
          requestAnimationFrame(checkComplete);
        }
      };

      setTimeout(() => checkComplete(), 100);
    });

    return () => cancelAnimationFrame(rafId);
  }, [scrollIntent, activeChapter?.id, onScrollIntentConsumed, scheduleProgressEmit]);

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
      if (scrollToElement(node, fragment, "smooth")) {
        setTimeout(() => scheduleProgressEmit(), 300);
      }
      onFragmentConsumed();
    });

    return () => cancelAnimationFrame(rafId);
  }, [pendingFragment, activeChapter?.id, onFragmentConsumed, scheduleProgressEmit]);

  // Save scroll position on unmount or chapter change
  useEffect(() => {
    const currentChapter = activeChapter;
    return () => {
      if (currentChapter && onChapterProgress) {
        if (progressDebounceTimeoutRef.current !== null) {
          clearTimeout(progressDebounceTimeoutRef.current);
          progressDebounceTimeoutRef.current = null;
        }
        if (progressRafRef.current !== null) {
          cancelAnimationFrame(progressRafRef.current);
          progressRafRef.current = null;
        }
        emitChapterProgress();
      }
    };
  }, [activeChapter?.id, displayChapter, onChapterProgress, emitChapterProgress]);

  // Emit progress on chapter change (after restoration)
  useEffect(() => {
    if (activeChapter?.id && restoredChapterIdRef.current !== activeChapter.id) {
      const timer = setTimeout(() => scheduleProgressEmit(), 200);
      return () => clearTimeout(timer);
    }
  }, [activeChapter?.id, scheduleProgressEmit]);

  // Handle chapter transitions
  useEffect(() => {
    if (!activeChapter?.id || !previousChapterIdRef.current) {
      previousChapterIdRef.current = activeChapter?.id;
      return;
    }

    if (previousChapterIdRef.current !== activeChapter.id) {
      if (activeBook) {
        const prevIndex = activeBook.chapters.findIndex(ch => ch.id === previousChapterIdRef.current);
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
      previousChapterIdRef.current = activeChapter.id;
      return () => clearTimeout(timer);
    }
  }, [activeChapter?.id, activeBook]);

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
      lastHighlightedElementRef.current = null;
      lastScrolledElementRef.current = null;
      return;
    }

    const segment = findCurrentAudioSegment(
      activeBook.audioSyncMap,
      currentAudioTrackHref,
      currentAudioTime,
    );

    if (!segment) {
      setHighlightedElementId(null);
      lastHighlightedElementRef.current = null;
      lastScrolledElementRef.current = null;
      return;
    }

    const chapterHref = activeChapter.href.split("#")[0];
    if (segment.chapterHref !== chapterHref) {
      setHighlightedElementId(null);
      lastHighlightedElementRef.current = null;
      lastScrolledElementRef.current = null;
      return;
    }

    const elementId = segment.textElementId;
    
    if (lastHighlightedElementRef.current !== elementId) {
      console.warn("[Audio Sync] Highlighted SMIL segment changed:", {
        previousElementId: lastHighlightedElementRef.current,
        newElementId: elementId,
        currentTime: currentAudioTime,
      });
    }
    
    setHighlightedElementId(elementId);
    lastHighlightedElementRef.current = elementId;

    // Auto-scroll to highlighted element
    const root = contentRef.current;
    if (!root) return;

    const shouldScroll = elementId && autoScrollEnabled && lastScrolledElementRef.current !== elementId;
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
        lastScrolledElementRef.current = elementId;
        return;
      }
      
      lastScrolledElementRef.current = elementId;
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

    if (highlightEnterTimeoutRef.current !== null) {
      clearTimeout(highlightEnterTimeoutRef.current);
      highlightEnterTimeoutRef.current = null;
    }

    const previousHighlightedId = lastHighlightedElementRef.current;
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
            highlightEnterTimeoutRef.current = window.setTimeout(() => {
              element.classList.remove("audio-highlight-enter");
              element.classList.add("audio-highlight-active");
            }, 200);
          });
        } else {
          element.classList.add("audio-highlight-active");
        }
      }
    }

    lastHighlightedElementRef.current = highlightedElementId;

    return () => {
      if (highlightEnterTimeoutRef.current !== null) {
        clearTimeout(highlightEnterTimeoutRef.current);
        highlightEnterTimeoutRef.current = null;
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
        if (scrollToElement(root, fragment, "smooth")) {
          scheduleProgressEmit();
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
  }, [activeBook, onSelectChapter, activeChapter?.id, scheduleProgressEmit]);

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
