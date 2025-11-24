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

const CHAPTER_CONTENT_SELECTOR = '[data-reader-chapter-content="true"]';
const READER_BLOCK_ID_ATTR = "data-reader-block-id";
const READER_BLOCK_INDEX_ATTR = "data-reader-block-index";
const TRACKABLE_ELEMENT_SELECTOR = [
  "p",
  "div",
  "section",
  "article",
  "blockquote",
  "pre",
  "figure",
  "table",
  "aside",
  "header",
  "footer",
  "main",
  "nav",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
].join(",");

type ActiveTrackable = {
  element: HTMLElement;
  index: number;
};

const collectTrackableElements = (container: HTMLElement | null): HTMLElement[] => {
  if (!container) {
    return [];
  }

  const candidates = Array.from(
    container.querySelectorAll<HTMLElement>(TRACKABLE_ELEMENT_SELECTOR),
  ).filter((element) => element instanceof HTMLElement);

  if (candidates.length > 0) {
    return candidates;
  }

  const childElements = Array.from(container.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement,
  );

  if (childElements.length > 0) {
    return childElements;
  }

  return [container];
};

const ensureTrackableMetadata = (chapterId: string, elements: HTMLElement[]) => {
  elements.forEach((element, index) => {
    const existingId =
      element.getAttribute(READER_BLOCK_ID_ATTR)?.trim() ?? element.dataset.readerBlockId?.trim();
    const candidateId =
      existingId && existingId.length > 0
        ? existingId
        : element.id && element.id.trim().length > 0
          ? element.id.trim()
          : `${chapterId}::div-${index}`;

    element.setAttribute(READER_BLOCK_ID_ATTR, candidateId);
    element.dataset.readerBlockId = candidateId;

    const indexString = String(index);
    element.setAttribute(READER_BLOCK_INDEX_ATTR, indexString);
    element.dataset.readerBlockIndex = indexString;
  });
};

const resolveActiveTrackable = (
  scrollNode: HTMLElement | null,
  elements: HTMLElement[],
): ActiveTrackable | null => {
  if (!scrollNode || elements.length === 0) {
    return null;
  }

  const viewportRect = scrollNode.getBoundingClientRect();
  const viewportTop = viewportRect.top;
  const viewportBottom = viewportRect.bottom;

  let lastAbove: ActiveTrackable | null = null;
  let firstBelow: ActiveTrackable | null = null;

  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index];
    const rect = element.getBoundingClientRect();

    const isAbove = rect.bottom < viewportTop + 1;
    const isBelow = rect.top > viewportBottom - 1;
    const intersects =
      rect.bottom >= viewportTop + 1 && rect.top <= viewportBottom - 1;

    if (intersects) {
      return { element, index };
    }

    if (isAbove) {
      lastAbove = { element, index };
      continue;
    }

    if (isBelow && !firstBelow) {
      firstBelow = { element, index };
      continue;
    }
  }

  if (firstBelow) {
    return firstBelow;
  }

  if (lastAbove) {
    return lastAbove;
  }

  if (elements.length > 0) {
    const lastIndex = elements.length - 1;
    return { element: elements[lastIndex], index: lastIndex };
  }

  return null;
};

const findChapterContentElement = (
  root: HTMLElement | null,
  chapterId: string | undefined,
): HTMLElement | null => {
  if (!root) {
    return null;
  }

  if (!chapterId) {
    return root.querySelector<HTMLElement>(CHAPTER_CONTENT_SELECTOR);
  }

  return (
    root.querySelector<HTMLElement>(
      `${CHAPTER_CONTENT_SELECTOR}[data-chapter-id="${chapterId}"]`,
    ) ?? root.querySelector<HTMLElement>(CHAPTER_CONTENT_SELECTOR)
  );
};

