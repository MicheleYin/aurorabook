import { useCallback } from "react";

import type { Book } from "./types/book";
import { FloatingAudioPlayer } from "./components/audio/FloatingAudioPlayer";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Library } from "./components/library/Library";
import { Reader } from "./components/reader/Reader";
import { Settings } from "./components/settings/SettingsPanel";
import { Toaster } from "./components/ui/sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import { AppProvider, TabValue, useAppContext } from "./context/AppContext";
import {
  AudioProgressProvider,
  useAudioProgressContext,
} from "./context/AudioProgressContext";
import {
  ChapterProgressProvider,
  useChapterProgressContext,
} from "./context/ChapterProgressContext";

function AppContent() {
  const { currentTab, setCurrentTab, currentBook } = useAppContext();

  return (
    <div className="flex h-screen flex-col relative">
      <Tabs
        value={currentTab}
        onValueChange={(value) => {
          setCurrentTab(value as TabValue);
        }}
        className="flex h-full flex-col"
      >
        <main className="flex-1 overflow-hidden">
          <TabsContent value="library" className="h-full overflow-auto m-0">
            <Library />
          </TabsContent>
          <TabsContent value="reader" className="h-full overflow-auto m-0">
            <Reader />
          </TabsContent>
          <TabsContent value="settings" className="h-full overflow-auto m-0">
            <Settings />
          </TabsContent>
        </main>
        <div className="absolute bottom-0 left-0 right-0 flex justify-center pb-4 pointer-events-none z-10">
          <TabsList className="rounded-full bg-background/80 backdrop-blur-lg border shadow-lg px-1 py-2 gap-1 pointer-events-auto">
            <TabsTrigger
              value="library"
              className="rounded-full px-4 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground transition-all"
            >
              Library
            </TabsTrigger>
            <TabsTrigger
              value="reader"
              disabled={!currentBook}
              className="rounded-full px-4 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground transition-all"
            >
              Reader
            </TabsTrigger>
            <TabsTrigger
              value="settings"
              className="rounded-full px-4 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground transition-all"
            >
              Settings
            </TabsTrigger>
          </TabsList>
        </div>
      </Tabs>
      <FloatingAudioPlayer />

      <Toaster richColors position="top-center" />
    </div>
  );
}

function AppWithProviders() {
  const {
    saveProgress,
    restoreProgress,
    loadLastOpenedChapter,
    calculateBookProgress,
  } = useChapterProgressContext();
  const {
    loadLastOpenedAudioTrack,
    loadAudioTrack,
    calculateAudioProgress,
    saveAudioProgress,
  } = useAudioProgressContext();

  // Wrap saveProgress to match AppProvider's expected signature
  const saveChapterProgress = useCallback(
    async (book: Book) => {
      await saveProgress(book);
    },
    [saveProgress]
  );

  // Wrap restoreProgress to match AppProvider's expected signature
  const restoreChapterProgress = useCallback(
    async (book: Book) => {
      restoreProgress(book);
    },
    [restoreProgress]
  );

  return (
    <AppProvider
      calculateBookProgress={calculateBookProgress}
      loadAudioTrack={loadAudioTrack}
      saveChapterProgress={saveChapterProgress}
      restoreChapterProgress={restoreChapterProgress}
      loadLastOpenedChapter={loadLastOpenedChapter}
      loadLastOpenedAudioTrack={loadLastOpenedAudioTrack}
      calculateAudioProgress={calculateAudioProgress}
      saveAudioProgress={saveAudioProgress}
    >
      <AppContent />
    </AppProvider>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ChapterProgressProvider>
        <AudioProgressProvider>
          <AppWithProviders />
        </AudioProgressProvider>
      </ChapterProgressProvider>
    </ErrorBoundary>
  );
}

export default App;
