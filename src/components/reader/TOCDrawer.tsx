import { useEffect, useMemo, useRef } from "react";
import { BookOpen, Volume2 } from "lucide-react";

import type { Book, Chapter } from "../../types/book";
import { useAudioProgressContext } from "../../context/AudioProgressContext";
import { cn, formatTime } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "../ui/drawer";
import { ScrollArea } from "../ui/scroll-area";

interface TOCDrawerProps {
  book: Book;
  currentChapter: Chapter;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onChapterSelect: (chapter: Chapter) => void;
}

export function TOCDrawer({
  book,
  currentChapter,
  isOpen,
  onOpenChange,
  onChapterSelect,
}: Readonly<TOCDrawerProps>) {
  const currentChapterRef = useRef<HTMLButtonElement | null>(null);
  const { currentAudioTrack } = useAudioProgressContext();

  // Create a map of chapter href to audio track titles and durations
  const chapterAudioTracks = useMemo(() => {
    const map = new Map<string, string[]>();

    if (!book.audioSyncMap?.segments || !book.audioTracks) {
      return map;
    }

    // Group segments by chapter href
    const chapterSegments = new Map<string, Set<string>>();
    book.audioSyncMap.segments.forEach((segment) => {
      if (!chapterSegments.has(segment.chapterHref)) {
        chapterSegments.set(segment.chapterHref, new Set());
      }
      chapterSegments.get(segment.chapterHref)?.add(segment.audioTrackHref);
    });

    // Find audio track titles for each chapter
    chapterSegments.forEach((trackHrefs, chapterHref) => {
      const trackTitles: string[] = [];
      trackHrefs.forEach((trackHref) => {
        const track = book.audioTracks.find(
          (t) => t.href === trackHref || t.filePath === trackHref
        );
        if (track?.title) {
          trackTitles.push(track.title);
        }
      });
      if (trackTitles.length > 0) {
        map.set(chapterHref, trackTitles);
      }
    });

    return map;
  }, [book.audioSyncMap, book.audioTracks]);

  // Create a map of chapter href to total audio duration
  const chapterAudioDurations = useMemo(() => {
    const map = new Map<string, number>();

    if (!book.audioSyncMap?.segments || !book.audioTracks) {
      return map;
    }

    // Group segments by chapter href
    const chapterSegments = new Map<string, Set<string>>();
    book.audioSyncMap.segments.forEach((segment) => {
      if (!chapterSegments.has(segment.chapterHref)) {
        chapterSegments.set(segment.chapterHref, new Set());
      }
      chapterSegments.get(segment.chapterHref)?.add(segment.audioTrackHref);
    });

    // Calculate total duration for each chapter
    chapterSegments.forEach((trackHrefs, chapterHref) => {
      let totalDuration = 0;
      trackHrefs.forEach((trackHref) => {
        const track = book.audioTracks.find(
          (t) => t.href === trackHref || t.filePath === trackHref
        );
        if (
          track &&
          "duration" in track &&
          typeof track.duration === "number" &&
          track.duration > 0
        ) {
          totalDuration += track.duration;
        }
      });
      if (totalDuration > 0) {
        map.set(chapterHref, totalDuration);
      }
    });

    return map;
  }, [book.audioSyncMap, book.audioTracks]);

  // Determine which chapter is currently playing based on audio sync map
  const playingChapterHref = useMemo(() => {
    if (!currentAudioTrack || !book.audioSyncMap?.segments) {
      return null;
    }

    // Get current track href (support both href and filePath)
    const trackHref = currentAudioTrack.href || currentAudioTrack.filePath;
    if (!trackHref) {
      return null;
    }

    // Find the first segment that matches the current track
    const matchingSegment = book.audioSyncMap.segments.find(
      (segment) => segment.audioTrackHref === trackHref
    );

    return matchingSegment?.chapterHref || null;
  }, [currentAudioTrack, book.audioSyncMap]);

  // Scroll to current chapter when drawer opens
  useEffect(() => {
    if (!isOpen) return;

    const scrollToCurrentChapter = () => {
      if (currentChapterRef.current) {
        currentChapterRef.current.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }
    };

    // Small delay to ensure drawer is fully rendered
    const timeoutId = setTimeout(scrollToCurrentChapter, 100);
    return () => clearTimeout(timeoutId);
  }, [isOpen, currentChapter.id]);

  return (
    <Drawer open={isOpen} onOpenChange={onOpenChange} direction="left">
      <DrawerTrigger asChild>
        <Button variant="ghost" size="icon">
          <BookOpen className="h-5 w-5" />
        </Button>
      </DrawerTrigger>
      <DrawerContent className="w-80 max-w-[85vw] max-h-[100vh] top-0 bottom-0 left-0 right-auto rounded-r-3xl rounded-l-none safe-area-top">
        <DrawerHeader className="pb-4">
          <DrawerTitle>Table of Contents</DrawerTitle>
        </DrawerHeader>
        <ScrollArea className="flex-1">
          <div className="p-4 space-y-1">
            {book.chapters.map((chapter) => (
              <button
                key={chapter.id}
                ref={
                  chapter.id === currentChapter.id ? currentChapterRef : null
                }
                onClick={() => onChapterSelect(chapter)}
                className={cn(
                  "w-full text-left px-3 py-2 rounded-md text-sm transition-colors",
                  chapter.id === currentChapter.id
                    ? "bg-primary/10 hover:bg-primary/20 text-foreground"
                    : "hover:bg-muted"
                )}
              >
                <div className="flex items-center gap-2">
                  <div className="font-medium flex-1">{chapter.title}</div>
                  {playingChapterHref === chapter.href && (
                    <Badge
                      variant="secondary"
                      className="h-5 px-1.5 text-[10px] shrink-0"
                    >
                      <Volume2 className="h-3 w-3 mr-1" />
                      Playing
                    </Badge>
                  )}
                </div>
                <div className="flex flex-col gap-0.5 mt-0.5">
                  {chapter.estimatedPageCount && (
                    <div className="text-xs opacity-70">
                      {chapter.estimatedPageCount} pages
                    </div>
                  )}
                  {chapterAudioTracks.has(chapter.href) && (
                    <div className="text-xs opacity-70 text-primary">
                      {chapterAudioTracks.get(chapter.href)?.join(", ")}
                    </div>
                  )}
                  {chapterAudioDurations.has(chapter.href) && (
                    <div className="text-xs opacity-70 text-primary">
                      {formatTime(chapterAudioDurations.get(chapter.href)!)}
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>
        </ScrollArea>
      </DrawerContent>
    </Drawer>
  );
}
