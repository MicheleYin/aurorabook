import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { Book, ChapterWithContent } from "../../types/book";
import type { ReaderSettings } from "./ReaderSettings";
import { useAudioProgressContext } from "../../context/AudioProgressContext";
import { useAudioTextSync } from "../../hooks/useAudioTextSync";
import { useReaderDictionary } from "../../hooks/useReaderDictionary";
import { logger } from "../../lib/logger";
import { isDictionaryCardTarget } from "../../lib/reader-dictionary";
import {
  getReaderPageCount,
  getReaderPageIndex,
  getReaderPageScrollLeft,
} from "../../lib/reader-pagination-utils";
import {
  clearReaderTextSelection,
  getPointerDistance,
  mountChapterInReaderShadowRoot,
  prepareChapterHtmlForReader,
  READER_CHROME_TOGGLE_DELAY_MS,
  scrollTopAfterChromeToggle,
  shouldToggleReaderHeaderOnClick,
} from "../../lib/reader-utils";
import { themeClassNames } from "../../lib/theme";
import { cn } from "../../lib/utils";
import { LoadingScreen } from "../app/LoadingScreen";
import { ReaderDictionaryCard } from "./ReaderDictionaryCard";

interface ReaderContentProps {
  book: Book;
  isLoading: boolean;
  currentChapter: ChapterWithContent;
  onRestoreProgress: (book: Book | null) => void;
  onContentClick?: () => void;
  settings?: ReaderSettings;
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>;
  headerRef: React.RefObject<HTMLDivElement | null> | undefined;
  isHeaderVisible?: boolean;
  onPageStatusChange?: (
    status: { currentPage: number; totalPages: number } | null
  ) => void;
}

