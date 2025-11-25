import { Loader2, Pause, Play } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Progress } from "../ui/progress";
import { Button } from "../ui/button";
import type { ConversionProgress } from "../../lib/audiobook-converter";
import { useAnimatedNumber } from "../../hooks/use-animated-number";

type ConversionProgressDialogProps = {
  open: boolean;
  progress: ConversionProgress | null;
  bookTitle: string;
  isPaused?: boolean;
  onPause?: () => void;
  onResume?: () => void;
  onCancel?: () => void;
};

export function ConversionProgressDialog({
  open,
  progress,
  bookTitle,
  isPaused = false,
  onPause,
  onResume,
  onCancel,
}: ConversionProgressDialogProps) {
  const targetProgressPercent = progress
    ? Math.round((progress.currentChapter / progress.totalChapters) * 100)
    : 0;
  
  // Animate the percentage number counting up
  const animatedProgressPercent = useAnimatedNumber(targetProgressPercent, 500);

  const stepLabels: Record<ConversionProgress["currentStep"], string> = {
    initializing: "Initializing TTS engine...",
    "generating-audio": "Generating audio",
    "merging-audio": "Merging audio files",
    "creating-smil": "Creating synchronization files",
    "updating-epub": "Updating EPUB structure",
    saving: "Saving EPUB...",
    complete: "Complete!",
  };

  const currentStepLabel = progress ? stepLabels[progress.currentStep] : "";

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-[500px] [&>button]:hidden">
        <DialogHeader>
          <DialogTitle>Converting to Audiobook</DialogTitle>
          <DialogDescription>{bookTitle}</DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-4">
          {progress ? (
            <>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    Chapter {progress.currentChapter} of {progress.totalChapters}
                  </span>
                  <span className="font-medium">{animatedProgressPercent}%</span>
                </div>
                <Progress 
                  value={animatedProgressPercent} 
                  className="h-2"
                  showPulse={true}
                  showWave={true}
                />
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                {!isPaused && <Loader2 className="h-4 w-4 animate-spin" />}
                <span>{progress.message || currentStepLabel}</span>
              </div>
              <div className="flex items-center gap-2 pt-2">
                {isPaused ? (
                  <>
                    {onResume && (
                      <Button onClick={onResume} size="sm" className="gap-2">
                        <Play className="h-4 w-4" />
                        Resume
                      </Button>
                    )}
                    {onCancel && (
                      <Button onClick={onCancel} variant="outline" size="sm">
                        Cancel
                      </Button>
                    )}
                  </>
                ) : (
                  <>
                    {onPause && (
                      <Button onClick={onPause} variant="outline" size="sm" className="gap-2">
                        <Pause className="h-4 w-4" />
                        Pause
                      </Button>
                    )}
                    {onCancel && (
                      <Button onClick={onCancel} variant="outline" size="sm">
                        Cancel
                      </Button>
                    )}
                  </>
                )}
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

