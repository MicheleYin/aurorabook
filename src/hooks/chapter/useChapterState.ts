/**
 * Chapter state hook - simplified version
 * Manages chapter index and restoration state based on progress from library
 * No useEffects - initialization is explicit
 */

import { useCallback, useRef, useState } from "react";
import { logger } from "../../lib/logger";
import { useContext } from "react";
import { ReaderCoordinatorContext } from "../../contexts/ReaderCoordinatorContext";
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
  const restorationAppliedRef = useRef<string | null>(null);
  const restorationInProgressRef = useRef<string | null>(null); // Lock to prevent concurrent restoration attempts
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
    
    logger.log("[useChapterState] onChapterLoaded called", {
      hasChapter: !!currentChapter,
      chapterId: currentChapter?.id,
      chapterIndex: currentIndexRef.current,
      hasContentElement: !!contentElement,
      hasScrollToElement: !!scrollToElement,
      restoreScrollTop,
      restoreElementIndex,
      isRestoring: isRestoringRef.current,
      alreadyApplied: restorationAppliedRef.current,
      restorationInProgress: restorationInProgressRef.current,
    });
    
    if (!currentChapter || !contentElement) {
      logger.warn("[useChapterState] onChapterLoaded: missing chapter or content element", {
        hasChapter: !!currentChapter,
        hasContentElement: !!contentElement,
      });
      return;
    }

    const shouldRestore = isRestoringRef.current;
    const scrollTopToRestore = restoreScrollTop;
    const elementIndexToRestore = restoreElementIndex;
    const currentChapterId = currentChapter.id;
    const alreadyApplied = restorationAppliedRef.current === currentChapterId;

    // Check if restoration is already in progress for this chapter (lock to prevent concurrent attempts)
    if (restorationInProgressRef.current === currentChapterId) {
      logger.log("[useChapterState] Restoration already in progress for this chapter, skipping", {
        chapterId: currentChapterId,
      });
      return;
    }

    logger.log("[useChapterState] onChapterLoaded: restoration decision", {
      chapterId: currentChapterId,
      shouldRestore,
      scrollTopToRestore,
      elementIndexToRestore,
      alreadyApplied,
      willRestore: shouldRestore && (scrollTopToRestore !== null || elementIndexToRestore !== null) && !alreadyApplied,
    });

    if (
      shouldRestore &&
      (scrollTopToRestore !== null || elementIndexToRestore !== null) &&
      !alreadyApplied
    ) {
      // Set lock to prevent concurrent restoration attempts
      restorationInProgressRef.current = currentChapterId;
      
      // Set a timeout to clear the lock if restoration doesn't complete (safety measure)
      const lockTimeout = setTimeout(() => {
        if (restorationInProgressRef.current === currentChapterId) {
          logger.warn("[useChapterState] Restoration lock timeout - clearing lock", {
            chapterId: currentChapterId,
          });
          restorationInProgressRef.current = null;
        }
      }, 5000); // 5 second timeout
      
      try {
        logger.log("[useChapterState] Applying restoration", {
          chapterId: currentChapterId,
          scrollTopToRestore,
          elementIndexToRestore,
          contentElementScrollHeight: contentElement.scrollHeight,
          contentElementClientHeight: contentElement.clientHeight,
        });
        
        // Restore element index first (if available) - uses scrollIntoView like audio
        if (elementIndexToRestore !== null && Number.isFinite(elementIndexToRestore) && scrollToElement) {
          logger.log("[useChapterState] Restoring element index", {
            chapterId: currentChapterId,
            elementIndex: elementIndexToRestore,
          });
          
          // Try to find element by index and scroll to it using scrollIntoView
          const elements = contentElement.querySelectorAll('[id^="f"]');
          logger.log("[useChapterState] Found elements for restoration", {
            chapterId: currentChapterId,
            elementIndex: elementIndexToRestore,
            totalElements: elements.length,
          });
          
          if (elementIndexToRestore < elements.length) {
            const element = elements[elementIndexToRestore] as HTMLElement;
            if (element && element.id) {
              logger.log("[useChapterState] Scrolling to element using scrollIntoView", {
                chapterId: currentChapterId,
                elementId: element.id,
                elementIndex: elementIndexToRestore,
              });
              
              // Use scrollIntoView like audio state sync
              element.scrollIntoView({
                behavior: "auto",
                block: "start",
                inline: "nearest"
              });
              
              // Also call scrollToElement for compatibility
              scrollToElement(element.id);
            } else {
              logger.warn("[useChapterState] Element at index has no ID", {
                chapterId: currentChapterId,
                elementIndex: elementIndexToRestore,
              });
            }
          } else {
            logger.warn("[useChapterState] Element index out of range", {
              chapterId: currentChapterId,
              elementIndex: elementIndexToRestore,
              totalElements: elements.length,
            });
          }
        }
        
        // Restore scroll position using scrollIntoView approach
        // If we have scrollTop but no element index, find the element at that scroll position
        if (scrollTopToRestore !== null && Number.isFinite(scrollTopToRestore) && elementIndexToRestore === null) {
          logger.log("[useChapterState] Restoring scrollTop using scrollIntoView approach", {
            chapterId: currentChapterId,
            scrollTop: scrollTopToRestore,
            maxScroll: contentElement.scrollHeight - contentElement.clientHeight,
          });
          
          // Find element closest to the scroll position
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
            logger.log("[useChapterState] Found element at scroll position, using scrollIntoView", {
              chapterId: currentChapterId,
              elementId: targetElement.id,
              elementTop: targetElement.offsetTop,
              targetScrollTop: scrollTopToRestore,
            });
            
            targetElement.scrollIntoView({
              behavior: "auto",
              block: "start",
              inline: "nearest"
            });
            
            // Adjust for exact scroll position if needed
            requestAnimationFrame(() => {
              const currentScrollTop = contentElement.scrollTop;
              const diff = Math.abs(currentScrollTop - scrollTopToRestore);
              if (diff > 10) { // Only adjust if significantly different
                contentElement.scrollTop = scrollTopToRestore;
                logger.log("[useChapterState] Adjusted scrollTop after scrollIntoView", {
                  chapterId: currentChapterId,
                  targetScrollTop: scrollTopToRestore,
                  actualScrollTop: contentElement.scrollTop,
                });
              }
            });
          } else {
            // Fallback: direct scroll if no element found
            logger.log("[useChapterState] No element found at scroll position, using direct scroll", {
              chapterId: currentChapterId,
              scrollTop: scrollTopToRestore,
            });
            contentElement.scrollTop = scrollTopToRestore;
          }
          
          logger.log("[useChapterState] ScrollTop restored", {
            chapterId: currentChapterId,
            actualScrollTop: contentElement.scrollTop,
            expectedScrollTop: scrollTopToRestore,
          });
        }
        
        restorationAppliedRef.current = currentChapterId;
        // Don't emit progress during restoration to avoid triggering saves that cause re-initialization
        // Progress will be emitted naturally when user scrolls
        setIsRestoring(false);
        setRestoreScrollTop(null);
        setRestoreElementIndex(null);
        
        logger.log("[useChapterState] Restoration applied successfully", {
          chapterId: currentChapterId,
          finalScrollTop: contentElement.scrollTop,
        });
      } catch (error) {
        logger.error("[useChapterState] Failed to apply restore state", {
          chapterId: currentChapterId,
          error,
          errorMessage: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : undefined,
        });
        setIsRestoring(false);
        setRestoreScrollTop(null);
        setRestoreElementIndex(null);
      } finally {
        // Clear lock after restoration attempt (even if it fails)
        clearTimeout(lockTimeout);
        // Keep lock until restoration completes to prevent race conditions
        // The lock will be cleared when isRestoring becomes false
        if (!isRestoringRef.current) {
          restorationInProgressRef.current = null;
        }
      }
    } else if (shouldRestore && scrollTopToRestore === null && elementIndexToRestore === null) {
      logger.log("[useChapterState] Should restore but no values, clearing restoration state", {
        chapterId: currentChapterId,
      });
      setIsRestoring(false);
      setRestoreScrollTop(null);
      setRestoreElementIndex(null);
      restorationAppliedRef.current = currentChapterId;
      restorationInProgressRef.current = null;
    } else if (!shouldRestore && scrollTopToRestore === null && elementIndexToRestore === null && !alreadyApplied) {
      logger.log("[useChapterState] No restoration needed, scrolling to top", {
        chapterId: currentChapterId,
      });
      contentElement.scrollTop = 0;
      restorationAppliedRef.current = null;
      restorationInProgressRef.current = null;
    } else {
      logger.log("[useChapterState] onChapterLoaded: no action taken", {
        chapterId: currentChapterId,
        shouldRestore,
        scrollTopToRestore,
        elementIndexToRestore,
        alreadyApplied,
      });
    }
  }, [restoreScrollTop, restoreElementIndex, emitProgress]);

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
