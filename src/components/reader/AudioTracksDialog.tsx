import { useCallback, useEffect, useRef } from "react";
import { X } from "lucide-react";
import type { AudioTrack, AudioSyncMap, Chapter } from "../../types/reader";
import { Button } from "../ui/button";
import { findChaptersForAudioTrack, chapterHrefsMatch } from "../../lib/epub";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerHandle,
  DrawerHeader,
  DrawerTitle,
} from "../ui/drawer";
import { cn } from "../../lib/utils";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { anim } from "../../lib/animations";

const formatTime = (value: number) => {
  if (!Number.isFinite(value) || value < 0) {
    value = 0;
  }
  const totalSeconds = Math.floor(value);
  
  // Calculate months (assuming 30 days per month for simplicity)
  const secondsPerMonth = 30 * 24 * 3600;
  const months = Math.floor(totalSeconds / secondsPerMonth);
  const remainingAfterMonths = totalSeconds % secondsPerMonth;
  
  // Calculate days
  const secondsPerDay = 24 * 3600;
  const days = Math.floor(remainingAfterMonths / secondsPerDay);
  const remainingAfterDays = remainingAfterMonths % secondsPerDay;
  
  // Calculate hours, minutes, seconds
  const hours = Math.floor(remainingAfterDays / 3600);
  const minutes = Math.floor((remainingAfterDays % 3600) / 60);
  const seconds = remainingAfterDays % 60;
  
  // Build the formatted string
  const parts: string[] = [];
  
  if (months > 0) {
    parts.push(`${months}mo`);
  }
  if (days > 0) {
    parts.push(`${days}d`);
  }
  
  // Format time portion
  if (hours > 0 || months > 0 || days > 0) {
    // Show full H:MM:SS format when we have days/months or hours
    parts.push(`${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`);
  } else {
    // Show M:SS format for durations under an hour
    parts.push(`${minutes}:${seconds.toString().padStart(2, "0")}`);
  }
  
  return parts.join(" ");
};

type AudioTracksDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tracks: AudioTrack[];
  currentIndex: number;
  bookTitle?: string;
  loadedTrackUrls: Map<string, string>;
  onTrackSelect: (trackIndex: number) => void;
  audioSyncMap?: AudioSyncMap;
  chapters?: Chapter[];
};

