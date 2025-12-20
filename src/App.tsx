import { useEffect, useState } from "react";
import { logger } from "./lib/logger";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Toaster } from "./components/ui/sonner";
import { LoadingScreen } from "./components/app/LoadingScreen";

// View components
import { LibraryView } from "./components/app/views/LibraryView";
import { ReaderView } from "./components/app/views/ReaderView";
import { SettingsView } from "./components/app/views/SettingsView";
import { AppNavigation } from "./components/app/AppNavigation";

// Simplified hooks
import { useLibrary } from "./hooks/useLibrary";
import { useReader } from "./hooks/useReader";
import { useAudioPlayer } from "./hooks/useAudioPlayer";
import { useSettings } from "./hooks/useSettings";

// Redux
import { useAppDispatch, useAppSelector } from "./store/hooks";
import { selectIsHydrated, selectCurrentBookId } from "./store/selectors";
import { setCurrentBook } from "./store/slices/readerSlice";
import { loadProgressChapter } from "./store/thunks/readerThunks";
import { loadProgressAudioTrack } from "./store/thunks/readerThunks";

type View = "library" | "reader" | "settings";

function App() {
  const dispatch = useAppDispatch();
  const isHydrated = useAppSelector(selectIsHydrated);
  const currentBookId = useAppSelector(selectCurrentBookId);
  const [currentView, setCurrentView] = useState<View>("library");

  const { books, refresh } = useLibrary();
  const { currentBook, currentChapter, scrollPosition, openBook, openChapter, saveScrollPosition } = useReader();
  const { currentTrack, trackUrl, seekPosition, isPlaying, play, pause, seek } = useAudioPlayer();
  const { settings, updateSettings } = useSettings();

  // Load library on init
  useEffect(() => {
    if (!isHydrated) {
      refresh();
    }
  }, [isHydrated, refresh]);

  // Auto-open last book when library loads
  useEffect(() => {
    if (isHydrated && books.length > 0 && !currentBookId) {
      // Find last opened book
      const lastBook = books
        .filter((b) => b.lastOpenedTime)
        .sort((a, b) => {
          const aTime = a.lastOpenedTime ? new Date(a.lastOpenedTime).getTime() : 0;
          const bTime = b.lastOpenedTime ? new Date(b.lastOpenedTime).getTime() : 0;
          return bTime - aTime;
        })[0] || books[0];

      if (lastBook) {
        logger.log("[App] Auto-opening last book", { bookId: lastBook.id });
        
        // Open book
        dispatch(setCurrentBook(lastBook.id));
        setCurrentView("reader");

        // Load last chapter if progress exists
        if (lastBook.progress?.currentChapterId) {
          dispatch(loadProgressChapter({
            bookId: lastBook.id,
            chapterId: lastBook.progress.currentChapterId,
          }));
        }

        // Load last audio track if audio state exists
        if (lastBook.audioState?.currentTrackId) {
          dispatch(loadProgressAudioTrack({
            bookId: lastBook.id,
            trackId: lastBook.audioState.currentTrackId,
          }));
        }
      }
    }
  }, [isHydrated, books, currentBookId, dispatch]);

  if (!isHydrated) {
    return <LoadingScreen />;
  }

  return (
    <ErrorBoundary>
      <div className="flex h-screen flex-col">
        <AppNavigation
          currentView={currentView}
          onViewChange={setCurrentView}
        />

        <main className="flex-1 overflow-hidden">
          {currentView === "library" && (
            <LibraryView
              books={books}
              onSelectBook={(bookId) => {
                openBook(bookId);
                setCurrentView("reader");
              }}
            />
          )}

          {currentView === "reader" && (
            <ReaderView
              currentBook={currentBook}
              currentChapter={currentChapter}
              scrollPosition={scrollPosition}
              onChapterChange={openChapter}
              onScrollPositionChange={saveScrollPosition}
              settings={settings}
            />
          )}

          {currentView === "settings" && (
            <SettingsView
              settings={settings}
              onSettingsChange={updateSettings}
            />
          )}
        </main>

        {/* Audio Player - always visible when track is loaded */}
        {currentTrack && trackUrl && (
          <div className="border-t">
            <SimpleAudioPlayer
              track={currentTrack}
              trackUrl={trackUrl}
              seekPosition={seekPosition}
              isPlaying={isPlaying}
              onPlay={play}
              onPause={pause}
              onSeek={seek}
            />
          </div>
        )}

        <Toaster />
      </div>
    </ErrorBoundary>
  );
}

// Simple audio player component
function SimpleAudioPlayer({
  track,
  trackUrl,
  seekPosition,
  isPlaying,
  onPlay,
  onPause,
  onSeek,
}: {
  track: { title: string };
  trackUrl: string;
  seekPosition: number | null;
  isPlaying: boolean;
  onPlay: () => void;
  onPause: () => void;
  onSeek: (position: number) => void;
}) {
  // This will be implemented in Phase 4
  return (
    <div className="p-4 border-t bg-background">
      <div className="flex items-center gap-4">
        <button onClick={isPlaying ? onPause : onPlay}>
          {isPlaying ? "⏸" : "▶"}
        </button>
        <span className="flex-1">{track.title}</span>
        {seekPosition !== null && (
          <span className="text-sm text-muted-foreground">
            {Math.floor(seekPosition / 60)}:{(Math.floor(seekPosition % 60)).toString().padStart(2, "0")}
          </span>
        )}
      </div>
    </div>
  );
}

export default App;
