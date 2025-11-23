import { Pause, Play, Square } from "lucide-react";
import type { Book, Chapter, PlaybackState, VoiceId } from "../types/reader";

import { Button } from "./ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
import { Slider } from "./ui/slider";

export type PlaybackPanelProps = {
  activeBook?: Book;
  activeChapter?: Chapter;
  playbackState: PlaybackState;
  isLoadingModel: boolean;
  isImporting: boolean;
  voice: VoiceId;
  voices: ReadonlyArray<{ label: string; value: VoiceId }>;
  progress: number;
  duration: number;
  error?: string | null;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onSeek: (value: number[]) => void;
  onSelectVoice: (voice: VoiceId) => void;
};

export function PlaybackPanel({
  activeBook,
  activeChapter,
  playbackState,
  isLoadingModel,
  isImporting,
  voice,
  voices,
  progress,
  duration,
  error,
  onPlay,
  onPause,
  onStop,
  onSeek,
  onSelectVoice,
}: PlaybackPanelProps) {
  const isPlayDisabled =
    !activeChapter || playbackState === "loading" || isLoadingModel || isImporting;

  const formatTime = (value: number) =>
    new Date(value * 1000).toISOString().slice(14, 19);

  return (
    <Card>
      <CardHeader className="space-y-2">
        <CardTitle>{activeBook?.title ?? "No book selected"}</CardTitle>
        <CardDescription>
          {activeBook?.author ?? "Choose a book to unlock narration."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={onPlay} disabled={isPlayDisabled}>
            {playbackState === "paused" ? (
              <>
                <Play className="mr-2 h-4 w-4" />
                Resume
              </>
            ) : (
              <>
                <Play className="mr-2 h-4 w-4" />
                {playbackState === "loading" ? "Preparing…" : "Play"}
              </>
            )}
          </Button>
          <Button
            variant="outline"
            onClick={onPause}
            disabled={playbackState !== "playing"}
          >
            <Pause className="mr-2 h-4 w-4" />
            Pause
          </Button>
          <Button
            variant="outline"
            onClick={onStop}
            disabled={playbackState === "idle"}
          >
            <Square className="mr-2 h-4 w-4" />
            Stop
          </Button>
        </div>

        <div>
          <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
            Voice
          </p>
          <div className="flex flex-wrap gap-2">
            {voices.map((option) => (
              <Button
                key={option.value}
                variant={voice === option.value ? "secondary" : "ghost"}
                size="sm"
                onClick={() => onSelectVoice(option.value)}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Progress</span>
            <span>
              {formatTime(progress)} / {duration ? formatTime(duration) : "--:--"}
            </span>
          </div>
          <Slider
            max={duration || 1}
            value={[Math.min(progress, duration || progress || 0)]}
            disabled={!duration || playbackState === "loading"}
            step={0.5}
            onValueChange={onSeek}
          />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        {(isLoadingModel || isImporting) && (
          <p className="text-sm text-muted-foreground">
            {isLoadingModel ? "Loading narrator model…" : "Importing your ebook…"}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

