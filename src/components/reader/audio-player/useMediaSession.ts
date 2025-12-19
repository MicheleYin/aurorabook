import { useEffect, useMemo, useRef } from "react";
import { logger } from "../../../lib/logger";
import type { AudioTrack, AudioSyncMap, Chapter } from "../../../types/reader";
import { findChaptersForAudioTrack, chapterHrefsMatch } from "../../../lib/epub";

const getMediaSessionMetadata = (
  currentTrack: AudioTrack | undefined,
  bookTitle?: string,
  bookAuthor?: string,
  coverUrl?: string,
  audioSyncMap?: AudioSyncMap,
  chapters?: Chapter[]
): { title: string; artist: string; album: string; artwork: MediaImage[] } | null => {
  if (!currentTrack || !bookTitle) {
    return null;
  }

  const chapterHrefs = audioSyncMap
    ? findChaptersForAudioTrack(audioSyncMap, currentTrack.href)
    : [];
  const relatedChapters = chapters
    ? chapters.filter((chapter) => {
        return chapterHrefs.some((chapterHref) =>
          chapterHrefsMatch(chapter.href, chapterHref)
        );
      })
    : [];

  const trackTitle = currentTrack.title || bookTitle;
  let title = trackTitle;
  if (relatedChapters.length > 0) {
    const chapterTitle = relatedChapters[0].title;
    title = `${chapterTitle} - ${trackTitle}`;
  }

  const artist = bookAuthor ? `${bookAuthor} - AuroraBook` : "AuroraBook";
  const album = `${bookTitle} - AuroraBook`;

  const artwork: MediaImage[] = [];
  if (coverUrl) {
    artwork.push({
      src: coverUrl,
      sizes: "512x512",
      type: "image/jpeg",
    });
  }

  return { title, artist, album, artwork };
};

const createMediaSessionHandlers = (
  handleTogglePlayback: () => void,
  handlePrevious: () => void,
  handleNext: () => void,
  handleSkipBack: () => void,
  handleSkipForward: () => void
) => {
  return {
    handlePlay: () => {
      logger.log("[Audio Player] MediaSession play action triggered");
      handleTogglePlayback();
    },
    handlePause: () => {
      logger.log("[Audio Player] MediaSession pause action triggered");
      handleTogglePlayback();
    },
    handlePreviousTrack: () => {
      logger.log("[Audio Player] MediaSession previoustrack action triggered");
      handlePrevious();
    },
    handleNextTrack: () => {
      logger.log("[Audio Player] MediaSession nexttrack action triggered");
      handleNext();
    },
    handleSeekBackward: () => {
      logger.log("[Audio Player] MediaSession seekbackward action triggered");
      handleSkipBack();
    },
    handleSeekForward: () => {
      logger.log("[Audio Player] MediaSession seekforward action triggered");
      handleSkipForward();
    },
  };
};

export function useMediaSession({
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
}: {
  currentTrack?: AudioTrack;
  bookTitle?: string;
  bookAuthor?: string;
  coverUrl?: string;
  audioSyncMap?: AudioSyncMap;
  chapters?: Chapter[];
  handleTogglePlayback: () => void;
  handlePrevious: () => void;
  handleNext: () => void;
  handleSkipBack: () => void;
  handleSkipForward: () => void;
}) {
  const mediaSessionMetadata = useMemo(() => {
    return getMediaSessionMetadata(
      currentTrack,
      bookTitle,
      bookAuthor,
      coverUrl,
      audioSyncMap,
      chapters
    );
  }, [currentTrack, bookTitle, bookAuthor, coverUrl, audioSyncMap, chapters]);

  const mediaSessionHandlers = useMemo(
    () =>
      createMediaSessionHandlers(
        handleTogglePlayback,
        handlePrevious,
        handleNext,
        handleSkipBack,
        handleSkipForward
      ),
    [handleTogglePlayback, handlePrevious, handleNext, handleSkipBack, handleSkipForward]
  );

  const previousMetadataRef = useRef<{ title: string; artist: string; album: string } | null>(
    null
  );

  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) {
      return;
    }

    const mediaSession = navigator.mediaSession;

    if (!mediaSessionMetadata) {
      if (previousMetadataRef.current) {
        try {
          mediaSession.metadata = null;
          previousMetadataRef.current = null;
        } catch {
          // Ignore errors when clearing metadata
        }
      }
      return;
    }

    const currentMetadata = {
      title: mediaSessionMetadata.title,
      artist: mediaSessionMetadata.artist,
      album: mediaSessionMetadata.album,
    };

    const previousMetadata = previousMetadataRef.current;
    const metadataChanged =
      !previousMetadata ||
      previousMetadata.title !== currentMetadata.title ||
      previousMetadata.artist !== currentMetadata.artist ||
      previousMetadata.album !== currentMetadata.album;

    if (metadataChanged) {
      try {
        mediaSession.metadata = new MediaMetadata(mediaSessionMetadata);
        previousMetadataRef.current = currentMetadata;

        logger.log("[Audio Player] MediaSession metadata updated", {
          title: mediaSessionMetadata.title,
          artist: mediaSessionMetadata.artist,
          album: mediaSessionMetadata.album,
          hasArtwork: mediaSessionMetadata.artwork.length > 0,
        });
      } catch (error) {
        logger.warn("[Audio Player] Failed to set MediaSession metadata", error);
      }
    }

    mediaSession.setActionHandler("play", mediaSessionHandlers.handlePlay);
    mediaSession.setActionHandler("pause", mediaSessionHandlers.handlePause);
    mediaSession.setActionHandler("previoustrack", mediaSessionHandlers.handlePreviousTrack);
    mediaSession.setActionHandler("nexttrack", mediaSessionHandlers.handleNextTrack);
    mediaSession.setActionHandler("seekbackward", mediaSessionHandlers.handleSeekBackward);
    mediaSession.setActionHandler("seekforward", mediaSessionHandlers.handleSeekForward);

    return () => {
      try {
        mediaSession.setActionHandler("play", null);
        mediaSession.setActionHandler("pause", null);
        mediaSession.setActionHandler("previoustrack", null);
        mediaSession.setActionHandler("nexttrack", null);
        mediaSession.setActionHandler("seekbackward", null);
        mediaSession.setActionHandler("seekforward", null);
      } catch {
        // Ignore errors when clearing handlers
      }
    };
  }, [mediaSessionMetadata, mediaSessionHandlers]);
}