export function AudioTracksDialog({
  open,
  onOpenChange,
  tracks,
  currentIndex,
  bookTitle,
  loadedTrackUrls,
  onTrackSelect,
  audioSyncMap,
  chapters,
}: AudioTracksDialogProps) {
  const isDesktop = useMediaQuery("(min-width: 640px)");
  const dialogScrollRef = useRef<HTMLDivElement>(null);
  const drawerScrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to current track when dialog/drawer opens
  useEffect(() => {
    if (open && currentIndex >= 0) {
      // Wait for dialog/drawer animation to complete before scrolling
      const timeoutId = setTimeout(() => {
        const scrollContainer = isDesktop 
          ? dialogScrollRef.current 
          : drawerScrollRef.current;
        
        if (scrollContainer) {
          const currentTrackButton = scrollContainer.querySelector(
            `[data-track-index="${currentIndex}"]`
          ) as HTMLElement;
          
          if (currentTrackButton) {
            currentTrackButton.scrollIntoView({
              behavior: 'smooth',
              block: 'center',
            });
          }
        }
      }, 300); // Wait for dialog/drawer animation (medium duration)

      return () => clearTimeout(timeoutId);
    }
  }, [open, currentIndex, isDesktop]);

  const handleTrackSelect = useCallback(
    (trackIndex: number) => {
      console.log("[AudioTracksDialog] handleTrackSelect called", {
        trackIndex,
        tracksLength: tracks.length,
      });
      onTrackSelect(trackIndex);
      onOpenChange(false);
    },
    [onTrackSelect, onOpenChange, tracks.length]
  );

  const tracksListContent = (
    <div className="flex flex-col gap-1 w-full min-w-0">
      {tracks.map((track, index) => {
        const isCurrentTrack = index === currentIndex;
        const trackUrl = loadedTrackUrls.get(track.id) || track.url;
        const hasUrl = !!trackUrl;
        
        // Find chapters associated with this audio track
        const chapterHrefs = audioSyncMap
          ? findChaptersForAudioTrack(audioSyncMap, track.href)
          : [];
        const relatedChapters = chapters
          ? chapters.filter((chapter) => {
              return chapterHrefs.some((chapterHref) =>
                chapterHrefsMatch(chapter.href, chapterHref)
              );
            })
          : [];

        return (
          <Button
            key={track.id}
            data-track-index={index}
            variant={isCurrentTrack ? "secondary" : "ghost"}
            size="default"
            className={cn(
              "h-auto",
              "justify-start relative min-w-0 w-full max-w-full",
              anim("normal", "all"),
              "hover:translate-x-1 hover:bg-accent/80",
              "active:translate-x-0.5",
              "transition-all duration-200 ease-out"
            )}
            style={{ 
              display: "flex",
              whiteSpace: "normal",
              width: "100%",
              maxWidth: "100%",
              boxSizing: "border-box",
            }}
            onClick={() => {
              console.log("[AudioTracksDialog] Button clicked", {
                index,
                trackId: track.id,
                hasUrl,
                isCurrentTrack,
              });
              
              handleTrackSelect(index);
            }}
            aria-label={`Play track ${index + 1}: ${track.title}`}
            aria-current={isCurrentTrack ? "true" : undefined}
          >
            <div className="flex flex-col flex-1 min-w-0 pr-2">
              <p
                className={cn(
                  "text-sm font-medium truncate text-left min-w-0",
                  isCurrentTrack && "text-primary",
                  !hasUrl && "text-muted-foreground"
                )}
              >
                {index + 1}. {track.title}
              </p>
              <div className="flex flex-col gap-0.5 mt-0.5">
                {track.duration && (
                  <p className="text-xs text-muted-foreground text-left">
                    {formatTime(track.duration)}
                  </p>
                )}
                {relatedChapters.length > 0 && (
                  <p className="text-xs text-muted-foreground truncate text-left min-w-0 ml-4">
                    Chapter: {relatedChapters.map(ch => ch.title).join(", ")}
                  </p>
                )}
              </div>
            </div>
            {isCurrentTrack && (
              <span
                className={cn(
                  "px-1.5 py-0.5 text-xs font-medium rounded shrink-0",
                  "bg-primary text-primary-foreground",
                  "animate-pulse"
                )}
                title="Currently playing"
              >
                Playing
              </span>
            )}
          </Button>
        );
      })}
    </div>
  );

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md ">
          <DialogHeader>
            <DialogTitle>
              {bookTitle ? `${bookTitle} - Tracks` : "All Tracks"}
            </DialogTitle>
          </DialogHeader>
          <div ref={dialogScrollRef} className="mt-4 flex-1 pr-2 min-w-0 w-full max-h-[80vh] overflow-y-auto">
            {tracksListContent}
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHandle className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-muted" />
        <div className="flex flex-1 flex-col gap-6 overflow-y-auto">
          <DrawerHeader className="gap-3 text-left">
            <div className="flex items-start justify-between gap-2">
              <div className="flex flex-col gap-1 text-left">
                <DrawerTitle>
                  {bookTitle ? `${bookTitle} - Tracks` : "All Tracks"}
                </DrawerTitle>
              </div>
              <DrawerClose asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Close tracks"
                >
                  <X className="h-4 w-4" />
                </Button>
              </DrawerClose>
            </div>
          </DrawerHeader>
          <div ref={drawerScrollRef} className="mt-4 flex-1 pr-2 min-w-0 w-full max-h-[60vh] overflow-y-auto">
            {tracksListContent}
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

