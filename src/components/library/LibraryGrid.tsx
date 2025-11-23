import { ImageOff } from "lucide-react";

import type { Book } from "../../types/reader";
import { cn } from "../../lib/utils";

interface LibraryGridProps {
  books: Book[];
  activeBookId?: string;
  onOpenBook: (bookId: string) => void;
}

export function LibraryGrid({ books, activeBookId, onOpenBook }: LibraryGridProps) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
      {books.map((book) => {
        const isActive = book.id === activeBookId;
        return (
          <button
            key={book.id}
            type="button"
            onClick={() => onOpenBook(book.id)}
            className={cn(
              "group flex h-full flex-col overflow-hidden rounded-xl border bg-card text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              isActive && "border-primary shadow-md ring-1 ring-primary/40",
            )}
          >
            <div className="relative aspect-[3/4] w-full overflow-hidden bg-muted">
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
              <div className="mt-auto flex items-center justify-between text-xs text-muted-foreground">
                <span>{book.chapters.length} chapters</span>
                <span>Tap to open</span>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
