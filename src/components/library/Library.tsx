import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { BookOpen, Grid2x2, List, Plus } from "lucide-react";
import { toast } from "sonner";

import type { Book } from "../../types/book";
import { useAppContext } from "../../context/AppContext";
import { useBookConversion } from "../../hooks/useBookConversion";
import { staggerDelay } from "../../lib/animations";
import { logger } from "../../lib/logger";
import {
  showLoadingToast,
  updateLoadingToastToError,
  updateLoadingToastToSuccess,
} from "../../lib/toast-utils";
import { cn } from "../../lib/utils";
import { LoadingScreen } from "../app/LoadingScreen";
import { Button } from "../ui/button";
import { Card, CardContent, CardFooter } from "../ui/card";
import { Input } from "../ui/input";
import { Progress } from "../ui/progress";
import { BookDetailDialog } from "./BookDetailDialog";

type ViewMode = "grid" | "list";

export function Library() {
  const {
    setCurrentTab,
    setCurrentBookWithLoading,
    library: books,
    setLibrary: setBooks,
    isLoadingLibrary: isLoading,

    loadBooks,
  } = useAppContext();

  const booksRef = useRef(books);

  // Keep ref in sync with state
  useEffect(() => {
    booksRef.current = books;
  }, [books]);

  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isAddingBook, setIsAddingBook] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [filterKey, setFilterKey] = useState(0);
  const previousFilteredBooksRef = useRef<string[]>([]);

  // Calculate filtered books
  const filteredBooks = useMemo(
    () =>
      !searchQuery.trim()
        ? books
        : books.filter((book) => {
            const query = searchQuery.toLowerCase();
            return (
              book.title.toLowerCase().includes(query) ||
              book.author.toLowerCase().includes(query) ||
              book.publisher?.toLowerCase().includes(query) ||
              book.subjects?.some((subject) =>
                subject.toLowerCase().includes(query)
              )
            );
          }),
    [books, searchQuery]
  );

  // Trigger re-animation only when filtered results actually change
  useEffect(() => {
    const currentBookIds = filteredBooks.map((book) => book.id).sort();
    const previousBookIds = previousFilteredBooksRef.current.sort();

    // Check if the filtered books have actually changed
    const hasChanged =
      currentBookIds.length !== previousBookIds.length ||
      currentBookIds.some((id, index) => id !== previousBookIds[index]);

    if (hasChanged) {
      setFilterKey((prev) => prev + 1);
      previousFilteredBooksRef.current = currentBookIds;
    }
  }, [filteredBooks]);

  const handleOpenBook = (book: Book, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setCurrentBookWithLoading(book, false);
    setCurrentTab("reader");
  };





  const {
    convertBook: convertBookFromContext,
    cancelConversion,
    isConverting,
    convertingBookId,
    conversionProgress,
    eta,
  } = useBookConversion();

  // Wrap convertBook (no changes needed, callbacks handle everything)
  const convertBook = useCallback(
    async (bookId: string) => {
      try {
        await convertBookFromContext(bookId);
      } catch (err) {
        // Error is already handled in context
        logger.error("Conversion failed:", err);
      }
    },
    [convertBookFromContext]
  );

  const ingestBook = async (epubPath: string) => {
    try {
      showLoadingToast("Adding book to library...", "ingest-book");

      // Use the same path for both epub_path and source_path
      // The backend will handle the file:// prefix if needed
      const book = await invoke<Book>("ingest_epub", {
        epubPath: epubPath,
        sourcePath: epubPath,
      });

      updateLoadingToastToSuccess(
        `"${book.title}" added to library!`,
        "ingest-book"
      );

      // Reload books to show the new one
      await loadBooks();
    } catch (err) {
      logger.error("Failed to ingest book:", err);
      updateLoadingToastToError(
        err instanceof Error ? err.message : "Failed to add book to library",
        "ingest-book"
      );
    }
  };

  const handleAddBook = async () => {
    try {
      setIsAddingBook(true);

      // On iOS, file type filters are not supported, so we don't use them
      // The user can select any file, and we'll validate it's an EPUB on the backend
      // Detect iOS using user agent
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

      // Open file dialog to select EPUB file
      const selected = await open({
        multiple: false,
        // Only use filters on non-iOS platforms (iOS doesn't support file type filters)
        ...(isIOS
          ? {}
          : {
              filters: [
                {
                  name: "EPUB Files",
                  extensions: ["epub"],
                },
              ],
            }),
      });

      if (!selected || typeof selected === "string") {
        // User cancelled or selected a single file (string path)
        if (selected) {
          await ingestBook(selected);
        }
      } else if (Array.isArray(selected)) {
        // Multiple files selected (shouldn't happen with multiple: false, but handle it)
        for (const filePath of selected as string[]) {
          await ingestBook(filePath);
        }
      }
    } catch (err) {
      logger.error("Failed to add book:", err);
      toast.error(err instanceof Error ? err.message : "Failed to add book");
    } finally {
      setIsAddingBook(false);
    }
  };

  const handleBookClick = (book: Book) => {
    setSelectedBookId(book.id);
    setIsDialogOpen(true);
  };

  const handleConvert = async () => {
    if (!selectedBookId) return;
    convertBook(selectedBookId);
    setIsDialogOpen(false);
  };

  const handleCancelConversion = () => {
    if (!selectedBookId) return;
    // cancelConversion expects bookId, not sourcePath
    cancelConversion(selectedBookId);
  };

  const handleDelete = async () => {
    if (!selectedBookId) return;

    try {
      setIsDeleting(true);
      showLoadingToast("Deleting book...", "delete-book");

      // Get book title before deleting for toast message
      const book = booksRef.current.find((book) => book.id === selectedBookId);
      const bookTitle = book?.title || "";

      await invoke("delete_book", {
        bookId: selectedBookId,
      });

      updateLoadingToastToSuccess(`"${bookTitle}" deleted`, "delete-book");

      // Remove the book from the list using functional update
      setBooks((prevBooks) =>
        prevBooks.filter((book) => book.id !== selectedBookId)
      );
      setSelectedBookId(null);
      setIsDialogOpen(false);
      setIsDeleting(false);
    } catch (err) {
      logger.error("Failed to delete book:", err);
      updateLoadingToastToError(
        err instanceof Error ? err.message : "Failed to delete book",
        "delete-book"
      );
    } finally {
      setIsDeleting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center space-y-2">
          <LoadingScreen />
          <p className="text-sm text-muted-foreground">Loading library...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex-shrink-0 p-6 space-y-4 border-b">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Library</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {filteredBooks.length}{" "}
              {filteredBooks.length === 1 ? "book" : "books"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={handleAddBook}
              disabled={isAddingBook}
              className="gap-2"
            >
              <Plus className="h-4 w-4" />
              {isAddingBook ? "Adding..." : "Add Book"}
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="text"
            placeholder="Search books by title, author, or subject..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <div className="flex items-center gap-1">
            <Button
              variant={viewMode === "grid" ? "default" : "outline"}
              size="sm"
              onClick={() => setViewMode("grid")}
              className="h-9 w-9 p-0"
            >
              <Grid2x2 className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === "list" ? "default" : "outline"}
              size="sm"
              onClick={() => setViewMode("list")}
              className="h-9 w-9 p-0"
            >
              <List className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {filteredBooks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center space-y-4">
            <BookOpen className="h-12 w-12 text-muted-foreground" />
            <div>
              <p className="text-lg font-medium">
                {searchQuery ? "No books found" : "No books in library"}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {searchQuery
                  ? "Try adjusting your search query"
                  : "Add books to get started"}
              </p>
            </div>
          </div>
        ) : viewMode === "grid" ? (
          <div className="max-2xl:grid max-2xl:grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:flex 2xl:flex-wrap 2xl:justify-start gap-4 library-grid-transition">
            {filteredBooks.map((book, index) => (
              <Card
                key={`${book.id}-${filterKey}`}
                className={cn(
                  "cursor-pointer hover:shadow-lg transition-shadow library-item-enter flex flex-col justify-between 2xl:w-60",
                  staggerDelay(index, 30)
                )}
                onClick={() => handleBookClick(book)}
              >
                <CardContent className="p-0">
                  <div className="aspect-[2/3] bg-muted relative overflow-hidden rounded-t-lg">
                    {book.coverUrl ? (
                      <img
                        src={book.coverUrl}
                        alt={book.title}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <BookOpen className="h-12 w-12 text-muted-foreground/50" />
                      </div>
                    )}
                    {!!book.progress?.bookProgressPercent && (
                      <div className="absolute bottom-0 left-0 right-0 h-1 bg-background/50">
                        <div
                          className="h-full bg-primary"
                          style={{
                            width: `${book.progress.bookProgressPercent}%`,
                          }}
                        />
                      </div>
                    )}
                  </div>
                  <div className="p-3 space-y-2">
                    <div className="space-y-1">
                      <p
                        className="font-medium text-sm line-clamp-2"
                        title={book.title}
                      >
                        {book.title}
                      </p>
                      <p
                        className="text-xs text-muted-foreground line-clamp-1"
                        title={book.author}
                      >
                        {book.author}
                      </p>
                    </div>
                    {convertingBookId === book.id && conversionProgress && (
                      <div className="space-y-1">
                        <div className="text-xs text-muted-foreground">
                          {conversionProgress.message}
                        </div>
                        <Progress
                          value={
                            conversionProgress.totalWords > 0
                              ? Math.round(
                                  (conversionProgress.wordsProcessed /
                                    conversionProgress.totalWords) *
                                    100
                                )
                              : 0
                          }
                          className="h-1.5"
                        />
                        {eta && (
                          <div className="text-xs text-muted-foreground">
                            ETA: {eta}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </CardContent>
                <CardFooter className="p-4">
                  <Button
                    size="sm"
                    className="w-full"
                    variant="ghost"
                    onClick={(e) => handleOpenBook(book, e)}
                  >
                    Open
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {filteredBooks.map((book, index) => (
              <Card
                key={`${book.id}-${filterKey}`}
                className={cn(
                  "cursor-pointer hover:bg-muted/50 transition-colors library-item-enter",
                  staggerDelay(index, 30)
                )}
                onClick={() => handleBookClick(book)}
              >
                <CardContent className="p-4 ">
                  <div className="flex items-center gap-4">
                    <div className="w-16 h-24 bg-muted rounded shrink-0 overflow-hidden">
                      {book.coverUrl ? (
                        <img
                          src={book.coverUrl}
                          alt={book.title}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <BookOpen className="h-6 w-6 text-muted-foreground/50" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0 space-y-2">
                      <div>
                        <h3 className="font-semibold text-base">
                          {book.title}
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          {book.author}
                        </p>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        {book.chapters.length > 0 && (
                          <span>{book.chapters.length} chapters</span>
                        )}
                        {book.pageCount && <span>{book.pageCount} pages</span>}
                        {!!book.progress?.bookProgressPercent && (
                          <span>
                            {Math.round(book.progress.bookProgressPercent)}%
                            read
                          </span>
                        )}
                      </div>
                      {!!book.progress?.bookProgressPercent && (
                        <div className="h-1 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary"
                            style={{
                              width: `${book.progress.bookProgressPercent}%`,
                            }}
                          />
                        </div>
                      )}
                      {convertingBookId === book.id && conversionProgress && (
                        <div className="space-y-1">
                          <div className="text-xs text-muted-foreground">
                            Converting: Chapter{" "}
                            {conversionProgress.currentChapter}/
                            {conversionProgress.totalChapters} -{" "}
                            {conversionProgress.message}
                          </div>
                          <Progress
                            value={
                              conversionProgress.totalWords > 0
                                ? Math.round(
                                    (conversionProgress.wordsProcessed /
                                      conversionProgress.totalWords) *
                                      100
                                  )
                                : 0
                            }
                            className="h-1.5"
                          />
                          {eta && (
                            <div className="text-xs text-muted-foreground">
                              ETA: {eta}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    <Button
                      size="sm"
                      className="w-auto"
                      variant="ghost"
                      onClick={(e) => handleOpenBook(book, e)}
                    >
                      Open
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {selectedBookId && (
        <BookDetailDialog
          book={books.find((book) => book.id === selectedBookId) || null}
          isOpen={isDialogOpen}
          onOpenChange={setIsDialogOpen}
          onConvert={handleConvert}
          onCancel={handleCancelConversion}
          onDelete={handleDelete}
          onOpenBook={handleOpenBook}
          isConverting={isConverting}
          isConvertingThisBook={selectedBookId === convertingBookId}
          isDeleting={isDeleting}
          conversionProgress={
            selectedBookId === convertingBookId ? conversionProgress : null
          }
          eta={selectedBookId === convertingBookId ? eta : null}
        />
      )}
    </div>
  );
}
