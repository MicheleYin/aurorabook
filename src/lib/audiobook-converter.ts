import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { VoiceId } from "../types/reader";
import type { Chapter } from "../types/reader";

export type ConversionProgress = {
  currentChapter: number;
  totalChapters: number;
  currentStep: "initializing" | "generating-audio" | "merging-audio" | "creating-smil" | "updating-epub" | "complete";
  message: string;
};

type ConversionOptions = {
  voiceId: VoiceId;
  onProgress?: (progress: ConversionProgress) => void;
  signal?: AbortSignal;
};

/**
 * Convert an EPUB to audiobook format (backend implementation)
 */
export async function convertEpubToAudiobook(
  epubBuffer: ArrayBuffer,
  chapters: Chapter[],
  options: ConversionOptions,
): Promise<ArrayBuffer> {
  const { voiceId, onProgress, signal } = options;
  
  // Check for cancellation before starting
  if (signal?.aborted) {
    throw new Error("Conversion cancelled");
  }
  
  // Set up event listener for progress updates
  const unlisten = await listen<any>("conversion-progress", (event) => {
    // Convert snake_case to camelCase if needed (Tauri should handle this, but just in case)
    const payload = event.payload;
    const progress: ConversionProgress = {
      currentChapter: payload.currentChapter ?? payload.current_chapter ?? 0,
      totalChapters: payload.totalChapters ?? payload.total_chapters ?? 0,
      currentStep: payload.currentStep ?? payload.current_step ?? "initializing",
      message: payload.message ?? "",
    };
    onProgress?.(progress);
  });
  
  try {
    // Convert ArrayBuffer to Vec<u8> for Rust
    const epubData = Array.from(new Uint8Array(epubBuffer));
    
    // Convert chapters to Rust format
    const rustChapters = chapters.map(ch => ({
      id: ch.id,
      title: ch.title,
      href: ch.href,
      content_html: ch.contentHtml,
    }));
    
    // Call backend conversion function
    const result = await invoke<number[]>("convert_epub_to_audiobook", {
      epubData,
      options: {
        voice_id: voiceId,  // Rust expects snake_case
        chapters: rustChapters,
      },
    });
    
    // Convert result back to ArrayBuffer
    return new Uint8Array(result).buffer;
  } finally {
    // Clean up event listener
    unlisten();
  }
}
