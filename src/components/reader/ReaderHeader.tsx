import { useCallback, useMemo } from "react";
import { ArrowLeft, Headphones, Settings } from "lucide-react";

import { useAppContext } from "@/context/AppContext";

import type { Book, Chapter } from "../../types/book";
import { useAudioProgressContext } from "../../context/AudioProgressContext";
import { useConversionState } from "../../context/ConversionStateContext";
import { Button } from "../ui/button";
import { TOCDrawer } from "./TOCDrawer";

interface ReaderHeaderProps {
  book: Book;
  currentChapter: Chapter;
  isTocOpen: boolean;
  onTocOpenChange: (open: boolean) => void;
  onChapterSelect: (chapter: Chapter) => void;
  onBack: () => void;
  onSettingsClick?: () => void;
}

export function ReaderHeader({
  book,
  currentChapter,
  isTocOpen,
  onTocOpenChange,
  onChapterSelect,
  onBack,
  onSettingsClick,
}: Readonly<ReaderHeaderProps>) {
  const { loadLastOpenedAudioTrack, currentAudioTrack, isLoadingAudio } =
    useAudioProgressContext();
  const { currentBook } = useAppContext();
  const { getCurrentConvertingChapter } = useConversionState();
  const hasAudio = useMemo(() => {
    const hasCompletedTracks = !!(
      currentBook?.audioTracks.length && currentBook.audioTracks.length > 0
    );
    const hasIncompleteLiveChapter =
      currentBook?.conversionStatus === "started" ||
      getCurrentConvertingChapter(book.id) !== null;
    return hasCompletedTracks || hasIncompleteLiveChapter;
  }, [book.id, currentBook, getCurrentConvertingChapter]);
  const onAudioShowClick = useCallback(() => {
    loadLastOpenedAudioTrack(book, false);
  }, [loadLastOpenedAudioTrack, book]);
  return (
    <div className="flex-shrink-0 select-none border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex items-center justify-between p-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex flex-col">
            <h1 className="font-semibold text-base line-clamp-1">
              {book.title}
            </h1>
            <p className="text-xs text-muted-foreground line-clamp-1">
              {currentChapter.title}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {hasAudio && onAudioShowClick && !currentAudioTrack && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onAudioShowClick}
              disabled={isLoadingAudio}
            >
              <Headphones className="h-5 w-5" />
            </Button>
          )}
          <TOCDrawer
            book={book}
            currentChapter={currentChapter}
            isOpen={isTocOpen}
            onOpenChange={onTocOpenChange}
            onChapterSelect={onChapterSelect}
          />
          {onSettingsClick && (
            <Button variant="ghost" size="icon" onClick={onSettingsClick}>
              <Settings className="h-5 w-5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
