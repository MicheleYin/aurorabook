import type { Book } from "../../types/reader";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import type { ChapterSelectionOptions } from "./types";
import { findChaptersForAudioTrack } from "../../lib/epub";
import { anim } from "../../lib/animations";
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
    <div className={cn("flex flex-col gap-1 w-full min-w-0", className)}>
      {book.chapters.map((chapter) => {
        const isActive = chapter.id === activeChapterId;
        const isCurrentlyPlaying = isChapterCurrentlyPlaying(chapter);
        
        return (
          <Button
            key={chapter.id}
            variant={isActive ? "secondary" : "ghost"}
            size="sm"
            className={cn(
              "justify-start relative min-w-0 w-full max-w-full overflow-hidden",
              anim("normal", "all"),
              "hover:translate-x-1 hover:bg-accent/80",
              "active:translate-x-0.5",
              "transition-all duration-200 ease-out"
            )}
            style={{ 
              display: "flex",
              whiteSpace: "normal",
              width: "100%",
              maxWidth: "100%",
              boxSizing: "border-box",
            }}
            onClick={() => {
              onSelectChapter(chapter.id, { 
                fragment: chapter.id, 
                isManualSelection: true,
                scrollPosition: "top"
              });
              onAfterSelect?.();
            }}
            aria-label={`Go to chapter: ${chapter.title}`}
            aria-current={isActive ? "true" : undefined}
          >
            <span className="truncate flex-1 text-left min-w-0 pr-2 overflow-hidden">{chapter.title}</span>
            {isCurrentlyPlaying && (
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
          </Button>
        );
      })}
    </div>
  );
}
