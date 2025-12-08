import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { VoiceId } from "../types/reader";

export type ConversionProgress = {
  currentChapter: number;
  totalChapters: number;
  wordsProcessed: number;
  totalWords: number;
  wordsInCurrentChapter: number;
  currentStep: "initializing" | "generating-audio" | "merging-audio" | "creating-smil" | "updating-epub" | "complete";
  message: string;
};

type ConversionOptions = {
  bookId: string;
  voiceId: VoiceId;
  onProgress?: (progress: ConversionProgress) => void;
  signal?: AbortSignal;
};

import type { Book } from "../types/reader";

/**
 * Convert an EPUB to audiobook format (backend implementation)
 * The backend handles everything: loads EPUB from database, extracts chapters, generates audio, and stores the result
 * Returns the updated Book with audio tracks if found in library, or null if not found
 */
export async function convertEpubToAudiobook(
  options: ConversionOptions,
): Promise<Book | null> {
  const { bookId, voiceId, onProgress, signal } = options;
  
  // Check for cancellation before starting
  if (signal?.aborted) {
    throw new Error("Conversion cancelled");
  }
  
  // Emit immediate progress update for responsive UI
  onProgress?.({
    currentChapter: 0,
    totalChapters: 0,
    wordsProcessed: 0,
    totalWords: 0,
    wordsInCurrentChapter: 0,
    currentStep: "initializing",
    message: "Starting conversion...",
  });
  
  // Set up event listener for progress updates
  const unlisten = await listen<any>("conversion-progress", (event) => {
    // Check for cancellation on each progress update
    if (signal?.aborted) {
      return;
    }
    
    // Convert snake_case to camelCase if needed (Tauri should handle this, but just in case)
    const payload = event.payload;
    const progress: ConversionProgress = {
      currentChapter: payload.currentChapter ?? payload.current_chapter ?? 0,
      totalChapters: payload.totalChapters ?? payload.total_chapters ?? 0,
      wordsProcessed: payload.wordsProcessed ?? payload.words_processed ?? 0,
      totalWords: payload.totalWords ?? payload.total_words ?? 0,
      wordsInCurrentChapter: payload.wordsInCurrentChapter ?? payload.words_in_current_chapter ?? 0,
      currentStep: payload.currentStep ?? payload.current_step ?? "initializing",
      message: payload.message ?? "",
    };
    onProgress?.(progress);
  });
  
  try {
    // Check for cancellation before invoking
    if (signal?.aborted) {
      throw new Error("Conversion cancelled");
    }
    
    // Set up abort listener to throw error immediately when cancelled
    let abortHandler: (() => void) | null = null;
    if (signal) {
      abortHandler = () => {
        // Signal is aborted, the invoke will be rejected
      };
      signal.addEventListener('abort', abortHandler);
    }
    
    try {
      // Call backend conversion function - backend loads EPUB from database and handles everything
      const updatedBook = await invoke<Book | null>("convert_epub_to_audiobook_command", {
        bookId,
        voiceId,
      });
      
      // Check one more time after invoke completes
      if (signal?.aborted) {
        throw new Error("Conversion cancelled");
      }
      
      return updatedBook;
    } catch (error) {
      // If aborted, throw cancellation error
      if (signal?.aborted) {
        throw new Error("Conversion cancelled");
      }
      throw error;
    } finally {
      // Clean up abort listener
      if (signal && abortHandler) {
        signal.removeEventListener('abort', abortHandler);
      }
    }
  } finally {
    // Clean up event listener
    unlisten();
  }
}
