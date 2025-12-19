import { memo, useRef } from "react";
import { Button } from "../ui/button";
import { List, MoveVertical, X } from "lucide-react";
import { AudioTracksDialog } from "./AudioTracksDialog";
import { cn } from "../../lib/utils";
import { animPatterns, enterExit } from "../../lib/animations";
import type { AudioTrack, AudioSyncMap, Chapter } from "../../types/reader";
import type { AudioProgressSnapshot } from "./types";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { setAudioPlayerShowTracksDialog } from "../../store/slices/readerSlice";
import { selectAudioPlayerShowTracksDialog } from "../../store/selectors";
import { useAudioPlayerLogic } from "./audio-player/useAudioPlayerLogic";
import { useMediaSession } from "./audio-player/useMediaSession";
import { AudioPlayerHeader } from "./audio-player/AudioPlayerHeader";
import { AudioPlayerControls } from "./audio-player/AudioPlayerControls";
import { AudioPlayerProgress } from "./audio-player/AudioPlayerProgress";
import { AudioPlayerSpeedControl } from "./audio-player/AudioPlayerSpeedControl";

type ReaderAudioPlayerProps = {
  bookId?: string;
  tracks: AudioTrack[];
  bookTitle?: string;
  bookAuthor?: string;
  coverUrl?: string;
  sourcePath?: string;
  onProgress?: (snapshot: AudioProgressSnapshot) => void;
  onRestorationStateChange?: (isRestoring: boolean) => void;
  chromeVisible?: boolean;
  onClose?: () => void;
  autoScrollEnabled?: boolean;
  onAutoScrollToggle?: (enabled: boolean) => void;
  onTrackChange?: (trackHref: string) => void;
  audioSyncMap?: AudioSyncMap;
  chapters?: Chapter[];
};

