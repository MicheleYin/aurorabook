import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Book, ChapterWithContent } from "../../types/book";
import type { ReaderSettings } from "./ReaderSettings";
import { useAudioProgressContext } from "../../context/AudioProgressContext";
import { useAudioTextSync } from "../../hooks/useAudioTextSync";
import { logger } from "../../lib/logger";
import { cn } from "../../lib/utils";
import { LoadingScreen } from "../app/LoadingScreen";

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
}: Readonly<ReaderContentProps>) {
  const shadowHostRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const previousHeaderVisibleRef = useRef<boolean | undefined>(isHeaderVisible);
  const scrollPositionRef = useRef<number>(0);
  const [isSystemDark, setIsSystemDark] = useState(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
  const { currentAudioTrack } = useAudioProgressContext();
  const previousAudioTrackRef =
    useRef<typeof currentAudioTrack>(currentAudioTrack);

  // Keep resolved system theme in sync so shadow DOM dark variants match app theme.
  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (event: MediaQueryListEvent) => {
      setIsSystemDark(event.matches);
    };

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }

    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, []);

  // Preserve scroll position when header visibility changes
  useEffect(() => {
    if (!scrollContainerRef?.current) return;

    const container = scrollContainerRef.current;
    const headerVisibleChanged =
      previousHeaderVisibleRef.current !== isHeaderVisible;

    if (headerVisibleChanged) {
      // Save current scroll position before header changes
      scrollPositionRef.current = container.scrollTop;

      // Wait for transition to complete, then restore scroll position
      const timeoutId = setTimeout(() => {
        if (container && scrollPositionRef.current !== undefined) {
          // Get the header height difference
          let previousHeaderHeight = 0;
          if (headerRef?.current && previousHeaderVisibleRef.current) {
            previousHeaderHeight =
              headerRef.current.getBoundingClientRect().height;
          }

          let currentHeaderHeight = 0;
          if (headerRef?.current && isHeaderVisible) {
            currentHeaderHeight =
              headerRef.current.getBoundingClientRect().height;
          }

          const headerHeightDiff = currentHeaderHeight - previousHeaderHeight;

          // Adjust scroll position by the header height difference
          const adjustedScrollTop =
            scrollPositionRef.current + headerHeightDiff;

          container.scrollTop = Math.max(0, adjustedScrollTop);
        }
      }, 350); // Wait for transition (300ms) + small buffer

      previousHeaderVisibleRef.current = isHeaderVisible;

      return () => clearTimeout(timeoutId);
    }
  }, [isHeaderVisible, scrollContainerRef, headerRef]);

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
  useAudioTextSync(
    book,
    scrollContainerRef ?? null,
    headerRef,
    isHeaderVisible
  );

  // Restore progress when chapter content is loaded
  useEffect(() => {
    if (
      book &&
      currentChapter &&
      scrollContainerRef &&
      !isLoading &&
      typeof scrollContainerRef !== "function" &&
      scrollContainerRef.current
    ) {
      const timeoutId = setTimeout(() => {
        onRestoreProgress(book);
      }, 200);
      return () => clearTimeout(timeoutId);
    }
  }, [book, currentChapter, onRestoreProgress, scrollContainerRef, isLoading]);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Only trigger if clicking directly on the content area, not on links or interactive elements
      const target = e.target as HTMLElement;
      if (
        target.tagName === "A" ||
        target.tagName === "BUTTON" ||
        target.closest("a") ||
        target.closest("button")
      ) {
        return;
      }
      onContentClick?.();
    },
    [onContentClick]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      // Allow keyboard users to toggle header with Enter or Space
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onContentClick?.();
      }
    },
    [onContentClick]
  );

  // Keep a ref so the content effect can always read the latest theme class
  // without adding it as a dependency (which would cause full shadow rebuilds).
  const themeClassRef = useRef("");

  // Apply settings styles - map backend string values to CSS
  const themeClass = useMemo(() => {
    if (!settings?.theme) return "";
    if (settings.theme === "dark") return "dark";
    if (settings.theme === "light") return "";
    if (settings.theme === "system") {
      // Match SettingsContext `applyTheme` on <html>, not only matchMedia, so shadow
      // prose stays in sync with the shell (Tailwind darkMode: class).
      return document.documentElement.classList.contains("dark") ? "dark" : "";
    }
    return "";
  }, [settings?.theme, isSystemDark]);

  // Always keep the ref in sync so effects that don't depend on themeClass
  // can still read the current value.
  themeClassRef.current = themeClass;

  const fontFamilyClass = useMemo(() => {
    if (!settings?.fontFamily) return "font-serif";
    if (settings.fontFamily === "merriweather") return "font-serif";
    if (settings.fontFamily === "inter") return "font-sans";
    if (settings.fontFamily === "monospace") return "font-mono";
    return "font-serif";
  }, [settings]);

  const fontSizeStyle = useMemo(() => {
    if (!settings?.fontSize) return { fontSize: "16px" };
    const fontSizeMap: Record<string, string> = {
      small: "14px",
      medium: "16px",
      large: "18px",
      xlarge: "20px",
    };
    return { fontSize: fontSizeMap[settings.fontSize] ?? "16px" };
  }, [settings]);

  const paddingStyle = useMemo(() => {
    if (!settings?.contentPadding)
      return { paddingLeft: "24px", paddingRight: "24px" };
    const paddingMap: Record<string, string> = {
      compact: "16px",
      comfortable: "24px",
      spacious: "48px",
    };
    const padding = paddingMap[settings.contentPadding] ?? "24px";
    return { paddingLeft: padding, paddingRight: padding };
  }, [settings]);

  // Render chapter content in an isolated Shadow DOM
  useEffect(() => {
    const host = shadowHostRef.current;
    if (!host) return;

    const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });

    // Inject document stylesheets into shadow root once so Tailwind
    // prose + audio-highlight styles apply to the isolated content.
    if (!shadow.querySelector("link[rel='stylesheet'], style")) {
      Array.from(
        document.head.querySelectorAll<HTMLElement>("link[rel='stylesheet'], style")
      ).forEach((node) => shadow.appendChild(node.cloneNode(true)));
    }

    // Theme wrapper — gives `dark:` Tailwind variants an ancestor with class "dark"
    let themeWrapper = shadow.querySelector<HTMLDivElement>("[data-shadow-theme]");
    if (!themeWrapper) {
      themeWrapper = document.createElement("div");
      themeWrapper.setAttribute("data-shadow-theme", "true");
      shadow.appendChild(themeWrapper);
    }
    // Always stamp the current theme class so chapter changes inherit the
    // right theme even when themeClass itself hasn't changed.
    themeWrapper.className = themeClassRef.current;

    // Create or reuse the prose content div
    let inner = themeWrapper.querySelector<HTMLDivElement>(
      "[data-reader-chapter-content]"
    );
    if (!inner) {
      inner = document.createElement("div");
      themeWrapper.appendChild(inner);
    }
    inner.setAttribute("data-reader-chapter-content", "true");
    inner.className = cn(
      "prose prose-slate dark:prose-invert max-w-none",
      fontFamilyClass
    );
    Object.assign(inner.style, fontSizeStyle);
    inner.innerHTML = currentChapter.contentHtml ?? "";

    contentRef.current = inner;

    // Disable link navigation within book content
    const handleLinkClick = (e: Event) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "A" || target.closest("a")) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    inner.addEventListener("click", handleLinkClick, true);

    return () => {
      inner!.removeEventListener("click", handleLinkClick, true);
    };
  }, [currentChapter.contentHtml, fontFamilyClass, fontSizeStyle]);

  // Sync dark/light theme class into shadow root so `dark:` variants work
  useEffect(() => {
    const wrapper = shadowHostRef.current?.shadowRoot?.querySelector<HTMLDivElement>(
      "[data-shadow-theme]"
    );
    if (wrapper) {
      wrapper.className = themeClass;
    }
  }, [themeClass]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center space-y-2">
          <LoadingScreen />
          <p className="text-sm text-muted-foreground">Loading chapter...</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={scrollContainerRef}
      className={cn("flex-1 min-w-0 overflow-y-auto overflow-x-hidden cursor-pointer", themeClass)}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
      title="Tap to toggle header visibility"
    >
      <div className="mx-auto py-8" style={paddingStyle}>
        <div
          ref={shadowHostRef}
          data-reader-chapter-shadow-host="true"
        />
      </div>
    </div>
  );
}
