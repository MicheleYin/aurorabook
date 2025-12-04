import { useState, useEffect, useRef, type KeyboardEvent } from "react";
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
import { useETA } from "../../hooks/useETA";

interface LibraryGridProps {
  books: Book[];
  activeBookId?: string;
  onOpenBook: (bookId: string) => void;
  onViewDetails: (bookId: string) => void;
  bookConversionProgress?: Record<string, ConversionProgress>;
  conversionStartTimeRef?: React.MutableRefObject<number | null>;
}

export function LibraryGrid({
  books,
  activeBookId,
  onOpenBook,
  onViewDetails,
  bookConversionProgress = {},
  conversionStartTimeRef,
}: LibraryGridProps) {
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
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 library-grid-transition">
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
              staggerDelay(displayIndex, 30)
            )}
          >
            <BookCoverCard
              book={book}
              isActive={isActive}
              status={status}
              progressText={progressText}
              chapterSummary={chapterSummary}
              isConverting={isConverting}
              conversionProgress={conversionProgress}
              conversionPercent={conversionPercent}
              onOpenBook={onOpenBook}
              onViewDetails={onViewDetails}
              handleKeyDown={handleKeyDown}
              conversionStartTimeRef={conversionStartTimeRef}
            />
          </div>
        );
      })}
    </div>
  );
}

function BookCoverCard({
  book,
  isActive,
  status,
  progressText,
  chapterSummary,
  isConverting,
  conversionProgress,
  conversionPercent,
  onOpenBook,
  onViewDetails,
  handleKeyDown,
  conversionStartTimeRef,
}: {
  book: Book;
  isActive: boolean;
  status: ReturnType<typeof getLibraryBookStatusFromSummary>;
  progressText: string;
  chapterSummary: string;
  isConverting: boolean;
  conversionProgress?: ConversionProgress;
  conversionPercent: number;
  onOpenBook: (bookId: string) => void;
  onViewDetails: (bookId: string) => void;
  handleKeyDown: (event: KeyboardEvent<HTMLDivElement>, bookId: string) => void;
  conversionStartTimeRef?: React.MutableRefObject<number | null>;
}) {
  const [isImageLoaded, setIsImageLoaded] = useState(false);
  const [hasImageError, setHasImageError] = useState(false);
  // Calculate ETA using exponentially decaying average for smoother estimates
  const eta = useETA({
    progressPercent: conversionPercent,
    startTimeRef: conversionStartTimeRef,
    isActive: isConverting && !!conversionProgress,
  });
  
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpenBook(book.id)}
      onKeyDown={(event) => handleKeyDown(event, book.id)}
            className={cn(
              "group flex h-full flex-col overflow-hidden rounded-xl border bg-card text-left shadow-sm",
              animPatterns.cardHover,
              isActive && "border-primary shadow-md ring-1 ring-primary/40",
              isActive && animPatterns.cardActive,
            )}
          >
      <div className="relative aspect-[3/4] w-full overflow-hidden bg-muted">
        <LibraryStatusBadge status={status} className="absolute left-2 top-2 z-10" />
        {book.coverUrl && !hasImageError ? (
          <>
            {/* Skeleton loader - shown while image is loading */}
            {!isImageLoaded && (
              <div className={cn(
                "absolute inset-0 animate-shimmer bg-gradient-to-r from-muted via-muted/50 to-muted bg-[length:200%_100%]"
              )} />
            )}
            <img
              src={book.coverUrl}
              alt={`${book.title} cover`}
              className={cn(
                "h-full w-full object-cover",
                animPatterns.imageZoom,
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
        {isConverting && conversionProgress ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                {conversionProgress.totalWords > 0
                  ? `${conversionProgress.wordsProcessed.toLocaleString()}/${conversionProgress.totalWords.toLocaleString()} words`
                  : `Converting: Chapter ${conversionProgress.currentChapter} of ${conversionProgress.totalChapters}`}
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
}