function ReaderAudioPlayerComponent({
  bookId,
  tracks,
  bookTitle,
  bookAuthor,
  coverUrl,
  sourcePath,
  onProgress,
  onRestorationStateChange,
  chromeVisible = true,
  onClose,
  autoScrollEnabled = true,
  onAutoScrollToggle,
  onTrackChange,
  audioSyncMap,
  chapters,
}: ReaderAudioPlayerProps) {
  // sourcePath is part of the interface but not currently used
  void sourcePath;

  const dispatch = useAppDispatch();
  const showTracksDialog = useAppSelector(selectAudioPlayerShowTracksDialog);
  const hasBeenDismissedRef = useRef(false);

  // Use the audio player logic hook
  const {
    isPlaying,
    currentTime,
    duration,
    playbackRate,
    isScrubbing,
    scrubTime,
    isVisible,
    trackAnimationClass,
    isLoadingOrChanging,
    currentTrack,
    currentIndex,
    isDismissing,
    handleTogglePlayback,
    handlePrevious,
    handleNext,
    handleSkipBack,
    handleSkipForward,
    handleScrubChange,
    handleScrubCommit,
    handleScrubPointerDown,
    handleScrubPointerUp,
    handlePlaybackRateChange,
    handleTrackSelect,
    handleDismiss,
  } = useAudioPlayerLogic({
    bookId,
    tracks,
    onProgress,
    onRestorationStateChange,
    onTrackChange,
  });

  // Use MediaSession hook
  useMediaSession({
    currentTrack,
    bookTitle,
    bookAuthor,
    coverUrl,
    audioSyncMap,
    chapters,
    handleTogglePlayback,
    handlePrevious,
    handleNext,
    handleSkipBack,
    handleSkipForward,
  });

  if (!currentTrack) {
    return null;
  }

  return (
    <div
      data-audio-player
      className={cn(
        "fixed inset-x-0 bottom-14 z-50 flex justify-center px-4 pb-6 sm:px-6",
        animPatterns.navBar,
        !chromeVisible && "translate-y-12 ",
        (isDismissing || !chromeVisible || hasBeenDismissedRef.current) &&
          "pointer-events-none",
        hasBeenDismissedRef.current && "opacity-0"
      )}
    >
      <div
        className={cn(
          "pointer-events-auto flex w-full max-w-2xl flex-col gap-3 rounded-2xl border border-border bg-background/90 p-4 shadow-lg ring-1 ring-black/5 backdrop-blur",
          isDismissing && "will-change-transform will-change-opacity will-change-scale",
          animPatterns.audioPlayer,
          isDismissing || hasBeenDismissedRef.current
            ? cn(
                "animate-out slide-out-to-top-4 fade-out-0 zoom-out-95",
                "duration-300 ease-in-out"
              )
            : enterExit(isVisible, "slideUpFade"),
          hasBeenDismissedRef.current && "opacity-0 pointer-events-none scale-95"
        )}
      >
        {/* Mobile: Top row with title, speed, sync, close */}
        <AudioPlayerHeader
          currentTrackTitle={currentTrack.title}
          bookTitle={bookTitle}
          playbackRate={playbackRate}
          onPlaybackRateChange={handlePlaybackRateChange}
          autoScrollEnabled={autoScrollEnabled}
          onAutoScrollToggle={onAutoScrollToggle}
          tracksCount={tracks.length}
          onShowTracksDialog={() => dispatch(setAudioPlayerShowTracksDialog(true))}
          onDismiss={onClose ? handleDismiss : undefined}
          trackAnimationClass={trackAnimationClass}
          isMobile={true}
        />

        {/* Mobile: Bottom row with playback controls */}
        <AudioPlayerControls
          isPlaying={isPlaying}
          isLoadingOrChanging={isLoadingOrChanging}
          currentIndex={currentIndex}
          tracksLength={tracks.length}
          onPrevious={handlePrevious}
          onNext={handleNext}
          onSkipBack={handleSkipBack}
          onSkipForward={handleSkipForward}
          onTogglePlayback={handleTogglePlayback}
          isMobile={true}
        />

        {/* Desktop: Single row with everything */}
        <div className="hidden sm:flex flex-row justify-between items-start gap-3">
          <div className="flex flex-row items-center gap-3 min-w-0 flex-1">
            <AudioPlayerHeader
              currentTrackTitle={currentTrack.title}
              bookTitle={bookTitle}
              playbackRate={playbackRate}
              onPlaybackRateChange={handlePlaybackRateChange}
              autoScrollEnabled={autoScrollEnabled}
              onAutoScrollToggle={onAutoScrollToggle}
              tracksCount={tracks.length}
              onShowTracksDialog={() => dispatch(setAudioPlayerShowTracksDialog(true))}
              onDismiss={onClose ? handleDismiss : undefined}
              trackAnimationClass={trackAnimationClass}
              isMobile={false}
            />
            <div className="flex flex-row items-center gap-2 sm:gap-3">
              <AudioPlayerControls
                isPlaying={isPlaying}
                isLoadingOrChanging={isLoadingOrChanging}
                currentIndex={currentIndex}
                tracksLength={tracks.length}
                onPrevious={handlePrevious}
                onNext={handleNext}
                onSkipBack={handleSkipBack}
                onSkipForward={handleSkipForward}
                onTogglePlayback={handleTogglePlayback}
                isMobile={false}
              />
              <AudioPlayerSpeedControl
                playbackRate={playbackRate}
                onPlaybackRateChange={handlePlaybackRateChange}
                showLabel={true}
              />
              {onAutoScrollToggle && tracks.length > 0 ? (
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
              {tracks.length > 1 ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="rounded-full"
                  onClick={() => dispatch(setAudioPlayerShowTracksDialog(true))}
                  aria-label="Show all tracks"
                  title="Show all tracks"
                >
                  <List className="h-4 w-4" />
                </Button>
              ) : null}
            </div>
          </div>
          {onClose ? (
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full flex-shrink-0"
              onClick={handleDismiss}
              aria-label="Dismiss audio player"
            >
              <X className="h-4 w-4" />
            </Button>
          ) : null}
        </div>

        {/* Progress bar */}
        <AudioPlayerProgress
          currentTime={currentTime}
          duration={duration}
          isScrubbing={isScrubbing}
          scrubTime={scrubTime}
          onScrubChange={handleScrubChange}
          onScrubCommit={handleScrubCommit}
          onScrubPointerDown={handleScrubPointerDown}
          onScrubPointerUp={handleScrubPointerUp}
          currentTrackUrl={currentTrack.url}
        />
      </div>

      {/* Tracks Dialog */}
      <AudioTracksDialog
        open={showTracksDialog}
        onOpenChange={(open) => dispatch(setAudioPlayerShowTracksDialog(open))}
        tracks={tracks}
        currentIndex={currentIndex}
        bookTitle={bookTitle}
        onTrackSelect={handleTrackSelect}
        audioSyncMap={audioSyncMap}
        chapters={chapters}
      />
    </div>
  );
}

// Memoize component to prevent unnecessary re-renders
export const ReaderAudioPlayer = memo(ReaderAudioPlayerComponent, (prevProps, nextProps) => {
  // Only re-render if these critical props change
  return (
    prevProps.bookId === nextProps.bookId &&
    prevProps.tracks === nextProps.tracks &&
    prevProps.bookTitle === nextProps.bookTitle &&
    prevProps.bookAuthor === nextProps.bookAuthor &&
    prevProps.coverUrl === nextProps.coverUrl &&
    prevProps.chromeVisible === nextProps.chromeVisible &&
    prevProps.autoScrollEnabled === nextProps.autoScrollEnabled &&
    prevProps.audioSyncMap === nextProps.audioSyncMap &&
    prevProps.chapters === nextProps.chapters
  );
});
