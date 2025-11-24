import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Headphones } from "lucide-react";

import type { ChapterProgressSnapshot, ChapterSelectionOptions, ReaderPanelBaseProps } from "./reader/types";
import { ReaderSettingsControl } from "./reader/ReaderSettingsControl";
import { ReaderTocDrawer } from "./reader/ReaderTocDrawer";
import { ReaderViewport } from "./reader/ReaderViewport";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";

type ReaderPanelProps = ReaderPanelBaseProps & {
  resolvedUiTheme: "light" | "dark";
  onChromeVisibilityChange?: (visible: boolean) => void;
  audioPlayerVisible?: boolean;
  onOpenAudioPlayer?: () => void;
  currentAudioTime?: number;
  currentAudioTrackHref?: string;
  autoScrollEnabled?: boolean;
};

export function ReaderPanel({
  activeBook,
  activeChapter,
  preferences,
  onPreferencesChange,
  onSelectChapter,
  pendingFragment,
  onFragmentConsumed,
  onNavigateLibrary,
  resolvedUiTheme,
  onChapterProgress,
  onChromeVisibilityChange,
  audioPlayerVisible,
  onOpenAudioPlayer,
  currentAudioTime,
  currentAudioTrackHref,
  autoScrollEnabled,
}: ReaderPanelProps) {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isTocOpen, setIsTocOpen] = useState(false);
  const [isImmersive, setIsImmersive] = useState(false);
  const [isAudioReopenVisible, setIsAudioReopenVisible] = useState(false);
  const [shouldRenderAudioReopen, setShouldRenderAudioReopen] = useState(false);
  const preserveChromeNextSelectionRef = useRef(false);
  const scrollIntentRef = useRef<"top" | "bottom" | null>(null);

  useEffect(() => {
    setIsTocOpen(false);
  }, [activeBook?.id]);

  useEffect(() => {
    if (preserveChromeNextSelectionRef.current) {
      preserveChromeNextSelectionRef.current = false;
      return;
    }
    setIsImmersive(false);
  }, [activeBook?.id, activeChapter?.id]);

  useEffect(() => {
    setIsImmersive(false);
  }, [activeBook?.id]);

  useEffect(() => {
    onChromeVisibilityChange?.(!isImmersive);
  }, [isImmersive, onChromeVisibilityChange]);

  useEffect(() => {
    return () => {
      onChromeVisibilityChange?.(true);
    };
  }, [onChromeVisibilityChange]);

  useEffect(() => {
    if (isImmersive) {
      setIsSettingsOpen(false);
      setIsTocOpen(false);
    }
  }, [isImmersive]);

  const handleBack = () => {
    setIsImmersive(false);
    onNavigateLibrary?.();
  };

  const appliedTheme: "light" | "dark" | "sepia" =
     preferences.theme === "system" ? resolvedUiTheme : preferences.theme;
  const audioTracks = activeBook?.audioTracks ?? [];
  const hasAudioTracks = audioTracks.length > 0;
  const showAudioPlayer = audioPlayerVisible ?? hasAudioTracks;
  const showAudioReopen = Boolean(hasAudioTracks && !showAudioPlayer && onOpenAudioPlayer);
  const chromeVisible = !isImmersive;

  // Handle audio reopen button animation
  useEffect(() => {
    if (showAudioReopen) {
      setShouldRenderAudioReopen(true);
      // Small delay to trigger enter animation
      const timer = setTimeout(() => {
        setIsAudioReopenVisible(true);
      }, 10);
      return () => clearTimeout(timer);
    } else if (shouldRenderAudioReopen) {
      // Trigger exit animation before hiding
      setIsAudioReopenVisible(false);
      // Wait for exit animation to complete before removing from DOM
      const timer = setTimeout(() => {
        setShouldRenderAudioReopen(false);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [showAudioReopen, shouldRenderAudioReopen]);

  const handleChapterChange = (chapterId: string, options?: ChapterSelectionOptions) => {
    const requestedScrollPosition = options?.scrollPosition ?? "maintain";
    scrollIntentRef.current =
      requestedScrollPosition === "maintain" ? null : (requestedScrollPosition as "top" | "bottom");

    if (options?.preserveChrome) {
      preserveChromeNextSelectionRef.current = true;
    }
    onSelectChapter(chapterId, options);
  };

  const handleChapterProgress = (snapshot: ChapterProgressSnapshot) => {
    if (!activeBook?.id) {
      return;
    }
    onChapterProgress?.(activeBook.id, snapshot);
  };

  return (
    <section className="flex flex-1 min-h-0 flex-col">
      <div
        data-reader-header
        className={cn(
          "sticky top-0 z-20 flex flex-col gap-3 border-b border-border bg-background/95 px-4 py-4 backdrop-blur transition-all duration-300",
          isImmersive &&
            "pointer-events-none -translate-y-full opacity-0 h-0 overflow-hidden border-transparent py-0",
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"

            variant="ghost"
            size="sm"
            className="px-2"
            onClick={handleBack}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Library
          </Button>
          <div className="flex items-center gap-2">
            {shouldRenderAudioReopen ? (
              <Button
                type="button"
                variant="outline"
                size="icon"
                className={cn(
                  "transition-all duration-300 ease-out",
                  isAudioReopenVisible
                    ? "opacity-100 scale-100 translate-y-0"
                    : "opacity-0 scale-95 -translate-y-2"
                )}
                onClick={onOpenAudioPlayer}
                aria-label="Open audio player"
              >
                <Headphones className="h-4 w-4" />
              </Button>
            ) : null}
            {activeBook && (
              <ReaderTocDrawer
                book={activeBook}
                activeChapterId={activeChapter?.id}
                currentAudioTrackHref={currentAudioTrackHref}
                isOpen={isTocOpen}
                onOpenChange={(open) => {
                  setIsImmersive(false);
                  setIsTocOpen(open);
                }}
                onSelectChapter={handleChapterChange}
              />
            )}
            <ReaderSettingsControl
              preferences={preferences}
              onPreferencesChange={onPreferencesChange}
              isOpen={isSettingsOpen}
              onOpenChange={(open) => {
                setIsImmersive(false);
                setIsSettingsOpen(open);
              }}
            />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">
            {activeChapter?.title ?? "Select a chapter"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {activeBook
              ? `${activeBook.title} · ${activeBook.author}`
              : "Once you import an EPUB, choose a chapter to begin."}
          </p>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden min-h-0">
        <ReaderViewport
          activeBook={activeBook}
          activeChapter={activeChapter}
          preferences={preferences}
          pendingFragment={pendingFragment}
          onFragmentConsumed={onFragmentConsumed}
          onSelectChapter={handleChapterChange}
          chromeVisible={chromeVisible}
          resolvedTheme={appliedTheme}
          onToggleChrome={() => setIsImmersive((prev) => !prev)}
          audioPlayerVisible={showAudioPlayer}
          scrollIntent={scrollIntentRef.current}
          onScrollIntentConsumed={() => {
            scrollIntentRef.current = null;
          }}
          onChapterProgress={handleChapterProgress}
          currentAudioTime={currentAudioTime}
          currentAudioTrackHref={currentAudioTrackHref}
          autoScrollEnabled={autoScrollEnabled}
        />
      </div>
    </section>
  );
}
