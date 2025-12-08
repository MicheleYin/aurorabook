import { useState, useEffect, useRef, type KeyboardEvent } from "react";
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
import { useETA } from "../../hooks/useETA";

interface LibraryListProps {
  books: Book[];
  activeBookId?: string;
  onOpenBook: (bookId: string) => void;
  onViewDetails: (bookId: string) => void;
  bookConversionProgress?: Record<string, ConversionProgress>;
  conversionStartTimeRef?: React.MutableRefObject<number | null>;
}

export function LibraryList({
  books,
  activeBookId,
  onOpenBook,
  onViewDetails,
  bookConversionProgress = {},
  conversionStartTimeRef,
}: LibraryListProps) {
  const [displayedBooks, setDisplayedBooks] = useState<Book[]>(books);
  const [exitingBookIds, setExitingBookIds] = useState<Set<string>>(new Set());
  const previousBooksRef = useRef<Book[]>(books);

  useEffect(() => {
    const currentBookIds = new Set(books.map(b => b.id));
    const previousBookIds = new Set(previousBooksRef.current.map(b => b.id));
    
    // Find books that are leaving
    const leavingIds = Array.from(previousBookIds).filter(id => !currentBookIds.has(id));
    
    if (leavingIds.length > 0) {
      // Mark books as exiting
      setExitingBookIds(new Set(leavingIds));
      
      // Remove them after animation completes
      const timer = setTimeout(() => {
        setDisplayedBooks(books);
        setExitingBookIds(new Set());
        previousBooksRef.current = books;
      }, 200); // Match exit animation duration
      
      return () => clearTimeout(timer);
    } else {
      // Books are being added or reordered
      setDisplayedBooks(books);
      previousBooksRef.current = books;
    }
  }, [books]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>, bookId: string) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpenBook(bookId);
    }
  };

  // Merge displayed books with exiting books to show exit animations
  const allBooks = displayedBooks.filter(b => !exitingBookIds.has(b.id));
  const exitingBooks = previousBooksRef.current.filter(b => exitingBookIds.has(b.id));
  const booksToRender = [...allBooks, ...exitingBooks];

  return (
    <div className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border">
      {booksToRender.map((book, index) => {
        const isExiting = exitingBookIds.has(book.id);
        const isVisible = books.some(b => b.id === book.id);
        const displayIndex = isVisible ? books.findIndex(b => b.id === book.id) : index;
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
        const conversionPercent = conversionProgress && conversionProgress.totalWords > 0
          ? Math.min(100, Math.max(0, Math.round((conversionProgress.wordsProcessed / conversionProgress.totalWords) * 100)))
          : conversionProgress && conversionProgress.totalChapters > 0
          ? Math.min(100, Math.max(0, Math.round((conversionProgress.currentChapter / conversionProgress.totalChapters) * 100)))
          : 0;
          
        return (
          <div
            key={book.id}
            className={cn(
              isExiting ? "library-item-exit" : "library-item-enter",
              staggerDelay(displayIndex, 20)
            )}
          >
            <div
              role="button"
              tabIndex={0}
              onClick={() => onOpenBook(book.id)}
              onKeyDown={(event) => handleKeyDown(event, book.id)}
              className={cn(
                "flex w-full items-center gap-4 px-4 py-3 text-left",
                anim("normal", "colors"),
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                isActive && "bg-primary/5",
              )}
              aria-label={`Open ${book.title} by ${book.author}`}
            >
            <div className="relative h-16 w-12 overflow-hidden rounded-md bg-muted">
              {book.coverUrl ? (
                <BookCoverImage src={book.coverUrl} alt={`${book.title} cover`} />
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
                <ConversionProgressWithETA
                  conversionProgress={conversionProgress}
                  conversionPercent={conversionPercent}
                  conversionStartTimeRef={conversionStartTimeRef}
                />
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
              aria-label={`View details for ${book.title}`}
            >
              Details
            </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ConversionProgressWithETA({
  conversionProgress,
  conversionPercent,
  conversionStartTimeRef,
}: {
  conversionProgress: ConversionProgress;
  conversionPercent: number;
  conversionStartTimeRef?: React.MutableRefObject<number | null>;
}) {
  // Calculate ETA using exponentially decaying average for smoother estimates
  const eta = useETA({
    progressPercent: conversionPercent,
    startTimeRef: conversionStartTimeRef,
    isActive: true,
  });

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">
          {conversionProgress.totalWords > 0
            ? `${conversionProgress.wordsProcessed.toLocaleString()}/${conversionProgress.totalWords.toLocaleString()} words`
            : `Converting: ${conversionProgress.currentChapter}/${conversionProgress.totalChapters}`}
        </span>
        <span className="font-medium">{conversionPercent}%</span>
      </div>
      <Progress value={conversionPercent} className="h-1.5" />
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <Loader2 className="h-3 w-3 animate-spin" />
          <span className="line-clamp-1">{conversionProgress.message}</span>
        </div>
        {eta && (
          <span className="shrink-0">ETA: {eta}</span>
        )}
      </div>
    </div>
  );
}

function BookCoverImage({ src, alt }: { src: string; alt: string }) {
  const [isImageLoaded, setIsImageLoaded] = useState(false);
  const [hasImageError, setHasImageError] = useState(false);

  return (
    <>
      {/* Skeleton loader - shown while image is loading */}
      {!isImageLoaded && !hasImageError && (
        <div className={cn(
          "absolute inset-0 animate-shimmer bg-gradient-to-r from-muted via-muted/50 to-muted bg-[length:200%_100%]"
        )} />
      )}
      <img
        src={src}
        alt={alt}
        className={cn(
          "h-full w-full object-cover",
          anim("normal", "all"),
          isImageLoaded ? "cover-loaded" : "cover-loading"
        )}
        onLoad={() => {
          setIsImageLoaded(true);
        }}
        onError={() => {
          setHasImageError(true);
          setIsImageLoaded(false);
        }}
      />
    </>
  );
}
