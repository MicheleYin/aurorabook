import { memo } from "react";
import { Slider } from "../../ui/slider";
import { formatTime } from "../../../lib/format-time";

type AudioPlayerProgressProps = {
  currentTime: number;
  duration: number;
  isScrubbing: boolean;
  scrubTime: number | null;
  onScrubChange: (value: number[]) => void;
  onScrubCommit: (value: number[]) => void;
  onScrubPointerDown: () => void;
  onScrubPointerUp: () => void;
  currentTrackUrl?: string;
};

export const AudioPlayerProgress = memo(function AudioPlayerProgress({
  currentTime,
  duration,
  isScrubbing,
  scrubTime,
  onScrubChange,
  onScrubCommit,
  onScrubPointerDown,
  onScrubPointerUp,
  currentTrackUrl,
}: AudioPlayerProgressProps) {
  const displayedCurrentTime = isScrubbing && typeof scrubTime === "number" 
    ? scrubTime 
    : currentTime;

  const sliderMax = duration && duration > 0 
    ? duration 
    : Math.max(displayedCurrentTime, 1);

  const sliderValue = Math.min(displayedCurrentTime, sliderMax);

  return (
    <div className="flex items-center gap-3">
      <span className="text-xs tabular-nums text-muted-foreground min-w-[3rem] text-right">
        {formatTime(displayedCurrentTime)}
      </span>
      <Slider
        className="flex-1"
        min={0}
        max={sliderMax}
        step={0.01}
        value={[sliderValue]}
        onValueChange={onScrubChange}
        onValueCommit={onScrubCommit}
        disabled={!duration}
        onPointerDown={onScrubPointerDown}
        onPointerUp={onScrubPointerUp}
        aria-label="Seek audio"
      />
      <span className="text-xs tabular-nums text-muted-foreground min-w-[5rem] relative">
        {currentTrackUrl ? (
          <span
            key="current-only"
            className="inline-block transition-opacity duration-300 ease-in-out animate-in fade-in"
          >
            {duration > 0 ? formatTime(duration) : "--:--"}
          </span>
        ) : (
          <span
            key="placeholder"
            className="inline-block transition-opacity duration-300 ease-in-out animate-in fade-in"
          >
            --:--
          </span>
        )}
      </span>
    </div>
  );
});

