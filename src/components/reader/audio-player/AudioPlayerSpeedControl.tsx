import { memo } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/select";

const PLAYBACK_RATE_OPTIONS = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;

const formatPlaybackRate = (rate: number) => {
  if (Number.isInteger(rate)) {
    return `${rate.toFixed(0)}x`;
  }
  return `${rate.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}x`;
};

type AudioPlayerSpeedControlProps = {
  playbackRate: number;
  onPlaybackRateChange: (value: string) => void;
  showLabel?: boolean;
};

export const AudioPlayerSpeedControl = memo(function AudioPlayerSpeedControl({
  playbackRate,
  onPlaybackRateChange,
  showLabel = false,
}: AudioPlayerSpeedControlProps) {
  return (
    <div className="flex items-center gap-1 text-xs text-muted-foreground">
      {showLabel && <span className="hidden md:block">Speed</span>}
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
  );
});

