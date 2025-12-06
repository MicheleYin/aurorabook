import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ImageOff, X, Loader2, Headphones, Share2, Play ,  Square} from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import { Button } from "../ui/button";
import { Progress } from "../ui/progress";
import type { Book } from "../../types/reader";
import type { ConversionProgress } from "../../lib/audiobook-converter";
import { ConvertToAudiobookDialog } from "./ConvertToAudiobookDialog";
import type { VoiceId } from "../../types/reader";
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
import { cn, formatDurationShort, getBookProgressSummary } from "../../lib/utils";
import { dialogSectionStagger } from "../../lib/animations";
import { useAnimatedNumber } from "../../hooks/use-animated-number";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useETA } from "../../hooks/useETA";

type BookDetailDialogProps = {
  book: Book;
  open: boolean;
  onClose: () => void;
  onOpenBook: () => void;
  onDeleteBook: () => void;
  isDeleting?: boolean;
  conversionProgress?: ConversionProgress;
  onConvertToAudiobook?: (book: Book, voiceId: VoiceId) => Promise<void>;
  onCancelConversion?: (bookId: string) => void;
  conversionStartTimeRef?: React.MutableRefObject<number | null>;
  isCancelling?: boolean;
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
  isDeleting = false,
  conversionProgress,
  onConvertToAudiobook,
  onCancelConversion,
  conversionStartTimeRef,
  isCancelling = false,
}: BookDetailDialogProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [showConvertDialog, setShowConvertDialog] = useState(false);
  const [durationMap, setDurationMap] = useState<Record<string, number>>({});
  const durationMapRef = useRef<Record<string, number>>({});
  const genres = (book.subjects ?? []).filter(Boolean);
  const hasAudio = book.audioTracks.length > 0;
  const isConverting = Boolean(conversionProgress);
  const isDesktop = useMediaQuery("(min-width: 640px)");
  
  const handleConvertClick = useCallback(() => {
    setShowConvertDialog(true);
  }, []);
  
  const handleResumeConversion = useCallback(async () => {
    if (!onConvertToAudiobook) {
      console.error("onConvertToAudiobook is not available");
      return;
    }
    
    // Use the voice ID stored in the book
    const voiceId = book.voiceId;
    
    console.log("Resuming conversion", {
      sourcePath: book.sourcePath,
      hasVoiceId: !!voiceId,
      voiceId,
      conversionStatus: book.conversionStatus,
      audioTracksCount: book.audioTracks.length,
    });
    
    if (voiceId) {
      // Resume with the stored voice ID
      try {
        await onConvertToAudiobook(book, voiceId);
      } catch (error) {
        console.error("Failed to resume conversion:", error);
        throw error;
      }
    } else {
      // No stored voice ID, show dialog to select one
      console.log("No stored voice ID, showing dialog");
      setShowConvertDialog(true);
    }
  }, [book, onConvertToAudiobook]);
  
  const handleConvertConfirm = useCallback(async (voiceId: VoiceId) => {
    setShowConvertDialog(false);
    
    if (onConvertToAudiobook) {
      // Voice ID will be stored by the backend when conversion starts
      await onConvertToAudiobook(book, voiceId);
    }
  }, [book, onConvertToAudiobook]);

  const handleExportEpub = useCallback(async () => {
    if (isConverting) return;

    try {
      // Check if we're in Tauri environment
      // Use save dialog and write file
      const { save } = await import("@tauri-apps/plugin-dialog");
      const { writeFile } = await import("@tauri-apps/plugin-fs");

        // Get EPUB buffer from Rust backend
        const { getEpubBuffer: getEpubBufferService } = await import("../../lib/book-service");
        const arrayBuffer = await getEpubBufferService(book.sourcePath);
        
        if (!arrayBuffer) {
          console.error("EPUB not found in store", {
            sourcePath: book.sourcePath,
          });
          toast.error("Cannot export EPUB", {
            description: "The EPUB is not available in store. Please re-import the book.",
          });
          return;
        }
        
        console.debug("Retrieved EPUB from store for export", {
          sizeBytes: arrayBuffer.byteLength,
        });
        
        if (!arrayBuffer || arrayBuffer.byteLength === 0) {
          toast.error("Cannot export EPUB", {
            description: "The EPUB buffer is empty or invalid.",
          });
          return;
        }

        // Show save dialog
        const filePath = await save({
          defaultPath: `${book.title.replace(/[^a-z0-9]/gi, "_")}.epub`,
          filters: [{ name: "EPUB files", extensions: ["epub"] }],
        });

      if (filePath) {
        await writeFile(filePath, new Uint8Array(arrayBuffer));
        toast.success("EPUB exported!", {
          description: `Saved to ${filePath.split("/").pop()}`,
        });
      }
    } catch (error) {
      console.error("Export error:", error);
      toast.error("Export failed", {
        description: error instanceof Error ? error.message : "Could not export the EPUB file.",
      });
    }
  }, [book, isConverting]);
  useEffect(() => {
    durationMapRef.current = durationMap;
  }, [durationMap]);

  useEffect(() => {
    setDurationMap({});
    durationMapRef.current = {};
  }, [book.id]);

  useEffect(() => {
    if (!book.audioTracks.length) {
      return;
    }
    const pendingTracks = book.audioTracks.filter(
      (track) =>
        !(typeof track.duration === "number" && Number.isFinite(track.duration)) &&
        typeof durationMapRef.current[track.id] !== "number",
    );
    if (!pendingTracks.length) {
      return;
    }
    let cancelled = false;
    const cleanupFns: Array<() => void> = [];
    pendingTracks.forEach((track) => {
      if (!track.url) {
        console.warn("[BookDetailDialog] Track missing URL", { trackId: track.id, href: track.href });
        return;
      }
      const audio = new Audio();
      audio.preload = "metadata";
      audio.src = track.url;
      audio.load();
      const settleDuration = () => {
        if (cancelled) {
          return;
        }
        const measured = Number.isFinite(audio.duration) ? Math.max(audio.duration, 0) : undefined;
        if (typeof measured === "number") {
          setDurationMap((prev) => {
            if (typeof prev[track.id] === "number") {
              return prev;
            }
            return { ...prev, [track.id]: measured };
          });
        }
      };
      const handleError = () => {
        console.error("[BookDetailDialog] Failed to load audio track for duration", {
          trackId: track.id,
          href: track.href,
          url: track.url,
          error: audio.error ? {
            code: audio.error.code,
            message: audio.error.message,
          } : "Unknown error",
        });
        settleDuration();
      };
      audio.addEventListener("loadedmetadata", settleDuration);
      audio.addEventListener("error", handleError);
      cleanupFns.push(() => {
        audio.removeEventListener("loadedmetadata", settleDuration);
        audio.removeEventListener("error", settleDuration);
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      });
    });
    return () => {
      cancelled = true;
      cleanupFns.forEach((dispose) => dispose());
    };
  }, [book.audioTracks, book.id]);

  const getTrackDuration = useCallback(
    (track: Book["audioTracks"][number]) => {
      if (typeof track.duration === "number" && Number.isFinite(track.duration)) {
        return Math.max(track.duration, 0);
      }
      const measured = durationMap[track.id];
      return typeof measured === "number" && Number.isFinite(measured) ? Math.max(measured, 0) : undefined;
    },
    [durationMap],
  );

  const totalAudioDurationSeconds = useMemo(() => {
    if (!book.audioTracks.length) return undefined;
    const sum = book.audioTracks.reduce((acc, track) => {
      const resolved = getTrackDuration(track);
      return typeof resolved === "number" ? acc + resolved : acc;
    }, 0);
    return sum > 0 ? sum : undefined;
  }, [book.audioTracks, getTrackDuration]);
  const listenedAudioSeconds = useMemo(() => {
    if (!book.audioTracks.length || !book.audioState) {
      return undefined;
    }
    const { currentTrackId, currentTrackHref, currentTrackIndex, currentTimeSeconds } = book.audioState;
    const resolvedIndexById = book.audioTracks.findIndex((track) => track.id === currentTrackId);
    const resolvedIndexByHref =
      resolvedIndexById === -1
        ? book.audioTracks.findIndex((track) => track.href === currentTrackHref)
        : resolvedIndexById;
    const index =
      resolvedIndexByHref >= 0
        ? resolvedIndexByHref
        : typeof currentTrackIndex === "number" && Number.isFinite(currentTrackIndex)
          ? currentTrackIndex
          : -1;
    if (index < 0 || index >= book.audioTracks.length) {
      return undefined;
    }
    const completedSeconds = book.audioTracks.slice(0, index).reduce((acc, track) => {
      const resolved = getTrackDuration(track);
      return typeof resolved === "number" ? acc + resolved : acc;
    }, 0);
    const currentSeconds =
      typeof currentTimeSeconds === "number" && Number.isFinite(currentTimeSeconds)
        ? Math.max(currentTimeSeconds, 0)
        : 0;
    return completedSeconds + currentSeconds;
  }, [book.audioTracks, book.audioState, getTrackDuration]);
  const audioProgressPercent =
    totalAudioDurationSeconds && listenedAudioSeconds !== undefined
      ? Math.min(Math.max(listenedAudioSeconds / totalAudioDurationSeconds, 0), 1)
      : undefined;
  const audioProgressPercentDisplay =
    typeof audioProgressPercent === "number" ? Math.round(audioProgressPercent * 100) : undefined;
  
  const displayProgress = conversionProgress;
  
  // Animate conversion progress percentage (based on words, fallback to chapters)
  const targetConversionPercent = displayProgress && displayProgress.totalWords > 0
    ? Math.min(100, Math.max(0, Math.round((displayProgress.wordsProcessed / displayProgress.totalWords) * 100)))
    : displayProgress && displayProgress.totalChapters > 0
    ? Math.min(100, Math.max(0, Math.round((displayProgress.currentChapter / displayProgress.totalChapters) * 100)))
    : 0;
  const animatedConversionPercent = useAnimatedNumber(targetConversionPercent, 500);
  
  // Animate audio progress percentage
  const targetAudioPercent = audioProgressPercentDisplay ?? 0;
  const animatedAudioPercent = useAnimatedNumber(targetAudioPercent, 500);
  
  // Calculate ETA using exponentially decaying average for smoother estimates
  const eta = useETA({
    progressPercent: targetConversionPercent,
    startTimeRef: conversionStartTimeRef,
    isActive: !!displayProgress ,
  });
  
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
      <div className={cn("grid gap-2", dialogSectionStagger(0))}>
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
        {displayProgress ? (
          <div className={cn("grid gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3", dialogSectionStagger(1))}>
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase text-muted-foreground">Converting to Audiobook</span>
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium">{animatedConversionPercent}%</span>
              </div>
            </div>
            <Progress
              value={animatedConversionPercent}
              className="h-2"
              showPulse={true}
              showWave={true}
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>
                  {displayProgress.totalWords > 0
                    ? `${displayProgress.wordsProcessed.toLocaleString()} / ${displayProgress.totalWords.toLocaleString()} words: ${displayProgress.message}`
                    : `Chapter ${displayProgress.currentChapter} of ${displayProgress.totalChapters}: ${displayProgress.message}`}
                </span>
              </div>
              {eta && (
                <span className="shrink-0">ETA: {eta}</span>
              )}
            </div>
          </div>
        ) : (
          <div className={cn("grid gap-1", dialogSectionStagger(1))}>
            <span className="text-xs uppercase text-muted-foreground">Reading progress</span>
            <span>{progressPrimaryText}</span>
            {progressSecondaryText ? (
              <span className="text-xs text-muted-foreground">{progressSecondaryText}</span>
            ) : null}
          </div>
        )}
       
        <div className={cn("grid gap-1", dialogSectionStagger(2))}>
          <span className="text-xs uppercase text-muted-foreground">Author</span>
          <span>{book.author || "Unknown author"}</span>
        </div>
        <div className={cn("grid gap-1", dialogSectionStagger(3))}>
          <span className="text-xs uppercase text-muted-foreground">Publisher</span>
          <span>{book.publisher || "Unknown publisher"}</span>
        </div>
        <div className={cn("grid gap-1", dialogSectionStagger(4))}>
          <span className="text-xs uppercase text-muted-foreground">Publication year</span>
          <span>{book.publishedYear || "Unknown year"}</span>
        </div>
        <div className={cn("grid gap-1", dialogSectionStagger(5))}>
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
        <div className={cn("grid gap-1", dialogSectionStagger(6))}>
          <span className="text-xs uppercase text-muted-foreground">File size</span>
          <span>{formatFileSize(book.fileSizeBytes)}</span>
        </div>
        <div className={cn("grid gap-1", dialogSectionStagger(7))}>
          <span className="text-xs uppercase text-muted-foreground">Audiobook</span>
          {hasAudio ? (
            <div className="flex flex-col gap-3">
              <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-3 sm:gap-4">
                <div className="flex flex-col gap-1">
                  <span className="uppercase tracking-wide">Total tracks</span>
                  <span className="text-base text-foreground">{book.audioTracks.length}</span>
                </div>
            <div className="flex flex-col gap-1">
                  <span className="uppercase tracking-wide">Total length</span>
                  <span className="text-base text-foreground">
                {totalAudioDurationSeconds
                      ? formatDurationShort(totalAudioDurationSeconds)
                      : "Unknown"}
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="uppercase tracking-wide">Time listened</span>
                  <span className="text-base text-foreground">
                    {listenedAudioSeconds !== undefined
                      ? formatDurationShort(listenedAudioSeconds)
                      : "Not started"}
              </span>
                </div>
              </div>
              {audioProgressPercentDisplay !== undefined ? (
                <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                  <span>
                    {`Listened ${formatDurationShort(listenedAudioSeconds ?? 0)} · ${animatedAudioPercent}%`}
                  </span>
                  <Progress
                    value={animatedAudioPercent}
                    className="h-1.5"
                    showShimmer={true}
                  />
                </div>
              ) : null}
            </div>
          ) : (
            <span>Not available</span>
          )}
        </div>
      </div>
    </div>
  );

  const Actions = ({ layout }: { layout: "dialog" | "drawer" }) => {
    const conversionStatus = book.conversionStatus ?? "notStarted";
    const canResume = conversionStatus === "started" && !isConverting && !isCancelling;
    const canConvert = conversionStatus === "notStarted" && !isConverting && !isCancelling;
    const isDisabled = isConverting || isCancelling;
    
    return (
      <div className={cn("flex gap-2 pt-4", layout === "dialog" ? "justify-end" : "flex-col")}>
        {canResume && onConvertToAudiobook && (
          <Button
            variant="outline"
            onClick={handleResumeConversion}
            disabled={isDisabled}
            className="gap-2"
          >
            <Play className="h-4 w-4" />
            Resume Conversion
          </Button>
        )}
        {canConvert && onConvertToAudiobook && (
          <Button
            variant="outline"
            onClick={handleConvertClick}
            disabled={isDisabled}
            className="gap-2"
          >
            <Headphones className="h-4 w-4" />
            Convert to Audiobook
          </Button>
        )}
        {isConverting && onCancelConversion && (
          <Button
            variant="outline"
            onClick={() => onCancelConversion(book.id)}
            disabled={isCancelling}
            className="gap-2"
          >
            {isCancelling ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Pausing…
              </>
            ) : (
              <>
                <Square className="h-4 w-4" />
                Pause
              </>
            )}
          </Button>
        )}
      <Button
        variant="outline"
        onClick={handleExportEpub}
        disabled={isDisabled}
        className="gap-2"
      >
        <Share2 className="h-4 w-4" />
        {isConverting ? "Exporting..." : "Export EPUB"}
      </Button>
      <Button onClick={onOpenBook} disabled={isDeleting}>
        Open book
      </Button>
      <Button
        variant="destructive"
        onClick={() => setConfirmOpen(true)}
        disabled={isDeleting}
      >
        {isDeleting ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Deleting…
          </>
        ) : (
          "Delete book"
        )}
      </Button>
      </div>
    );
  };

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
          <Button
            variant="outline"
            onClick={() => setConfirmOpen(false)}
            disabled={isDeleting}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              setConfirmOpen(false);
              onDeleteBook();
            }}
            disabled={isDeleting}
          >
            {isDeleting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Deleting…
              </>
            ) : (
              "Delete"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );

    return (
      <>
      {isDesktop ? (
        /* Desktop: Dialog */
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
      ) : (
        /* Mobile: Drawer */
        <Drawer
          open={open}
          onOpenChange={(next) => {
            if (!next) onClose();
          }}
        >
          <DrawerContent>
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
      )}
      
      {confirmDialog}
      {onConvertToAudiobook && (
        <ConvertToAudiobookDialog
          open={showConvertDialog && !isConverting}
          onOpenChange={(open) => {
            if (!isConverting) {
              setShowConvertDialog(open);
            }
          }}
          onConfirm={handleConvertConfirm}
          bookTitle={book.title}
        />
      )}
    </>
  );
}

