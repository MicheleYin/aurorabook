import { ImageOff } from "lucide-react";

import type { Book } from "../../types/reader";
import { cn } from "../../lib/utils";

interface LibraryListProps {
  books: Book[];
  activeBookId?: string;
  onOpenBook: (bookId: string) => void;
}

export function LibraryList({ books, activeBookId, onOpenBook }: LibraryListProps) {
  return (
    <div className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border">
      {books.map((book) => {
        const isActive = book.id === activeBookId;
        return (
          <button
            key={book.id}
            type="button"
            onClick={() => onOpenBook(book.id)}
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
              <span className="line-clamp-1 text-sm font-semibold text-foreground">
                {book.title}
              </span>
              <span className="line-clamp-1 text-xs text-muted-foreground">
                {book.author}
              </span>
              <span className="text-xs text-muted-foreground">
                {book.chapters.length} chapter{book.chapters.length === 1 ? "" : "s"}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
