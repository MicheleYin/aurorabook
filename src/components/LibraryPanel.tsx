import { BookOpen, ImageOff, Plus } from "lucide-react";

import type { Book } from "../types/reader";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";

export type LibraryPanelProps = {
  library: Book[];
  activeBookId?: string;
  isImporting: boolean;
  onAddEbook: () => void;
  onOpenBook: (bookId: string) => void;
};

export function LibraryPanel({
  library,
  activeBookId,
  isImporting,
  onAddEbook,
  onOpenBook,
}: LibraryPanelProps) {
  const hasBooks = library.length > 0;

  return (
    <Card className="h-full">
      <CardHeader className="space-y-4">
        <div>
          <CardTitle className="flex items-center gap-2 text-lg">
            <BookOpen className="h-5 w-5 text-primary" />
            Library
          </CardTitle>
          <CardDescription>
            Import EPUB files and build your personal narrated shelf.
          </CardDescription>
        </div>
        <Button onClick={onAddEbook} disabled={isImporting}>
          {isImporting ? (
            "Adding…"
          ) : (
            <>
              <Plus className="mr-2 h-4 w-4" />
              Add ebook
            </>
          )}
        </Button>
      </CardHeader>
      <CardContent>
        {hasBooks ? (
          <div className="grid gap-4 grid-cols-2">
            {library.map((book) => {
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
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 rounded-md border border-dashed p-8 text-center">
            <p className="text-sm font-medium">Your shelf is empty.</p>
            <p className="text-sm text-muted-foreground">
              Bring an EPUB into Whisperleaf to start reading and listening.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

