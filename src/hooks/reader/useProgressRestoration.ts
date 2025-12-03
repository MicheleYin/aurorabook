/**
 * Hook for managing progress restoration
 * No useEffects - restoration is explicit via callbacks
 */

import { useCallback, useRef } from "react";
import type { Book, Chapter } from "../../types/reader";
import { computeScrollMetrics, computeWindowScrollMetrics } from "../../lib/scroll-utils";

type RestoreState = {
  hasRestored: boolean;
  isRestoring: boolean;
  restoredChapterId: string | null;
  shouldRestore: boolean;
};

export function useProgressRestoration() {
  const stateRef = useRef<RestoreState>({
    hasRestored: false,
    isRestoring: false,
    restoredChapterId: null,
    shouldRestore: false,
  });

  const restoreProgress = useCallback((
    book: Book,
    chapter: Chapter,
    contentRef: React.RefObject<HTMLDivElement | null>,
    onComplete?: () => void
  ) => {
    if (!book.progress || !chapter) return;
    if (stateRef.current.hasRestored) return;
    if (!stateRef.current.shouldRestore) return;

    const progress = book.progress;
    if (progress.currentChapterId !== chapter.id) return;

    stateRef.current.isRestoring = true;

    const attemptRestore = () => {
      const node = contentRef.current;
      if (!node) {
        setTimeout(attemptRestore, 50);
        return;
      }

      const containerMetrics = computeScrollMetrics(node);
      const windowMetrics = computeWindowScrollMetrics();
      
      const useContainer = containerMetrics && containerMetrics.maxScroll > 0;
      const useWindow = !useContainer && windowMetrics && windowMetrics.maxScroll > 0;
      const metrics = useContainer ? containerMetrics : (useWindow ? windowMetrics : null);

      if (!metrics || metrics.maxScroll === 0) {
        setTimeout(attemptRestore, 50);
        return;
      }

      const targetScrollTop = progress.currentChapterScrollTop > 0
        ? Math.min(progress.currentChapterScrollTop, metrics.maxScroll)
        : (progress.chapterProgressPercent > 0
          ? Math.round(progress.chapterProgressPercent * metrics.maxScroll)
          : 0);

      if (useContainer && targetScrollTop > 0) {
        node.scrollTop = targetScrollTop;
      } else if (useWindow && targetScrollTop > 0) {
        window.scrollTo({ top: targetScrollTop, behavior: "auto" });
      }

      stateRef.current.hasRestored = true;
      stateRef.current.isRestoring = false;
      stateRef.current.restoredChapterId = chapter.id;
      onComplete?.();
    };

    setTimeout(attemptRestore, 100);
  }, []);

  const reset = useCallback((shouldRestore: boolean = false) => {
    stateRef.current.hasRestored = false;
    stateRef.current.isRestoring = false;
    stateRef.current.restoredChapterId = null;
    stateRef.current.shouldRestore = shouldRestore;
  }, []);

  const markRestored = useCallback((chapterId: string) => {
    stateRef.current.hasRestored = true;
    stateRef.current.isRestoring = false;
    stateRef.current.restoredChapterId = chapterId;
  }, []);

  return {
    restoreProgress,
    reset,
    markRestored,
    getState: () => stateRef.current,
  };
}

