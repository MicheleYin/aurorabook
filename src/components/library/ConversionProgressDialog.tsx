import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Progress } from "../ui/progress";
import type { ConversionProgress } from "../../lib/audiobook-converter";

type ConversionProgressDialogProps = {
  open: boolean;
  progress: ConversionProgress | null;
  bookTitle: string;
};

export function ConversionProgressDialog({
  open,
  progress,
  bookTitle,
}: ConversionProgressDialogProps) {
  const progressPercent = progress
    ? Math.round((progress.currentChapter / progress.totalChapters) * 100)
    : 0;

  const stepLabels: Record<ConversionProgress["currentStep"], string> = {
    initializing: "Initializing TTS engine...",
    "generating-audio": "Generating audio",
    "merging-audio": "Merging audio files",
    "creating-smil": "Creating synchronization files",
    "updating-epub": "Updating EPUB structure",
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
                  <span className="font-medium">{progressPercent}%</span>
                </div>
                <Progress value={progressPercent} className="h-2" />
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>{progress.message || currentStepLabel}</span>
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

