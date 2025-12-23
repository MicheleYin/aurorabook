import {
  createContext,
  Dispatch,
  SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";

import type { Book } from "./types/book";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Library } from "./components/library/Library";
import { Reader } from "./components/reader/Reader";
import { Settings } from "./components/settings/SettingsPanel";
import { Toaster } from "./components/ui/sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";

type TabValue = "library" | "reader" | "settings";

interface AppContextType {
  currentTab: TabValue;
  setCurrentTab: Dispatch<SetStateAction<TabValue>>;
  currentBook: Book | null;
  setCurrentBook: Dispatch<SetStateAction<Book | null>>;
  library: Book[];
  setLibrary: Dispatch<SetStateAction<Book[]>>;
  isLoadingLibrary: boolean;
  setIsLoadingLibrary: Dispatch<SetStateAction<boolean>>;
  loadBooks: () => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function useAppContext() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useAppContext must be used within App");
  }
  return context;
}

function App() {
  const [currentTab, setCurrentTab] = useState<TabValue>("library");
  const [currentBook, setCurrentBook] = useState<Book | null>(null);
  const [isLoadingLibrary, setIsLoadingLibrary] = useState(true);
  const [library, setLibrary] = useState<Book[]>([]);
  const loadBooks = useCallback(async () => {
    try {
      setIsLoadingLibrary(true);
      const loadedBooks = await invoke<Book[]>("read_all_books", {
        filter: null,
      });
      setLibrary(loadedBooks);
    } catch (err) {
      console.error("Failed to load books:", err);
      toast.error("Failed to load books");
    } finally {
      setIsLoadingLibrary(false);
    }
  }, []);
  // load books on mount
  useEffect(() => {
    loadBooks();
  }, [loadBooks]);
  const contextValue = useMemo(
    () => ({
      currentTab,
      setCurrentTab,
      currentBook,
      setCurrentBook,
      library,
      setLibrary,
      isLoadingLibrary,
      setIsLoadingLibrary,
      loadBooks,
    }),
    [
      currentTab,
      currentBook,
      library,
      isLoadingLibrary,
      setIsLoadingLibrary,
      loadBooks,
    ]
  );

  return (
    <ErrorBoundary>
      <AppContext.Provider value={contextValue}>
        <div className="flex h-screen flex-col relative">
          <Tabs
            value={currentTab}
            onValueChange={(value) => setCurrentTab(value as TabValue)}
            className="flex h-full flex-col"
          >
            <main className="flex-1 overflow-hidden">
              <TabsContent value="library" className="h-full overflow-auto m-0">
                <Library />
              </TabsContent>
              <TabsContent value="reader" className="h-full overflow-auto m-0">
                <Reader />
              </TabsContent>
              <TabsContent
                value="settings"
                className="h-full overflow-auto m-0"
              >
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
          <Toaster richColors position="top-center" />
        </div>
      </AppContext.Provider>
    </ErrorBoundary>
  );
}

export default App;
