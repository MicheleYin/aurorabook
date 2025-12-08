import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Headphones } from "lucide-react";

import type { ChapterSelectionOptions, ReaderPanelBaseProps, AudioProgressSnapshot } from "./reader/types";
import type { UITheme } from "../types/ui";
import { ReaderSettingsControl } from "./reader/ReaderSettingsControl";
import { ReaderTocDrawer } from "./reader/ReaderTocDrawer";
import { ReaderWrapper } from "./reader/ReaderWrapper";
import { cn } from "../lib/utils";
import { animPatterns, enterExit, anim } from "../lib/animations";
import { Button } from "./ui/button";
type ReaderPanelProps = ReaderPanelBaseProps & {
  resolvedUiTheme: "light" | "dark";
  uiTheme: UITheme;
  onThemeChange: (theme: UITheme) => void;
  onChromeVisibilityChange?: (visible: boolean) => void;
  audioPlayerVisible?: boolean;
  onOpenAudioPlayer?: () => void;
  currentAudioTrackHref?: string;
  onSaveProgress?: (saveFn: () => void) => void;
  autoScrollEnabled?: boolean;
  currentAudioProgress?: AudioProgressSnapshot;
};

export function ReaderPanel({
  activeBook,
  activeChapter,
  preferences,
  onPreferencesChange,
  onSelectChapter,
  onNavigateLibrary,
  resolvedUiTheme,
  uiTheme,
  onThemeChange,
  onChapterProgress,
  onChromeVisibilityChange,
  audioPlayerVisible,
  onOpenAudioPlayer,
  currentAudioTrackHref,
  onSaveProgress,
  autoScrollEnabled,
  currentAudioProgress,
}: ReaderPanelProps) {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isTocOpen, setIsTocOpen] = useState(false);
  const [isImmersive, setIsImmersive] = useState(false);
  const [isAudioReopenVisible, setIsAudioReopenVisible] = useState(false);
  const [shouldRenderAudioReopen, setShouldRenderAudioReopen] = useState(false);
  const preserveChromeNextSelectionRef = useRef(false);
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

  const appliedTheme: "light" | "dark" = resolvedUiTheme;
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
    if (options?.preserveChrome) {
      preserveChromeNextSelectionRef.current = true;
    }
    onSelectChapter(chapterId, options);
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
            aria-label="Go back to library"
          >
            <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
            Library
          </Button>
          <div className="flex items-center gap-2">
           
              <Button
                type="button"
                variant="outline"
                size="icon"
                className={cn(enterExit(isAudioReopenVisible, "scaleFade"),shouldRenderAudioReopen ? "opacity-100" : "opacity-0")}
                onClick={onOpenAudioPlayer}
                aria-label="Open audio player"
              >
                <Headphones className="h-4 w-4" aria-hidden="true" />
              </Button>
  
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
              uiTheme={uiTheme}
              onThemeChange={onThemeChange}
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
        <ReaderWrapper
          activeBook={activeBook}
          activeChapter={activeChapter}
          preferences={preferences}
          onPreferencesChange={onPreferencesChange}
          onSelectChapter={handleChapterChange}
          chromeVisible={chromeVisible}
          resolvedTheme={appliedTheme}
          onToggleChrome={handleToggleImmersive}
          audioPlayerVisible={showAudioPlayer}
          onChapterProgress={onChapterProgress}
          onSaveProgress={onSaveProgress}
          autoScrollEnabled={autoScrollEnabled}
          currentAudioProgress={currentAudioProgress}
        />
      </div>
    </section>
  );
}
