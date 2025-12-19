import { memo } from "react";
import { List, MoveVertical, X } from "lucide-react";
import { Button } from "../../ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/select";
import { cn } from "../../../lib/utils";

const PLAYBACK_RATE_OPTIONS = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;

const formatPlaybackRate = (rate: number) => {
  if (Number.isInteger(rate)) {
    return `${rate.toFixed(0)}x`;
  }
  return `${rate.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}x`;
};

type AudioPlayerHeaderProps = {
  currentTrackTitle: string;
  bookTitle?: string;
  playbackRate: number;
  onPlaybackRateChange: (value: string) => void;
  autoScrollEnabled?: boolean;
  onAutoScrollToggle?: (enabled: boolean) => void;
  tracksCount: number;
  onShowTracksDialog: () => void;
  onDismiss?: () => void;
  trackAnimationClass?: string | null;
  isMobile?: boolean;
};

export const AudioPlayerHeader = memo(function AudioPlayerHeader({
  currentTrackTitle,
  bookTitle,
  playbackRate,
  onPlaybackRateChange,
  autoScrollEnabled,
  onAutoScrollToggle,
  tracksCount,
  onShowTracksDialog,
  onDismiss,
  trackAnimationClass,
  isMobile = false,
}: AudioPlayerHeaderProps) {
  if (isMobile) {
    return (
      <div className="flex sm:hidden flex-row justify-between items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className={cn("truncate text-sm font-semibold", trackAnimationClass)}>
            {currentTrackTitle}
          </p>
          {bookTitle ? (
            <p className={cn("truncate text-xs text-muted-foreground", trackAnimationClass)}>
              {bookTitle}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Select value={playbackRate.toString()} onValueChange={onPlaybackRateChange}>
              <SelectTrigger
                aria-label="Playback speed"
                className="h-8 min-w-[48px] rounded-md border border-input bg-background px-2 text-xs font-medium text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {PLAYBACK_RATE_OPTIONS.map((rate) => (
                  <SelectItem key={rate} value={rate.toString()} className="text-xs">
                    {formatPlaybackRate(rate)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {onAutoScrollToggle && tracksCount > 0 ? (
            <Button
              variant={autoScrollEnabled ? "secondary" : "ghost"}
              size="icon"
              className={cn(
                "rounded-full auto-scroll-button-transition",
                autoScrollEnabled && "ring-1 ring-primary/20"
              )}
              onClick={() => onAutoScrollToggle(!autoScrollEnabled)}
              aria-label={autoScrollEnabled ? "Disable auto-scroll" : "Enable auto-scroll"}
              title={autoScrollEnabled ? "Auto-scroll enabled" : "Auto-scroll disabled"}
            >
              <MoveVertical
                className={cn(
                  "h-4 w-4 transition-transform duration-200",
                  autoScrollEnabled && "scale-110"
                )}
              />
            </Button>
          ) : null}
          {tracksCount > 1 ? (
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full"
              onClick={onShowTracksDialog}
              aria-label="Show all tracks"
              title="Show all tracks"
            >
              <List className="h-4 w-4" />
            </Button>
          ) : null}
          {onDismiss ? (
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full flex-shrink-0"
              onClick={onDismiss}
              aria-label="Dismiss audio player"
            >
              <X className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  // Desktop header (part of combined layout)
  return (
    <div className="min-w-0 flex-1 w-auto">
      <p className={cn("truncate text-sm font-semibold", trackAnimationClass)}>
        {currentTrackTitle}
      </p>
      {bookTitle ? (
        <p className={cn("truncate text-xs text-muted-foreground", trackAnimationClass)}>
          {bookTitle}
        </p>
      ) : null}
    </div>
  );
});

