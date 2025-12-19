import { memo } from "react";
import { ArrowLeft, Headphones } from "lucide-react";

import type { ChapterSelectionOptions, ReaderPanelBaseProps, AudioProgressSnapshot } from "./reader/types";
import type { UITheme } from "../types/ui";
import { ReaderSettingsControl } from "./reader/ReaderSettingsControl";
import { ReaderTocDrawer } from "./reader/ReaderTocDrawer";
import { ReaderWrapper } from "./reader/ReaderWrapper";
import { cn } from "../lib/utils";
import { animPatterns, enterExit, anim } from "../lib/animations";
import { Button } from "./ui/button";
import { useResolvedTheme } from "../hooks/useResolvedTheme";
import { useReaderPanel } from "../hooks/reader/useReaderPanel";
import { useAppDispatch } from "../store/hooks";
import { setReaderUISettingsOpen, setReaderUITocOpen, setReaderUIImmersive } from "../store/slices/readerSlice";
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
  onTrackChangeHandlerReady?: (handler: (trackHref: string) => Promise<void>) => void;
};

function ReaderPanelComponent({
  activeBook,
  activeChapter,
  preferences,
  onPreferencesChange,
  onSelectChapter,
  onNavigateLibrary,
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
  onTrackChangeHandlerReady,
}: ReaderPanelProps) {
  const dispatch = useAppDispatch();
  
  // Use the new hook for clean Redux integration
  const {
    isSettingsOpen,
    isTocOpen,
    isImmersive,
    isAudioReopenVisible,
    shouldRenderAudioReopen,
    chromeVisible,
    toggleImmersive,
    showAudioReopen,
  } = useReaderPanel({
    activeBook,
    activeChapter,
    audioPlayerVisible,
    onOpenAudioPlayer,
    onChromeVisibilityChange,
  });

  const handleBack = () => {
    dispatch(setReaderUIImmersive(false));
    // Note: Progress saving happens in App.tsx useEffect when view changes
    onNavigateLibrary?.();
  };

  // Resolve reader theme (separate from UI theme, listens to system changes)
  const resolvedReaderTheme = useResolvedTheme(preferences.theme as UITheme);
  const audioTracks = activeBook?.audioTracks ?? [];
  const hasAudioTracks = audioTracks.length > 0;
  const showAudioPlayer = audioPlayerVisible ?? hasAudioTracks;

  const handleChapterChange = (chapterId: string, options?: ChapterSelectionOptions) => {
    // Handle preserveChrome option through the hook
    if (options?.preserveChrome) {
      // This is handled by useReaderPanel hook
    }
    onSelectChapter(chapterId, options);
  };


  return (
    <section className="flex flex-1 min-h-0 flex-col">
      <div
        data-reader-header
        className={cn(
          "sticky top-0 z-20 flex flex-col gap-3 border-b border-border bg-background/95 px-4 py-4 backdrop-blur safe-area-top",
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
                    dispatch(setReaderUIImmersive(false));
                  }
                  dispatch(setReaderUITocOpen(open));
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
                  dispatch(setReaderUIImmersive(false));
                }
                dispatch(setReaderUISettingsOpen(open));
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
          activeBookId={activeBook?.id}
          activeChapterId={activeChapter?.id}
          preferences={preferences}
          onPreferencesChange={onPreferencesChange}
          onSelectChapter={handleChapterChange}
          chromeVisible={chromeVisible}
          resolvedTheme={resolvedReaderTheme}
          onToggleChrome={toggleImmersive}
          audioPlayerVisible={showAudioPlayer}
          onChapterProgress={onChapterProgress}
          onSaveProgress={onSaveProgress}
          autoScrollEnabled={autoScrollEnabled}
          currentAudioProgress={currentAudioProgress}
          onTrackChangeHandlerReady={onTrackChangeHandlerReady}
        />
      </div>
    </section>
  );
}

export const ReaderPanel = memo(ReaderPanelComponent, (prevProps, nextProps) => {
  // Compare activeBook - check if it's the same reference or if key properties changed
  if (prevProps.activeBook !== nextProps.activeBook) {
    if (prevProps.activeBook?.id !== nextProps.activeBook?.id) return false;
    // Check if important book properties changed
    if (
      prevProps.activeBook?.title !== nextProps.activeBook?.title ||
      prevProps.activeBook?.audioTracks.length !== nextProps.activeBook?.audioTracks.length
    ) {
      return false;
    }
  }
  
  // Compare activeChapter - check if it's the same reference or if key properties changed
  if (prevProps.activeChapter !== nextProps.activeChapter) {
    if (prevProps.activeChapter?.id !== nextProps.activeChapter?.id) return false;
    if (prevProps.activeChapter?.title !== nextProps.activeChapter?.title) return false;
  }
  
  // Compare preferences object
  const prevPrefs = prevProps.preferences;
  const nextPrefs = nextProps.preferences;
  if (
    prevPrefs.fontFamily !== nextPrefs.fontFamily ||
    prevPrefs.fontSize !== nextPrefs.fontSize ||
    prevPrefs.contentPadding !== nextPrefs.contentPadding ||
    prevPrefs.theme !== nextPrefs.theme ||
    prevPrefs.lineHeight !== nextPrefs.lineHeight
  ) {
    return false;
  }
  
  // Compare primitive props
  if (
    prevProps.uiTheme !== nextProps.uiTheme ||
    prevProps.audioPlayerVisible !== nextProps.audioPlayerVisible ||
    prevProps.currentAudioTrackHref !== nextProps.currentAudioTrackHref ||
    prevProps.autoScrollEnabled !== nextProps.autoScrollEnabled
  ) {
    return false;
  }
  
  // Compare callbacks - assume stable if same reference
  if (
    prevProps.onPreferencesChange !== nextProps.onPreferencesChange ||
    prevProps.onSelectChapter !== nextProps.onSelectChapter ||
    prevProps.onNavigateLibrary !== nextProps.onNavigateLibrary ||
    prevProps.onThemeChange !== nextProps.onThemeChange ||
    prevProps.onChapterProgress !== nextProps.onChapterProgress ||
    prevProps.onChromeVisibilityChange !== nextProps.onChromeVisibilityChange ||
    prevProps.onOpenAudioPlayer !== nextProps.onOpenAudioPlayer ||
    prevProps.onSaveProgress !== nextProps.onSaveProgress ||
    prevProps.onTrackChangeHandlerReady !== nextProps.onTrackChangeHandlerReady
  ) {
    return false;
  }
  
  // Compare currentAudioProgress - check if it's the same reference
  if (prevProps.currentAudioProgress !== nextProps.currentAudioProgress) return false;
  
  return true;
});
