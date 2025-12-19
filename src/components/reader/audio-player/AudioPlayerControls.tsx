import { memo } from "react";
import { Loader2, Pause, Play, SkipBack, SkipForward, StepBack, StepForward } from "lucide-react";
import { Button } from "../../ui/button";

type AudioPlayerControlsProps = {
  isPlaying: boolean;
  isLoadingOrChanging: boolean;
  currentIndex: number;
  tracksLength: number;
  onPrevious: () => void;
  onNext: () => void;
  onSkipBack: () => void;
  onSkipForward: () => void;
  onTogglePlayback: () => void;
  isMobile?: boolean;
};

export const AudioPlayerControls = memo(function AudioPlayerControls({
  isPlaying,
  isLoadingOrChanging,
  currentIndex,
  tracksLength,
  onPrevious,
  onNext,
  onSkipBack,
  onSkipForward,
  onTogglePlayback,
  isMobile = false,
}: AudioPlayerControlsProps) {
  const controls = (
    <div className="flex items-center gap-2">
      <Button
        variant="ghost"
        size="icon"
        className="rounded-full"
        onClick={onPrevious}
        aria-label="Previous track"
        disabled={currentIndex <= 0 || (!isMobile && isLoadingOrChanging)}
      >
        <SkipBack className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="rounded-full"
        onClick={onSkipBack}
        aria-label="Skip back 10 seconds"
        title="Skip back 10 seconds"
        disabled={isLoadingOrChanging}
      >
        <StepBack className="h-4 w-4" />
      </Button>
      <Button
        variant="secondary"
        size="icon"
        className="h-12 w-12 rounded-full"
        onClick={onTogglePlayback}
        aria-label={isPlaying ? "Pause audio" : "Play audio"}
        disabled={isLoadingOrChanging}
      >
        {isLoadingOrChanging ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : isPlaying ? (
          <Pause className="h-5 w-5" />
        ) : (
          <Play className="h-5 w-5" />
        )}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="rounded-full"
        onClick={onSkipForward}
        aria-label="Skip forward 10 seconds"
        title="Skip forward 10 seconds"
        disabled={isLoadingOrChanging}
      >
        <StepForward className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="rounded-full"
        onClick={onNext}
        aria-label="Next track"
        disabled={currentIndex + 1 >= tracksLength || (!isMobile && isLoadingOrChanging)}
      >
        <SkipForward className="h-4 w-4" />
      </Button>
    </div>
  );

  if (isMobile) {
    return (
      <div className="flex sm:hidden flex-row items-center justify-center gap-2">
        {controls}
      </div>
    );
  }

  return controls;
});

