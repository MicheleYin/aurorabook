import type { KeyboardEvent } from "react";
import { ImageOff, Loader2 } from "lucide-react";

import type { Book } from "../../types/reader";
import type { ConversionProgress } from "../../lib/audiobook-converter";
import {
  cn,
  getBookProgressSummary,
  getLibraryBookStatusFromSummary,
} from "../../lib/utils";
import { animPatterns, staggerDelay } from "../../lib/animations";
import { Button } from "../ui/button";
import { Progress } from "../ui/progress";
import { LibraryStatusBadge } from "./LibraryStatusBadge";

interface LibraryGridProps {
  books: Book[];
  activeBookId?: string;
  onOpenBook: (bookId: string) => void;
  onViewDetails: (bookId: string) => void;
  bookConversionProgress?: Record<string, ConversionProgress>;
}

export function LibraryGrid({
  books,
  activeBookId,
  onOpenBook,
  onViewDetails,
  bookConversionProgress = {},
}: LibraryGridProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>, bookId: string) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpenBook(bookId);
    }
  };

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 library-grid-transition">
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
              "group flex h-full flex-col overflow-hidden rounded-xl border bg-card text-left shadow-sm library-item-enter",
              animPatterns.cardHover,
              isActive && "border-primary shadow-md ring-1 ring-primary/40",
              isActive && animPatterns.cardActive,
              staggerDelay(index, 30),
            )}
          >
            <div className="relative aspect-[3/4] w-full overflow-hidden bg-muted">
              <LibraryStatusBadge status={status} className="absolute left-2 top-2 z-10" />
              {book.coverUrl ? (
                <>
                  <img
                    src={book.coverUrl}
                    alt={`${book.title} cover`}
                    className={cn("h-full w-full object-cover", animPatterns.imageZoom)}
                    onLoad={(e) => {
                      // Remove shimmer when image loads
                      e.currentTarget.classList.remove(animPatterns.coverShimmer.split(" ")[0]);
                    }}
                    onError={(e) => {
                      // Remove shimmer on error
                      e.currentTarget.classList.remove(animPatterns.coverShimmer.split(" ")[0]);
                    }}
                  />
                  {/* Shimmer overlay while loading */}
                  <div className={cn("absolute inset-0 pointer-events-none", animPatterns.coverShimmer)} />
                </>
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
              {isConverting ? (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      Converting: Chapter {conversionProgress.currentChapter} of {conversionProgress.totalChapters}
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
                <p className="text-xs text-muted-foreground">{progressText}</p>
              )}
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
