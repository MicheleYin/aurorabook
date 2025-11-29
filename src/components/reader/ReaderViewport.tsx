import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";

import { cn } from "../../lib/utils";
import { anim, animPatterns } from "../../lib/animations";
import { findCurrentAudioSegment } from "../../lib/epub";
import { computeScrollMetrics, computeWindowScrollMetrics, restoreScrollPosition, restoreWindowScrollPosition, scrollToElement } from "../../lib/scroll-utils";
import { usePrevious } from "../../hooks/usePrevious";
import { useLibrary } from "../../hooks/useLibrary";
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
import React from "react";
import type { ReaderTheme, Chapter } from "../../types/reader";
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
    restoreRafId: null as number | null,
    scrollIntentRafId: null as number | null,
    restoreTimeout: null as number | null,
    cancelled: false,
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
    restoredBookId: null as string | null,
  });
  
  const [isScrolling, setIsScrolling] = useState(false);
  const [highlightedElementId, setHighlightedElementId] = useState<string | null>(null);
  const [chapterTransitionDirection, setChapterTransitionDirection] = useState<"left" | "right" | "fade" | null>(null);
  
  // useChapterProgress is now accessed via useLibrary hook - must be called before useEffect
  const libraryHook = useLibrary();
  const { setLibrary, library } = libraryHook;
  
  // Chapter content is now loaded lazily - load it if missing
  const [loadedChapter, setLoadedChapter] = useState<Chapter | undefined>(undefined);
  const [isLoadingChapter, setIsLoadingChapter] = useState(false);
  
  // Always use activeChapter as base, but prefer loadedChapter if it has content
  const displayChapter = (loadedChapter?.id === activeChapter?.id && loadedChapter?.contentHtml) 
    ? loadedChapter 
    : activeChapter || null;

  // Use usePrevious hook for chapter tracking
  const previousChapterId = usePrevious(activeChapter?.id);
  
  // Track the current loading request to prevent race conditions
  const loadingRequestRef = useRef<{ bookId: string; chapterId: string } | null>(null);
  const isLoadingRef = useRef(false);
  
  // Lazy load chapter content when needed
  useEffect(() => {
    if (!activeChapter || !activeBook) {
      setLoadedChapter(undefined);
      setIsLoadingChapter(false);
      isLoadingRef.current = false;
      loadingRequestRef.current = null;
      return;
    }
    
    const currentBookId = activeBook.id;
    const currentChapterId = activeChapter.id;
    
    // If chapter already has content, we're done
    if (activeChapter.contentHtml && activeChapter.plainText) {
      setLoadedChapter(activeChapter);
      setIsLoadingChapter(false);
      isLoadingRef.current = false;
      loadingRequestRef.current = null;
      return;
    }
    
    // Check if this chapter is already loaded in the library
    const bookInLibrary = library.find((b) => b.id === currentBookId);
    const chapterInLibrary = bookInLibrary?.chapters.find((ch) => ch.id === currentChapterId);
    if (chapterInLibrary?.contentHtml && chapterInLibrary?.plainText) {
      setLoadedChapter(chapterInLibrary);
      setIsLoadingChapter(false);
      isLoadingRef.current = false;
      loadingRequestRef.current = null;
      return;
    }
    
    // Don't reload if we're already loading this exact chapter
    if (isLoadingRef.current && 
        loadingRequestRef.current?.bookId === currentBookId &&
        loadingRequestRef.current?.chapterId === currentChapterId) {
      return;
    }
    
    // Mark that we're starting a new load
    loadingRequestRef.current = { bookId: currentBookId, chapterId: currentChapterId };
    isLoadingRef.current = true;
    
    // Load the chapter content
    setIsLoadingChapter(true);
    let isCancelled = false;
    
    ensureChapterLoaded(currentBookId, activeChapter)
      .then((loaded) => {
        // Check if this request is still valid
        if (isCancelled) {
          return;
        }
        
        // Only update if this is still the active chapter and this is the current request
        if (loaded && 
            loaded.id === currentChapterId &&
            loadingRequestRef.current?.bookId === currentBookId &&
            loadingRequestRef.current?.chapterId === currentChapterId) {
          setLoadedChapter(loaded);
          setIsLoadingChapter(false);
          isLoadingRef.current = false;
          
          // Update library state with loaded chapter only if it's not already there
          // This ensures the chapter content persists in the library without unnecessary updates
          setLibrary((prevLibrary) => {
            const book = prevLibrary.find((b) => b.id === currentBookId);
            if (!book) return prevLibrary;
            
            const existingChapter = book.chapters.find((ch) => ch.id === loaded.id);
            // Only update if chapter doesn't have content or content is different
            if (!existingChapter?.contentHtml || existingChapter.contentHtml !== loaded.contentHtml) {
              return prevLibrary.map((b) => {
                if (b.id === currentBookId) {
                  return {
                    ...b,
                    chapters: b.chapters.map((ch) =>
                      ch.id === loaded.id ? loaded : ch
                    ),
                  };
                }
                return b;
              });
            }
            return prevLibrary;
          });
        } else {
          // Request is stale, just clear loading state
          setIsLoadingChapter(false);
          isLoadingRef.current = false;
        }
        loadingRequestRef.current = null;
      })
      .catch((error) => {
        if (isCancelled) {
          return;
        }
        console.error("[ReaderViewport] Failed to load chapter content:", error);
        setIsLoadingChapter(false);
        isLoadingRef.current = false;
        setLoadedChapter(undefined);
        loadingRequestRef.current = null;
      });
    
    // Cleanup function to cancel the request if component unmounts or dependencies change
    return () => {
      isCancelled = true;
      setIsLoadingChapter(false);
      isLoadingRef.current = false;
      // Don't clear loadingRequestRef here - let the next effect handle it
    };
  }, [activeChapter?.id, activeBook?.id, setLibrary, library]);

  const {
    updateMetricsOnScroll,
  } = libraryHook.useChapterProgress({
    activeChapter: displayChapter ?? activeChapter ?? null,
    contentRef: contentRef as React.RefObject<HTMLElement>,
    onProgress: onChapterProgress ? (snapshot: ChapterProgressSnapshot) => {
      onChapterProgress(snapshot);
    } : undefined,
    onSaveProgress,
    isRestoringScroll: scrollRestoreStateRef.current.isRestoring,
  });

  if (!activeChapter) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="text-muted-foreground">No chapter selected</div>
      </div>
    );
  }
  
  // Ensure we have a displayChapter (fallback to activeChapter)
  const chapterToDisplay = displayChapter || activeChapter;

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

  // // Track scrollTop changes - window is scrolling, not the container
  // useEffect(() => {
  //   const node = contentRef.current;
    
  //   // Check both window and container scroll
  //   const handleWindowScroll = () => {
  //     const windowScrollY = window.scrollY;
  //     const documentScrollTop = document.documentElement.scrollTop;
  //     const bodyScrollTop = document.body.scrollTop;
      
  //     // Also check the container in case it's also scrolling
  //     const containerScrollTop = node?.scrollTop ?? 0;
  //     const containerScrollHeight = node?.scrollHeight ?? 0;
  //     const containerClientHeight = node?.clientHeight ?? 0;
  //     const containerMaxScroll = containerScrollHeight - containerClientHeight;
  //     const containerPercent = containerMaxScroll > 0 ? containerScrollTop / containerMaxScroll : 0;
      
  //     // Calculate window-based metrics
  //     const windowMaxScroll = Math.max(
  //       document.documentElement.scrollHeight - window.innerHeight,
  //       document.body.scrollHeight - window.innerHeight,
  //       0
  //     );
  //     const windowPercent = windowMaxScroll > 0 ? windowScrollY / windowMaxScroll : 0;

  //     console.log("[ReaderViewport] scrollTop changed (window scroll)", {
  //       windowScrollY,
  //       documentScrollTop,
  //       bodyScrollTop,
  //       windowMaxScroll,
  //       windowPercent: Number(windowPercent.toFixed(4)),
  //       containerScrollTop,
  //       containerScrollHeight,
  //       containerClientHeight,
  //       containerMaxScroll,
  //       containerPercent: Number(containerPercent.toFixed(4)),
  //       chapterId: activeChapter?.id,
  //     });
  //   };

  //   // Listen to window scroll events (this is what's actually scrolling)
  //   window.addEventListener("scroll", handleWindowScroll, { passive: true });
    
    
  // }, [activeChapter?.id]);

  // Unified scroll management: listener setup, restoration, and intent handling
  useEffect(() => {
    const node = contentRef.current;
    if (!node) return;

    // Cancel any existing restoration loops before starting new ones
    if (scrollStateRef.current.restoreTimeout !== null) {
      clearTimeout(scrollStateRef.current.restoreTimeout);
      scrollStateRef.current.restoreTimeout = null;
    }
    if (scrollStateRef.current.restoreRafId !== null) {
      cancelAnimationFrame(scrollStateRef.current.restoreRafId);
      scrollStateRef.current.restoreRafId = null;
    }
    if (scrollStateRef.current.scrollIntentRafId !== null) {
      cancelAnimationFrame(scrollStateRef.current.scrollIntentRafId);
      scrollStateRef.current.scrollIntentRafId = null;
    }
    if (scrollStateRef.current.rafId !== null) {
      cancelAnimationFrame(scrollStateRef.current.rafId);
      scrollStateRef.current.rafId = null;
    }

    // Setup scroll listener for UI state tracking
    node.addEventListener("scroll", handleScroll, { passive: true });

    // Handle scroll intent (top/bottom) - takes priority over restoration
    if (scrollIntent) {
      scrollStateRef.current.cancelled = false;
      
      let attemptCount = 0;
      const maxAttempts = 50; // ~3 seconds at 60fps
      
      const attemptScrollIntent = () => {
        if (scrollStateRef.current.cancelled) return;
        
        // Try both container and window to see which is scrollable
        const containerMetrics = computeScrollMetrics(node);
        const windowMetrics = computeWindowScrollMetrics();
        
        // Use whichever is actually scrollable (prefer container if both are)
        const useContainer = containerMetrics && containerMetrics.maxScroll > 0;
        const useWindow = !useContainer && windowMetrics && windowMetrics.maxScroll > 0;
        
        const metrics = useContainer ? containerMetrics : (useWindow ? windowMetrics : null);
        
        // Wait for content to be loaded and scrollable
        if (!metrics || !metrics.maxScroll) {
          attemptCount++;
          if (attemptCount < maxAttempts) {
            const nextRafId = requestAnimationFrame(attemptScrollIntent);
            scrollStateRef.current.rafId = nextRafId;
            return;
          } else {
            // Give up after max attempts
            onScrollIntentConsumed?.();
            return;
          }
        }

        const target = scrollIntent === "bottom" ? metrics.maxScroll : 0;
        
        // Scroll the appropriate container
        if (useContainer && node) {
          node.scrollTo({ top: target, behavior: "smooth" });
        } else if (useWindow) {
          window.scrollTo({ top: target, behavior: "smooth" });
        } else {
          onScrollIntentConsumed?.();
          return;
        }

        const checkComplete = () => {
          if (scrollStateRef.current.cancelled) return;
          
          // Check the same container we scrolled
          const currentMetrics = useContainer 
            ? computeScrollMetrics(node)
            : (useWindow ? computeWindowScrollMetrics() : null);
            
          if (currentMetrics && Math.abs(currentMetrics.scrollTop - target) <= 5) {
            onScrollIntentConsumed?.();
            scrollStateRef.current.scrollIntentRafId = null;
          } else {
            const nextRafId = requestAnimationFrame(checkComplete);
            scrollStateRef.current.scrollIntentRafId = nextRafId;
          }
        };

        setTimeout(() => {
          if (!scrollStateRef.current.cancelled) {
            const nextRafId = requestAnimationFrame(checkComplete);
            scrollStateRef.current.scrollIntentRafId = nextRafId;
          }
        }, 100);
      };
      
      // Add a small delay to allow content to render
      setTimeout(() => {
        if (!scrollStateRef.current.cancelled) {
          const initialRafId = requestAnimationFrame(attemptScrollIntent);
          scrollStateRef.current.rafId = initialRafId;
        }
      }, 50);
    }

    // Reset restoration state when book changes
    if (activeBook && scrollRestoreStateRef.current.restoredBookId !== activeBook.id) {
      scrollRestoreStateRef.current.restoredBookId = activeBook.id;
      scrollRestoreStateRef.current.restoredChapterId = null;
    }

    // Restore scroll position when chapter loads (only if no scroll intent)
    // Check if chapter content is loaded before attempting restoration
    const chapterHasContent = displayChapter?.contentHtml || activeChapter?.contentHtml;
    if (!scrollIntent && activeChapter && activeBook?.progress && chapterHasContent) {
      if (scrollRestoreStateRef.current.restoredChapterId !== activeChapter.id) {
        const progress = activeBook.progress;
        if (progress.currentChapterId === activeChapter.id) {
          // Store chapter ID in ref to prevent stale closures
          const targetChapterId = activeChapter.id;
          scrollRestoreStateRef.current.isRestoring = true;
          scrollStateRef.current.cancelled = false;

          let attemptCount = 0;
          const maxAttempts = 100; // ~6 seconds at 60fps (increased to allow more time for layout)
          
          // Add a small delay before starting restoration to allow CSS/layout to settle
          scrollStateRef.current.restoreTimeout = window.setTimeout(() => {
            if (scrollStateRef.current.cancelled || activeChapter?.id !== targetChapterId) {
              scrollRestoreStateRef.current.isRestoring = false;
              scrollStateRef.current.restoreRafId = null;
              return;
            }
            
            const attemptRestore = () => {
              // Check if cancelled or chapter changed before proceeding
              if (scrollStateRef.current.cancelled || activeChapter?.id !== targetChapterId) {
                scrollRestoreStateRef.current.isRestoring = false;
                scrollStateRef.current.restoreRafId = null;
                return;
              }
              
              // Try both container and window scroll metrics to see which one is actually scrollable
              const containerMetrics = computeScrollMetrics(node);
              const windowMetrics = computeWindowScrollMetrics();
              
              // Determine which scroll container is actually being used
              // Prefer container if it's scrollable, otherwise use window
              const useContainer = containerMetrics && containerMetrics.maxScroll > 0;
              const useWindow = !useContainer && windowMetrics && windowMetrics.maxScroll > 0;
              
              const metrics = useContainer ? containerMetrics : (useWindow ? windowMetrics : null);
              
              // Wait for content to be rendered and at least one scroll container to be scrollable
              const hasContent = metrics && metrics.scrollHeight > 0;
              const isScrollable = metrics && metrics.maxScroll > 0;
              
              if (!hasContent || !isScrollable) {
                attemptCount++;
                if (attemptCount < maxAttempts) {
                  const nextRafId = requestAnimationFrame(attemptRestore);
                  scrollStateRef.current.restoreRafId = nextRafId;
                } else {
                  console.warn("[ReaderViewport] Failed to restore scroll - content not loaded or no scrollable container after max attempts", {
                    containerScrollHeight: containerMetrics?.scrollHeight ?? 0,
                    containerClientHeight: containerMetrics?.clientHeight ?? 0,
                    containerMaxScroll: containerMetrics?.maxScroll ?? 0,
                    windowScrollHeight: windowMetrics?.scrollHeight ?? 0,
                    windowClientHeight: windowMetrics?.clientHeight ?? 0,
                    windowMaxScroll: windowMetrics?.maxScroll ?? 0,
                    chapterId: targetChapterId,
                    useContainer,
                    useWindow,
                  });
                  scrollRestoreStateRef.current.isRestoring = false;
                  scrollRestoreStateRef.current.restoredChapterId = targetChapterId;
                  scrollStateRef.current.restoreRafId = null;
                }
                return;
              }

              // Attempt to restore scroll position using the appropriate container
              let restored = false;
              if (useContainer && containerMetrics) {
                restored = restoreScrollPosition(node, {
                  scrollTop: progress.currentChapterScrollTop,
                  scrollHeight: progress.currentChapterScrollHeight,
                  clientHeight: progress.currentChapterClientHeight,
                  percent: progress.chapterProgressPercent,
                });
              } else if (useWindow && windowMetrics) {
                restored = restoreWindowScrollPosition({
                  scrollTop: progress.currentChapterScrollTop,
                  scrollHeight: progress.currentChapterScrollHeight,
                  clientHeight: progress.currentChapterClientHeight,
                  percent: progress.chapterProgressPercent,
                });
              }

              if (restored) {
                console.log("[ReaderViewport] Successfully restored scroll position", {
                  chapterId: targetChapterId,
                  scrollTop: progress.currentChapterScrollTop,
                  percent: progress.chapterProgressPercent,
                  restoredScrollTop: metrics.scrollTop,
                  container: useContainer ? "container" : "window",
                });
                scrollRestoreStateRef.current.isRestoring = false;
                scrollRestoreStateRef.current.restoredChapterId = targetChapterId;
                scrollStateRef.current.restoreRafId = null;
              } else {
                // Restoration failed - retry if we haven't exceeded max attempts
                attemptCount++;
                if (attemptCount < maxAttempts) {
                  const nextRafId = requestAnimationFrame(attemptRestore);
                  scrollStateRef.current.restoreRafId = nextRafId;
                } else {
                  console.warn("[ReaderViewport] Failed to restore scroll position after max attempts", {
                    chapterId: targetChapterId,
                    savedScrollTop: progress.currentChapterScrollTop,
                    savedPercent: progress.chapterProgressPercent,
                    currentMaxScroll: metrics.maxScroll,
                    currentScrollTop: metrics.scrollTop,
                    container: useContainer ? "container" : (useWindow ? "window" : "none"),
                  });
                  scrollRestoreStateRef.current.isRestoring = false;
                  scrollRestoreStateRef.current.restoredChapterId = targetChapterId;
                  scrollStateRef.current.restoreRafId = null;
                }
              }
            };

            const initialRafId = requestAnimationFrame(attemptRestore);
            scrollStateRef.current.restoreRafId = initialRafId;
            scrollStateRef.current.restoreTimeout = null;
          }, 100); // Wait 100ms for layout to settle before starting restoration
        }
      }
    } else if (!activeChapter || scrollIntent) {
      scrollRestoreStateRef.current.restoredChapterId = null;
    }

    return () => {
      node.removeEventListener("scroll", handleScroll);
      
      // Mark as cancelled to stop any running RAF loops
      scrollStateRef.current.cancelled = true;
      
      // Cleanup timeouts and RAF
      if (scrollStateRef.current.restoreTimeout !== null) {
        clearTimeout(scrollStateRef.current.restoreTimeout);
        scrollStateRef.current.restoreTimeout = null;
      }
      if (scrollStateRef.current.activityTimeout !== null) {
        clearTimeout(scrollStateRef.current.activityTimeout);
        scrollStateRef.current.activityTimeout = null;
      }
      if (scrollStateRef.current.rafId !== null) {
        cancelAnimationFrame(scrollStateRef.current.rafId);
        scrollStateRef.current.rafId = null;
      }
      if (scrollStateRef.current.restoreRafId !== null) {
        cancelAnimationFrame(scrollStateRef.current.restoreRafId);
        scrollStateRef.current.restoreRafId = null;
      }
      if (scrollStateRef.current.scrollIntentRafId !== null) {
        cancelAnimationFrame(scrollStateRef.current.scrollIntentRafId);
        scrollStateRef.current.scrollIntentRafId = null;
      }
      
      setIsScrolling(false);
    };
  }, [
    handleScroll,
    scrollIntent,
    activeChapter?.id,
    activeBook?.id,
    activeBook?.progress?.currentChapterId,
    activeBook?.progress?.currentChapterScrollTop,
    displayChapter?.contentHtml,
    activeChapter?.contentHtml,
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
            id={chapterToDisplay.id}
            data-chapter-id={chapterToDisplay.id}
            data-reader-chapter-root="true"
            key={chapterToDisplay.id}
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
            <h2 className="text-2xl font-semibold">{chapterToDisplay.title}</h2>
            {isLoadingChapter ? (
              <div className="flex items-center justify-center py-12">
                <div className="text-muted-foreground">Loading chapter content...</div>
              </div>
            ) : chapterToDisplay.contentHtml ? (
              <div
                data-reader-chapter-content="true"
                data-chapter-id={chapterToDisplay.id}
                className="animate-in fade-in duration-300"
                dangerouslySetInnerHTML={{
                  __html: chapterToDisplay.contentHtml,
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
