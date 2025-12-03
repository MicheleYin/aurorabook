/**
 * Chapter progress tracking hook - simplified version
 * Tracks scroll metrics and creates progress snapshots
 * No useEffects - save function registration is explicit
 */

import { useCallback, useRef } from "react";
import {
  getCurrentScrollMetrics,
  createProgressSnapshot,
  isProgressUnchanged as isProgressSnapshotUnchanged,
} from "../../lib/progress-utils";
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
    saveFunction: null as (() => void) | null,
  });

  const isRestoringRef = useRef(isRestoringScroll);
  isRestoringRef.current = isRestoringScroll;

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
      return;
    }

    // Skip saving if we're currently restoring scroll position
    if (isRestoringRef.current) {
      return;
    }

    const containerElement = contentRef?.current ?? null;
    const currentMetrics = getCurrentScrollMetrics(
      progressStateRef.current.lastKnownMetrics,
      containerElement,
    );

    // If current scroll position is 0 (likely during restoration),
    // use last known metrics to prevent overwriting valid progress
    let metricsToUse = currentMetrics;
    if (
      currentMetrics &&
      currentMetrics.scrollTop === 0 &&
      progressStateRef.current.lastKnownMetrics &&
      progressStateRef.current.lastKnownMetrics.scrollTop > 0
    ) {
      metricsToUse = {
        ...progressStateRef.current.lastKnownMetrics,
        scrollHeight: currentMetrics.scrollHeight || progressStateRef.current.lastKnownMetrics.scrollHeight,
        clientHeight: currentMetrics.clientHeight || progressStateRef.current.lastKnownMetrics.clientHeight,
        maxScroll: currentMetrics.maxScroll || progressStateRef.current.lastKnownMetrics.maxScroll,
      };
    } else if (currentMetrics && (currentMetrics.maxScroll > 0 || currentMetrics.scrollTop > 0)) {
      progressStateRef.current.lastKnownMetrics = currentMetrics;
    }

    const snapshot = createProgressSnapshot(activeChapter.id, metricsToUse);
    progressStateRef.current.lastProgress = snapshot;
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

  // Register save function if provided (explicit, no useEffect)
  if (onSaveProgress && progressStateRef.current.saveFunction !== saveProgress) {
    progressStateRef.current.saveFunction = saveProgress;
    onSaveProgress(saveProgress);
  }

  return {
    emitChapterProgress,
    saveProgress,
    updateMetricsOnScroll,
  };
}
