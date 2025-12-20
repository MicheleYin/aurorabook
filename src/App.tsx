import { ErrorBoundary } from "./components/ErrorBoundary";
import { Toaster } from "./components/ui/sonner";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./components/ui/tabs";
import { Library } from "./components/Library";
import { Reader } from "./components/Reader";
import { Settings } from "./components/settings/SettingsPanel";

function App() {
  return (
    <ErrorBoundary>
      <div className="flex h-screen flex-col relative">
        <Tabs defaultValue="library" className="flex h-full flex-col">
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
        <Toaster />
      </div>
    </ErrorBoundary>
  );
}

export default App;
