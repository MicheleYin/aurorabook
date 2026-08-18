import type { AudioTrack, Book } from "../types/book";

export function audioTrackChapterIndex(
  track: Pick<AudioTrack, "href" | "filePath" | "order">,
  book: Pick<Book, "chapters" | "audioSyncMap">
): number | null {
  const trackHref = track.href || track.filePath;
  const segments = book.audioSyncMap?.segments;
  if (trackHref && segments?.length) {
    const matchingSegment = segments.find(
      (segment) => segment.audioTrackHref === trackHref
    );
    if (matchingSegment) {
      const chapterIndex = book.chapters.findIndex(
        (chapter) => chapter.href === matchingSegment.chapterHref
      );
      if (chapterIndex >= 0) {
        return chapterIndex;
      }
    }
  }

  if (
    Number.isInteger(track.order) &&
    track.order >= 0 &&
    track.order < book.chapters.length
  ) {
    return track.order;
  }

  return null;
}

export function completedAudioChapterIndices(
  book: Pick<
    Book,
    "chapters" | "audioTracks" | "audioSyncMap" | "completedChapters"
  >
): Set<number> {
  const indices = new Set<number>();

  for (const track of book.audioTracks ?? []) {
    const chapterIndex = audioTrackChapterIndex(track, book);
    if (chapterIndex !== null) {
      indices.add(chapterIndex);
    }
  }

  for (const [index, chapter] of (book.chapters ?? []).entries()) {
    if ((book.completedChapters ?? []).includes(chapter.href)) {
      indices.add(index);
    }
  }

  return indices;
}

/**
 * The live or paused chapter that still has generated audio not stored as a
 * completed track. Conversion is sequential, so this is the first incomplete
 * chapter — or the backend's converting chapter when that is still unfinished.
 */
export function resolveUnfinishedChapterIndex(
  book: Pick<
    Book,
    "chapters" | "audioTracks" | "audioSyncMap" | "completedChapters"
  >,
  convertingChapterIndex: number | null
): number | null {
  const completed = completedAudioChapterIndices(book);
  const firstMissingChapter = book.chapters.findIndex(
    (_, index) => !completed.has(index)
  );

  if (
    convertingChapterIndex !== null &&
    convertingChapterIndex >= 0 &&
    convertingChapterIndex < book.chapters.length
  ) {
    if (completed.has(convertingChapterIndex)) {
      return firstMissingChapter >= 0 ? firstMissingChapter : null;
    }
    return convertingChapterIndex;
  }

  return firstMissingChapter >= 0 ? firstMissingChapter : null;
}

export function sumAudioTrackDurationSeconds(
  tracks: Array<{ duration?: number }> | undefined
): number {
  if (!tracks?.length) {
    return 0;
  }

  return tracks.reduce((total, track) => {
    const duration = track.duration;
    if (
      typeof duration !== "number" ||
      !Number.isFinite(duration) ||
      duration <= 0
    ) {
      return total;
    }
    return total + duration;
  }, 0);
}

export function totalBookAudioDurationSeconds(
  completedTracksDurationSeconds: number,
  unfinishedChapterDurationSeconds: number | null | undefined
): number {
  const completed =
    Number.isFinite(completedTracksDurationSeconds) &&
    completedTracksDurationSeconds > 0
      ? completedTracksDurationSeconds
      : 0;
  const unfinished =
    typeof unfinishedChapterDurationSeconds === "number" &&
    Number.isFinite(unfinishedChapterDurationSeconds) &&
    unfinishedChapterDurationSeconds > 0
      ? unfinishedChapterDurationSeconds
      : 0;
  return completed + unfinished;
}
