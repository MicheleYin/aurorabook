import { useCallback } from "react";
import { X } from "lucide-react";
import type { AudioTrack } from "../../types/reader";
import { Button } from "../ui/button";
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

const formatTime = (value: number) => {
  if (!Number.isFinite(value) || value < 0) {
    value = 0;
  }
  const totalSeconds = Math.floor(value);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

type AudioTracksDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tracks: AudioTrack[];
  currentIndex: number;
  bookTitle?: string;
  loadedTrackUrls: Map<string, string>;
  onTrackSelect: (trackIndex: number) => void;
};

export function AudioTracksDialog({
  open,
  onOpenChange,
  tracks,
  currentIndex,
  bookTitle,
  loadedTrackUrls,
  onTrackSelect,
}: AudioTracksDialogProps) {
  const isDesktop = useMediaQuery("(min-width: 640px)");

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
    <div className="space-y-1">
      {tracks.map((track, index) => {
        const isCurrentTrack = index === currentIndex;
        const trackUrl = loadedTrackUrls.get(track.id) || track.url;
        const hasUrl = !!trackUrl;

        return (
          <Button
            key={track.id}
            variant={isCurrentTrack ? "secondary" : "ghost"}
            className={cn(
              "w-full justify-start text-left h-auto px-4 py-3 rounded-lg",
              isCurrentTrack && "ring-1 ring-primary/20"
            )}
            // disabled={!hasUrl}
            onClick={() => {
              console.log("[AudioTracksDialog] Button clicked", {
                index,
                trackId: track.id,
                hasUrl,
                isCurrentTrack,
              });
              
              handleTrackSelect(index);
            }}
          >
            <div className="flex items-center justify-between gap-2 w-full min-w-0">
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "text-sm font-medium truncate",
                    isCurrentTrack && "text-primary",
                    !hasUrl && "text-muted-foreground"
                  )}
                >
                  {index + 1}. {track.title}
                </p>
                {track.duration && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {formatTime(track.duration)}
                  </p>
                )}
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
            </div>
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
          <div className="my-4 px-1 py-1 max-h-[80vh] overflow-y-auto">
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
          <div className="max-h-[60vh] overflow-y-auto px-1 py-1">
            {tracksListContent}
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

