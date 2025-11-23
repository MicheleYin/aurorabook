import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import { Button } from "../ui/button";
import type { Book } from "../../types/reader";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHandle,
  DrawerHeader,
  DrawerTitle,
} from "../ui/drawer";
import { useMediaQuery } from "../../hooks/use-media-query";
import { cn } from "../../lib/utils";

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

  const detailFields = (
    <div className="grid gap-4 text-sm text-foreground">
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
  );

  const Actions = ({ layout }: { layout: "dialog" | "drawer" }) => (
    <div className={cn("flex gap-2 pt-4", layout === "dialog" ? "justify-end" : "flex-col")}>
      <Button variant="outline" onClick={onClose}>
        Close
      </Button>
      <Button onClick={onOpenBook}>Open book</Button>
      <Button variant="destructive" onClick={() => setConfirmOpen(true)}>
        Delete audiobook
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
              <DrawerHeader className="text-left">
                <DrawerTitle>{book.title}</DrawerTitle>
                <DrawerDescription>Book overview and metadata</DrawerDescription>
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
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{book.title}</DialogTitle>
            <DialogDescription>Book overview and metadata</DialogDescription>
          </DialogHeader>
          {detailFields}
          <Actions layout="dialog" />
        </DialogContent>
      </Dialog>
      {confirmDialog}
    </>
  );
}

