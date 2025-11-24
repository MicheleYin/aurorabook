import type { Book } from "../../types/reader";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import type { ChapterSelectionOptions } from "./types";
import { findChaptersForAudioTrack } from "../../lib/epub";

type ChapterListProps = {
  book: Book;
  activeChapterId?: string;
  currentAudioTrackHref?: string;
  className?: string;
  onSelectChapter: (chapterId: string, options?: ChapterSelectionOptions) => void;
  onAfterSelect?: () => void;
};

export function ChapterList({
  book,
  activeChapterId,
  currentAudioTrackHref,
  className,
  onSelectChapter,
  onAfterSelect,
}: ChapterListProps) {
  // Find which chapters match the current audio track
  const chaptersForCurrentTrack = currentAudioTrackHref && book.audioSyncMap
    ? findChaptersForAudioTrack(book.audioSyncMap, currentAudioTrackHref)
    : [];

  // Determine if a chapter is currently playing
  const isChapterCurrentlyPlaying = (chapter: typeof book.chapters[0]) => {
    if (!currentAudioTrackHref || chaptersForCurrentTrack.length === 0) {
      return false;
    }
    const chapterHref = chapter.href.split("#")[0];
    return chaptersForCurrentTrack.includes(chapterHref);
  };

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {book.chapters.map((chapter) => {
        const isActive = chapter.id === activeChapterId;
        const isCurrentlyPlaying = isChapterCurrentlyPlaying(chapter);
        
        return (
          <Button
            key={chapter.id}
            variant={isActive ? "secondary" : "ghost"}
            size="sm"
            className="justify-start relative"
            onClick={() => {
              onSelectChapter(chapter.id, { fragment: chapter.id, isManualSelection: true });
              onAfterSelect?.();
            }}
          >
            <span className="line-clamp-1 flex-1 text-left">{chapter.title}</span>
            {isCurrentlyPlaying && (
              <span
                className={cn(
                  "ml-2 px-1.5 py-0.5 text-xs font-medium rounded",
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
}
