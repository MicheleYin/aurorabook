/**
 * Chapter progress tracking hook
 */

import { useCallback, useEffect, useRef } from "react";
import {
  getCurrentScrollMetrics,
  createProgressSnapshot,
  isProgressUnchanged as isProgressSnapshotUnchanged,
} from "../../lib/progress-utils";
import { usePrevious } from "../usePrevious";
import type { UseChapterProgressParams } from "./types";

export function useChapterProgress(params: UseChapterProgressParams) {
  const {
    activeChapter,
    contentRef,
    onProgress,
    onSaveProgress,
    isRestoringScroll = false,
  } = params;

  const progressStateRef = useRef({
    lastProgress: null as Parameters<NonNullable<typeof onProgress>>[0] | null,
    lastKnownMetrics: null as {
      scrollTop: number;
      scrollHeight: number;
      clientHeight: number;
      maxScroll: number;
    } | null,
  });

  const scrollStateRef = useRef({
    rafId: null as number | null,
    debounceTimeout: null as number | null,
  });

  const isRestoringRef = useRef(isRestoringScroll);
  const previousChapterId = usePrevious(activeChapter?.id);
  const restorationCheckTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    isRestoringRef.current = isRestoringScroll;
  }, [isRestoringScroll]);

  // Auto-detect when restoration completes by checking if scroll position has been restored
  // This handles the case where isRestoringScroll prop doesn't update (e.g., when using refs)
  useEffect(() => {
    if (!isRestoringRef.current || !activeChapter) {
      // Clear any pending checks if we're not restoring
      if (restorationCheckTimeoutRef.current !== null) {
        clearTimeout(restorationCheckTimeoutRef.current);
        restorationCheckTimeoutRef.current = null;
      }
      return;
    }

    const containerElement = contentRef?.current ?? null;
    if (!containerElement) return;

    // Clear any existing timeout
    if (restorationCheckTimeoutRef.current !== null) {
      clearTimeout(restorationCheckTimeoutRef.current);
    }

    // Check periodically if restoration has completed
    const checkRestorationComplete = () => {
      if (!isRestoringRef.current) return;

      const metrics = getCurrentScrollMetrics(
        progressStateRef.current.lastKnownMetrics,
        containerElement,
      );

      // If we have a non-zero scroll position, restoration is likely complete
      if (metrics.scrollTop > 0) {
        // Wait a bit to ensure restoration is stable (scroll position doesn't jump back to 0)
        restorationCheckTimeoutRef.current = window.setTimeout(() => {
          if (!isRestoringRef.current) return;

          const finalMetrics = getCurrentScrollMetrics(
            progressStateRef.current.lastKnownMetrics,
            containerElement,
          );
          
          // If scroll is still non-zero and stable, restoration is complete
          if (finalMetrics.scrollTop > 0) {
            console.debug("[useChapterProgress] Auto-detected restoration complete via scroll position", {
              chapterId: activeChapter.id,
              scrollTop: finalMetrics.scrollTop,
            });
            isRestoringRef.current = false;
            restorationCheckTimeoutRef.current = null;
          }
        }, 300); // Wait 300ms to ensure restoration is stable
      } else {
        // Still at 0, check again soon
        restorationCheckTimeoutRef.current = window.setTimeout(checkRestorationComplete, 100);
      }
    };

    // Start checking after a short delay to allow restoration to begin
    restorationCheckTimeoutRef.current = window.setTimeout(checkRestorationComplete, 200);
    
    return () => {
      if (restorationCheckTimeoutRef.current !== null) {
        clearTimeout(restorationCheckTimeoutRef.current);
        restorationCheckTimeoutRef.current = null;
      }
    };
  }, [isRestoringScroll, activeChapter?.id, contentRef]);

  const emitChapterProgress = useCallback(() => {
    if (!activeChapter || !onProgress || isRestoringRef.current) {
      return;
    }

    const containerElement = contentRef?.current ?? null;
    const metrics = getCurrentScrollMetrics(
      progressStateRef.current.lastKnownMetrics,
      containerElement,
    );

    if (metrics.maxScroll > 0 || metrics.scrollTop > 0) {
      progressStateRef.current.lastKnownMetrics = metrics;
    }

    const snapshot = createProgressSnapshot(activeChapter.id, metrics);

    if (
      isProgressSnapshotUnchanged(
        progressStateRef.current.lastProgress,
        snapshot,
      )
    ) {
      return;
    }

    progressStateRef.current.lastProgress = snapshot;
    onProgress(snapshot);
  }, [activeChapter, onProgress, contentRef]);

  const saveProgress = useCallback(() => {
    if (!activeChapter || !onProgress) {
      console.debug("[useChapterProgress] saveProgress skipped", {
        hasActiveChapter: !!activeChapter,
        hasOnProgress: !!onProgress,
      });
      return;
    }

    // Check if we're currently restoring scroll position
    // Also verify by checking actual scroll position to handle cases where ref doesn't update
    const checkElement = contentRef?.current ?? null;
    let actuallyRestoring = isRestoringRef.current;
    
    if (actuallyRestoring && checkElement) {
      // Double-check: if scroll position is non-zero and stable, restoration is likely complete
      const checkMetrics = getCurrentScrollMetrics(
        progressStateRef.current.lastKnownMetrics,
        checkElement,
      );
      
      // If we have a non-zero scroll position, restoration is probably done
      // (restoration sets scroll to non-zero, so if it's non-zero, restoration completed)
      if (checkMetrics.scrollTop > 10) {
        console.debug("[useChapterProgress] Overriding isRestoring flag - scroll position indicates restoration complete", {
          chapterId: activeChapter.id,
          scrollTop: checkMetrics.scrollTop,
          wasRestoring: isRestoringRef.current,
        });
        actuallyRestoring = false;
        isRestoringRef.current = false;
      }
    }

    // Skip saving if we're currently restoring scroll position
    if (actuallyRestoring) {
      console.debug("[useChapterProgress] saveProgress skipped - restoration in progress", {
        chapterId: activeChapter.id,
      });
      return;
    }

    if (scrollStateRef.current.debounceTimeout !== null) {
      clearTimeout(scrollStateRef.current.debounceTimeout);
      scrollStateRef.current.debounceTimeout = null;
    }
    if (scrollStateRef.current.rafId !== null) {
      cancelAnimationFrame(scrollStateRef.current.rafId);
      scrollStateRef.current.rafId = null;
    }

    const containerElement = contentRef?.current ?? null;
    const currentMetrics = getCurrentScrollMetrics(
      progressStateRef.current.lastKnownMetrics,
      containerElement,
    );

    // If current scroll position is 0 (likely during restoration or before content loads),
    // and we have a last known good position, use that instead to prevent overwriting
    // valid progress with invalid 0 position
    let metricsToUse = currentMetrics;
    if (currentMetrics && currentMetrics.scrollTop === 0 && 
        progressStateRef.current.lastKnownMetrics && 
        progressStateRef.current.lastKnownMetrics.scrollTop > 0) {
      console.debug("[useChapterProgress] Using last known metrics to prevent overwriting with 0", {
        chapterId: activeChapter.id,
        currentScrollTop: currentMetrics.scrollTop,
        lastKnownScrollTop: progressStateRef.current.lastKnownMetrics.scrollTop,
      });
      // Use last known metrics but update with current dimensions if available
      metricsToUse = {
        ...progressStateRef.current.lastKnownMetrics,
        scrollHeight: currentMetrics.scrollHeight || progressStateRef.current.lastKnownMetrics.scrollHeight,
        clientHeight: currentMetrics.clientHeight || progressStateRef.current.lastKnownMetrics.clientHeight,
        maxScroll: currentMetrics.maxScroll || progressStateRef.current.lastKnownMetrics.maxScroll,
      };
    } else if (currentMetrics && (currentMetrics.maxScroll > 0 || currentMetrics.scrollTop > 0)) {
      // Update lastKnownMetrics with valid current metrics
      progressStateRef.current.lastKnownMetrics = currentMetrics;
    }

    const snapshot = createProgressSnapshot(activeChapter.id, metricsToUse);
    progressStateRef.current.lastProgress = snapshot;
    
    console.log("[useChapterProgress] Saving progress", {
      chapterId: activeChapter.id,
      scrollTop: snapshot.scrollTop,
      percent: snapshot.percent,
      scrollHeight: snapshot.scrollHeight,
      usedLastKnown: metricsToUse !== currentMetrics,
    });
    
    onProgress(snapshot);
  }, [activeChapter, onProgress, contentRef]);

  const updateMetricsOnScroll = useCallback(() => {
    const containerElement = contentRef?.current ?? null;
    const metrics = getCurrentScrollMetrics(
      progressStateRef.current.lastKnownMetrics,
      containerElement,
    );
    if (metrics.maxScroll > 0 || metrics.scrollTop > 0) {
      progressStateRef.current.lastKnownMetrics = metrics;
    }
  }, [contentRef]);

  useEffect(() => {
    if (onSaveProgress) {
      onSaveProgress(saveProgress);
    }
  }, [saveProgress, onSaveProgress]);

  useEffect(() => {
    const currentChapterId = activeChapter?.id;
    if (previousChapterId && previousChapterId !== currentChapterId) {
      const timer = setTimeout(() => {
        saveProgress();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [activeChapter?.id, previousChapterId, saveProgress]);

  return {
    emitChapterProgress,
    saveProgress,
    updateMetricsOnScroll,
  };
}

