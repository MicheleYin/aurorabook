import type { KeyboardEvent } from "react";
import { ImageOff } from "lucide-react";

import type { Book } from "../../types/reader";
import {
  cn,
  formatPageCount,
  getBookProgressSummary,
  getLibraryBookStatusFromSummary,
} from "../../lib/utils";
import { Button } from "../ui/button";
import { LibraryStatusBadge } from "./LibraryStatusBadge";

interface LibraryListProps {
  books: Book[];
  activeBookId?: string;
  onOpenBook: (bookId: string) => void;
  onViewDetails: (bookId: string) => void;
}

export function LibraryList({
  books,
  activeBookId,
  onOpenBook,
  onViewDetails,
}: LibraryListProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>, bookId: string) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpenBook(bookId);
    }
  };

  return (
    <div className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border">
      {books.map((book) => {
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
        const pageSummary = formatPageCount(book.pageCount) ?? "Pages unknown";
        return (
          <div
            key={book.id}
            role="button"
            tabIndex={0}
            onClick={() => onOpenBook(book.id)}
            onKeyDown={(event) => handleKeyDown(event, book.id)}
            className={cn(
              "flex w-full items-center gap-4 px-4 py-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              isActive && "bg-primary/5",
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
              <span className="line-clamp-1 text-xs text-muted-foreground">{progressText}</span>
              <span className="line-clamp-1 text-xs text-muted-foreground">
                {`${chapterSummary} · ${pageSummary}`}
              </span>
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
