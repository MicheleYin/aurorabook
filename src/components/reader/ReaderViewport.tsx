import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { Loader2 } from "lucide-react";

import { cn } from "../../lib/utils";
import { anim, animPatterns } from "../../lib/animations";
import { findCurrentAudioSegment } from "../../lib/epub";
import { ensureChapterLoaded } from "../../lib/lazy-chapter-loader";
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
  const showAudioPlayer = audioPlayerVisible;
  const lastHighlightedElementRef = useRef<string | null>(null);
  const lastScrolledElementRef = useRef<string | null>(null);
  const previousChapterIdRef = useRef<string | undefined>(activeChapter?.id);
  const highlightEnterTimeoutRef = useRef<number | null>(null);

  // Lazy load chapter content when needed
  useEffect(() => {
    if (!activeBook || !activeChapter) {
      setLoadedChapter(null);
      return;
    }

    // If chapter already has content, use it directly
    if (activeChapter.contentHtml && activeChapter.plainText) {
      setLoadedChapter(activeChapter);
      return;
    }

    // Load chapter content lazily
    setIsLoadingChapter(true);
    ensureChapterLoaded(activeBook.sourcePath, activeChapter)
      .then((loaded) => {
        setLoadedChapter(loaded);
        setIsLoadingChapter(false);
        
        // Update the chapter in the library if needed
        // This ensures the loaded content is available for future use
        if (activeBook && loaded.contentHtml && loaded.plainText) {
          // The chapter is now loaded and cached
        }
      })
      .catch((error) => {
        console.error("Failed to load chapter", error);
        setIsLoadingChapter(false);
        // Keep the chapter even if loading failed
        setLoadedChapter(activeChapter);
      });
  }, [activeBook?.sourcePath, activeChapter?.id, activeChapter?.href]);

  // Use loaded chapter if available, otherwise fall back to activeChapter
  const displayChapter = loadedChapter || activeChapter;
  
  // Early return if no chapter is available
  if (!displayChapter || !activeChapter) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="text-muted-foreground">No chapter selected</div>
      </div>
    );
  }

  const computeScrollMetrics = useCallback(() => {
    const node = contentRef.current;
    if (!node) {
      return null;
    }

    const scrollHeight = Math.max(node.scrollHeight, 0);
    const clientHeight = Math.max(node.clientHeight, 0);
    const maxScroll = Math.max(scrollHeight - clientHeight, 0);
    const scrollTop = Math.min(Math.max(node.scrollTop, 0), maxScroll);

    return { scrollTop, scrollHeight, clientHeight, maxScroll };
  }, []);

  const emitChapterProgress = useCallback(() => {
    const chapter = displayChapter || activeChapter;
    if (!chapter || !onChapterProgress) {
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
      chapterId: chapter.id,
      scrollTop: metrics.scrollTop,
      scrollHeight: metrics.scrollHeight,
      clientHeight: metrics.clientHeight,
      percent: Number(percent.toFixed(4)),
      activeElementId: null,
      activeElementIndex: null,
    };

    onChapterProgress(snapshot);
  }, [displayChapter, activeChapter, computeScrollMetrics, onChapterProgress]);

  const scheduleProgressEmit = useCallback(() => {
    if (!activeChapter || !onChapterProgress) {
      return;
    }

    // Debounce progress emissions to reduce state sync calls
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
    }, 150); // Debounce by 150ms
  }, [activeChapter, emitChapterProgress, onChapterProgress]);

  useEffect(() => {
    return () => {
      if (progressRafRef.current !== null) {
        cancelAnimationFrame(progressRafRef.current);
        progressRafRef.current = null;
      }
      if (progressDebounceTimeoutRef.current !== null) {
        clearTimeout(progressDebounceTimeoutRef.current);
        progressDebounceTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const node = contentRef.current;
    if (!node) {
      return;
    }

    const handleScroll = () => {
      setIsScrolling(true);
      if (scrollActivityTimeoutRef.current !== null) {
        clearTimeout(scrollActivityTimeoutRef.current);
      }
      scrollActivityTimeoutRef.current = window.setTimeout(() => {
        scrollActivityTimeoutRef.current = null;
        setIsScrolling(false);
      }, 200);

      scheduleProgressEmit();
    };

    node.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      node.removeEventListener("scroll", handleScroll);
      if (scrollActivityTimeoutRef.current !== null) {
        clearTimeout(scrollActivityTimeoutRef.current);
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

      node.scrollTop = targetWithinChapter;
      scheduleProgressEmit();
    });

    return () => cancelAnimationFrame(rafId);
  }, [
    activeBook?.id,
    activeBook?.progress?.updatedAt,
    displayChapter?.id,
    displayChapter?.contentHtml,
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

    const rafId = requestAnimationFrame(() => {
      const metrics = computeScrollMetrics();
      if (!metrics) {
        onScrollIntentConsumed?.();
        return;
      }
      
      const target = scrollIntent === "bottom" ? metrics.maxScroll : 0;
      node.scrollTo({ top: target, behavior: "smooth" });
      
      // Wait for smooth scroll to complete before emitting progress
      const checkComplete = () => {
        const currentMetrics = computeScrollMetrics();
        if (currentMetrics && Math.abs(currentMetrics.scrollTop - target) <= 5) {
          scheduleProgressEmit();
          onScrollIntentConsumed?.();
        } else {
          requestAnimationFrame(checkComplete);
        }
      };
      
      setTimeout(() => {
        checkComplete();
      }, 100);
    });

    return () => cancelAnimationFrame(rafId);
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
        // Delay progress emit to allow scroll to complete
        setTimeout(() => {
          scheduleProgressEmit();
        }, 300);
      }

      onFragmentConsumed();
    });

    return () => cancelAnimationFrame(rafId);
  }, [pendingFragment, activeChapter?.id, onFragmentConsumed, scheduleProgressEmit]);

  // Only emit progress on chapter change, not on preference/visibility changes
  useEffect(() => {
    if (activeChapter?.id) {
      scheduleProgressEmit();
    }
  }, [activeChapter?.id, scheduleProgressEmit]);

  // Reset scroll tracking when chapter changes
  useEffect(() => {
    lastScrolledElementRef.current = null;
  }, [activeChapter?.id]);

  // Handle chapter transitions
  useEffect(() => {
    if (!activeChapter?.id || !previousChapterIdRef.current) {
      previousChapterIdRef.current = activeChapter?.id;
      return;
    }

    if (previousChapterIdRef.current !== activeChapter.id) {
      // Determine transition direction based on chapter order
      if (activeBook) {
        const prevIndex = activeBook.chapters.findIndex(ch => ch.id === previousChapterIdRef.current);
        const currentIndex = activeBook.chapters.findIndex(ch => ch.id === activeChapter.id);
        
        if (prevIndex !== -1 && currentIndex !== -1) {
          if (currentIndex > prevIndex) {
            // Moving forward - slide left
            setChapterTransitionDirection("left");
          } else {
            // Moving backward - slide right
            setChapterTransitionDirection("right");
          }
        } else {
          setChapterTransitionDirection("fade");
        }
      } else {
        setChapterTransitionDirection("fade");
      }

      const timer = setTimeout(() => {
        setChapterTransitionDirection(null);
      }, 300); // Match animation duration

      previousChapterIdRef.current = activeChapter.id;
      return () => clearTimeout(timer);
    }
  }, [activeChapter?.id, activeBook]);

  // Save scroll position when audio player closes
  const previousAudioPlayerVisibleRef = useRef(audioPlayerVisible);
  useEffect(() => {
    // When audio player transitions from visible to hidden, save scroll position
    if (previousAudioPlayerVisibleRef.current && !audioPlayerVisible && activeChapter && onChapterProgress) {
      // Small delay to ensure any pending audio progress is saved first
      const timer = setTimeout(() => {
        scheduleProgressEmit();
      }, 150);
      previousAudioPlayerVisibleRef.current = audioPlayerVisible;
      return () => clearTimeout(timer);
    }
    previousAudioPlayerVisibleRef.current = audioPlayerVisible;
  }, [audioPlayerVisible, activeChapter, onChapterProgress, scheduleProgressEmit]);

  // Handle audio sync highlighting
  useEffect(() => {
    console.debug("[Audio Sync] Effect running:", {
      hasSyncMap: !!activeBook?.audioSyncMap,
      currentAudioTrackHref,
      currentAudioTime,
      hasActiveChapter: !!activeChapter,
      activeChapterHref: activeChapter?.href,
      isAudioRestoring,
      showAudioPlayer,
    });

    // Wait for audio restoration to complete before syncing scroll
    if (isAudioRestoring) {
      console.debug("[Audio Sync] Waiting for audio restoration to complete");
      return;
    }

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
      lastScrolledElementRef.current = null; // Reset scroll tracking when no segment
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
      console.debug("[Audio Sync] Segment doesn't match current chapter", {
        segmentChapterHref: segment.chapterHref,
        currentChapterHref: chapterHref,
      });
      setHighlightedElementId(null);
      lastHighlightedElementRef.current = null;
      lastScrolledElementRef.current = null; // Reset scroll tracking when chapter changes
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

    // Only scroll if this is a new element (not already scrolled to)
    const shouldScroll = element && autoScrollEnabled && lastScrolledElementRef.current !== elementId;

    if (shouldScroll) {
      // Check if element is already visible in the viewport (especially in bottom portion)
      const elementRect = element.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const viewportBottom = viewportHeight;
      
      // Consider element visible if it's in the bottom 70% of the viewport
      // This prevents scrolling when element is already near the bottom
      const visibleThreshold = viewportHeight * 0.7;
      const isInBottomPortion = elementRect.top >= 0 && 
                                 elementRect.top <= visibleThreshold &&
                                 elementRect.bottom <= viewportBottom;
      
      if (isInBottomPortion) {
        console.debug("[Auto-Scroll] Element already visible in bottom portion, skipping scroll:", {
          elementId,
          elementTop: elementRect.top,
          viewportHeight,
          visibleThreshold,
        });
        // Mark as scrolled even though we didn't scroll, to prevent repeated checks
        lastScrolledElementRef.current = elementId;
        return;
      }
      
      // Mark this element as scrolled to prevent multiple scrolls
      lastScrolledElementRef.current = elementId;
      
      // Use native scrollIntoView for simplicity
      element.scrollIntoView({ behavior: "smooth", block: "start" });
    } else if (element && !autoScrollEnabled) {
      console.debug("[Auto-Scroll] Auto-scroll disabled, skipping scroll to:", elementId);
    } else if (element && lastScrolledElementRef.current === elementId) {
      console.debug("[Auto-Scroll] Already scrolled to this element, skipping:", elementId);
    } else if (!element) {
      console.warn("[Auto-Scroll] Element not found:", selector, "in root:", root);
    }
  }, [
    activeBook?.audioSyncMap,
    currentAudioTrackHref,
    currentAudioTime,
    activeChapter?.id,
    activeChapter?.href,
    autoScrollEnabled,
    isAudioRestoring,
    showAudioPlayer, // Re-run when audio player becomes visible to ensure sync on first load
  ]);

  // Apply highlighting styles to elements with smooth transitions
  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;

    // Clear any pending enter timeout
    if (highlightEnterTimeoutRef.current !== null) {
      clearTimeout(highlightEnterTimeoutRef.current);
      highlightEnterTimeoutRef.current = null;
    }

    const previousHighlightedId = lastHighlightedElementRef.current;
    const isNewHighlight = highlightedElementId !== previousHighlightedId;
    const exitTimeouts: number[] = [];

    // First, remove ALL existing highlights (in case multiple are somehow highlighted)
    const allHighlighted = root.querySelectorAll(".audio-highlight, .audio-highlight-enter, .audio-highlight-active");
    allHighlighted.forEach((el) => {
      const element = el as HTMLElement;
      // Skip if this is the element we're about to highlight
      if (highlightedElementId && element.id === highlightedElementId) {
        return;
      }
      
      // Remove modifier classes but keep base class for exit animation
      element.classList.remove("audio-highlight-enter", "audio-highlight-active");
      
      // Ensure base class exists for exit animation
      if (!element.classList.contains("audio-highlight")) {
        element.classList.add("audio-highlight");
      }
      
      // Add exit animation class
      element.classList.add("audio-highlight-exit");
      
      // Remove all highlight classes after exit animation completes
      const exitTimeout = window.setTimeout(() => {
        element.classList.remove("audio-highlight", "audio-highlight-exit");
      }, 200); // Match animation duration
      
      exitTimeouts.push(exitTimeout);
    });

    // Apply new highlighting with animations
    if (highlightedElementId) {
      const selector =
        typeof CSS !== "undefined" && CSS.escape
          ? `#${CSS.escape(highlightedElementId)}`
          : `#${highlightedElementId}`;
      const element = root.querySelector<HTMLElement>(selector);
      
      if (element) {
        // Remove any existing exit animation first
        element.classList.remove("audio-highlight-exit");
        
        // Remove any existing modifier classes
        element.classList.remove("audio-highlight-enter", "audio-highlight-active");
        
        // Add base highlight class
        element.classList.add("audio-highlight");
        
        // If this is a new highlight (different from previous), add enter animation
        if (isNewHighlight) {
          // Small delay to ensure DOM is ready and exit animation can start first
          requestAnimationFrame(() => {
            element.classList.add("audio-highlight-enter");
            
            // After enter animation completes, switch to active state
            highlightEnterTimeoutRef.current = window.setTimeout(() => {
              element.classList.remove("audio-highlight-enter");
              element.classList.add("audio-highlight-active");
            }, 200); // Match fade-in animation duration
          });
        } else {
          // If same element, just ensure active state
          element.classList.add("audio-highlight-active");
        }
      }
    }

    // Update ref for next comparison
    lastHighlightedElementRef.current = highlightedElementId;

    // Cleanup function
    return () => {
      if (highlightEnterTimeoutRef.current !== null) {
        clearTimeout(highlightEnterTimeoutRef.current);
        highlightEnterTimeoutRef.current = null;
      }
      exitTimeouts.forEach(timeout => clearTimeout(timeout));
    };
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
          // Visual indicator when auto-scroll is active (with smooth transition)
          autoScrollEnabled && "auto-scroll-active",
          // Smooth transition when auto-scroll is toggled
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
            showAudioPlayer && "pb-32",
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
              // Chapter transition animation
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


