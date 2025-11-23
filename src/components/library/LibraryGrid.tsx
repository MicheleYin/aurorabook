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

interface LibraryGridProps {
  books: Book[];
  activeBookId?: string;
  onOpenBook: (bookId: string) => void;
  onViewDetails: (bookId: string) => void;
}

export function LibraryGrid({
  books,
  activeBookId,
  onOpenBook,
  onViewDetails,
}: LibraryGridProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>, bookId: string) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpenBook(bookId);
    }
  };

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
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
        return (
          <div
            key={book.id}
            role="button"
            tabIndex={0}
            onClick={() => onOpenBook(book.id)}
            onKeyDown={(event) => handleKeyDown(event, book.id)}
            className={cn(
              "group flex h-full flex-col overflow-hidden rounded-xl border bg-card text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              isActive && "border-primary shadow-md ring-1 ring-primary/40",
            )}
          >
            <div className="relative aspect-[3/4] w-full overflow-hidden bg-muted">
              <LibraryStatusBadge status={status} className="absolute left-2 top-2" />
              {book.coverUrl ? (
                <img
                  src={book.coverUrl}
                  alt={`${book.title} cover`}
                  className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                  <ImageOff className="h-10 w-10" />
                </div>
              )}
            </div>
            <div className="flex flex-1 flex-col gap-2 p-4">
              <div>
                <p className="line-clamp-1 text-sm font-semibold text-foreground">
                  {book.title}
                </p>
                <p className="line-clamp-1 text-xs text-muted-foreground">
                  {book.author}
                </p>
              </div>
              <p className="text-xs text-muted-foreground">{progressText}</p>
              <div className="mt-auto flex items-center justify-between text-xs text-muted-foreground">
                <div className="flex flex-col">
                  <span>{chapterSummary}</span>
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
            </div>
          </div>
        );
      })}
    </div>
  );
}
