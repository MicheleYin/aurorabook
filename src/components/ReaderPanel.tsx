import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Headphones } from "lucide-react";

import type { ChapterProgressSnapshot, ChapterSelectionOptions, ReaderPanelBaseProps } from "./reader/types";
import { ReaderSettingsControl } from "./reader/ReaderSettingsControl";
import { ReaderTocDrawer } from "./reader/ReaderTocDrawer";
import { ReaderViewport } from "./reader/ReaderViewport";
import { cn } from "../lib/utils";
import { animPatterns, enterExit, anim } from "../lib/animations";
import { Button } from "./ui/button";
type ReaderPanelProps = ReaderPanelBaseProps & {
  resolvedUiTheme: "light" | "dark";
  onChromeVisibilityChange?: (visible: boolean) => void;
  audioPlayerVisible?: boolean;
  onOpenAudioPlayer?: () => void;
  currentAudioTime?: number;
  currentAudioTrackHref?: string;
  autoScrollEnabled?: boolean;
  isAudioRestoring?: boolean;
  onSaveProgress?: (saveFn: () => void) => void;
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
  isAudioRestoring,
  onSaveProgress,
}: ReaderPanelProps) {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isTocOpen, setIsTocOpen] = useState(false);
  const [isImmersive, setIsImmersive] = useState(false);
  const [isAudioReopenVisible, setIsAudioReopenVisible] = useState(false);
  const [shouldRenderAudioReopen, setShouldRenderAudioReopen] = useState(false);
  const preserveChromeNextSelectionRef = useRef(false);
  const scrollIntentRef = useRef<"top" | "bottom" | null>(null);
  const previousBookIdRef = useRef<string | undefined>(activeBook?.id);
  const previousChapterIdRef = useRef<string | undefined>(activeChapter?.id);

  // Consolidated handler for book/chapter changes
  const handleBookOrChapterChange = useCallback(() => {
    setIsTocOpen(false);
    
    if (preserveChromeNextSelectionRef.current) {
      preserveChromeNextSelectionRef.current = false;
      return;
    }
    
    setIsImmersive(false);
  }, []);

  // Reset immersive state when book or chapter changes
  useEffect(() => {
    const bookChanged = previousBookIdRef.current !== activeBook?.id;
    const chapterChanged = previousChapterIdRef.current !== activeChapter?.id;
    
    if (bookChanged || chapterChanged) {
      handleBookOrChapterChange();
    }
    
    previousBookIdRef.current = activeBook?.id;
    previousChapterIdRef.current = activeChapter?.id;
  }, [activeBook?.id, activeChapter?.id, handleBookOrChapterChange]);

  // Derived state for chrome visibility
  const chromeVisible = !isImmersive;

  // Notify parent of chrome visibility changes
  useEffect(() => {
    onChromeVisibilityChange?.(chromeVisible);
    return () => {
      onChromeVisibilityChange?.(true);
    };
  }, [chromeVisible, onChromeVisibilityChange]);

  // Handle immersive toggle - close drawers when entering immersive mode
  const handleToggleImmersive = useCallback(() => {
    const newImmersive = !isImmersive;
    setIsImmersive(newImmersive);
    if (newImmersive) {
      setIsSettingsOpen(false);
      setIsTocOpen(false);
    }
  }, [isImmersive]);

  const handleBack = () => {
    setIsImmersive(false);
    // Note: Progress saving happens in App.tsx useEffect when view changes
    onNavigateLibrary?.();
  };

  const appliedTheme: "light" | "dark" | "sepia" =
     preferences.theme === "system" ? resolvedUiTheme : preferences.theme;
  const audioTracks = activeBook?.audioTracks ?? [];
  const hasAudioTracks = audioTracks.length > 0;
  const showAudioPlayer = audioPlayerVisible ?? hasAudioTracks;
  const showAudioReopen = Boolean(hasAudioTracks && !showAudioPlayer && onOpenAudioPlayer);

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
          "sticky top-0 z-20 flex flex-col gap-3 border-b border-border bg-background/95 px-4 py-4 backdrop-blur",
          animPatterns.readerChrome,
          "transition-all duration-300 ease-in-out",
          isImmersive
            ? "pointer-events-none -translate-y-full opacity-0 h-0 overflow-hidden border-transparent py-0"
            : "translate-y-0 opacity-100",
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
                className={enterExit(isAudioReopenVisible, "scaleFade")}
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
                  if (open) {
                    setIsImmersive(false);
                  }
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
                if (open) {
                  setIsImmersive(false);
                }
                setIsSettingsOpen(open);
              }}
            />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <h2 
            key={activeChapter?.id}
            className={cn(
              "text-lg font-semibold",
              anim("normal", "all"),
              "transition-all duration-200 ease-in-out"
            )}
          >
            {activeChapter?.title ?? "Select a chapter"}
          </h2>
          <p 
            key={`${activeBook?.id}-${activeChapter?.id}`}
            className={cn(
              "text-sm text-muted-foreground",
              anim("normal", "all"),
              "transition-all duration-200 ease-in-out"
            )}
          >
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
          onToggleChrome={handleToggleImmersive}
          audioPlayerVisible={showAudioPlayer}
          scrollIntent={scrollIntentRef.current}
          onScrollIntentConsumed={() => {
            scrollIntentRef.current = null;
          }}
          onChapterProgress={handleChapterProgress}
          currentAudioTime={currentAudioTime}
          currentAudioTrackHref={currentAudioTrackHref}
          autoScrollEnabled={Boolean(activeBook?.audioTracks?.length) && autoScrollEnabled}
          isAudioRestoring={isAudioRestoring}
          onSaveProgress={onSaveProgress}
        />
      </div>
    </section>
  );
}