const prepareTrackableElements = (
  root: HTMLElement | null,
  chapterId: string | undefined,
): HTMLElement[] => {
  if (!root || !chapterId) {
    return [];
  }

  const container = findChapterContentElement(root, chapterId);
  if (!container) {
    return [];
  }

  const elements = collectTrackableElements(container);
  ensureTrackableMetadata(chapterId, elements);
  return elements;
};

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
    activeElementId: string | null;
    activeElementIndex: number | null;
  } | null>(null);
  const trackableElementsRef = useRef<HTMLElement[]>([]);
  const scrollRafRef = useRef<number | null>(null);
  const shouldRestoreProgressRef = useRef(false);

  const refreshTrackableElements = useCallback((): HTMLElement[] => {
    const node = contentRef.current;
    if (!activeChapter || !node) {
      trackableElementsRef.current = [];
      return [];
    }

    const elements = prepareTrackableElements(node, activeChapter.id);
    trackableElementsRef.current = elements;
    return elements;
  }, [activeChapter?.id, contentRef]);

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

  useEffect(() => {
    if (!activeChapter) {
      trackableElementsRef.current = [];
      return;
    }

    const rafId = requestAnimationFrame(() => {
      const elements = refreshTrackableElements();
      console.debug(`${LOG_PREFIX} refreshed trackable elements`, {
        chapterId: activeChapter.id,
        count: elements.length,
      });
    });

    return () => cancelAnimationFrame(rafId);
  }, [activeChapter?.id, activeChapter?.contentHtml, refreshTrackableElements]);

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

    const elementId =
      typeof progress.currentChapterElementId === "string" &&
      progress.currentChapterElementId.trim().length > 0
        ? progress.currentChapterElementId.trim()
        : null;

    const elementIndex =
      typeof progress.currentChapterElementIndex === "number" &&
      Number.isFinite(progress.currentChapterElementIndex)
        ? Math.max(Math.round(progress.currentChapterElementIndex), 0)
        : null;

    const snapshot = {
      chapterId: activeChapter.id,
      scrollTop,
      scrollHeight,
      clientHeight,
      percent,
      activeElementId: elementId,
      activeElementIndex: elementIndex,
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
      maxScroll > 0 && scrollTop + clientHeight >= scrollHeight - 1;
    if (atBottom) {
      percent = 1;
    }

    const elements =
      trackableElementsRef.current.length > 0
        ? trackableElementsRef.current
        : refreshTrackableElements();
    const activeTrackable = resolveActiveTrackable(node, elements);
    const activeElementId =
      activeTrackable?.element.getAttribute(READER_BLOCK_ID_ATTR) ??
      activeTrackable?.element.dataset.readerBlockId ??
      null;
    const activeElementIndex = activeTrackable ? activeTrackable.index : null;

    const snapshot: ChapterProgressSnapshot = {
      chapterId: activeChapter.id,
      scrollTop,
      scrollHeight,
      clientHeight,
      percent: Number(percent.toFixed(4)),
      activeElementId,
      activeElementIndex,
    };

    const last = lastProgressRef.current;
    if (
      last &&
      last.chapterId === snapshot.chapterId &&
      Math.abs(last.scrollTop - snapshot.scrollTop) < 1 &&
      Math.abs(last.scrollHeight - snapshot.scrollHeight) < 1 &&
      Math.abs(last.clientHeight - snapshot.clientHeight) < 1 &&
      Math.abs(last.percent - snapshot.percent) < 0.002 &&
      (last.activeElementId ?? null) === (snapshot.activeElementId ?? null) &&
      (last.activeElementIndex ?? null) === (snapshot.activeElementIndex ?? null)
    ) {
      return;
    }

    lastProgressRef.current = snapshot;
    console.debug(`${LOG_PREFIX} emitting progress`, snapshot);
    onChapterProgress(snapshot);
  }, [activeChapter, onChapterProgress, refreshTrackableElements]);

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

      const elements =
        trackableElementsRef.current.length > 0
          ? trackableElementsRef.current
          : refreshTrackableElements();

      const savedMaxScroll = Math.max(
        chapterProgress.scrollHeight - chapterProgress.clientHeight,
        0,
      );

      const normalizedSavedIndex =
        typeof chapterProgress.activeElementIndex === "number" &&
        Number.isFinite(chapterProgress.activeElementIndex)
          ? Math.max(Math.round(chapterProgress.activeElementIndex), 0)
          : null;

      let targetElement: HTMLElement | null = null;
      if (chapterProgress.activeElementId) {
        targetElement =
          elements.find(
            (element) =>
              element.getAttribute(READER_BLOCK_ID_ATTR) === chapterProgress.activeElementId,
          ) ?? null;
      }

      if (!targetElement && normalizedSavedIndex !== null && elements[normalizedSavedIndex]) {
        targetElement = elements[normalizedSavedIndex];
      }

      let targetFromElement: number | null = null;
      if (targetElement) {
        const nodeRect = node.getBoundingClientRect();
        const elementRect = targetElement.getBoundingClientRect();
        const offset = elementRect.top - nodeRect.top + node.scrollTop;
        targetFromElement = clampValue(Math.round(offset), 0, maxScroll);
      }

      let target = targetFromElement ?? 0;
      if (targetFromElement === null) {
        if (chapterProgress.percent >= 0.999 && maxScroll > 0) {
          target = maxScroll;
        } else if (savedMaxScroll > 0 && maxScroll > 0 && chapterProgress.scrollTop > 0) {
          const savedRatio = clampValue(chapterProgress.scrollTop / savedMaxScroll, 0, 1);
          target = Math.round(savedRatio * maxScroll);
        } else if (maxScroll > 0) {
          target = Math.round(clampValue(chapterProgress.percent, 0, 1) * maxScroll);
        }
      }

      if (Math.abs(node.scrollTop - target) > 1) {
        console.debug(`${LOG_PREFIX} restoring scroll position`, {
          chapterId: activeChapter.id,
          target,
          current: node.scrollTop,
          maxScroll,
          saved: chapterProgress,
          viaElement: Boolean(targetElement),
        });
        node.scrollTop = target;
      }

      const normalizedPercent =
        maxScroll > 0 ? clampValue(node.scrollTop / maxScroll, 0, 1) : chapterProgress.percent;

      const resolvedActiveElement = targetElement
        ? {
            id:
              targetElement.getAttribute(READER_BLOCK_ID_ATTR) ??
              targetElement.dataset.readerBlockId ??
              null,
            index: (() => {
              const rawIndex = elements.indexOf(targetElement);
              return rawIndex >= 0 ? rawIndex : null;
            })(),
          }
        : {
            id: chapterProgress.activeElementId ?? null,
            index: normalizedSavedIndex,
          };

      const normalizedResolvedIndex =
        typeof resolvedActiveElement.index === "number" && Number.isFinite(resolvedActiveElement.index)
          ? Math.max(resolvedActiveElement.index, 0)
          : null;

      lastProgressRef.current = {
        chapterId: activeChapter.id,
        scrollTop: Math.max(node.scrollTop, 0),
        scrollHeight,
        clientHeight,
        percent: normalizedPercent,
        activeElementId: resolvedActiveElement.id,
        activeElementIndex: normalizedResolvedIndex,
      };

      shouldRestoreProgressRef.current = false;
      console.debug(`${LOG_PREFIX} restore complete`, lastProgressRef.current);
      scheduleProgressEmit();
    });

    return () => cancelAnimationFrame(rafId);
  }, [activeChapter?.id, chapterProgress, refreshTrackableElements, scheduleProgressEmit]);

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



