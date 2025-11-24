import type { KeyboardEvent } from "react";
import { ImageOff, Loader2 } from "lucide-react";

import type { Book } from "../../types/reader";
import type { ConversionProgress } from "../../lib/audiobook-converter";
import {
  cn,
  getBookProgressSummary,
  getLibraryBookStatusFromSummary,
} from "../../lib/utils";
import { anim, staggerDelay } from "../../lib/animations";
import { Button } from "../ui/button";
import { Progress } from "../ui/progress";
import { LibraryStatusBadge } from "./LibraryStatusBadge";

interface LibraryListProps {
  books: Book[];
  activeBookId?: string;
  onOpenBook: (bookId: string) => void;
  onViewDetails: (bookId: string) => void;
  bookConversionProgress?: Record<string, ConversionProgress>;
}

export function LibraryList({
  books,
  activeBookId,
  onOpenBook,
  onViewDetails,
  bookConversionProgress = {},
}: LibraryListProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>, bookId: string) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpenBook(bookId);
    }
  };

  return (
    <div className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border">
      {books.map((book, index) => {
        const isActive = book.id === activeBookId;
        const progressSummary = getBookProgressSummary(book);
        const status = getLibraryBookStatusFromSummary(progressSummary);
        const hasChapters = book.chapters.length > 0;
        const progressText = hasChapters
          ? `Progress: ${progressSummary.label}`
          : "Progress: No chapters available";
        const chapterSummary = hasChapters
          ? `Chapters: ${book.chapters.length}`
          : "Chapters: Not available";
        const conversionProgress = bookConversionProgress[book.id];
        const isConverting = Boolean(conversionProgress);
        const conversionPercent = conversionProgress
          ? Math.round((conversionProgress.currentChapter / conversionProgress.totalChapters) * 100)
          : 0;
          
        return (
          <div
            key={book.id}
            role="button"
            tabIndex={0}
            onClick={() => onOpenBook(book.id)}
            onKeyDown={(event) => handleKeyDown(event, book.id)}
            className={cn(
              "flex w-full items-center gap-4 px-4 py-3 text-left library-item-enter",
              anim("normal", "colors"),
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              isActive && "bg-primary/5",
              staggerDelay(index, 20),
            )}
          >
            <div className="relative h-16 w-12 overflow-hidden rounded-md bg-muted">
              {book.coverUrl ? (
                <img
                  src={book.coverUrl}
                  alt={`${book.title} cover`}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                  <ImageOff className="h-6 w-6" />
                </div>
              )}
            </div>
            <div className="flex flex-1 flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="line-clamp-1 text-sm font-semibold text-foreground">
                  {book.title}
                </span>
                <LibraryStatusBadge status={status} className="shrink-0" />
              </div>
              <span className="line-clamp-1 text-xs text-muted-foreground">
                {book.author}
              </span>
              {isConverting ? (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      Converting: {conversionProgress.currentChapter}/{conversionProgress.totalChapters}
                    </span>
                    <span className="font-medium">{conversionPercent}%</span>
                  </div>
                  <Progress value={conversionPercent} className="h-1.5" />
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span className="line-clamp-1">{conversionProgress.message}</span>
                  </div>
                </div>
              ) : (
                <>
                  <span className="line-clamp-1 text-xs text-muted-foreground">{progressText}</span>
                  <span className="line-clamp-1 text-xs text-muted-foreground">
                    {`${chapterSummary}`}
                  </span>
                </>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={(event) => {
                event.stopPropagation();
                onViewDetails(book.id);
              }}
            >
              Details
            </Button>
          </div>
        );
      })}
    </div>
  );
}
