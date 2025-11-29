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
  sourcePath: string;
  epubData: ArrayBuffer;
  voiceId: VoiceId;
  onProgress?: (progress: ConversionProgress) => void;
  signal?: AbortSignal;
};

/**
 * Convert an EPUB to audiobook format (backend implementation)
 * The backend handles everything: extracts chapters from EPUB, generates audio, and stores the result
 */
export async function convertEpubToAudiobook(
  options: ConversionOptions,
): Promise<void> {
  const { sourcePath, epubData, voiceId, onProgress, signal } = options;
  
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
    // Convert ArrayBuffer to number array for Tauri
    const epubBytes = Array.from(new Uint8Array(epubData));
    
    // Call backend conversion function - backend handles everything
    await invoke("convert_epub_to_audiobook_command", {
      sourcePath,
      epubData: epubBytes,
      voiceId,
    });
  } finally {
    // Clean up event listener
    unlisten();
  }
}
