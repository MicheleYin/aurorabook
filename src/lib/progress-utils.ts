/**
 * Shared utilities for progress tracking and metrics management
 */

import type { ScrollMetrics } from "./scroll-utils";
import { computeWindowScrollMetrics, computeScrollMetrics, calculateProgress } from "./scroll-utils";
import type { ChapterProgressSnapshot } from "../components/reader/types";

/**
 * Selects the best metrics to use, preferring current metrics but falling back
 * to last known metrics when current metrics are invalid (e.g., during layout changes)
 */
export function selectBestMetrics(
  currentMetrics: ScrollMetrics,
  lastKnownMetrics: ScrollMetrics | null,
): ScrollMetrics {
  // If current metrics show actual scroll position, use them
  if (currentMetrics.maxScroll > 0 || currentMetrics.scrollTop > 0) {
    return currentMetrics;
  }

  // If current metrics show no scroll but we have valid last known metrics, use those
  if (
    lastKnownMetrics &&
    (lastKnownMetrics.maxScroll > 0 || lastKnownMetrics.scrollTop > 0)
  ) {
    return lastKnownMetrics;
  }

  // Fallback to current metrics (even if they're 0)
  return currentMetrics;
}

/**
 * Creates a progress snapshot from metrics
 */
export function createProgressSnapshot(
  chapterId: string,
  metrics: ScrollMetrics,
): ChapterProgressSnapshot {
  const percent = calculateProgress(metrics);
  return {
    chapterId,
    scrollTop: metrics.scrollTop,
    scrollHeight: metrics.scrollHeight,
    clientHeight: metrics.clientHeight,
    percent: Number(percent.toFixed(4)),
    activeElementId: null,
    activeElementIndex: null,
  };
}

/**
 * Checks if two progress snapshots are effectively the same (within tolerance)
 */
export function isProgressUnchanged(
  previous: ChapterProgressSnapshot | null,
  current: ChapterProgressSnapshot,
  tolerance: {
    scrollTop?: number;
    scrollHeight?: number;
    clientHeight?: number;
    percent?: number;
  } = {},
): boolean {
  if (!previous || previous.chapterId !== current.chapterId) {
    return false;
  }

  const {
    scrollTop = 0.5,
    scrollHeight = 1,
    clientHeight = 1,
    percent = 0.001,
  } = tolerance;

  return (
    Math.abs(previous.scrollTop - current.scrollTop) < scrollTop &&
    Math.abs(previous.scrollHeight - current.scrollHeight) < scrollHeight &&
    Math.abs(previous.clientHeight - current.clientHeight) < clientHeight &&
    Math.abs(previous.percent - current.percent) < percent
  );
}

/**
 * Gets current scroll metrics with fallback to last known
 * Uses container metrics if provided and scrollable, otherwise falls back to window metrics
 */
export function getCurrentScrollMetrics(
  lastKnownMetrics: ScrollMetrics | null,
  containerElement?: HTMLElement | null,
): ScrollMetrics {
  // Try container first if provided
  let currentMetrics: ScrollMetrics | null = null;
  
  if (containerElement) {
    const containerMetrics = computeScrollMetrics(containerElement);
    // Use container if it's actually scrollable (maxScroll > 0)
    if (containerMetrics && containerMetrics.maxScroll > 0) {
      currentMetrics = containerMetrics;
    }
  }
  
  // Fall back to window if container isn't scrollable or not provided
  if (!currentMetrics) {
    currentMetrics = computeWindowScrollMetrics();
  }
  
  return selectBestMetrics(currentMetrics, lastKnownMetrics);
}

