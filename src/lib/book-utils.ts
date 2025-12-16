import type { Book } from "../types/reader";

/**
 * Merges audio-related fields from an updated book into the current book.
 * Preserves all other state including loaded chapters, audio playback state, etc.
 * 
 * @param currentBook - The existing book in the library
 * @param updatedBook - The updated book from the backend
 * @returns A new book with audio fields merged
 */
export function mergeBookAudioFields(
  currentBook: Book,
  updatedBook: Book
): Book {
  return {
    ...currentBook,
    chapters: updatedBook.chapters,
    fileSizeBytes: updatedBook.fileSizeBytes,
    audioTracks: updatedBook.audioTracks,
    audioSyncMap: updatedBook.audioSyncMap,
    conversionStatus: updatedBook.conversionStatus,
    completedChapters: updatedBook.completedChapters,
    voiceId: updatedBook.voiceId,
    // Include optional fields that may be present
    totalWords: updatedBook.totalWords,
    wordsProcessed: updatedBook.wordsProcessed,
  };
}

