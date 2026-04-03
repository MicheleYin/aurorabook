import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { filesize } from "filesize";
import humanizeDuration from "humanize-duration";
import {
  AlertTriangle,
  BookOpen,
  Calendar,
  Download,
  FileText,
  Play,
  Trash2,
  User,
  X,
} from "lucide-react";
import { toast } from "sonner";

import type { Book } from "../../types/book";
import { useIsMobile } from "../../hooks/useIsMobile";
import { logger } from "../../lib/logger";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHandle,
  DrawerHeader,
  DrawerTitle,
} from "../ui/drawer";
import { Progress } from "../ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Separator } from "../ui/separator";

interface ConversionProgress {
  currentChapter: number;
  totalChapters: number;
  wordsProcessed: number;
  totalWords: number;
  wordsInCurrentChapter: number;
  currentStep: string;
  message: string;
}

interface BookDetailDialogProps {
  book: Book | null;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onConvert: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onOpenBook: (book: Book) => void;
  isConverting: boolean;
  isConvertingThisBook: boolean;
  isDeleting: boolean;
  conversionProgress: ConversionProgress | null;
  eta: string | null;
}

const BookDetailContent = ({
  book,
  conversionProgress,
  eta,
}: {
  book: Book;
  conversionProgress: ConversionProgress | null;
  eta: string | null;
}) => {
  return (
    <div className="space-y-6">
      <div className="flex gap-6">
        <div className="w-32 h-48 bg-muted rounded overflow-hidden shrink-0">
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
        </div>
        <div className="flex-1 space-y-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <User className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">Author</span>
            </div>
            <p className="text-sm text-muted-foreground">{book.author}</p>
          </div>
          {book.publisher && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">Publisher</span>
              </div>
              <p className="text-sm text-muted-foreground">
                {book.publisher}
                {book.publishedYear && `, ${book.publishedYear}`}
              </p>
            </div>
          )}
          {book.publishedYear && !book.publisher && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">Published</span>
              </div>
              <p className="text-sm text-muted-foreground">
                {book.publishedYear}
              </p>
            </div>
          )}
        </div>
      </div>

      <Separator />

      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-sm font-medium mb-1">Chapters</p>
          <p className="text-sm text-muted-foreground">
            {book.chapters.length}
          </p>
        </div>
        {book.pageCount && (
          <div>
            <p className="text-sm font-medium mb-1">Pages</p>
            <p className="text-sm text-muted-foreground">{book.pageCount}</p>
          </div>
        )}
        {book.fileSizeBytes && (
          <div>
            <p className="text-sm font-medium mb-1">File Size</p>
            <p className="text-sm text-muted-foreground">
              {filesize(book.fileSizeBytes)}
            </p>
          </div>
        )}
        {!!book.progress?.bookProgressPercent && (
          <div>
            <p className="text-sm font-medium mb-1">Progress</p>
            <p className="text-sm text-muted-foreground">
              {Math.round(book.progress.bookProgressPercent)}%
            </p>
          </div>
        )}
      </div>

      {book.subjects && book.subjects.length > 0 && (
        <>
          <Separator />
          <div>
            <p className="text-sm font-medium mb-2">Subjects</p>
            <div className="flex flex-wrap gap-2">
              {book.subjects.map((subject) => (
                <Badge key={subject} variant="secondary">
                  {subject}
                </Badge>
              ))}
            </div>
          </div>
        </>
      )}

      {!!book.progress?.bookProgressPercent && (
        <>
          <Separator />
          <div>
            <p className="text-sm font-medium mb-2">Reading Progress</p>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary"
                style={{ width: `${book.progress.bookProgressPercent}%` }}
              />
            </div>
          </div>
        </>
      )}

      {book.conversionStatus && (
        <>
          <Separator />
          <div>
            <p className="text-sm font-medium mb-2">Conversion Status</p>
            <Badge
              variant={
                book.conversionStatus === "done"
                  ? "default"
                  : book.conversionStatus === "started"
                    ? "secondary"
                    : "outline"
              }
            >
              {book.conversionStatus.charAt(0).toUpperCase() +
                book.conversionStatus.slice(1)}
            </Badge>
          </div>
        </>
      )}

      {conversionProgress && (
        <>
          <Separator />
          <div>
            <p className="text-sm font-medium mb-2">Conversion Progress</p>
            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">
                {conversionProgress.message}
              </div>
              <div className="text-xs text-muted-foreground">
                Chapter {conversionProgress.currentChapter}/
                {conversionProgress.totalChapters}
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
                className="h-2"
              />
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {conversionProgress.totalWords > 0
                    ? Math.round(
                        (conversionProgress.wordsProcessed /
                          conversionProgress.totalWords) *
                          100
                      )
                    : 0}
                  %
                </span>
                {eta && (
                  <span className="text-xs text-muted-foreground">
                    ETA: {eta}
                  </span>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {book.audioTracks && book.audioTracks.length > 0 && (
        <>
          <Separator />
          <div>
            <p className="text-sm font-medium mb-2">Audiobook</p>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  Audio Tracks
                </span>
                <span className="text-sm font-medium">
                  {book.audioTracks.length}
                </span>
              </div>
              {book.audioTracks.some((track) => track.duration) && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    Total Duration
                  </span>
                  <span className="text-sm font-medium">
                    {humanizeDuration(
                      book.audioTracks.reduce(
                        (total, track) => total + (track.duration || 0),
                        0
                      ) * 1000
                    )}
                  </span>
                </div>
              )}

              {book.audioTracks.some((track) => track.fileSizeBytes) && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    Audio Size
                  </span>
                  <span className="text-sm font-medium">
                    {filesize(
                      book.audioTracks.reduce(
                        (total, track) => total + (track.fileSizeBytes || 0),
                        0
                      )
                    )}
                  </span>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export function BookDetailDialog({
  book,
  isOpen,
  onOpenChange,
  onConvert,
  onCancel,
  onDelete,
  onOpenBook,
  isConverting,
  isConvertingThisBook,
  isDeleting,
  conversionProgress,
  eta,
}: Readonly<BookDetailDialogProps>) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [exportDropdownKey, setExportDropdownKey] = useState(0);
  const isMobile = useIsMobile();

  const handleDeleteClick = useCallback(() => setShowDeleteConfirm(true), []);

  const handleDeleteConfirm = useCallback(() => {
    setShowDeleteConfirm(false);
    onDelete();
  }, [onDelete]);

  const handleDeleteCancel = useCallback(() => setShowDeleteConfirm(false), []);

  const handleExportEpub = useCallback(async () => {
    if (!book) return;

    try {
      // Open save dialog
      const filePath = await save({
        defaultPath: `${book.title}.epub`,
        filters: [
          {
            name: "EPUB Files",
            extensions: ["epub"],
          },
        ],
      });

      if (!filePath) {
        // User cancelled
        return;
      }

      // Call backend to export EPUB
      await invoke("export_epub_to_file", {
        bookId: book.id,
        outputPath: filePath,
      });

      toast.success("EPUB exported successfully");
    } catch (err) {
      logger.error("Failed to export EPUB:", err);
      toast.error(err instanceof Error ? err.message : "Failed to export EPUB");
    }
  }, [book]);

  const handleExportM4b = useCallback(async () => {
    if (!book) return;

    try {
      // Open save dialog
      const filePath = await save({
        defaultPath: `${book.title}.m4b`,
        filters: [
          {
            name: "M4B Audio Files",
            extensions: ["m4b"],
          },
        ],
      });

      if (!filePath) {
        // User cancelled
        return;
      }

      // Call backend to export M4B
      await invoke("export_as_m4b", {
        bookId: book.id,
        outputPath: filePath,
      });

      toast.success("M4B exported successfully");
    } catch (err) {
      logger.error("Failed to export M4B:", err);
      toast.error(err instanceof Error ? err.message : "Failed to export M4B");
    }
  }, [book]);

  const handleExportDropdownAction = useCallback(
    (value: string) => {
      if (value === "epub") {
        void handleExportEpub();
      } else if (value === "m4b") {
        void handleExportM4b();
      }
      setExportDropdownKey((prev) => prev + 1);
    },
    [handleExportEpub, handleExportM4b]
  );

  logger.log("isConvertingThisBook", isConvertingThisBook);
  if (!book) return null;

  return (
    <>
      {/* Desktop Dialog */}
      {!isMobile && (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto flex flex-col">
            <DialogHeader>
              <DialogTitle>{book.title}</DialogTitle>
              <DialogDescription>Book Details</DialogDescription>
            </DialogHeader>
            <div className="flex-1 overflow-y-auto">
              <BookDetailContent
                book={book}
                conversionProgress={conversionProgress}
                eta={eta}
              />
            </div>
            <DialogFooter className="flex-shrink-0 gap-2">
              <Button
                onClick={() => {
                  onOpenBook(book);
                  onOpenChange(false);
                }}
                className="gap-2"
              >
                <BookOpen className="h-4 w-4" />
                Open Book
              </Button>
              <Select
                key={`desktop-${exportDropdownKey}`}
                onValueChange={handleExportDropdownAction}
                disabled={isDeleting || isConvertingThisBook}
              >
                <SelectTrigger className="w-[170px] gap-2">
                  <Download className="h-4 w-4" />
                  <SelectValue placeholder="Export" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="epub">Export as EPUB</SelectItem>
                  <SelectItem value="m4b">Export as M4B</SelectItem>
                </SelectContent>
              </Select>
              {book.conversionStatus === "started" && isConvertingThisBook && (
                <Button
                  variant="outline"
                  onClick={onCancel}
                  disabled={isDeleting}
                  className="gap-2"
                >
                  <X className="h-4 w-4" />
                  Cancel Conversion
                </Button>
              )}
              {book.conversionStatus === "started" && !isConvertingThisBook && (
                <Button
                  variant="outline"
                  onClick={onConvert}
                  disabled={isDeleting || isConverting}
                  className="gap-2"
                >
                  <Play className="h-4 w-4" />
                  Resume Conversion
                </Button>
              )}
              {book.conversionStatus === "notStarted" && (
                <Button
                  variant="outline"
                  onClick={onConvert}
                  className="gap-2"
                  disabled={isDeleting || isConverting}
                >
                  <Play className="h-4 w-4" />
                  Convert to Audiobook
                </Button>
              )}
              <Button
                variant="destructive"
                onClick={handleDeleteClick}
                disabled={isDeleting || isConvertingThisBook}
                className="gap-2"
              >
                <Trash2 className="h-4 w-4" />
                {isDeleting ? "Deleting..." : "Delete"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Mobile Drawer */}
      {isMobile && (
        <Drawer open={isOpen} onOpenChange={onOpenChange}>
          <DrawerContent className="max-h-[80vh] flex flex-col">
            <DrawerHandle />
            <DrawerHeader>
              <DrawerTitle>{book.title}</DrawerTitle>
              <DrawerDescription>Book Details</DrawerDescription>
            </DrawerHeader>
            <div className="flex-1 overflow-y-auto px-6 pb-6">
              <BookDetailContent
                book={book}
                conversionProgress={conversionProgress}
                eta={eta}
              />
            </div>
            <DrawerFooter className="flex-shrink-0 gap-2 p-4">
              <Button
                onClick={() => {
                  onOpenBook(book);
                  onOpenChange(false);
                }}
                className="gap-2"
              >
                <BookOpen className="h-4 w-4" />
                Open Book
              </Button>
              <Select
                key={`mobile-${exportDropdownKey}`}
                onValueChange={handleExportDropdownAction}
                
                disabled={isDeleting || isConvertingThisBook}
              >
                <SelectTrigger className="w-full gap-2">
                  <Download className="h-4 w-4" />
                  <SelectValue placeholder="Export" />
                </SelectTrigger>
                <SelectContent className="w-full">
                  <SelectItem className="w-full" value="epub">Export as EPUB</SelectItem>
                  <SelectItem className="w-full" value="m4b">Export as M4B</SelectItem>
                </SelectContent>
              </Select>
              {book.conversionStatus === "started" && isConvertingThisBook && (
                <Button
                  variant="outline"
                  onClick={onCancel}
                  disabled={isDeleting}
                  className="gap-2"
                >
                  <X className="h-4 w-4" />
                  Cancel Conversion
                </Button>
              )}
              {book.conversionStatus === "started" && !isConvertingThisBook && (
                <Button
                  variant="outline"
                  onClick={onConvert}
                  disabled={isDeleting || isConverting}
                  className="gap-2"
                >
                  <Play className="h-4 w-4" />
                  Resume Conversion
                </Button>
              )}
              {book.conversionStatus === "notStarted" && (
                <Button
                  variant="outline"
                  onClick={onConvert}
                  className="gap-2"
                  disabled={isDeleting || isConverting}
                >
                  <Play className="h-4 w-4" />
                  Convert to Audiobook
                </Button>
              )}
              <Button
                variant="destructive"
                onClick={handleDeleteClick}
                disabled={isDeleting || isConvertingThisBook}
                className="gap-2"
              >
                <Trash2 className="h-4 w-4" />
                {isDeleting ? "Deleting..." : "Delete"}
              </Button>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10">
                <AlertTriangle className="h-5 w-5 text-destructive" />
              </div>
              <DialogTitle>Delete Book</DialogTitle>
            </div>
            <DialogDescription>
              Are you sure you want to delete{" "}
              <strong>&ldquo;{book.title}&rdquo;</strong>? This action cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={handleDeleteCancel}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteConfirm}
              disabled={isDeleting}
              className="gap-2"
            >
              <Trash2 className="h-4 w-4" />
              {isDeleting ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
