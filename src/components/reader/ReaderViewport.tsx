import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";

import { cn } from "../../lib/utils";
import { findCurrentAudioSegment } from "../../lib/epub";
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
}: ReaderViewportProps) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const progressRafRef = useRef<number | null>(null);
  const scrollActivityTimeoutRef = useRef<number | null>(null);
  const [isScrolling, setIsScrolling] = useState(false);
  const [highlightedElementId, setHighlightedElementId] = useState<string | null>(null);
  const showAudioPlayer = audioPlayerVisible;
  const lastHighlightedElementRef = useRef<string | null>(null);

  const computeScrollMetrics = useCallback(() => {
    const node = contentRef.current;
    if (!node) {
      return null;
    }

    const hasWindow = typeof window !== "undefined";
    const scrollHeight = Math.max(node.scrollHeight, 0);

    if (!hasWindow) {
      const clientHeight = Math.max(node.clientHeight, 0);
      const maxScroll = Math.max(scrollHeight - clientHeight, 0);
      const scrollTop = Math.min(Math.max(node.scrollTop, 0), maxScroll);
      return { scrollTop, scrollHeight, clientHeight, maxScroll, nodeDocumentTop: 0 };
    }

    const clientHeight = Math.max(window.innerHeight, 0);
    const maxScroll = Math.max(scrollHeight - clientHeight, 0);
    const rectTop = node.getBoundingClientRect().top;
    const scrollTop = Math.min(Math.max(-rectTop, 0), maxScroll);
    const nodeDocumentTop = window.scrollY + rectTop;

    return { scrollTop, scrollHeight, clientHeight, maxScroll, nodeDocumentTop };
  }, []);

  const emitChapterProgress = useCallback(() => {
    if (!activeChapter || !onChapterProgress) {
      return;
    }

    const node = contentRef.current;
    if (!node) {
      return;
    }

    const metrics = computeScrollMetrics();
    if (!metrics) {
      return;
    }

    let percent = 0;
    if (metrics.maxScroll > 0) {
      percent = Math.min(Math.max(metrics.scrollTop / metrics.maxScroll, 0), 1);
    } else if (metrics.scrollTop > 0) {
      percent = 1;
    }

    const snapshot: ChapterProgressSnapshot = {
      chapterId: activeChapter.id,
      scrollTop: metrics.scrollTop,
      scrollHeight: metrics.scrollHeight,
      clientHeight: metrics.clientHeight,
      percent: Number(percent.toFixed(4)),
      activeElementId: null,
      activeElementIndex: null,
    };

    onChapterProgress(snapshot);
  }, [activeChapter, computeScrollMetrics, onChapterProgress]);

  const scheduleProgressEmit = useCallback(() => {
    if (!activeChapter || !onChapterProgress) {
      return;
    }

    if (progressRafRef.current !== null) {
      cancelAnimationFrame(progressRafRef.current);
    }

    progressRafRef.current = requestAnimationFrame(() => {
      progressRafRef.current = null;
      emitChapterProgress();
    });
  }, [activeChapter, emitChapterProgress, onChapterProgress]);

  useEffect(() => {
    return () => {
      if (progressRafRef.current !== null) {
        cancelAnimationFrame(progressRafRef.current);
        progressRafRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    let lastScrollY = window.scrollY;
    const handleWindowScroll = () => {
      lastScrollY = window.scrollY;
      console.log("Scroll Y:", lastScrollY);

      if (!contentRef.current) {
        return;
      }

      setIsScrolling(true);
      if (scrollActivityTimeoutRef.current !== null) {
        window.clearTimeout(scrollActivityTimeoutRef.current);
      }
      scrollActivityTimeoutRef.current = window.setTimeout(() => {
        scrollActivityTimeoutRef.current = null;
        setIsScrolling(false);
      }, 200);

      scheduleProgressEmit();
    };

    window.addEventListener("scroll", handleWindowScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", handleWindowScroll);
      if (scrollActivityTimeoutRef.current !== null) {
        window.clearTimeout(scrollActivityTimeoutRef.current);
        scrollActivityTimeoutRef.current = null;
      }
      setIsScrolling(false);
    };
  }, [scheduleProgressEmit]);

  useEffect(() => {
    if (!activeChapter || scrollIntent) {
      return;
    }

    const node = contentRef.current;
    if (!node) {
      return;
    }

    const progress = activeBook?.progress;
    const rafId = requestAnimationFrame(() => {
      const metrics = computeScrollMetrics();
      if (!metrics) {
        return;
      }

      const maxScroll = metrics.maxScroll;
      const targetWithinChapter =
        progress && progress.currentChapterId === activeChapter.id
          ? Math.max(Math.min(progress.currentChapterScrollTop, maxScroll), 0)
          : 0;

      if (typeof window !== "undefined") {
        const rectTop = node.getBoundingClientRect().top;
        const nodeDocumentTop = window.scrollY + rectTop;
        window.scrollTo({ top: nodeDocumentTop + targetWithinChapter });
      } else {
        node.scrollTop = targetWithinChapter;
      }
      scheduleProgressEmit();
    });

    return () => cancelAnimationFrame(rafId);
  }, [
    activeBook?.id,
    activeBook?.progress?.updatedAt,
    activeChapter?.id,
    activeChapter?.contentHtml,
    computeScrollMetrics,
    scheduleProgressEmit,
    scrollIntent,
  ]);

  useEffect(() => {
    if (!scrollIntent) {
      return;
    }

    const node = contentRef.current;
    if (!node) {
      onScrollIntentConsumed?.();
      return;
    }

    let rafId: number | null = null;
    let attempts = 0;
    const maxAttempts = 12;
    const tolerance = 1;

    const finalize = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      onScrollIntentConsumed?.();
    };

    const applyIntent = () => {
      const metrics = computeScrollMetrics();
      if (!metrics) {
        finalize();
        return;
      }
      const target = scrollIntent === "bottom" ? metrics.maxScroll : 0;

      if (typeof window !== "undefined") {
        const rectTop = node.getBoundingClientRect().top;
        const nodeDocumentTop = window.scrollY + rectTop;
        window.scrollTo({ top: nodeDocumentTop + target });
      } else {
        node.scrollTop = target;
      }
      scheduleProgressEmit();

      rafId = requestAnimationFrame(() => {
        const verifyMetrics = computeScrollMetrics();
        if (!verifyMetrics) {
          finalize();
          return;
        }

        const reached = Math.abs(verifyMetrics.scrollTop - target) <= tolerance;
        if (reached || attempts >= maxAttempts) {
          finalize();
          return;
        }

        attempts += 1;
        applyIntent();
      });
    };

    applyIntent();

    return () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [
    scrollIntent,
    activeChapter?.id,
    onScrollIntentConsumed,
    scheduleProgressEmit,
    computeScrollMetrics,
  ]);

  useEffect(() => {
    if (!pendingFragment) {
      return;
    }

    const node = contentRef.current;
    if (!node) {
      onFragmentConsumed();
      return;
    }

    const fragment = pendingFragment.replace(/^#/, "");
    const rafId = requestAnimationFrame(() => {
      const selector =
        typeof CSS !== "undefined" && CSS.escape
          ? `#${CSS.escape(fragment)}`
          : `#${fragment}`;
      const chapterRoot =
        node.querySelector<HTMLElement>(
          `[data-reader-chapter-content="true"][data-chapter-id="${activeChapter?.id}"]`,
        ) ?? node;
      const target =
        chapterRoot.querySelector<HTMLElement>(selector) ??
        chapterRoot.querySelector<HTMLElement>(`a[name="${fragment}"]`);

      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        scheduleProgressEmit();
      }

      onFragmentConsumed();
    });

    return () => cancelAnimationFrame(rafId);
  }, [pendingFragment, activeChapter?.id, onFragmentConsumed, scheduleProgressEmit]);

  useEffect(() => {
    scheduleProgressEmit();
  }, [
    activeChapter?.id,
    preferences.fontFamily,
    preferences.fontSize,
    preferences.contentPadding,
    chromeVisible,
    audioPlayerVisible,
    scheduleProgressEmit,
  ]);

  // Handle audio sync highlighting
  useEffect(() => {
    console.debug("[Audio Sync] Effect running:", {
      hasSyncMap: !!activeBook?.audioSyncMap,
      currentAudioTrackHref,
      currentAudioTime,
      hasActiveChapter: !!activeChapter,
      activeChapterHref: activeChapter?.href,
    });

    if (
      !activeBook?.audioSyncMap ||
      !currentAudioTrackHref ||
      typeof currentAudioTime !== "number" ||
      !activeChapter
    ) {
      console.debug("[Audio Sync] Early return - missing prerequisites");
      setHighlightedElementId(null);
      lastHighlightedElementRef.current = null;
      return;
    }

    const segment = findCurrentAudioSegment(
      activeBook.audioSyncMap,
      currentAudioTrackHref,
      currentAudioTime,
    );

    console.debug("[Audio Sync] Segment lookup result:", {
      found: !!segment,
      currentTime: currentAudioTime,
      trackHref: currentAudioTrackHref,
      segment: segment ? {
        elementId: segment.textElementId,
        chapterHref: segment.chapterHref,
        audioTrackHref: segment.audioTrackHref,
        clipBegin: segment.clipBegin,
        clipEnd: segment.clipEnd,
      } : null,
    });

    if (!segment) {
      console.debug("[Audio Sync] No segment found for current time");
      setHighlightedElementId(null);
      lastHighlightedElementRef.current = null;
      return;
    }

    // Only highlight if the segment belongs to the current chapter
    const chapterHref = activeChapter.href.split("#")[0];
    console.debug("[Audio Sync] Chapter comparison:", {
      segmentChapterHref: segment.chapterHref,
      currentChapterHref: chapterHref,
      matches: segment.chapterHref === chapterHref,
    });

    if (segment.chapterHref !== chapterHref) {
      console.debug("[Audio Sync] Segment doesn't match current chapter");
      setHighlightedElementId(null);
      lastHighlightedElementRef.current = null;
      return;
    }

    const elementId = segment.textElementId;
    
    // Log warning when highlighted SMIL segment changes
    if (lastHighlightedElementRef.current !== elementId) {
      console.warn("[Audio Sync] Highlighted SMIL segment changed:", {
        previousElementId: lastHighlightedElementRef.current,
        newElementId: elementId,
        chapterHref: segment.chapterHref,
        audioTrackHref: segment.audioTrackHref,
        clipBegin: segment.clipBegin,
        clipEnd: segment.clipEnd,
        currentTime: currentAudioTime,
        timeInSegment: (currentAudioTime - segment.clipBegin).toFixed(2),
      });
    } else {
      console.debug("[Audio Sync] Same segment, no change:", elementId);
    }
    
    setHighlightedElementId(elementId);
    lastHighlightedElementRef.current = elementId;

    // Scroll to highlighted element if it's not already visible
    const root = contentRef.current;
    if (!root) return;

    const selector =
      typeof CSS !== "undefined" && CSS.escape
        ? `#${CSS.escape(elementId)}`
        : `#${elementId}`;
    const element = root.querySelector<HTMLElement>(selector);

    if (element) {
      const rect = element.getBoundingClientRect();
      const isVisible =
        rect.top >= 0 &&
        rect.left >= 0 &&
        rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
        rect.right <= (window.innerWidth || document.documentElement.clientWidth);

      if (!isVisible) {
        element.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }, [
    activeBook?.audioSyncMap,
    currentAudioTrackHref,
    currentAudioTime,
    activeChapter?.id,
    activeChapter?.href,
  ]);

  // Apply highlighting styles to elements
  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;

    // Remove previous highlighting
    const previousHighlighted = root.querySelectorAll(".audio-highlight");
    previousHighlighted.forEach((el) => {
      el.classList.remove("audio-highlight");
    });

    // Apply new highlighting
    if (highlightedElementId) {
      const selector =
        typeof CSS !== "undefined" && CSS.escape
          ? `#${CSS.escape(highlightedElementId)}`
          : `#${highlightedElementId}`;
      const element = root.querySelector<HTMLElement>(selector);
      if (element) {
        element.classList.add("audio-highlight");
      }
    }
  }, [highlightedElementId]);

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
    });
  };

  const handleNext = () => {
    if (!nextChapter) return;
    requestChapterChange(nextChapter.id, {
      preserveChrome: true,
      scrollPosition: "top",
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
  }, [activeBook, onSelectChapter, activeChapter?.id]);

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
        data-reader-scrolling={isScrolling ? "true" : "false"}
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
            data-reader-chapter-root="true"
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
              data-reader-chapter-content="true"
              data-chapter-id={activeChapter.id}
              className=""
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


