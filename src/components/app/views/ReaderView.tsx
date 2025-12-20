import { memo } from "react";
import { ErrorBoundary } from "../../ErrorBoundary";
import { ReaderPanel } from "../../ReaderPanel";
// ReaderCoordinatorProvider removed - using Redux directly
import type { Book, Chapter } from "../../../types/reader";
import type { ReaderPreferences } from "../../../types/reader";
import type { ChapterSelectionOptions, AudioProgressSnapshot, ChapterProgressSnapshot } from "../../reader/types";

type ReaderViewProps = {
  activeBook: Book | null;
  activeChapter: Chapter | null;
  readerPreferences: ReaderPreferences;
  onPreferencesChange: (preferences: Partial<ReaderPreferences>) => void;
  onSelectChapter: (chapterId: string, options?: ChapterSelectionOptions) => Promise<void>;
  onNavigateLibrary: () => Promise<void>;
  resolvedUiTheme: "light" | "dark";
  uiTheme: "light" | "dark" | "system";
  onThemeChange: (theme: "light" | "dark" | "system") => void;
  onChapterProgress: (bookId: string, snapshot: ChapterProgressSnapshot) => void;
  onChromeVisibilityChange: (visible: boolean) => void;
  audioPlayerVisible: boolean;
  onOpenAudioPlayer: () => void;
  currentAudioTrackHref?: string;
  onSaveProgress: (saveFn: () => void) => void;
  autoScrollEnabled: boolean;
  currentAudioProgress?: AudioProgressSnapshot;
  onTrackChangeHandlerReady: (handler: (trackHref: string) => Promise<void>) => void;
};

export const ReaderView = memo(function ReaderView({
  activeBook,
  activeChapter,
  readerPreferences,
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
  onTrackChangeHandlerReady,
}: ReaderViewProps) {
  return (
    <ErrorBoundary>
      <ReaderPanel
        activeBook={activeBook ?? undefined}
        activeChapter={activeChapter ?? undefined}
        preferences={readerPreferences}
        onPreferencesChange={onPreferencesChange}
        onSelectChapter={onSelectChapter}
        onNavigateLibrary={onNavigateLibrary}
        resolvedUiTheme={resolvedUiTheme}
        uiTheme={uiTheme}
        onThemeChange={onThemeChange}
        onChapterProgress={onChapterProgress}
        onChromeVisibilityChange={onChromeVisibilityChange}
        audioPlayerVisible={audioPlayerVisible}
        onOpenAudioPlayer={onOpenAudioPlayer}
        currentAudioTrackHref={currentAudioTrackHref}
        onSaveProgress={onSaveProgress}
        autoScrollEnabled={autoScrollEnabled}
        currentAudioProgress={currentAudioProgress}
        onTrackChangeHandlerReady={onTrackChangeHandlerReady}
      />
    </ErrorBoundary>
  );
});

