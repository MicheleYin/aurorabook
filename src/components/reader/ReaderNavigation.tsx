import { ChevronLeft, ChevronRight } from "lucide-react";

import type { Book, Chapter } from "../../types/book";
import { Button } from "../ui/button";

interface ReaderNavigationProps {
  book: Book;
  currentChapter: Chapter;
  onPrevious: () => void;
  onNext: () => void;
}

export function ReaderNavigation({
  book,
  currentChapter,
  onPrevious,
  onNext,
}: ReaderNavigationProps) {
  const currentChapterIndex = book.chapters.findIndex(
    (ch) => ch.id === currentChapter.id
  );
  const hasPrevious = currentChapterIndex > 0;
  const hasNext = currentChapterIndex < book.chapters.length - 1;

  return (
    <div className="absolute bottom-0 left-0 right-0 z-10 flex-shrink-0">
      <div className="flex items-center justify-between p-4">
        <Button
          variant="outline"
          onClick={onPrevious}
          disabled={!hasPrevious}
          className="gap-2"
        >
          <ChevronLeft className="h-4 w-4" />
          Previous
        </Button>
        <div className="text-sm text-muted-foreground">
          Chapter {currentChapterIndex + 1} of {book.chapters.length}
        </div>
        <Button
          variant="outline"
          onClick={onNext}
          disabled={!hasNext}
          className="gap-2"
        >
          Next
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
