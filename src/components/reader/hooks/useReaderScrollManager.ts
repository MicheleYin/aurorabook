import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type MutableRefObject,
} from "react";

import type { Book, Chapter, ReaderPreferences } from "../../../types/reader";

const LOG_PREFIX = "[ReaderScroll]";
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
    scrollTop: number;
    scrollHeight: number;
    clientHeight: number;
    percent: number;
  } | null>(null);
  const scrollRafRef = useRef<number | null>(null);
  const shouldRestoreProgressRef = useRef(false);

  const hasActiveBook = Boolean(activeBook && activeBook.chapters.length);

  useEffect(() => {
    const node = contentRef.current;
    if (!node) {
      console.debug(`${LOG_PREFIX} content ref missing on layout`);
      return;
    }
    console.debug(`${LOG_PREFIX} content metrics`, {
      chapterId: activeChapter?.id,
      scrollTop: node.scrollTop,
      scrollHeight: node.scrollHeight,
      clientHeight: node.clientHeight,
      offsetHeight: node.offsetHeight,
      styleOverflowY: node.style?.overflowY,
    });
  }, [activeChapter?.id, chromeVisible, audioPlayerVisible]);

  const chapterProgress = useMemo(() => {
    if (!activeBook || !activeBook.progress || !activeChapter) {
      console.debug(`${LOG_PREFIX} no chapter progress available`, {
        bookId: activeBook?.id,
        chapterId: activeChapter?.id,
      });
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

    const scrollTop =
      typeof progress.currentChapterScrollTop === "number" && Number.isFinite(progress.currentChapterScrollTop)
        ? Math.max(progress.currentChapterScrollTop, 0)
        : 0;
    const scrollHeight =
      typeof progress.currentChapterScrollHeight === "number" &&
      Number.isFinite(progress.currentChapterScrollHeight)
        ? Math.max(progress.currentChapterScrollHeight, 0)
        : 0;
    const clientHeight =
      typeof progress.currentChapterClientHeight === "number" &&
      Number.isFinite(progress.currentChapterClientHeight)
        ? Math.max(progress.currentChapterClientHeight, 0)
        : 0;

    const percentCandidate = progress.chapterProgressPercent;
    let percent =
      typeof percentCandidate === "number" && Number.isFinite(percentCandidate)
        ? clampValue(percentCandidate, 0, 1)
        : 0;

    if (percent === 0 && scrollHeight > 0 && clientHeight > 0 && scrollTop > 0) {
      const maxScroll = Math.max(scrollHeight - clientHeight, 0);
      if (maxScroll > 0) {
        percent = clampValue(scrollTop / maxScroll, 0, 1);
      }
    }

    if (percent === 0) {
      const legacyPageIndex = (progress as unknown as { currentChapterPageIndex?: number }).currentChapterPageIndex;
      const legacyPageCount = (progress as unknown as { currentChapterPageCount?: number }).currentChapterPageCount;
      if (
        typeof legacyPageIndex === "number" &&
        Number.isFinite(legacyPageIndex) &&
        typeof legacyPageCount === "number" &&
        Number.isFinite(legacyPageCount) &&
        legacyPageCount > 1
      ) {
        percent = clampValue(
          Math.round(legacyPageIndex) / Math.max(Math.round(legacyPageCount) - 1, 1),
          0,
          1,
        );
      }
    }

    const snapshot = {
      chapterId: activeChapter.id,
      scrollTop,
      scrollHeight,
      clientHeight,
      percent,
    };

    console.debug(`${LOG_PREFIX} resolved stored progress`, snapshot);

    return snapshot;
  }, [activeBook, activeChapter]);

  const emitChapterProgress = useCallback(() => {
    if (!activeChapter || !onChapterProgress) {
      return;
    }

    const node = contentRef.current;
    if (!node) {
      return;
    }

    const scrollTop = Math.max(node.scrollTop, 0);
    const scrollHeight = Math.max(node.scrollHeight, 0);
    const clientHeight = Math.max(node.clientHeight, 0);
    const maxScroll = Math.max(scrollHeight - clientHeight, 0);

    let percent = 0;
      if (maxScroll > 0) {
      percent = clampValue(scrollTop / maxScroll, 0, 1);
      } else {
      percent = scrollTop > 0 ? 1 : 0;
      }

      const atBottom =
      maxScroll <= 1 || scrollTop + clientHeight >= scrollHeight - 1;
      if (atBottom) {
        percent = 1;
      }

    const snapshot: ChapterProgressSnapshot = {
      chapterId: activeChapter.id,
      scrollTop,
      scrollHeight,
      clientHeight,
      percent: Number(percent.toFixed(4)),
    };

    const last = lastProgressRef.current;
    if (
      last &&
      last.chapterId === snapshot.chapterId &&
      Math.abs(last.scrollTop - snapshot.scrollTop) < 1 &&
      Math.abs(last.scrollHeight - snapshot.scrollHeight) < 1 &&
      Math.abs(last.clientHeight - snapshot.clientHeight) < 1 &&
      Math.abs(last.percent - snapshot.percent) < 0.002
    ) {
      return;
    }

    lastProgressRef.current = snapshot;
    console.debug(`${LOG_PREFIX} emitting progress`, snapshot);
    onChapterProgress(snapshot);
  }, [activeChapter, onChapterProgress]);

  const scheduleProgressEmit = useCallback(() => {
    if (!activeChapter || !onChapterProgress) {
      return;
    }
    if (scrollRafRef.current !== null) {
      console.debug(`${LOG_PREFIX} emit already scheduled`, {
        chapterId: activeChapter?.id,
        scrollTop: contentRef.current?.scrollTop ?? null,
      });
      return;
    }

    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      emitChapterProgress();
    });
    console.debug(`${LOG_PREFIX} queued progress emit`, {
      chapterId: activeChapter.id,
      scrollTop: contentRef.current?.scrollTop ?? null,
    });
  }, [activeChapter, emitChapterProgress, onChapterProgress]);

  const handleScroll = useCallback(() => {
    if (!activeChapter || !onChapterProgress) {
      console.debug(`${LOG_PREFIX} handleScroll skipped`, {
        hasActiveChapter: Boolean(activeChapter),
        hasProgressHandler: Boolean(onChapterProgress),
      });
      return;
    }
    const node = contentRef.current;
    console.debug(`${LOG_PREFIX} handleScroll`, {
      chapterId: activeChapter.id,
      scrollTop: node?.scrollTop ?? null,
      scrollHeight: node?.scrollHeight ?? null,
      clientHeight: node?.clientHeight ?? null,
    });
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
      const scrollHeight = Math.max(node.scrollHeight, 0);
      const clientHeight = Math.max(node.clientHeight, 0);
      const maxScroll = Math.max(scrollHeight - clientHeight, 0);

      const savedMaxScroll = Math.max(
        chapterProgress.scrollHeight - chapterProgress.clientHeight,
        0,
      );

      let target = 0;
      if (chapterProgress.percent >= 0.999 && maxScroll > 0) {
        target = maxScroll;
      } else if (savedMaxScroll > 0 && maxScroll > 0 && chapterProgress.scrollTop > 0) {
        const savedRatio = clampValue(chapterProgress.scrollTop / savedMaxScroll, 0, 1);
        target = Math.round(savedRatio * maxScroll);
      } else if (maxScroll > 0) {
        target = Math.round(clampValue(chapterProgress.percent, 0, 1) * maxScroll);
      }

      if (Math.abs(node.scrollTop - target) > 1) {
        console.debug(`${LOG_PREFIX} restoring scroll position`, {
          chapterId: activeChapter.id,
          target,
          current: node.scrollTop,
          maxScroll,
          saved: chapterProgress,
        });
        node.scrollTop = target;
      }

      const normalizedPercent =
        maxScroll > 0 ? clampValue(node.scrollTop / maxScroll, 0, 1) : chapterProgress.percent;

      lastProgressRef.current = {
        chapterId: activeChapter.id,
        scrollTop: Math.max(node.scrollTop, 0),
        scrollHeight,
        clientHeight,
        percent: normalizedPercent,
      };

      shouldRestoreProgressRef.current = false;
      console.debug(`${LOG_PREFIX} restore complete`, lastProgressRef.current);
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


