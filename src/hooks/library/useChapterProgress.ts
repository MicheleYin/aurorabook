/**
 * Chapter progress tracking hook - simplified version
 * Tracks scroll metrics and creates progress snapshots
 * No useEffects - save function registration is explicit
 * 
 * Refactored to maintain internal scroll state that is updated on every scroll event.
 * This ensures scroll position is always available when saving, even if DOM is reset during navigation.
 */

import { useCallback, useRef, useEffect } from "react";
import {
  createProgressSnapshot,
  isProgressUnchanged as isProgressSnapshotUnchanged,
} from "../../lib/progress-utils";
import type { UseChapterProgressParams } from "./types";
import type { ScrollMetrics } from "../../lib/scroll-utils";
import { computeScrollMetrics, computeWindowScrollMetrics } from "../../lib/scroll-utils";

export function useChapterProgress(params: UseChapterProgressParams) {
  const {
    activeChapter,
    contentRef,
    onProgress,
    onSaveProgress,
    isRestoringScroll = false,
  } = params;

  // Internal scroll state - tracks the current scroll position for the active chapter
  // This is updated on every scroll event and used when saving progress
  const scrollStateRef = useRef<{
    chapterId: string | null;
    metrics: ScrollMetrics | null;
  }>({
    chapterId: null,
    metrics: null,
  });

  const progressStateRef = useRef({
    lastProgress: null as Parameters<NonNullable<typeof onProgress>>[0] | null,
    saveFunction: null as (() => void) | null,
  });

  const isRestoringRef = useRef(
    typeof isRestoringScroll === "function" ? isRestoringScroll() : isRestoringScroll
  );
  // Update ref every render - if isRestoringScroll is a function, call it; otherwise use the value
  isRestoringRef.current = typeof isRestoringScroll === "function" 
    ? isRestoringScroll() 
    : isRestoringScroll;

  // Reset scroll state when chapter changes
  if (activeChapter && scrollStateRef.current.chapterId !== activeChapter.id) {
    scrollStateRef.current.chapterId = activeChapter.id;
    scrollStateRef.current.metrics = null;
  }

  // Helper to get current scroll metrics from DOM
  const getCurrentScrollMetricsFromDOM = useCallback((): ScrollMetrics => {
    const containerElement = contentRef?.current ?? null;
    
    // Try container first if provided
    if (containerElement) {
      const containerMetrics = computeScrollMetrics(containerElement);
      // Use container if it's actually scrollable (maxScroll > 0)
      if (containerMetrics && containerMetrics.maxScroll > 0) {
        return containerMetrics;
      }
    }
    
    // Fall back to window scroll metrics
    return computeWindowScrollMetrics();
  }, [contentRef]);

  const emitChapterProgress = useCallback(() => {
    if (!activeChapter || !onProgress || isRestoringRef.current) {
      return;
    }

    // Use internal scroll state if available, otherwise read from DOM
    let metrics: ScrollMetrics;
    if (
      scrollStateRef.current.chapterId === activeChapter.id &&
      scrollStateRef.current.metrics &&
      (scrollStateRef.current.metrics.maxScroll > 0 || scrollStateRef.current.metrics.scrollTop > 0)
    ) {
      // Use tracked scroll state
      metrics = scrollStateRef.current.metrics;
    } else {
      // Fallback to reading from DOM
      metrics = getCurrentScrollMetricsFromDOM();
      
      // Update scroll state if we got valid metrics
      if (metrics.maxScroll > 0 || metrics.scrollTop > 0) {
        scrollStateRef.current.metrics = metrics;
      }
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
  }, [activeChapter, onProgress, getCurrentScrollMetricsFromDOM]);

  const saveProgress = useCallback(() => {
    if (!activeChapter || !onProgress) {
      return;
    }

    // Skip saving if we're currently restoring scroll position
    if (isRestoringRef.current) {
      return;
    }

    // Always read fresh from DOM first to get the absolute latest scroll position
    // This ensures we save the most up-to-date position, not a cached one
    const currentMetrics = getCurrentScrollMetricsFromDOM();
    
    let metricsToUse: ScrollMetrics;
    
    // Prefer fresh DOM metrics if available and valid
    if (currentMetrics && (currentMetrics.maxScroll > 0 || currentMetrics.scrollTop > 0)) {
      metricsToUse = currentMetrics;
      // Update cached state for future reference
      scrollStateRef.current.chapterId = activeChapter.id;
      scrollStateRef.current.metrics = currentMetrics;
    } else if (
      // Fallback to cached state only if DOM is not available (e.g., during navigation)
      scrollStateRef.current.chapterId === activeChapter.id &&
      scrollStateRef.current.metrics &&
      (scrollStateRef.current.metrics.maxScroll > 0 || scrollStateRef.current.metrics.scrollTop > 0)
    ) {
      // Use cached scroll state as fallback when DOM is reset
      metricsToUse = scrollStateRef.current.metrics;
    } else {
      // If neither DOM nor cached state is available, we can't save valid progress
      console.warn("[useChapterProgress] Cannot save progress: no valid scroll state", {
        chapterId: activeChapter.id,
        hasTrackedState: !!scrollStateRef.current.metrics,
        trackedScrollTop: scrollStateRef.current.metrics?.scrollTop,
        domScrollTop: currentMetrics?.scrollTop,
        domMaxScroll: currentMetrics?.maxScroll,
      });
      return;
    }

    const snapshot = createProgressSnapshot(activeChapter.id, metricsToUse);
    progressStateRef.current.lastProgress = snapshot;
    onProgress(snapshot);
  }, [activeChapter, onProgress, getCurrentScrollMetricsFromDOM]);

  // Use requestAnimationFrame for more responsive scroll tracking
  // This batches DOM reads to the next frame while still being very responsive
  const updateMetricsOnScrollFrameRef = useRef<number | null>(null);
  
  const updateMetricsOnScroll = useCallback(() => {
    // Skip updating if we're restoring scroll position
    if (isRestoringRef.current) {
      return;
    }

    // Cancel any pending frame update
    if (updateMetricsOnScrollFrameRef.current !== null) {
      cancelAnimationFrame(updateMetricsOnScrollFrameRef.current);
    }

    // Schedule update for next frame for better performance and responsiveness
    // This ensures we capture the latest scroll position without blocking the scroll event
    updateMetricsOnScrollFrameRef.current = requestAnimationFrame(() => {
      updateMetricsOnScrollFrameRef.current = null;
      
      // Always update internal scroll state on scroll events
      // This ensures we have the latest position available when saving
      const metrics = getCurrentScrollMetricsFromDOM();
      
      // Update scroll state if we got valid metrics
      if (metrics && (metrics.maxScroll > 0 || metrics.scrollTop > 0)) {
        scrollStateRef.current.chapterId = activeChapter?.id || null;
        scrollStateRef.current.metrics = metrics;
      }
    });
  }, [getCurrentScrollMetricsFromDOM, activeChapter]);

  // Method to update scroll state (used by restoration to sync state)
  const updateScrollState = useCallback((chapterId: string, metrics: ScrollMetrics) => {
    if (chapterId === activeChapter?.id) {
      scrollStateRef.current.chapterId = chapterId;
      scrollStateRef.current.metrics = metrics;
    }
  }, [activeChapter]);

  // Register save function if provided (explicit, no useEffect)
  if (onSaveProgress && progressStateRef.current.saveFunction !== saveProgress) {
    progressStateRef.current.saveFunction = saveProgress;
    onSaveProgress(saveProgress);
  }

  // Cleanup requestAnimationFrame on unmount
  useEffect(() => {
    return () => {
      if (updateMetricsOnScrollFrameRef.current !== null) {
        cancelAnimationFrame(updateMetricsOnScrollFrameRef.current);
        updateMetricsOnScrollFrameRef.current = null;
      }
    };
  }, []);

  return {
    emitChapterProgress,
    saveProgress,
    updateMetricsOnScroll,
    updateScrollState,
  };
}
