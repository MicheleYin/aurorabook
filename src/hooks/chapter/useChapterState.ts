/**
 * Chapter state hook - simplified version
 * Manages chapter index and restoration state based on progress from library
 * No useEffects - initialization is explicit
 */

import { useCallback, useRef, useState, useEffect } from "react";
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
  const book = bookId ? library.find((b) => b.id === bookId) : undefined;
  const initialProgress = book?.progress;

  const [currentIndex, setCurrentIndexState] = useState(0);
  const [restoreScrollTop, setRestoreScrollTop] = useState<number | null>(null);
  const [restoreElementIndex, setRestoreElementIndex] = useState<number | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);

  const currentIndexRef = useRef(0);
  const onProgressRef = useRef(onProgress);
  const chaptersRef = useRef(chapters);
  const isRestoringRef = useRef(false);
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

  // Find chapter index from initial progress
  const findChapterIndex = useCallback((): number => {
    if (!chapters.length || !initialProgress) {
      return 0;
    }

    if (initialProgress.currentChapterId) {
      const matchById = chapters.findIndex(
        (chapter) => chapter.id === initialProgress.currentChapterId,
      );
      if (matchById >= 0) return matchById;
    }

    if (initialProgress.currentChapterHref) {
      const matchByHref = chapters.findIndex(
        (chapter) => chapter.href === initialProgress.currentChapterHref,
      );
      if (matchByHref >= 0) return matchByHref;
    }

    if (
      typeof initialProgress.currentChapterIndex === "number" &&
      Number.isFinite(initialProgress.currentChapterIndex) &&
      initialProgress.currentChapterIndex >= 0 &&
      initialProgress.currentChapterIndex < chapters.length
    ) {
      return initialProgress.currentChapterIndex;
    }

    return 0;
  }, [chapters, initialProgress]);

  // Check if progress is an echo (same as what we just emitted)
  const isProgressEcho = useCallback((): boolean => {
    const progress = initialProgress;
    if (!progress) return false;

    const snapshot = lastProgressSnapshotRef.current;
    if (
      !snapshot.chapterId &&
      !snapshot.chapterHref &&
      typeof snapshot.chapterIndex !== "number"
    ) {
      return false;
    }

    const nextChapterIndex =
      typeof progress.currentChapterIndex === "number" &&
      Number.isFinite(progress.currentChapterIndex)
        ? progress.currentChapterIndex
        : undefined;
    const nextPercent =
      typeof progress.chapterProgressPercent === "number" &&
      Number.isFinite(progress.chapterProgressPercent)
        ? progress.chapterProgressPercent
        : undefined;

    const chapterMatches =
      Boolean(snapshot.chapterId && snapshot.chapterId === progress.currentChapterId) ||
      Boolean(
        snapshot.chapterHref && snapshot.chapterHref === progress.currentChapterHref,
      ) ||
      (typeof snapshot.chapterIndex === "number" &&
        typeof nextChapterIndex === "number" &&
        snapshot.chapterIndex === nextChapterIndex);

    if (!chapterMatches) return false;

    const percentMatches =
      (snapshot.updatedAt && snapshot.updatedAt === progress.updatedAt) ||
      (typeof snapshot.percent === "number" &&
        typeof nextPercent === "number" &&
        Math.abs(snapshot.percent - nextPercent) <=
          PROGRESS_ECHO_TOLERANCE_PERCENT);

    return percentMatches;
  }, [initialProgress]);

  // Initialize from progress (call explicitly when needed)
  // Use refs to avoid recreating callback on every progress update
  const initialize = useCallback(() => {
    // Get fresh values from refs/closures
    const currentBook = bookId ? library.find((b) => b.id === bookId) : undefined;
    const currentProgress = currentBook?.progress;
    
    if (!bookId) {
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
    if (initializedRef.current === signature) {
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
    
    if (isEcho) {
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
        } else if (currentProgress.currentChapterHref) {
          const matchByHref = chapters.findIndex(
            (chapter) => chapter.href === currentProgress.currentChapterHref,
          );
          if (matchByHref >= 0) {
            nextIndex = matchByHref;
          } else if (
            typeof currentProgress.currentChapterIndex === "number" &&
            Number.isFinite(currentProgress.currentChapterIndex) &&
            currentProgress.currentChapterIndex >= 0 &&
            currentProgress.currentChapterIndex < chapters.length
          ) {
            nextIndex = currentProgress.currentChapterIndex;
          }
        }
      }
    }
    
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

    setRestoreScrollTop(restoredScrollTop);
    setRestoreElementIndex(restoredElementIndex);
    setIsRestoring(restoredScrollTop !== null || restoredElementIndex !== null);
    restorationAppliedRef.current = null;
    lastProgressSnapshotRef.current = { timestamp: 0 };
    initializedRef.current = signature;
  }, [bookId, library, chapters.length]);

  // Use useEffect to initialize when bookId or state changes (prevents infinite loops)
  // Only re-initialize when chapter ID or index changes, not when updatedAt changes
  // Use refs to track previous values and avoid unnecessary re-initializations
  const prevBookIdRef = useRef<string | undefined>(undefined);
  const prevChapterIdRef = useRef<string | undefined>(undefined);
  const prevChapterIndexRef = useRef<number | undefined>(undefined);
  const prevChaptersLengthRef = useRef<number>(0);
  
  useEffect(() => {
    // Don't re-initialize if we're currently restoring - wait for restoration to complete
    if (isRestoringRef.current) {
      return;
    }
    
    // Get fresh progress from library inside effect to avoid stale closures
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
            initializedRef.current = currentSignature;
            return;
          }
        }
        
        initialize();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, library, chapters.length]);

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
    if (!currentChapter || !contentElement) return;

    const shouldRestore = isRestoringRef.current;
    const scrollTopToRestore = restoreScrollTop;
    const elementIndexToRestore = restoreElementIndex;
    const currentChapterId = currentChapter.id;
    const alreadyApplied = restorationAppliedRef.current === currentChapterId;

    if (
      shouldRestore &&
      (scrollTopToRestore !== null || elementIndexToRestore !== null) &&
      !alreadyApplied
    ) {
      try {
        // Restore scroll position
        if (scrollTopToRestore !== null && Number.isFinite(scrollTopToRestore)) {
          contentElement.scrollTop = scrollTopToRestore;
        }
        
        // Restore element index if available
        if (elementIndexToRestore !== null && Number.isFinite(elementIndexToRestore) && scrollToElement) {
          // Try to find element by index and scroll to it
          const elements = contentElement.querySelectorAll('[id^="f"]');
          if (elementIndexToRestore < elements.length) {
            const element = elements[elementIndexToRestore];
            if (element && element.id) {
              scrollToElement(element.id);
            }
          }
        }
        
        restorationAppliedRef.current = currentChapterId;
        // Don't emit progress during restoration to avoid triggering saves that cause re-initialization
        // Progress will be emitted naturally when user scrolls
        setIsRestoring(false);
        setRestoreScrollTop(null);
        setRestoreElementIndex(null);
      } catch (error) {
        logger.warn("Failed to apply restore state:", error);
        setIsRestoring(false);
        setRestoreScrollTop(null);
        setRestoreElementIndex(null);
      }
    } else if (shouldRestore && scrollTopToRestore === null && elementIndexToRestore === null) {
      setIsRestoring(false);
      setRestoreScrollTop(null);
      setRestoreElementIndex(null);
      restorationAppliedRef.current = currentChapterId;
    } else if (!shouldRestore && scrollTopToRestore === null && elementIndexToRestore === null && !alreadyApplied) {
      contentElement.scrollTop = 0;
      restorationAppliedRef.current = null;
    }
  }, [restoreScrollTop, restoreElementIndex, emitProgress]);

  const setCurrentIndex = useCallback((index: number) => {
    if (index < 0 || index >= chaptersRef.current.length) return;
    
    const newChapter = chaptersRef.current[index];
    if (newChapter) {
      onChapterChanged(newChapter.id);
    }
    setCurrentIndexState(index);
    currentIndexRef.current = index;
  }, [onChapterChanged]);

  // Ensure index is valid (use useEffect to avoid state updates during render)
  useEffect(() => {
    if (chapters.length && currentIndex >= chapters.length) {
      setCurrentIndexState(0);
      currentIndexRef.current = 0;
    }
  }, [chapters.length, currentIndex]);

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
