/**
 * Chapter state hook - simplified version
 * Manages chapter index and restoration state based on progress from library
 * No useEffects - initialization is explicit
 */

import { useCallback, useRef, useState } from "react";
import { logger } from "../../lib/logger";
import { useContext } from "react";
import { ReaderCoordinatorContext } from "../../contexts/ReaderCoordinatorContext";
import { findScrollableContainer } from "../../lib/scroll-utils";
import type { Book, Chapter } from "../../types/reader";

type UseChapterStateParams = {
  bookId?: string;
  chapters: Chapter[];
  library: Book[];
  onProgress?: (snapshot: {
    chapterId: string;
    chapterHref: string;
    chapterIndex: number;
    scrollTop?: number;
    percent?: number;
    elementIndex?: number;
    updatedAt?: string;
  }) => void;
};

const PROGRESS_ECHO_TOLERANCE_PERCENT = 0.01; // 1% tolerance

export function useChapterState(params: UseChapterStateParams) {
  const { bookId, chapters, library, onProgress } = params;
  // Get coordinator for operation management (optional - may not be available at library level)
  const coordinator = useContext(ReaderCoordinatorContext); // May be null if provider isn't available
  
  // Get progress from library (single source of truth)
  // Note: Progress is read fresh from library in initialize() callback

  const [currentIndex, setCurrentIndexState] = useState(0);
  const [restoreScrollTop, setRestoreScrollTop] = useState<number | null>(null);
  const [restoreElementIndex, setRestoreElementIndex] = useState<number | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);

  const currentIndexRef = useRef(0);
  const onProgressRef = useRef(onProgress);
  const chaptersRef = useRef(chapters);
  const isRestoringRef = useRef(false);
  const restoreScrollTopRef = useRef<number | null>(null);
  const restoreElementIndexRef = useRef<number | null>(null);
  const restorationAppliedRef = useRef<string | null>(null);
  const lastProgressSnapshotRef = useRef<{
    chapterId?: string;
    chapterHref?: string;
    chapterIndex?: number;
    scrollTop?: number;
    percent?: number;
    elementIndex?: number;
    updatedAt?: string;
    timestamp: number;
  }>({ timestamp: 0 });
  const initializedRef = useRef<string | undefined>(undefined);

  // Update refs when props change
  onProgressRef.current = onProgress;
  chaptersRef.current = chapters;
  currentIndexRef.current = currentIndex;
  isRestoringRef.current = isRestoring;
  restoreScrollTopRef.current = restoreScrollTop;
  restoreElementIndexRef.current = restoreElementIndex;


  // Initialize from progress (call explicitly when needed)
  // Use refs to avoid recreating callback on every progress update
  const initialize = useCallback(() => {
    logger.log("[useChapterState] initialize called", {
      bookId,
      chaptersLength: chapters.length,
      currentIndex: currentIndexRef.current,
    });

    // Get fresh values from refs/closures
    const currentBook = bookId ? library.find((b) => b.id === bookId) : undefined;
    const currentProgress = currentBook?.progress;
    
    logger.log("[useChapterState] Current book and progress state", {
      bookId,
      hasBook: !!currentBook,
      hasProgress: !!currentProgress,
      progress: currentProgress ? {
        currentChapterId: currentProgress.currentChapterId,
        currentChapterIndex: currentProgress.currentChapterIndex,
        currentChapterHref: currentProgress.currentChapterHref,
        chapterProgressPercent: currentProgress.chapterProgressPercent,
        bookProgressPercent: currentProgress.bookProgressPercent,
        scrollTop: currentProgress.currentChapterScrollTop,
        elementIndex: currentProgress.currentChapterElementIndex,
        elementId: currentProgress.currentChapterElementId,
        updatedAt: currentProgress.updatedAt,
      } : null,
    });
    
    if (!bookId) {
      logger.log("[useChapterState] No bookId, resetting state", {});
      setRestoreScrollTop(null);
      setRestoreElementIndex(null);
      setIsRestoring(false);
      setCurrentIndexState(0);
      currentIndexRef.current = 0;
      initializedRef.current = undefined;
      return;
    }

    // Create signature to detect changes (exclude updatedAt to avoid re-initialization on every save)
    // Only re-initialize if chapter ID or index actually changes
    const signature = `${bookId}|${currentProgress?.currentChapterId}|${currentProgress?.currentChapterIndex}|${chapters.length}`;
    logger.log("[useChapterState] Checking initialization signature", {
      bookId,
      signature,
      previousSignature: initializedRef.current,
      willReinitialize: initializedRef.current !== signature,
    });
    
    if (initializedRef.current === signature) {
      logger.log("[useChapterState] Already initialized with this signature, skipping", {
        signature,
      });
      return; // Already initialized with this state
    }

    // Check if progress is an echo using current progress
    const snapshot = lastProgressSnapshotRef.current;
    const isEcho = currentProgress && (
      (snapshot.chapterId && snapshot.chapterId === currentProgress.currentChapterId) ||
      (snapshot.chapterHref && snapshot.chapterHref === currentProgress.currentChapterHref) ||
      (typeof snapshot.chapterIndex === "number" &&
        typeof currentProgress.currentChapterIndex === "number" &&
        snapshot.chapterIndex === currentProgress.currentChapterIndex)
    ) && (
      (snapshot.updatedAt && snapshot.updatedAt === currentProgress.updatedAt) ||
      (typeof snapshot.percent === "number" &&
        typeof currentProgress.chapterProgressPercent === "number" &&
        Math.abs(snapshot.percent - currentProgress.chapterProgressPercent) <= PROGRESS_ECHO_TOLERANCE_PERCENT)
    );
    
    logger.log("[useChapterState] Checking if progress is echo", {
      bookId,
      isEcho,
      snapshot: {
        chapterId: snapshot.chapterId,
        chapterHref: snapshot.chapterHref,
        chapterIndex: snapshot.chapterIndex,
        percent: snapshot.percent,
        updatedAt: snapshot.updatedAt,
        timestamp: snapshot.timestamp,
      },
      currentProgress: currentProgress ? {
        currentChapterId: currentProgress.currentChapterId,
        currentChapterHref: currentProgress.currentChapterHref,
        currentChapterIndex: currentProgress.currentChapterIndex,
        chapterProgressPercent: currentProgress.chapterProgressPercent,
        updatedAt: currentProgress.updatedAt,
      } : null,
    });
    
    if (isEcho) {
      logger.log("[useChapterState] Progress is echo, skipping restoration", {
        bookId,
        signature,
      });
      initializedRef.current = signature;
      return; // Don't restore if this is just an echo of our own progress
    }

    // Find chapter index from current progress
    let nextIndex = 0;
    if (chapters.length && currentProgress) {
      if (currentProgress.currentChapterId) {
        const matchById = chapters.findIndex(
          (chapter) => chapter.id === currentProgress.currentChapterId,
        );
        if (matchById >= 0) {
          nextIndex = matchById;
          logger.log("[useChapterState] Found chapter by ID", {
            bookId,
            chapterId: currentProgress.currentChapterId,
            chapterIndex: nextIndex,
          });
        } else if (currentProgress.currentChapterHref) {
          const matchByHref = chapters.findIndex(
            (chapter) => chapter.href === currentProgress.currentChapterHref,
          );
          if (matchByHref >= 0) {
            nextIndex = matchByHref;
            logger.log("[useChapterState] Found chapter by href", {
              bookId,
              chapterHref: currentProgress.currentChapterHref,
              chapterIndex: nextIndex,
            });
          } else if (
            typeof currentProgress.currentChapterIndex === "number" &&
            Number.isFinite(currentProgress.currentChapterIndex) &&
            currentProgress.currentChapterIndex >= 0 &&
            currentProgress.currentChapterIndex < chapters.length
          ) {
            nextIndex = currentProgress.currentChapterIndex;
            logger.log("[useChapterState] Using chapter index from progress", {
              bookId,
              chapterIndex: nextIndex,
            });
          } else {
            logger.warn("[useChapterState] Could not find chapter, using index 0", {
              bookId,
              progressChapterId: currentProgress.currentChapterId,
              progressChapterHref: currentProgress.currentChapterHref,
              progressChapterIndex: currentProgress.currentChapterIndex,
              chaptersLength: chapters.length,
            });
          }
        }
      } else {
        logger.warn("[useChapterState] No chapter ID in progress, using index 0", {
          bookId,
          hasProgress: !!currentProgress,
        });
      }
    } else {
      logger.log("[useChapterState] No chapters or progress, using index 0", {
        bookId,
        chaptersLength: chapters.length,
        hasProgress: !!currentProgress,
      });
    }
    
    logger.log("[useChapterState] Setting chapter index", {
      bookId,
      previousIndex: currentIndexRef.current,
      nextIndex,
    });
    
    setCurrentIndexState(nextIndex);
    currentIndexRef.current = nextIndex;

    const restoredScrollTop =
      typeof currentProgress?.currentChapterScrollTop === "number" &&
      Number.isFinite(currentProgress.currentChapterScrollTop) &&
      currentProgress.currentChapterScrollTop > 0
        ? Math.max(currentProgress.currentChapterScrollTop, 0)
        : null;

    const restoredElementIndex =
      typeof currentProgress?.currentChapterElementIndex === "number" &&
      Number.isFinite(currentProgress.currentChapterElementIndex) &&
      currentProgress.currentChapterElementIndex >= 0
        ? currentProgress.currentChapterElementIndex
        : null;

    logger.log("[useChapterState] Setting restoration values", {
      bookId,
      chapterIndex: nextIndex,
      restoredScrollTop,
      restoredElementIndex,
      progressScrollTop: currentProgress?.currentChapterScrollTop,
      progressElementIndex: currentProgress?.currentChapterElementIndex,
      willRestore: restoredScrollTop !== null || restoredElementIndex !== null,
    });

    setRestoreScrollTop(restoredScrollTop);
    setRestoreElementIndex(restoredElementIndex);
    setIsRestoring(restoredScrollTop !== null || restoredElementIndex !== null);
    restorationAppliedRef.current = null;
    lastProgressSnapshotRef.current = { timestamp: 0 };
    initializedRef.current = signature;
    
    logger.log("[useChapterState] Initialization complete", {
      bookId,
      chapterIndex: nextIndex,
      restoreScrollTop: restoredScrollTop,
      restoreElementIndex: restoredElementIndex,
      isRestoring: restoredScrollTop !== null || restoredElementIndex !== null,
      signature,
    });
  }, [bookId, library, chapters.length]);

  // Track previous values to detect changes (for explicit initialization)
  const prevBookIdRef = useRef<string | undefined>(undefined);
  const prevChapterIdRef = useRef<string | undefined>(undefined);
  const prevChapterIndexRef = useRef<number | undefined>(undefined);
  const prevChaptersLengthRef = useRef<number>(0);
  
  // Check for changes and initialize explicitly (instead of useEffect)
  // Don't re-initialize if we're currently restoring - wait for restoration to complete
  if (!isRestoringRef.current) {
    // Get fresh progress from library
    const currentBook = bookId ? library.find((b) => b.id === bookId) : undefined;
    const currentProgress = currentBook?.progress;
    
    const currentChapterId = currentProgress?.currentChapterId;
    const currentChapterIndex = currentProgress?.currentChapterIndex;
    const currentChaptersLength = chapters.length;
    
    // Check if any relevant value actually changed
    const bookIdChanged = prevBookIdRef.current !== bookId;
    const chapterIdChanged = prevChapterIdRef.current !== currentChapterId;
    const chapterIndexChanged = prevChapterIndexRef.current !== currentChapterIndex;
    const chaptersLengthChanged = prevChaptersLengthRef.current !== currentChaptersLength;
    
    // Only initialize if something actually changed
    if (bookIdChanged || chapterIdChanged || chapterIndexChanged || chaptersLengthChanged) {
      logger.log("[useChapterState] Detected changes, checking if initialization needed", {
        bookId,
        bookIdChanged,
        chapterIdChanged,
        chapterIndexChanged,
        chaptersLengthChanged,
        previousChapterId: prevChapterIdRef.current,
        currentChapterId,
        previousChapterIndex: prevChapterIndexRef.current,
        currentChapterIndex,
        previousChaptersLength: prevChaptersLengthRef.current,
        currentChaptersLength,
      });
      
      // Update refs
      prevBookIdRef.current = bookId;
      prevChapterIdRef.current = currentChapterId;
      prevChapterIndexRef.current = currentChapterIndex;
      prevChaptersLengthRef.current = currentChaptersLength;
      
      // Initialize only if we have a valid signature change
      const currentSignature = bookId && currentProgress
        ? `${bookId}|${currentProgress.currentChapterId}|${currentProgress.currentChapterIndex}|${chapters.length}`
        : undefined;
      
      // Only initialize if signature actually changed (prevents loops from progress saves)
      if (initializedRef.current !== currentSignature) {
        // Additional check: if we're already initialized with the same chapter, don't re-initialize
        // This prevents re-initialization when only progress values (like scrollTop) change
        const existingSignature = initializedRef.current;
        if (existingSignature && currentSignature) {
          const existingParts = existingSignature.split('|');
          const currentParts = currentSignature.split('|');
          // If bookId and chapter info match, don't re-initialize (only progress values changed)
          if (existingParts[0] === currentParts[0] && 
              existingParts[1] === currentParts[1] && 
              existingParts[2] === currentParts[2]) {
            // Same book and chapter - just update the signature to prevent future checks
            logger.log("[useChapterState] Same book and chapter, updating signature only", {
              bookId,
              signature: currentSignature,
            });
            initializedRef.current = currentSignature;
          } else {
            // Different chapter - initialize
            logger.log("[useChapterState] Calling initialize due to chapter change", {
              bookId,
              signature: currentSignature,
            });
            initialize();
          }
        } else {
          // No existing signature or no current signature - initialize
          logger.log("[useChapterState] Calling initialize (no existing signature)", {
            bookId,
            signature: currentSignature,
          });
          initialize();
        }
      }
    }
  } else {
    logger.log("[useChapterState] Currently restoring, skipping initialization check", {
      bookId,
    });
  }

  const onChapterChanged = useCallback((newChapterId: string) => {
    const currentChapter = chaptersRef.current[currentIndexRef.current];
    if (!currentChapter || currentChapter.id === newChapterId) {
      return;
    }

    // Check if chapter change operation is in progress or cancelled (if coordinator available)
    if (coordinator && coordinator.isOperationInProgress("changeChapter")) {
      const currentOp = coordinator.getCurrentOperation("changeChapter");
      if (currentOp?.cancelled) {
        return;
      }
    }

    if (isRestoringRef.current) {
      return;
    }

    setRestoreScrollTop(null);
    setRestoreElementIndex(null);
    restorationAppliedRef.current = null;
  }, [coordinator]);

  const emitProgress = useCallback((
    _chapterId: string,
    scrollTop?: number,
    percent?: number,
    elementIndex?: number
  ) => {
    const chapter = chaptersRef.current[currentIndexRef.current];
    const listener = onProgressRef.current;
    if (!chapter || !listener) return;

    const updatedAt = new Date().toISOString();

    lastProgressSnapshotRef.current = {
      chapterId: chapter.id,
      chapterHref: chapter.href,
      chapterIndex: currentIndexRef.current,
      scrollTop,
      percent,
      elementIndex,
      updatedAt,
      timestamp: Date.now(),
    };

    listener({
      chapterId: chapter.id,
      chapterHref: chapter.href,
      chapterIndex: currentIndexRef.current,
      scrollTop,
      percent,
      elementIndex,
      updatedAt,
    });
  }, []);

  const onChapterLoaded = useCallback((
    contentElement: HTMLElement | null,
    scrollToElement?: (elementId: string) => void
  ) => {
    const currentChapter = chaptersRef.current[currentIndexRef.current];
    if (!currentChapter || !contentElement) {
      logger.warn("[useChapterState] onChapterLoaded: missing chapter or content element", {
        hasChapter: !!currentChapter,
        hasContentElement: !!contentElement,
      });
      return;
    }

    const shouldRestore = isRestoringRef.current;
    const scrollTopToRestore = restoreScrollTopRef.current;
    const elementIndexToRestore = restoreElementIndexRef.current;
    const currentChapterId = currentChapter.id;
    const alreadyApplied = restorationAppliedRef.current === currentChapterId;

    // Find the actual scrollable container (might be a parent of contentElement)
    // Do this once outside the retry loop since the container structure won't change
    let scrollContainer: HTMLElement = contentElement;
    
    // Wait for content to be fully loaded and scrollable (similar to audio waiting for track to load)
    const waitForContentReady = (attempts = 0) => {
      // Find the actual scrollable container (might be a parent of contentElement)
      scrollContainer = findScrollableContainer(contentElement) || contentElement;
      const maxScroll = scrollContainer.scrollHeight - scrollContainer.clientHeight;
      // Content is ready only when it's actually scrollable (maxScroll > 0)
      // This ensures the layout is complete and we can restore scroll position
      const isContentReady = maxScroll > 0;
      
      logger.log("[useChapterState] Checking if content is ready", {
        chapterId: currentChapterId,
        attempt: attempts,
        contentElementScrollHeight: contentElement.scrollHeight,
        contentElementClientHeight: contentElement.clientHeight,
        scrollContainerTag: scrollContainer.tagName,
        scrollContainerScrollHeight: scrollContainer.scrollHeight,
        scrollContainerClientHeight: scrollContainer.clientHeight,
        maxScroll,
        isContentReady,
        isScrollContainerDifferent: scrollContainer !== contentElement,
      });
      
      // If content isn't ready yet, wait and try again (up to 20 attempts)
      if (!isContentReady && attempts < 20) {
        setTimeout(() => {
          requestAnimationFrame(() => waitForContentReady(attempts + 1));
        }, 50);
        return;
      }
      
      // If content still isn't ready after all attempts, try window/document scrolling
      if (!isContentReady) {
        // Check if window/document can scroll as a fallback
        const documentMaxScroll = document.documentElement.scrollHeight - window.innerHeight;
        const windowCanScroll = documentMaxScroll > 0;
        
        logger.log("[useChapterState] Element container not scrollable, checking window/document", {
          chapterId: currentChapterId,
          attempts,
          scrollHeight: scrollContainer.scrollHeight,
          clientHeight: scrollContainer.clientHeight,
          maxScroll,
          documentScrollHeight: document.documentElement.scrollHeight,
          windowInnerHeight: window.innerHeight,
          documentMaxScroll,
          windowCanScroll,
        });
        
        if (windowCanScroll) {
          // Use window/document as the scroll container
          scrollContainer = document.documentElement;
          logger.log("[useChapterState] Using window/document as scroll container", {
            chapterId: currentChapterId,
            documentScrollHeight: document.documentElement.scrollHeight,
            windowInnerHeight: window.innerHeight,
            documentMaxScroll,
          });
        } else {
          // No scrollable container found at all
          logger.warn("[useChapterState] No scrollable container found after retries, cannot restore", {
            chapterId: currentChapterId,
            attempts,
            scrollHeight: scrollContainer.scrollHeight,
            clientHeight: scrollContainer.clientHeight,
            maxScroll,
            documentScrollHeight: document.documentElement.scrollHeight,
            windowInnerHeight: window.innerHeight,
            documentMaxScroll,
          });
          // Clear restoration state since we can't restore
          restorationAppliedRef.current = currentChapterId;
          setIsRestoring(false);
          setRestoreScrollTop(null);
          setRestoreElementIndex(null);
          return;
        }
      }
      
      // Content is ready (or we've given up waiting), proceed with restoration
      logger.log("[useChapterState] onChapterLoaded - content ready, proceeding", {
        chapterId: currentChapterId,
        shouldRestore,
        scrollTopToRestore,
        elementIndexToRestore,
        alreadyApplied,
        willRestore: shouldRestore && (scrollTopToRestore !== null || elementIndexToRestore !== null) && !alreadyApplied,
      });
      
      // Apply restoration now that content is ready
      if (
        shouldRestore &&
        (scrollTopToRestore !== null || elementIndexToRestore !== null) &&
        !alreadyApplied
      ) {
        try {
          logger.log("[useChapterState] Applying restoration", {
            chapterId: currentChapterId,
            scrollTopToRestore,
            elementIndexToRestore,
            contentElementScrollHeight: contentElement.scrollHeight,
            contentElementClientHeight: contentElement.clientHeight,
            scrollContainerTag: scrollContainer.tagName,
            scrollContainerScrollHeight: scrollContainer.scrollHeight,
            scrollContainerClientHeight: scrollContainer.clientHeight,
            isScrollContainerDifferent: scrollContainer !== contentElement,
          });
          
          // Restore element index first (if available)
          if (elementIndexToRestore !== null && Number.isFinite(elementIndexToRestore) && scrollToElement) {
            const elements = contentElement.querySelectorAll('[id^="f"]');
            if (elementIndexToRestore < elements.length) {
              const element = elements[elementIndexToRestore] as HTMLElement;
              if (element && element.id) {
                element.scrollIntoView({
                  behavior: "auto",
                  block: "start",
                  inline: "nearest"
                });
                scrollToElement(element.id);
              }
            }
          }
          
          // Restore scroll position if we have scrollTop but no element index
          if (scrollTopToRestore !== null && Number.isFinite(scrollTopToRestore) && elementIndexToRestore === null) {
            const isDocumentElement = scrollContainer === document.documentElement;
            const maxScroll = isDocumentElement 
              ? document.documentElement.scrollHeight - window.innerHeight
              : scrollContainer.scrollHeight - scrollContainer.clientHeight;
            // Calculate target scroll position
            const targetScroll = Math.min(scrollTopToRestore, maxScroll);
            
            logger.log("[useChapterState] Applying scroll restoration", {
              chapterId: currentChapterId,
              scrollTopToRestore,
              targetScroll,
              maxScroll,
              scrollContainerTag: scrollContainer.tagName,
              isDocumentElement,
            });
            
            const elements = contentElement.querySelectorAll('[id^="f"]');
            let targetElement: HTMLElement | null = null;
            
            for (let i = 0; i < elements.length; i++) {
              const element = elements[i] as HTMLElement;
              const elementTop = element.offsetTop;
              
              if (elementTop >= scrollTopToRestore) {
                targetElement = element;
                break;
              }
            }
            
            if (targetElement) {
              targetElement.scrollIntoView({
                behavior: "auto",
                block: "start",
                inline: "nearest"
              });
              
              requestAnimationFrame(() => {
                const currentScrollTop = isDocumentElement 
                  ? window.scrollY 
                  : scrollContainer.scrollTop;
                const diff = Math.abs(currentScrollTop - targetScroll);
                if (diff > 10) {
                  if (isDocumentElement) {
                    window.scrollTo({ top: targetScroll, behavior: "auto" });
                  } else {
                    scrollContainer.scrollTop = targetScroll;
                  }
                  logger.log("[useChapterState] Adjusted scrollTop after scrollIntoView", {
                    chapterId: currentChapterId,
                    targetScrollTop: targetScroll,
                    actualScrollTop: isDocumentElement ? window.scrollY : scrollContainer.scrollTop,
                  });
                }
              });
            } else {
              if (isDocumentElement) {
                window.scrollTo({ top: targetScroll, behavior: "auto" });
              } else {
                scrollContainer.scrollTop = targetScroll;
              }
              logger.log("[useChapterState] Direct scrollTop restoration", {
                chapterId: currentChapterId,
                scrollTop: targetScroll,
                actualScrollTop: isDocumentElement ? window.scrollY : scrollContainer.scrollTop,
                maxScroll,
              });
            }
          }
          
          restorationAppliedRef.current = currentChapterId;
          setIsRestoring(false);
          setRestoreScrollTop(null);
          setRestoreElementIndex(null);
          
          const finalScrollTop = scrollContainer === document.documentElement 
            ? window.scrollY 
            : scrollContainer.scrollTop;
          logger.log("[useChapterState] Restoration applied successfully", {
            chapterId: currentChapterId,
            finalScrollTop,
            scrollContainerTag: scrollContainer.tagName,
            isDocumentElement: scrollContainer === document.documentElement,
          });
        } catch (error) {
          logger.warn("Failed to apply restore state:", error);
          setIsRestoring(false);
          setRestoreScrollTop(null);
          setRestoreElementIndex(null);
        }
      } else if (shouldRestore && scrollTopToRestore === null && elementIndexToRestore === null) {
        logger.log("[useChapterState] Should restore but no values, clearing restoration state", {
          chapterId: currentChapterId,
        });
        setIsRestoring(false);
        setRestoreScrollTop(null);
        setRestoreElementIndex(null);
        restorationAppliedRef.current = currentChapterId;
      } else if (!shouldRestore && scrollTopToRestore === null && elementIndexToRestore === null && !alreadyApplied) {
        logger.log("[useChapterState] No restoration needed, scrolling to top", {
          chapterId: currentChapterId,
        });
        restorationAppliedRef.current = null;
      } else {
        logger.log("[useChapterState] onChapterLoaded: no action taken", {
          chapterId: currentChapterId,
          shouldRestore,
          scrollTopToRestore,
          elementIndexToRestore,
          alreadyApplied,
        });
      }
    };
    
    // Start waiting for content to be ready
    waitForContentReady();
  }, []);

  const setCurrentIndex = useCallback((index: number) => {
    // Validate index before setting
    const validIndex = index < 0 || index >= chaptersRef.current.length 
      ? 0 
      : index;
    
    // Ensure index is valid (explicit validation instead of useEffect)
    if (chaptersRef.current.length && validIndex >= chaptersRef.current.length) {
      logger.warn("[useChapterState] Index out of bounds, resetting to 0", {
        requestedIndex: index,
        chaptersLength: chaptersRef.current.length,
      });
      setCurrentIndexState(0);
      currentIndexRef.current = 0;
      return;
    }
    
    const newChapter = chaptersRef.current[validIndex];
    if (newChapter) {
      onChapterChanged(newChapter.id);
    }
    setCurrentIndexState(validIndex);
    currentIndexRef.current = validIndex;
  }, [onChapterChanged]);

  return {
    currentIndex,
    setCurrentIndex,
    restoreScrollTop,
    restoreElementIndex,
    isRestoring,
    onChapterLoaded,
    onChapterChanged,
    emitProgress,
  };
}
