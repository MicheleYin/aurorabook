import { BookOpen, X } from "lucide-react";

import type { Book } from "../../types/reader";
import type { ReaderPanelBaseProps } from "./types";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader as DrawerModalHeader,
  DrawerTitle,
  DrawerTrigger,
} from "../ui/drawer";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";
import { anim } from "../../lib/animations";
import { ScrollArea } from "../ui/scroll-area";
import { ChapterList } from "./ChapterList";

type ReaderTocDrawerProps = {
  book: Book;
  activeChapterId?: string;
  currentAudioTrackHref?: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectChapter: ReaderPanelBaseProps["onSelectChapter"];
};

export function ReaderTocDrawer({
  book,
  activeChapterId,
  currentAudioTrackHref,
  isOpen,
  onOpenChange,
  onSelectChapter,
}: ReaderTocDrawerProps) {
  console.log("ReaderTocDrawer", {
    book,
    activeChapterId,
    currentAudioTrackHref,
    isOpen,
    onOpenChange,
    onSelectChapter,
  });
  return (
    <Drawer open={isOpen} onOpenChange={onOpenChange} direction="left">
      <DrawerTrigger asChild>
        <Button 
          variant="outline" 
          size="sm"
          className={cn(
            anim("medium", "all"),
            "ease-in-out"
          )}
          aria-label="Open table of contents"
        >
          <BookOpen className={cn(
            "h-4 w-4 shrink-0",
            anim("medium", "all"),
            "sm:mr-2 transition-[margin] duration-300 ease-in-out"
          )} aria-hidden="true" />
          <span 
            className={cn(
              "hidden sm:inline-block whitespace-nowrap",
              anim("medium", "opacity"),
              "transition-opacity duration-300 ease-in-out"
            )}
          >
            Table of contents
          </span>
        </Button>
      </DrawerTrigger>
      <DrawerContent className="data-[vaul-drawer-direction=left]:inset-y-0 data-[vaul-drawer-direction=left]:bottom-0 data-[vaul-drawer-direction=left]:left-0 data-[vaul-drawer-direction=left]:right-auto data-[vaul-drawer-direction=left]:top-0 data-[vaul-drawer-direction=left]:h-full data-[vaul-drawer-direction=left]:max-h-none data-[vaul-drawer-direction=left]:w-full data-[vaul-drawer-direction=left]:max-w-[320px] data-[vaul-drawer-direction=left]:rounded-none data-[vaul-drawer-direction=left]:border-r data-[vaul-drawer-direction=left]:p-0 data-[vaul-drawer-direction=left]:shadow-2xl data-[vaul-drawer-direction=left]:sm:inset-y-0 data-[vaul-drawer-direction=left]:sm:left-0 data-[vaul-drawer-direction=left]:sm:right-auto data-[vaul-drawer-direction=left]:sm:top-0 data-[vaul-drawer-direction=left]:sm:bottom-0 data-[vaul-drawer-direction=left]:sm:h-full data-[vaul-drawer-direction=left]:sm:max-h-none data-[vaul-drawer-direction=left]:sm:max-w-[360px] data-[vaul-drawer-direction=left]:sm:rounded-none data-[vaul-drawer-direction=left]:sm:border-r data-[vaul-drawer-direction=left]:sm:shadow-2xl data-[vaul-drawer-direction=left]:sm:-translate-x-0 data-[vaul-drawer-direction=left]:sm:-translate-y-0 data-[vaul-drawer-direction=left]:data-[state=open]:slide-in-from-left data-[vaul-drawer-direction=left]:data-[state=closed]:slide-out-to-left">
        <div className="flex h-full flex-1 flex-col overflow-hidden p-6 min-w-0">
          <DrawerModalHeader className="flex flex-row items-start justify-between text-left min-w-0">
            <div className="min-w-0 flex-1">
              <DrawerTitle className="text-lg font-semibold">Table of contents</DrawerTitle>
              <DrawerDescription>
                Jump between chapters without leaving the reader.
              </DrawerDescription>
            </div>
            <DrawerClose asChild>
              <Button variant="ghost" size="icon" aria-label="Close table of contents" className="shrink-0">
                <X className="h-4 w-4" />
              </Button>
            </DrawerClose>
          </DrawerModalHeader>
          <ScrollArea className="mt-4 flex-1 pr-2 min-w-0 w-full">
            <div className="w-full min-w-0">
              <ChapterList
                book={book}
                activeChapterId={activeChapterId}
                currentAudioTrackHref={currentAudioTrackHref}
                onSelectChapter={onSelectChapter}
                onAfterSelect={() => onOpenChange(false)}
                className="gap-1 w-full"
              />
            </div>
          </ScrollArea>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
