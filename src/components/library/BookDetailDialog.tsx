import { useState } from "react";
import { ImageOff, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import { Button } from "../ui/button";
import type { Book } from "../../types/reader";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHandle,
  DrawerHeader,
  DrawerTitle,
} from "../ui/drawer";
import { useMediaQuery } from "../../hooks/use-media-query";
import { cn, formatPageCount, getBookProgressSummary } from "../../lib/utils";

type BookDetailDialogProps = {
  book: Book;
  open: boolean;
  onClose: () => void;
  onOpenBook: () => void;
  onDeleteBook: () => void;
};

const formatFileSize = (bytes?: number) => {
  if (!bytes || Number.isNaN(bytes)) {
    return "Unknown";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(size < 10 && unitIndex > 0 ? 1 : 0)} ${units[unitIndex]}`;
};

export function BookDetailDialog({
  book,
  open,
  onClose,
  onOpenBook,
  onDeleteBook,
}: BookDetailDialogProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const isDesktop = useMediaQuery("(min-width: 640px)");
  const genres = (book.subjects ?? []).filter(Boolean);
  const hasAudio = book.audioTracks.length > 0;
  const progressSummary = getBookProgressSummary(book);
  const progressPrimaryText = book.chapters.length
    ? progressSummary.label
    : "No chapters available";
  const progressSecondaryText =
    progressSummary.currentChapterTitle && progressSummary.current > 0 && !progressSummary.isFinished
      ? `Current chapter: ${progressSummary.currentChapterTitle}`
      : progressSummary.isFinished && book.chapters.length
        ? "You're finished with this book."
        : undefined;

  const detailFields = (
    <div className="grid gap-6 text-sm text-foreground sm:grid-cols-[auto,1fr] sm:items-start">
      <div className="grid gap-2">
        <span className="text-xs uppercase text-muted-foreground">Cover</span>
        <div className="relative mx-auto aspect-[3/4] w-36 overflow-hidden rounded-lg border bg-muted shadow-sm sm:mx-0 sm:w-40">
          {book.coverUrl ? (
            <img
              src={book.coverUrl}
              alt={`${book.title} cover`}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
              <ImageOff className="h-10 w-10" />
            </div>
          )}
        </div>
        {!book.coverUrl ? (
          <span className="text-xs text-muted-foreground">No cover available</span>
        ) : null}
      </div>
      <div className="grid gap-4">
        <div className="grid gap-1">
          <span className="text-xs uppercase text-muted-foreground">Reading progress</span>
          <span>{progressPrimaryText}</span>
          {progressSecondaryText ? (
            <span className="text-xs text-muted-foreground">{progressSecondaryText}</span>
          ) : null}
        </div>
        <div className="grid gap-1">
          <span className="text-xs uppercase text-muted-foreground">Page count</span>
          <span>{formatPageCount(book.pageCount) ?? "Unknown"}</span>
        </div>
        <div className="grid gap-1">
          <span className="text-xs uppercase text-muted-foreground">Author</span>
          <span>{book.author || "Unknown author"}</span>
        </div>
        <div className="grid gap-1">
          <span className="text-xs uppercase text-muted-foreground">Publisher</span>
          <span>{book.publisher || "Unknown publisher"}</span>
        </div>
        <div className="grid gap-1">
          <span className="text-xs uppercase text-muted-foreground">Publication year</span>
          <span>{book.publishedYear || "Unknown year"}</span>
        </div>
        <div className="grid gap-1">
          <span className="text-xs uppercase text-muted-foreground">Genres / subjects</span>
          {genres.length ? (
            <div className="flex flex-wrap gap-2">
              {genres.map((subject) => (
                <span
                  key={subject}
                  className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground"
                >
                  {subject}
                </span>
              ))}
            </div>
          ) : (
            <span>Not available</span>
          )}
        </div>
        <div className="grid gap-1">
          <span className="text-xs uppercase text-muted-foreground">File size</span>
          <span>{formatFileSize(book.fileSizeBytes)}</span>
        </div>
        <div className="grid gap-1">
          <span className="text-xs uppercase text-muted-foreground">Audiobook</span>
          <span>
            {hasAudio
              ? `${book.audioTracks.length} track${book.audioTracks.length === 1 ? "" : "s"} available`
              : "Not available"}
          </span>
        </div>
      </div>
    </div>
  );

  const Actions = ({ layout }: { layout: "dialog" | "drawer" }) => (
    <div className={cn("flex gap-2 pt-4", layout === "dialog" ? "justify-end" : "flex-col")}>


      <Button onClick={onOpenBook}>Open book</Button>
      <Button variant="destructive" onClick={() => setConfirmOpen(true)}>
        Delete book
      </Button>
    </div>
  );

  const confirmDialog = (
    <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Remove audiobook?</DialogTitle>
          <DialogDescription>
            This will remove &ldquo;{book.title}&rdquo; from your library. You can re-import it at
            any time.
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setConfirmOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              setConfirmOpen(false);
              onDeleteBook();
            }}
          >
            Delete
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );

  if (!isDesktop) {
    return (
      <>
        <Drawer
          open={open}
          onOpenChange={(next) => {
            if (!next) onClose();
          }}
        >
          <DrawerContent className="">
            <DrawerHandle className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-muted" />
            <div className="flex flex-1 flex-col gap-6 overflow-y-auto">
              <DrawerHeader className="gap-3 text-left">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-col gap-1 text-left">
                    <DrawerTitle>{book.title}</DrawerTitle>
                    <DrawerDescription>Book overview and metadata</DrawerDescription>
                  </div>
                  <DrawerClose asChild>
                    <Button variant="ghost" size="icon" aria-label="Close book details">
                      <X className="h-4 w-4" />
                    </Button>
                  </DrawerClose>
                </div>
              </DrawerHeader>
              <div className="px-1">{detailFields}</div>
              <DrawerFooter className="px-1">
                <Actions layout="drawer" />
              </DrawerFooter>
            </div>
          </DrawerContent>
        </Drawer>
        {confirmDialog}
      </>
    );
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) onClose();
        }}
      >
        <DialogContent className="max-w-2xl [&>button]:hidden">
          <DialogHeader className="gap-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex flex-col gap-1 text-left sm:text-left">
                <DialogTitle>{book.title}</DialogTitle>
                <DialogDescription>Book overview and metadata</DialogDescription>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close book details"
                onClick={onClose}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </DialogHeader>
          {detailFields}
          <Actions layout="dialog" />
        </DialogContent>
      </Dialog>
      {confirmDialog}
    </>
  );
}

