import type { PropsWithChildren, ReactNode } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";

type MobileNavigationProps = PropsWithChildren<{
  activeView: "library" | "reader" | "player";
  onChange: (view: "library" | "reader" | "player") => void;
  librarySlot: ReactNode;
  readerSlot: ReactNode;
  playerSlot: ReactNode;
}>;

export function MobileNavigation({
  activeView,
  onChange,
  librarySlot,
  readerSlot,
  playerSlot,
}: MobileNavigationProps) {
  return (
    <Tabs
      value={activeView}
      onValueChange={(value) => onChange(value as "library" | "reader" | "player")}
      className="lg:hidden"
    >
      <TabsList className="grid w-full grid-cols-3">
        <TabsTrigger value="library">Library</TabsTrigger>
        <TabsTrigger value="reader">Reader</TabsTrigger>
        <TabsTrigger value="player">Audiobook</TabsTrigger>
      </TabsList>
      <TabsContent value="library" className="mt-4">
        {librarySlot}
      </TabsContent>
      <TabsContent value="reader" className="mt-4">
        {readerSlot}
      </TabsContent>
      <TabsContent value="player" className="mt-4">
        {playerSlot}
      </TabsContent>
    </Tabs>
  );
}

