import type { Book } from "../../types/reader";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import type { ChapterSelectionOptions } from "./types";

type ChapterListProps = {
  book: Book;
  activeChapterId?: string;
  className?: string;
  onSelectChapter: (chapterId: string, options?: ChapterSelectionOptions) => void;
  onAfterSelect?: () => void;
};

export function ChapterList({
  book,
  activeChapterId,
  className,
  onSelectChapter,
  onAfterSelect,
}: ChapterListProps) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {book.chapters.map((chapter) => {
        const isActive = chapter.id === activeChapterId;
        return (
          <Button
            key={chapter.id}
            variant={isActive ? "secondary" : "ghost"}
            size="sm"
            className="justify-start"
            onClick={() => {
              onSelectChapter(chapter.id, { fragment: chapter.id, isManualSelection: true });
              onAfterSelect?.();
            }}
          >
            <span className="line-clamp-1">{chapter.title}</span>
          </Button>
        );
      })}
    </div>
  );
}