export function ReaderContent({
  book,
  isLoading,
  currentChapter,
  onRestoreProgress,
  onContentClick,
  settings,
  scrollContainerRef,
  headerRef,
  isHeaderVisible,
  onPageStatusChange,
}: Readonly<ReaderContentProps>) {
  const isPaginated = settings?.paginationMode === "pages";
  const contentRef = useRef<HTMLDivElement>(null);
  const previousPageWidthRef = useRef(0);
  const previousPaginationModeRef = useRef(isPaginated);
  const previousLayoutChapterIdRef = useRef(currentChapter.id);
  const scrollSnapTimeoutRef = useRef<number | null>(null);
  const reportedPageStatusRef = useRef<{
    currentPage: number;
    totalPages: number;
  } | null>(null);
  const [pageStatus, setPageStatus] = useState({
    currentPage: 1,
    totalPages: 1,
  });
  const scrollPositionRef = useRef<number>(0);
  const pendingChromeScrollRef = useRef<{
    scrollTop: number;
    headerHeight: number;
  } | null>(null);
  const restoredChapterKeyRef = useRef<string | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const chromeToggleTimeoutRef = useRef<number | null>(null);
  const { currentAudioTrack } = useAudioProgressContext();
  const previousAudioTrackRef =
    useRef<typeof currentAudioTrack>(currentAudioTrack);
  const {
    dictionary,
    close: closeDictionary,
    consumeChromeToggleSuppression,
  } = useReaderDictionary(contentRef);

  // Preserve scroll position when audio player opens/closes
  useEffect(() => {
    if (!scrollContainerRef?.current) return;

    const container = scrollContainerRef.current;
    const audioTrackChanged =
      previousAudioTrackRef.current !== currentAudioTrack;

    if (audioTrackChanged) {
      // Save current scroll position before audio player state changes
      scrollPositionRef.current = container.scrollTop;

      // Restore scroll position after a short delay to allow re-render to complete
      const timeoutId = setTimeout(() => {
        if (container && scrollPositionRef.current !== undefined) {
          container.scrollTop = scrollPositionRef.current;
        }
      }, 50); // Small delay to allow DOM to update

      previousAudioTrackRef.current = currentAudioTrack;

      return () => clearTimeout(timeoutId);
    }
  }, [currentAudioTrack, scrollContainerRef]);

  // Audio-text sync
  logger.log("[ReaderContent] Calling useAudioTextSync", {
    hasBook: !!book,
    bookId: book?.id,
    hasScrollContainerRef: !!scrollContainerRef,
  });
  const { beginChromeToggle } = useAudioTextSync(
    book,
    scrollContainerRef ?? null,
    headerRef,
    isHeaderVisible,
    isPaginated
  );

  const captureChromeScroll = useCallback(() => {
    const container = scrollContainerRef?.current;
    const header = headerRef?.current;
    pendingChromeScrollRef.current = {
      scrollTop: container?.scrollTop ?? 0,
      headerHeight: isHeaderVisible
        ? (header?.getBoundingClientRect().height ?? 0)
        : 0,
    };
    beginChromeToggle();
  }, [beginChromeToggle, headerRef, isHeaderVisible, scrollContainerRef]);

  const updatePageStatus = useCallback(
    (container = scrollContainerRef?.current) => {
      if (!container || !isPaginated) {
        if (reportedPageStatusRef.current !== null) {
          reportedPageStatusRef.current = null;
          setPageStatus({ currentPage: 1, totalPages: 1 });
          onPageStatusChange?.(null);
        }
        return;
      }

      const totalPages = getReaderPageCount(
        container.scrollWidth,
        container.clientWidth
      );
      const status = {
        currentPage:
          getReaderPageIndex(
            container.scrollLeft,
            container.clientWidth,
            totalPages
          ) + 1,
        totalPages,
      };
      const previousStatus = reportedPageStatusRef.current;
      if (
        previousStatus?.currentPage === status.currentPage &&
        previousStatus.totalPages === status.totalPages
      ) {
        return;
      }
      reportedPageStatusRef.current = status;
      setPageStatus(status);
      onPageStatusChange?.(status);
    },
    [isPaginated, onPageStatusChange, scrollContainerRef]
  );

  useLayoutEffect(() => {
    const container = scrollContainerRef?.current;
    const host = contentRef.current;
    if (!container || !host) return;
    if (previousLayoutChapterIdRef.current !== currentChapter.id) {
      previousLayoutChapterIdRef.current = currentChapter.id;
      container.scrollTo({ left: 0 });
      previousPageWidthRef.current = 0;
      reportedPageStatusRef.current = null;
    }
    let contentObserver: MutationObserver | null = null;

    const updateLayout = () => {
      const content = host.shadowRoot?.querySelector<HTMLElement>(
        "[data-reader-chapter-content]"
      );
      if (!content) return;
      if (
        isPaginated &&
        !contentObserver &&
        typeof MutationObserver !== "undefined"
      ) {
        contentObserver = new MutationObserver(updateLayout);
        contentObserver.observe(content, {
          childList: true,
          characterData: true,
          subtree: true,
        });
      }

      const pageWidth = container.clientWidth;
      const pageHeight = container.clientHeight;
      if (pageWidth <= 0 || pageHeight <= 0) return;

      const previousMode = previousPaginationModeRef.current;
      const modeChanged = previousMode !== isPaginated;
      const previousProgress = previousMode
        ? container.scrollLeft /
          Math.max(1, container.scrollWidth - container.clientWidth)
        : container.scrollTop /
          Math.max(1, container.scrollHeight - container.clientHeight);

      if (!isPaginated) {
        content.classList.remove("reader-paginated-content");
        content.style.width = "";
        content.style.height = "";
        content.style.columnWidth = "";
        content.style.columnGap = "";
        content.style.columnFill = "";
        host.style.height = "";
        if (modeChanged) {
          void content.offsetHeight;
          container.scrollTop =
            previousProgress *
            Math.max(0, container.scrollHeight - container.clientHeight);
        }
        container.scrollLeft = 0;
        previousPaginationModeRef.current = false;
        previousPageWidthRef.current = 0;
        updatePageStatus(container);
        return;
      }

      const oldPageWidth = previousPageWidthRef.current;
      const oldPageIndex =
        oldPageWidth > 0
          ? getReaderPageIndex(
              container.scrollLeft,
              oldPageWidth,
              getReaderPageCount(container.scrollWidth, oldPageWidth)
            )
          : 0;
      const requestedPadding = Number(settings?.contentPadding);
      const padding = Number.isFinite(requestedPadding)
        ? Math.min(
            Math.max(8, requestedPadding),
            Math.max(8, (pageWidth - 64) / 2)
          )
        : 24;
      const pageContentWidth = Math.max(1, pageWidth - padding * 2);
      const safeBottom = isHeaderVisible
        ? Number.parseFloat(
            getComputedStyle(document.documentElement).getPropertyValue(
              "--app-device-safe-bottom"
            )
          ) || 0
        : 0;
      const pageContentHeight = Math.max(
        1,
        pageHeight - 64 - (isHeaderVisible ? 72 + safeBottom : 0)
      );

      host.style.height = `${pageContentHeight}px`;
      content.classList.add("reader-paginated-content");
      content.style.width = `${pageContentWidth}px`;
      content.style.height = `${pageContentHeight}px`;
      content.style.columnWidth = `${pageContentWidth}px`;
      content.style.columnGap = `${padding * 2}px`;
      content.style.columnFill = "auto";
      void content.offsetWidth;

      const totalPages = getReaderPageCount(container.scrollWidth, pageWidth);
      if (modeChanged) {
        container.scrollLeft =
          previousProgress * Math.max(0, container.scrollWidth - pageWidth);
      } else if (oldPageWidth > 0 && oldPageWidth !== pageWidth) {
        container.scrollLeft = getReaderPageScrollLeft(
          oldPageIndex,
          pageWidth,
          totalPages
        );
      } else {
        container.scrollLeft = getReaderPageScrollLeft(
          getReaderPageIndex(container.scrollLeft, pageWidth, totalPages),
          pageWidth,
          totalPages
        );
      }
      previousPaginationModeRef.current = true;
      previousPageWidthRef.current = pageWidth;
      updatePageStatus(container);
    };

    updateLayout();
    const layoutTimeout = window.setTimeout(updateLayout, 0);
    host.addEventListener("load", updateLayout, true);
    const observer =
      isPaginated && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(updateLayout)
        : null;
    observer?.observe(container);
    return () => {
      window.clearTimeout(layoutTimeout);
      host.removeEventListener("load", updateLayout, true);
      observer?.disconnect();
      contentObserver?.disconnect();
    };
  }, [
    currentChapter.id,
    isLoading,
    isHeaderVisible,
    isPaginated,
    scrollContainerRef,
    settings?.contentPadding,
    settings?.fontFamily,
    settings?.fontSize,
    updatePageStatus,
  ]);

  const handleContainerScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      if (isPaginated) {
        const container = event.currentTarget;
        updatePageStatus(container);
        if (scrollSnapTimeoutRef.current !== null) {
          window.clearTimeout(scrollSnapTimeoutRef.current);
        }
        scrollSnapTimeoutRef.current = window.setTimeout(() => {
          scrollSnapTimeoutRef.current = null;
          const pageCount = getReaderPageCount(
            container.scrollWidth,
            container.clientWidth
          );
          const pageIndex = getReaderPageIndex(
            container.scrollLeft,
            container.clientWidth,
            pageCount
          );
          const targetScrollLeft = getReaderPageScrollLeft(
            pageIndex,
            container.clientWidth,
            pageCount
          );
          if (Math.abs(container.scrollLeft - targetScrollLeft) > 2) {
            container.scrollTo({ left: targetScrollLeft, behavior: "smooth" });
          }
        }, 120);
      }
    },
    [isPaginated, updatePageStatus]
  );

  useEffect(
    () => () => {
      if (scrollSnapTimeoutRef.current !== null) {
        window.clearTimeout(scrollSnapTimeoutRef.current);
      }
    },
    []
  );

  useLayoutEffect(() => {
    const pending = pendingChromeScrollRef.current;
    const container = scrollContainerRef?.current;
    if (!pending || !container) {
      return;
    }
    pendingChromeScrollRef.current = null;

    // Match App's immersive CSS tokens before measuring. Child layout effects
    // can run while --app-safe-* still reflect the previous mode; without this,
    // exiting immersive on iOS under-counts header height (safe-top) and text jumps.
    const root = document.documentElement;
    if (isHeaderVisible) {
      delete root.dataset.readerImmersive;
    } else {
      root.dataset.readerImmersive = "true";
    }

    const header = headerRef?.current;
    let nextHeaderHeight = 0;
    if (isHeaderVisible && header) {
      // Force style recalc so safe-area padding is included in the measurement.
      void header.offsetHeight;
      nextHeaderHeight = header.getBoundingClientRect().height;
    }
    container.scrollTo({
      top: scrollTopAfterChromeToggle(
        pending.scrollTop,
        pending.headerHeight,
        nextHeaderHeight
      ),
    });
  }, [headerRef, isHeaderVisible, scrollContainerRef]);

  // Restore progress when chapter content is loaded
  useEffect(() => {
    const chapterKey = `${book.id}:${currentChapter.id}`;
    if (
      book &&
      currentChapter &&
      scrollContainerRef &&
      !isLoading &&
      typeof scrollContainerRef !== "function" &&
      scrollContainerRef.current
    ) {
      if (restoredChapterKeyRef.current === chapterKey) {
        return;
      }

      restoredChapterKeyRef.current = chapterKey;
      const timeoutId = setTimeout(() => {
        onRestoreProgress(book);
      }, 200);
      return () => clearTimeout(timeoutId);
    }
  }, [book, currentChapter, onRestoreProgress, scrollContainerRef, isLoading]);

  useEffect(() => {
    const container = scrollContainerRef?.current;
    if (!container || isLoading) return;

    const preventSelect = (event: Event) => {
      event.preventDefault();
    };
    const onSelectionChange = () => {
      clearReaderTextSelection(container);
    };

    container.addEventListener("selectstart", preventSelect);
    container.addEventListener("dragstart", preventSelect);
    document.addEventListener("selectionchange", onSelectionChange);

    return () => {
      container.removeEventListener("selectstart", preventSelect);
      container.removeEventListener("dragstart", preventSelect);
      document.removeEventListener("selectionchange", onSelectionChange);
    };
  }, [isLoading, scrollContainerRef, currentChapter.id]);

  // Disable all links in reader content
  useEffect(() => {
    if (!contentRef.current) return;

    const handleLinkClick = (e: Event) => {
      const hasAnchor = e
        .composedPath()
        .some((node) => node instanceof HTMLAnchorElement);
      if (hasAnchor) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    const container = contentRef.current;
    container.addEventListener("click", handleLinkClick, true);

    return () => {
      container.removeEventListener("click", handleLinkClick, true);
    };
  }, [currentChapter]);

  useEffect(() => {
    closeDictionary();
  }, [closeDictionary, currentChapter.id, isLoading]);

  const cancelPendingChromeToggle = useCallback(() => {
    if (chromeToggleTimeoutRef.current !== null) {
      window.clearTimeout(chromeToggleTimeoutRef.current);
      chromeToggleTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      cancelPendingChromeToggle();
    };
  }, [cancelPendingChromeToggle]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      pointerStartRef.current = { x: e.clientX, y: e.clientY };
      if (isDictionaryCardTarget(e.target)) {
        return;
      }
      // Mouse/pen: block selection without breaking touch scrolling.
      if (e.button === 0 && e.pointerType !== "touch") {
        e.preventDefault();
      }
    },
    []
  );

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (
        isDictionaryCardTarget(e.target) ||
        consumeChromeToggleSuppression()
      ) {
        cancelPendingChromeToggle();
        return;
      }

      const selectedText = window.getSelection()?.toString() ?? "";
      const pointerDistancePx = getPointerDistance(pointerStartRef.current, {
        x: e.clientX,
        y: e.clientY,
      });

      if (
        !shouldToggleReaderHeaderOnClick({
          target: e.target,
          selectedText,
          pointerDistancePx,
        })
      ) {
        cancelPendingChromeToggle();
        return;
      }

      cancelPendingChromeToggle();
      chromeToggleTimeoutRef.current = window.setTimeout(() => {
        chromeToggleTimeoutRef.current = null;
        const stillSelected = window.getSelection()?.toString().trim() ?? "";
        if (stillSelected.length > 0) {
          return;
        }
        captureChromeScroll();
        onContentClick?.();
      }, READER_CHROME_TOGGLE_DELAY_MS);
    },
    [
      cancelPendingChromeToggle,
      captureChromeScroll,
      consumeChromeToggleSuppression,
      onContentClick,
    ]
  );

  const handleDoubleClick = useCallback(() => {
    cancelPendingChromeToggle();
  }, [cancelPendingChromeToggle]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      // Allow keyboard users to toggle header with Enter or Space
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        captureChromeScroll();
        onContentClick?.();
      }
    },
    [captureChromeScroll, onContentClick]
  );

  // Apply settings styles - map backend string values to CSS
  const themeClass = useMemo(
    () => themeClassNames(settings?.theme),
    [settings?.theme]
  );

  const fontFamilyClass = useMemo(() => {
    if (!settings?.fontFamily) return "font-serif";
    if (settings.fontFamily === "merriweather") return "font-serif";
    if (settings.fontFamily === "inter") return "font-sans";
    if (settings.fontFamily === "monospace") return "font-mono";
    return "font-serif";
  }, [settings]);

  const fontSizeStyle = useMemo(() => {
    const parsed = Number(settings?.fontSize);
    const fontSize = Number.isFinite(parsed)
      ? Math.min(36, Math.max(11, parsed))
      : 16;
    const lineHeight = fontSize >= 20 ? 1.7 : fontSize >= 18 ? 1.65 : 1.6;
    return {
      fontSize: `${fontSize}px`,
      // Drive .reader-prose !important rules via CSS variables.
      ["--reader-font-size" as string]: `${fontSize}px`,
      ["--reader-line-height" as string]: String(lineHeight),
      lineHeight,
    };
  }, [settings]);

  const paddingStyle = useMemo(() => {
    const parsed = Number(settings?.contentPadding);
    const padding = Number.isFinite(parsed)
      ? Math.min(128, Math.max(8, parsed))
      : 24;
    return { paddingLeft: padding, paddingRight: padding };
  }, [settings]);

  const preparedChapterHtml = useMemo(
    () => prepareChapterHtmlForReader(currentChapter.contentHtml || ""),
    [currentChapter.contentHtml]
  );

  useLayoutEffect(() => {
    const host = contentRef.current;
    if (!host) return;
    mountChapterInReaderShadowRoot(host, preparedChapterHtml);
  }, [currentChapter.id, isLoading, preparedChapterHtml]);

  useLayoutEffect(() => {
    const shadowRoot = contentRef.current?.shadowRoot;
    const themeContainer = shadowRoot?.querySelector<HTMLElement>(
      "[data-reader-chapter-theme]"
    );
    const contentContainer = shadowRoot?.querySelector<HTMLElement>(
      "[data-reader-chapter-content]"
    );
    if (!themeContainer || !contentContainer) return;

    themeContainer.className = themeClass;
    contentContainer.className = cn(
      "prose prose-slate dark:prose-invert reader-prose max-w-none cursor-default select-none",
      fontFamilyClass,
      isPaginated && "reader-paginated-content"
    );
    contentContainer.style.fontSize = String(fontSizeStyle.fontSize);
    contentContainer.style.lineHeight = String(fontSizeStyle.lineHeight);
    contentContainer.style.setProperty(
      "--reader-font-size",
      String(fontSizeStyle.fontSize)
    );
    contentContainer.style.setProperty(
      "--reader-line-height",
      String(fontSizeStyle.lineHeight)
    );
    contentContainer.style.userSelect = "none";
    contentContainer.style.setProperty("-webkit-user-select", "none");
  }, [fontFamilyClass, fontSizeStyle, isLoading, isPaginated, themeClass]);

  if (isLoading) {
    return (
      <div
        className="flex h-full items-center justify-center"
        data-testid="reader-loading"
      >
        <div className="text-center space-y-2">
          <LoadingScreen />
          <p className="text-sm text-muted-foreground">Loading chapter...</p>
        </div>
        {isPaginated ? (
          <span className="sr-only" aria-live="polite">
            {pageStatus.currentPage} / {pageStatus.totalPages}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div
      ref={scrollContainerRef}
      className={cn(
        "flex-1 select-none",
        isPaginated
          ? "overflow-x-auto overflow-y-hidden snap-x snap-mandatory"
          : "overflow-y-auto",
        themeClass
      )}
      data-testid="reader-scroll-container"
      data-reader-pagination={isPaginated ? "pages" : "scroll"}
      onScroll={handleContainerScroll}
      style={
        isPaginated
          ? {
              touchAction: "pan-x",
              scrollSnapType: "x mandatory",
              scrollbarWidth: "none",
            }
          : undefined
      }
      onPointerDown={handlePointerDown}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      onDragStart={(event) => event.preventDefault()}
      title="Tap to toggle header visibility"
    >
      <div
        className="reader-content-selectable mx-auto py-8 select-none"
        style={
          isPaginated
            ? { ...paddingStyle, height: "100%", boxSizing: "border-box" }
            : paddingStyle
        }
      >
        <div ref={contentRef} className="reader-chapter-shadow-host" />
      </div>
      {dictionary ? (
        <ReaderDictionaryCard
          dictionary={dictionary}
          onClose={closeDictionary}
          themeClass={themeClass}
        />
      ) : null}
    </div>
  );
}
