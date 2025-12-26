import { useCallback, useEffect, useMemo, useRef } from "react";
import { List } from "lucide-react";

import type { AudioTrack, Book } from "../../types/book";
import { useIsMobile } from "../../hooks/useIsMobile";
import { cn, formatTime } from "../../lib/utils";
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

  const content = (
    <>
      <div className="pb-4">
        <DrawerHeader>
          <DrawerTitle>Audio Tracks</DrawerTitle>
        </DrawerHeader>
      </div>
      <ScrollArea className="flex-1 overflow-y-auto">
        <div className="p-4 space-y-1">
          {book.audioTracks.map((track) => {
            const isCurrentTrack = track.id === currentTrackId;
            const trackName = track.title || `Track ${track.order + 1}`;
            const trackHref = track.href || track.filePath;
            const chapterTitle = trackHref
              ? trackChapters.get(trackHref)
              : null;
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
