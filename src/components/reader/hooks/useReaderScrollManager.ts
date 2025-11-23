import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type MutableRefObject,
} from "react";

import { getChapterPageCount } from "../../../lib/utils";
import type { Book, Chapter, ReaderPreferences } from "../../../types/reader";
import type { ChapterProgressSnapshot } from "../types";

const clampValue = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

type UseReaderScrollManagerArgs = {
  activeBook?: Book;
  activeChapter?: Chapter;
  preferences: ReaderPreferences;
  chromeVisible: boolean;
  audioPlayerVisible: boolean;
  pendingFragment: string | null;
  onFragmentConsumed: () => void;
  scrollIntent?: "top" | "bottom" | null;
  onScrollIntentConsumed?: () => void;
  onChapterProgress?: (snapshot: ChapterProgressSnapshot) => void;
};

type UseReaderScrollManagerResult = {
  contentRef: MutableRefObject<HTMLDivElement | null>;
  handleScroll: () => void;
  requestNavigationIntent: (intent: "top" | "bottom") => void;
};

export function useReaderScrollManager({
  activeBook,
  activeChapter,
  preferences,
  chromeVisible,
  audioPlayerVisible,
  pendingFragment,
  onFragmentConsumed,
  scrollIntent,
  onScrollIntentConsumed,
  onChapterProgress,
}: UseReaderScrollManagerArgs): UseReaderScrollManagerResult {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const navigationScrollIntentRef = useRef<"top" | "bottom" | null>(null);
  const pendingScrollIntentRef = useRef<"top" | "bottom" | null>(null);
  const lastProgressRef = useRef<{
    chapterId: string;
    pageIndex: number;
    pageCount: number;
    percent: number;
  } | null>(null);
  const scrollRafRef = useRef<number | null>(null);
  const shouldRestoreProgressRef = useRef(false);

  const hasActiveBook = Boolean(activeBook && activeBook.chapters.length);

  const chapterProgress = useMemo(() => {
    if (!activeBook || !activeBook.progress || !activeChapter) {
      return null;
    }

    const progress = activeBook.progress;
    const chapters = activeBook.chapters ?? [];

    if (progress.currentChapterId && progress.currentChapterId !== activeChapter.id) {
      return null;
    }

    if (!progress.currentChapterId) {
      const candidateIndex =
        typeof progress.currentChapterIndex === "number" && Number.isFinite(progress.currentChapterIndex)
          ? clampValue(
              Math.round(progress.currentChapterIndex),
              0,
              Math.max(chapters.length - 1, 0),
            )
          : -1;

      if (
        candidateIndex >= 0 &&
        chapters[candidateIndex] &&
        chapters[candidateIndex]?.id !== activeChapter.id
      ) {
        return null;
      }
    }

    const pageCountCandidate =
      typeof progress.currentChapterPageCount === "number" &&
      Number.isFinite(progress.currentChapterPageCount)
        ? progress.currentChapterPageCount
        : getChapterPageCount(activeChapter) ?? 1;
    const pageCount = Math.max(1, Math.round(pageCountCandidate));

    const pageIndexCandidate =
      typeof progress.currentChapterPageIndex === "number" &&
      Number.isFinite(progress.currentChapterPageIndex)
        ? progress.currentChapterPageIndex
        : 0;
    const pageIndex = clampValue(Math.round(pageIndexCandidate), 0, Math.max(pageCount - 1, 0));

    const percentCandidate = progress.chapterProgressPercent;
    const percent =
      typeof percentCandidate === "number" && Number.isFinite(percentCandidate)
        ? clampValue(percentCandidate, 0, 1)
        : pageCount > 1
          ? pageIndex / Math.max(pageCount - 1, 1)
          : pageIndex > 0
            ? 1
            : 0;

    return {
      pageIndex,
      pageCount,
      percent,
    };
  }, [activeBook, activeChapter]);

  const emitChapterProgress = useCallback(() => {
    if (!activeChapter || !onChapterProgress) {
      return;
    }

    const node = contentRef.current;
    const pageCount = Math.max(getChapterPageCount(activeChapter) ?? 1, 1);

    let percent = 0;
    if (node) {
      const maxScroll = Math.max(node.scrollHeight - node.clientHeight, 0);
      if (maxScroll > 0) {
        percent = Math.min(Math.max(node.scrollTop / maxScroll, 0), 1);
      } else {
        percent = node.scrollTop > 0 ? 1 : 0;
      }

      const atBottom =
        maxScroll <= 1 ||
        node.scrollTop + node.clientHeight >= node.scrollHeight - 1;
      if (atBottom) {
        percent = 1;
      }
    }

    const rawPageIndex = Math.floor(percent * pageCount);
    const pageIndex =
      percent >= 0.999 || rawPageIndex >= pageCount
        ? pageCount - 1
        : Math.min(Math.max(rawPageIndex, 0), Math.max(pageCount - 1, 0));

    const normalizedPercent =
      pageCount <= 1 ? (pageIndex > 0 ? 1 : percent) : percent;

    const snapshot: ChapterProgressSnapshot = {
      chapterId: activeChapter.id,
      pageIndex,
      pageCount,
      percent: Number(normalizedPercent.toFixed(4)),
    };

    const last = lastProgressRef.current;
    if (
      last &&
      last.chapterId === snapshot.chapterId &&
      last.pageIndex === snapshot.pageIndex &&
      last.pageCount === snapshot.pageCount &&
      Math.abs(last.percent - snapshot.percent) < 0.005
    ) {
      return;
    }

    lastProgressRef.current = snapshot;
    onChapterProgress(snapshot);
  }, [activeChapter, onChapterProgress]);

  const scheduleProgressEmit = useCallback(() => {
    if (!activeChapter || !onChapterProgress) {
      return;
    }
    if (scrollRafRef.current !== null) {
      return;
    }

    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      emitChapterProgress();
    });
  }, [activeChapter, emitChapterProgress, onChapterProgress]);

  const handleScroll = useCallback(() => {
    if (!activeChapter || !onChapterProgress) {
      return;
    }
    scheduleProgressEmit();
  }, [activeChapter, onChapterProgress, scheduleProgressEmit]);

  useEffect(() => {
    shouldRestoreProgressRef.current = true;
  }, [activeBook?.id, activeChapter?.id]);

  const applyScrollIntent = useCallback((intent: "top" | "bottom" | null) => {
    const node = contentRef.current;
    if (!node || !intent) return false;
    const targetTop =
      intent === "bottom"
        ? Math.max(0, node.scrollHeight - node.clientHeight)
        : 0;

    node.scrollTop = targetTop;
    return Math.abs(node.scrollTop - targetTop) <= 1;
  }, []);

  useLayoutEffect(() => {
    const externalIntent = scrollIntent ?? null;
    const defaultIntent = chapterProgress ? null : "top";
    const intent = navigationScrollIntentRef.current ?? externalIntent ?? defaultIntent;
    navigationScrollIntentRef.current = null;
    pendingScrollIntentRef.current = intent ?? null;
    if (scrollIntent !== undefined) {
      onScrollIntentConsumed?.();
    }

    if (!intent) {
      pendingScrollIntentRef.current = null;
      shouldRestoreProgressRef.current = Boolean(chapterProgress);
      scheduleProgressEmit();
      return;
    }

    shouldRestoreProgressRef.current = false;

    if (applyScrollIntent(intent)) {
      pendingScrollIntentRef.current = null;
      scheduleProgressEmit();
    } else if (intent === "bottom") {
      requestAnimationFrame(() => {
        if (applyScrollIntent(pendingScrollIntentRef.current)) {
          pendingScrollIntentRef.current = null;
        }
        scheduleProgressEmit();
      });
    } else {
      scheduleProgressEmit();
    }
  }, [
    activeChapter?.id,
    chapterProgress,
    scrollIntent,
    onScrollIntentConsumed,
    scheduleProgressEmit,
    applyScrollIntent,
  ]);

  useEffect(() => {
    return () => {
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    lastProgressRef.current = null;
    if (!activeChapter || !onChapterProgress) {
      return;
    }
    scheduleProgressEmit();
  }, [activeChapter?.id, onChapterProgress, scheduleProgressEmit]);

  useEffect(() => {
    if (!activeChapter || !onChapterProgress) {
      return;
    }
    scheduleProgressEmit();
  }, [
    activeChapter?.id,
    preferences.fontFamily,
    preferences.fontSize,
    preferences.contentPadding,
    chromeVisible,
    audioPlayerVisible,
    scheduleProgressEmit,
    onChapterProgress,
  ]);

  useEffect(() => {
    if (!activeChapter || !chapterProgress) {
      return;
    }
    if (!shouldRestoreProgressRef.current) {
      return;
    }
    const node = contentRef.current;
    if (!node) {
      return;
    }

    const rafId = requestAnimationFrame(() => {
      const maxScroll = Math.max(node.scrollHeight - node.clientHeight, 0);

      if (maxScroll <= 0) {
        shouldRestoreProgressRef.current = false;
        scheduleProgressEmit();
        return;
      }

      const target =
        chapterProgress.percent >= 0.999
          ? maxScroll
          : clampValue(Math.round(maxScroll * chapterProgress.percent), 0, maxScroll);

      if (Math.abs(node.scrollTop - target) > 1) {
        node.scrollTop = target;
      }

      lastProgressRef.current = {
        chapterId: activeChapter.id,
        pageIndex: chapterProgress.pageIndex,
        pageCount: chapterProgress.pageCount,
        percent: chapterProgress.percent,
      };

      shouldRestoreProgressRef.current = false;
      scheduleProgressEmit();
    });

    return () => cancelAnimationFrame(rafId);
  }, [activeChapter?.id, chapterProgress, scheduleProgressEmit]);

  useEffect(() => {
    const node = contentRef.current;
    if (!node) return;

    if (!pendingScrollIntentRef.current) return;

    if (typeof ResizeObserver === "undefined") {
      const timeout = setTimeout(() => {
        if (applyScrollIntent(pendingScrollIntentRef.current)) {
          pendingScrollIntentRef.current = null;
          scheduleProgressEmit();
        }
      }, 50);
      return () => clearTimeout(timeout);
    }

    const observer = new ResizeObserver(() => {
      if (!pendingScrollIntentRef.current) return;
      if (applyScrollIntent(pendingScrollIntentRef.current)) {
        pendingScrollIntentRef.current = null;
        scheduleProgressEmit();
      }
    });

    observer.observe(node);
    return () => observer.disconnect();
  }, [activeChapter?.id, scheduleProgressEmit, applyScrollIntent]);

  useEffect(() => {
    const node = contentRef.current;
    if (!node) return;
    node.scrollTo({ top: 0, behavior: "auto" });
    scheduleProgressEmit();
  }, [
    preferences.fontFamily,
    preferences.fontSize,
    preferences.contentPadding,
    scheduleProgressEmit,
  ]);

  useEffect(() => {
    if (!pendingFragment) return;
    const root = contentRef.current;
    if (!root) return;

    const fragment = pendingFragment.replace(/^#/, "");

    const scrollToFragment = () => {
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
      onFragmentConsumed();
    };

    const id = requestAnimationFrame(scrollToFragment);
    return () => cancelAnimationFrame(id);
  }, [
    pendingFragment,
    onFragmentConsumed,
    activeChapter?.id,
    hasActiveBook,
    scheduleProgressEmit,
  ]);

  const requestNavigationIntent = useCallback((intent: "top" | "bottom") => {
    navigationScrollIntentRef.current = intent;
  }, []);

  return {
    contentRef,
    handleScroll,
    requestNavigationIntent,
  };
}


