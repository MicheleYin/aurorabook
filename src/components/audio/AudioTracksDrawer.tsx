import { useCallback, useEffect, useRef } from "react";
import { List } from "lucide-react";

import type { AudioTrack, Book } from "../../types/book";
import { useIsMobile } from "../../hooks/useIsMobile";
import { cn } from "../../lib/utils";
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

            return (
              <button
                key={track.id}
                ref={isCurrentTrack ? currentTrackRef : null}
                onClick={() => handleTrackSelect(track)}
                className={cn(
                  "w-full text-left px-3 py-2 rounded-md text-sm transition-colors",
                  isCurrentTrack
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted"
                )}
              >
                <div className="font-medium">{trackName}</div>
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
        <DrawerContent>
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
