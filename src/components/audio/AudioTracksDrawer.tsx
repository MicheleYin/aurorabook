import { List } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { useConversionState } from "../../context/ConversionStateContext";
import { useIsMobile } from "../../hooks/useIsMobile";
import { logger } from "../../lib/logger";
import { cn, formatTime } from "../../lib/utils";
import type { AudioTrack, Book } from "../../types/book";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Dialog, DialogContent } from "../ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerHandle,
  DrawerHeader,
  DrawerTitle,
} from "../ui/drawer";
import { ScrollArea } from "../ui/scroll-area";

interface AudioTracksDrawerProps {
  book: Book;
  currentTrackId: string | null;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onTrackSelect: (track: AudioTrack) => void;
}

export function AudioTracksDrawer({
  book,
  currentTrackId,
  isOpen,
  onOpenChange,
  onTrackSelect,
}: Readonly<AudioTracksDrawerProps>) {
  const isMobile = useIsMobile();
  const currentTrackRef = useRef<HTMLButtonElement | null>(null);
  const {
    isConverting,
    convertingBookId,
    getCurrentConvertingChapter,
    refreshCurrentConvertingChapter,
  } = useConversionState();
  const completedChapters = book.completedChapters ?? [];
  const isConvertingThisBook = isConverting && convertingBookId === book.id;
  const hasPartialConversion =
    book.conversionStatus === "started" ||
    (completedChapters.length > 0 &&
      completedChapters.length < book.chapters.length);

  const currentConvertingChapter = getCurrentConvertingChapter(book.id);

  const currentTrackChapterIndex = useMemo(() => {
    if (!currentTrackId) return null;
    const livePrefix = `live-${book.id}-`;
    if (!currentTrackId.startsWith(livePrefix)) return null;

    const parsed = Number.parseInt(currentTrackId.slice(livePrefix.length), 10);
    return Number.isFinite(parsed) ? parsed : null;
  }, [book.id, currentTrackId]);

  useEffect(() => {
    if (!isConvertingThisBook && !hasPartialConversion) {
      return;
    }

    void refreshCurrentConvertingChapter(book.id);
  }, [
    book.id,
    hasPartialConversion,
    isConvertingThisBook,
    refreshCurrentConvertingChapter,
  ]);

  const getTrackChapterIndex = useCallback(
    (track: AudioTrack): number | null => {
      const trackHref = track.href || track.filePath;
      if (trackHref && book.audioSyncMap?.segments?.length) {
        const matchingSegment = book.audioSyncMap.segments.find(
          (segment) => segment.audioTrackHref === trackHref
        );
        if (matchingSegment) {
          const chapterIndex = book.chapters.findIndex(
            (chapter) => chapter.href === matchingSegment.chapterHref
          );
          if (chapterIndex >= 0) {
            return chapterIndex;
          }
        }
      }

      if (track.order >= 0 && track.order < book.chapters.length) {
        return track.order;
      }

      return null;
    },
    [book.audioSyncMap?.segments, book.chapters]
  );

  const effectiveConvertingChapter = useMemo(() => {
    const trackChapterIndices = new Set<number>();
    for (const track of book.audioTracks) {
      const chapterIndex = getTrackChapterIndex(track);
      if (chapterIndex !== null) {
        trackChapterIndices.add(chapterIndex);
      }
    }

    const firstMissingChapter = book.chapters.findIndex(
      (_, idx) => !trackChapterIndices.has(idx)
    );

    if (currentConvertingChapter !== null) {
      if (
        currentConvertingChapter >= 0 &&
        trackChapterIndices.has(currentConvertingChapter) &&
        firstMissingChapter >= 0
      ) {
        return firstMissingChapter;
      }

      return currentConvertingChapter;
    }

    if (currentTrackChapterIndex !== null) {
      return currentTrackChapterIndex;
    }

    if (!isConvertingThisBook && !hasPartialConversion) {
      return null;
    }

    return firstMissingChapter >= 0 ? firstMissingChapter : null;
  }, [
    book.audioTracks,
    book.chapters,
    currentConvertingChapter,
    currentTrackChapterIndex,
    getTrackChapterIndex,
    hasPartialConversion,
    isConvertingThisBook,
  ]);

  // Create a map of track href to chapter title
  const trackChapters = useMemo(() => {
    const map = new Map<string, string>();

    if (!book.audioSyncMap?.segments || !book.chapters) {
      return map;
    }

    // Find unique chapter hrefs for each track
    const trackChapterMap = new Map<string, Set<string>>();
    book.audioSyncMap.segments.forEach((segment) => {
      if (!trackChapterMap.has(segment.audioTrackHref)) {
        trackChapterMap.set(segment.audioTrackHref, new Set());
      }
      trackChapterMap.get(segment.audioTrackHref)?.add(segment.chapterHref);
    });

    // Map track hrefs to chapter titles
    trackChapterMap.forEach((chapterHrefs, trackHref) => {
      // Get the first chapter that matches (most tracks belong to one chapter)
      const chapterHref = Array.from(chapterHrefs)[0];
      const chapter = book.chapters.find((ch) => ch.href === chapterHref);
      if (chapter) {
        map.set(trackHref, chapter.title);
      }
    });

    return map;
  }, [book.audioSyncMap, book.chapters]);

  // Scroll to current track when drawer/dialog opens
  useEffect(() => {
    if (!isOpen) return;

    const scrollToCurrentTrack = () => {
      if (currentTrackRef.current) {
        currentTrackRef.current.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }
    };

    // Small delay to ensure drawer/dialog is fully rendered
    const timeoutId = setTimeout(scrollToCurrentTrack, 100);
    return () => clearTimeout(timeoutId);
  }, [isOpen, currentTrackId]);

  const handleTrackSelect = useCallback(
    (track: AudioTrack) => {
      onTrackSelect(track);
      onOpenChange(false);
    },
    [onTrackSelect, onOpenChange]
  );

  const selectableTracks = useMemo(() => {
    const tracks = [...book.audioTracks];
    const existingChapterIndices = new Set<number>();

    for (const track of tracks) {
      const chapterIndex = getTrackChapterIndex(track);
      if (chapterIndex !== null) {
        existingChapterIndices.add(chapterIndex);
      }
    }

    // Add synthetic live track for the active/converting chapter when no completed track exists yet.
    if ((isConvertingThisBook || hasPartialConversion) && effectiveConvertingChapter !== null) {
      if (!existingChapterIndices.has(effectiveConvertingChapter)) {
        const chapter = book.chapters[effectiveConvertingChapter];
        if (chapter) {
          tracks.push({
            id: `live-${book.id}-${effectiveConvertingChapter}`,
            bookId: book.id,
            chapterHref: chapter.href,
            filePath: chapter.href,
            href: chapter.href,
            title: chapter.title || `Chapter ${effectiveConvertingChapter + 1}`,
            order: effectiveConvertingChapter,
          });
        }
      }
    }

    return tracks.sort((a, b) => a.order - b.order);
  }, [
    book.audioTracks,
    book.chapters,
    book.id,
    completedChapters,
    hasPartialConversion,
    isConvertingThisBook,
    effectiveConvertingChapter,
    getTrackChapterIndex,
  ]);

  useEffect(() => {
    const currentInList = currentTrackId
      ? selectableTracks.some((track) => track.id === currentTrackId)
      : false;

    logger.info("[tracks-drawer] selectable tracks recalculated", {
      bookId: book.id,
      isConvertingThisBook,
      hasPartialConversion,
      currentConvertingChapter,
      effectiveConvertingChapter,
      currentTrackId,
      currentInList,
      selectedTrackIds: selectableTracks.map((track) => track.id),
    });
  }, [
    book.id,
    currentConvertingChapter,
    currentTrackId,
    effectiveConvertingChapter,
    hasPartialConversion,
    isConvertingThisBook,
    selectableTracks,
  ]);

  const content = (
    <>
      <div className="pb-4">
        <DrawerHeader>
          <DrawerTitle>Audio Tracks</DrawerTitle>
        </DrawerHeader>
      </div>
      <ScrollArea className="flex-1 overflow-y-auto">
        <div className="p-4 space-y-1">
          {selectableTracks.map((track) => {
            const chapterIndex = getTrackChapterIndex(track);
            const isCurrentTrack =
              track.id === currentTrackId ||
              (currentTrackChapterIndex !== null &&
                chapterIndex === currentTrackChapterIndex);
            const trackName = track.title || `Track ${track.order + 1}`;
            const trackHref = track.href || track.filePath;
            const chapterTitle = trackHref
              ? trackChapters.get(trackHref)
              : null;
            // Only show badge on the chapter that's actually being converted (from backend)
            const showStatusBadge =
              chapterIndex === effectiveConvertingChapter ||
              (isConvertingThisBook &&
                effectiveConvertingChapter === null &&
                chapterIndex !== null &&
                chapterIndex === currentTrackChapterIndex);
            const statusText = isConvertingThisBook ? "Live" : "Paused";
            const statusBadgeClass = isConvertingThisBook
              ? "bg-amber-500 text-amber-950 hover:bg-amber-500"
              : "bg-sky-600 text-sky-50 hover:bg-sky-600";
            const duration =
              "duration" in track &&
              typeof track.duration === "number" &&
              track.duration > 0
                ? formatTime(track.duration)
                : null;

            return (
              <button
                key={track.id}
                ref={isCurrentTrack ? currentTrackRef : null}
                onClick={() => handleTrackSelect(track)}
                className={cn(
                  "w-full text-left px-3 py-2 rounded-md text-sm transition-colors",
                  isCurrentTrack
                    ? "bg-primary/10 hover:bg-primary/20 text-foreground"
                    : "hover:bg-muted"
                )}
              >
                <div className="flex items-center gap-2">
                  <div className="font-medium flex-1">{trackName}</div>
                  {showStatusBadge && (
                    <Badge
                      variant="secondary"
                      className={cn(
                        "h-5 px-1.5 text-[10px] shrink-0",
                        statusBadgeClass
                      )}
                    >
                      {statusText}
                    </Badge>
                  )}
                  {duration && (
                    <span className="text-xs text-muted-foreground shrink-0">
                      {duration}
                    </span>
                  )}
                  {isCurrentTrack && (
                    <Badge
                      variant="secondary"
                      className="h-5 px-1.5 text-[10px] shrink-0"
                    >
                      Playing
                    </Badge>
                  )}
                </div>
                {chapterTitle && (
                  <div className="text-xs opacity-70 mt-0.5 text-primary">
                    {chapterTitle}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </ScrollArea>
    </>
  );

  if (isMobile) {
    return (
      <Drawer open={isOpen} onOpenChange={onOpenChange} direction="bottom">
        <DrawerContent className="max-h-[80vh] flex flex-col">
          <DrawerHandle />
          {content}
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[80vh]">{content}</DialogContent>
    </Dialog>
  );
}

interface AudioTracksButtonProps {
  onClick: () => void;
  disabled?: boolean;
}

export function AudioTracksButton({
  onClick,
  disabled,
}: Readonly<AudioTracksButtonProps>) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-10 w-10 shrink-0"
      onClick={onClick}
      disabled={disabled}
      title="Audio tracks"
    >
      <List className="h-5 w-5 shrink-0" />
    </Button>
  );
}
