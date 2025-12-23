import { useEffect, useRef } from "react";
import { BookOpen } from "lucide-react";

import type { Book, Chapter } from "../../types/book";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "../ui/drawer";
import { ScrollArea } from "../ui/scroll-area";

interface TOCDrawerProps {
  book: Book;
  currentChapter: Chapter;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onChapterSelect: (chapter: Chapter) => void;
}

export function TOCDrawer({
  book,
  currentChapter,
  isOpen,
  onOpenChange,
  onChapterSelect,
}: Readonly<TOCDrawerProps>) {
  const currentChapterRef = useRef<HTMLButtonElement | null>(null);

  // Scroll to current chapter when drawer opens
  useEffect(() => {
    if (!isOpen) return;

    const scrollToCurrentChapter = () => {
      if (currentChapterRef.current) {
        currentChapterRef.current.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }
    };

    // Small delay to ensure drawer is fully rendered
    const timeoutId = setTimeout(scrollToCurrentChapter, 100);
    return () => clearTimeout(timeoutId);
  }, [isOpen, currentChapter.id]);

  return (
    <Drawer open={isOpen} onOpenChange={onOpenChange} direction="left">
      <DrawerTrigger asChild>
        <Button variant="ghost" size="icon">
          <BookOpen className="h-5 w-5" />
        </Button>
      </DrawerTrigger>
      <DrawerContent className="w-80 max-w-[85vw] max-h-[100vh] top-0 bottom-0 left-0 right-auto rounded-r-3xl rounded-l-none safe-area-top">
        <DrawerHeader className="pb-4">
          <DrawerTitle>Table of Contents</DrawerTitle>
        </DrawerHeader>
        <ScrollArea className="flex-1">
          <div className="p-4 space-y-1">
            {book.chapters.map((chapter) => (
              <button
                key={chapter.id}
                ref={
                  chapter.id === currentChapter.id ? currentChapterRef : null
                }
                onClick={() => onChapterSelect(chapter)}
                className={cn(
                  "w-full text-left px-3 py-2 rounded-md text-sm transition-colors",
                  chapter.id === currentChapter.id
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted"
                )}
              >
                <div className="font-medium">{chapter.title}</div>
                {chapter.estimatedPageCount && (
                  <div className="text-xs opacity-70 mt-0.5">
                    {chapter.estimatedPageCount} pages
                  </div>
                )}
              </button>
            ))}
          </div>
        </ScrollArea>
      </DrawerContent>
    </Drawer>
  );
}
