import { memo } from "react";
import { ErrorBoundary } from "../../ErrorBoundary";
import { ReaderPanel } from "../../ReaderPanel";
import { ReaderCoordinatorProvider } from "../../../contexts/ReaderCoordinatorContext";
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
  library: Book[];
  updateBookAudioState: (bookId: string, snapshot: AudioProgressSnapshot) => Promise<void>;
  flushAudioStateUpdate: () => Promise<void>;
  handleTrackChange: (trackHref: string) => Promise<void>;
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
  library,
  updateBookAudioState,
  flushAudioStateUpdate,
  handleTrackChange,
}: ReaderViewProps) {
  return (
    <ErrorBoundary>
      <ReaderCoordinatorProvider
        onChapterChange={async (_bookId, chapterId, options) => {
          await onSelectChapter(chapterId, options);
        }}
        onChapterRestore={async () => {
          // Chapter restore is handled by ReaderWrapper
        }}
        onChapterProgressRestore={async () => {
          // Progress restore is coordinated through the coordinator
          // The actual restoration will happen in onChapterLoaded when DOM is ready
        }}
        onChapterSave={async () => {
          // Chapter save is handled by ReaderWrapper's saveProgress
        }}
        onChapterProgressSave={async (bookId, _chapterId, snapshot) => {
          onChapterProgress(bookId, snapshot);
        }}
        onAudioTrackLoad={async (bookId, trackId) => {
          const { ensureAudioTrackLoaded } = await import("../../../lib/lazy-chapter-loader");
          const book = library.find((b) => b.id === bookId);
          if (!book) return null;
          const track = book.audioTracks.find((t) => t.id === trackId);
          if (!track) return null;
          const loaded = await ensureAudioTrackLoaded(bookId, track);
          return loaded.url || null;
        }}
        onAudioTimestampRestore={async () => {
          // Audio timestamp restore is handled by audio player
        }}
        onAudioTrackSave={async () => {
          await flushAudioStateUpdate();
        }}
        onAudioTimestampSave={async (bookId, trackId, timestamp) => {
          const book = library.find((b) => b.id === bookId);
          if (book) {
            const track = book.audioTracks.find((t) => t.id === trackId);
            if (track) {
              await updateBookAudioState(bookId, {
                currentTimeSeconds: timestamp,
                trackId: trackId,
                trackHref: track.href,
                trackIndex: book.audioTracks.findIndex((t) => t.id === trackId),
                updatedAt: new Date().toISOString(),
              });
            }
          }
        }}
        onAudioTrackChange={async (bookId, trackId) => {
          const book = library.find((b) => b.id === bookId);
          if (book) {
            const track = book.audioTracks.find((t) => t.id === trackId);
            if (track) {
              await handleTrackChange(track.href);
            }
          }
        }}
      >
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
      </ReaderCoordinatorProvider>
    </ErrorBoundary>
  );
});

