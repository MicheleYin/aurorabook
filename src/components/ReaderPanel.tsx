import { useEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";

import type {
  ChapterProgressSnapshot,
  ChapterSelectionOptions,
  ReaderPanelBaseProps,
} from "./reader/types";
import { ReaderSettingsControl } from "./reader/ReaderSettingsControl";
import { ReaderTocDrawer } from "./reader/ReaderTocDrawer";
import { ReaderViewport } from "./reader/ReaderViewport";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { ReaderAudioPlayer } from "./reader/ReaderAudioPlayer";

type ReaderPanelProps = ReaderPanelBaseProps & {
  resolvedUiTheme: "light" | "dark";
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
}: ReaderPanelProps) {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isTocOpen, setIsTocOpen] = useState(false);
  const [isImmersive, setIsImmersive] = useState(false);
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
  const showAudioPlayer = audioTracks.length > 0;

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
            {activeBook && (
              <ReaderTocDrawer
                book={activeBook}
                activeChapterId={activeChapter?.id}
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
          chromeVisible={!isImmersive}
          resolvedTheme={appliedTheme}
          onToggleChrome={() => setIsImmersive((prev) => !prev)}
          audioPlayerVisible={showAudioPlayer}
          scrollIntent={scrollIntentRef.current}
          onScrollIntentConsumed={() => {
            scrollIntentRef.current = null;
          }}
          onChapterProgress={handleChapterProgress}
        />
      </div>
      {showAudioPlayer ? (
        <ReaderAudioPlayer tracks={audioTracks} bookTitle={activeBook?.title} />
      ) : null}
    </section>
  );
}
