import type { VoiceId } from "../types/reader";
import type { Chapter } from "../types/reader";

export type ConversionState = {
  bookId: string;
  voiceId: VoiceId;
  sourcePath: string;
  chapters: Chapter[];
  completedChapters: number[]; // Array of chapter indices that are completed
  lastUpdated: number;
  isPaused: boolean;
};

const CONVERSION_STATE_PREFIX = "conversion-state:";

/**
 * Save conversion state to localStorage
 */
export function saveConversionState(state: ConversionState): void {
  try {
    const key = `${CONVERSION_STATE_PREFIX}${state.bookId}`;
    localStorage.setItem(key, JSON.stringify(state));
    console.debug("[ConversionState] Saved conversion state", {
      bookId: state.bookId,
      completedChapters: state.completedChapters.length,
      totalChapters: state.chapters.length,
    });
  } catch (error) {
    console.warn("[ConversionState] Failed to save conversion state:", error);
  }
}

/**
 * Load conversion state from localStorage
 */
export function loadConversionState(bookId: string): ConversionState | null {
  try {
    const key = `${CONVERSION_STATE_PREFIX}${bookId}`;
    const stored = localStorage.getItem(key);
    if (!stored) return null;
    const state = JSON.parse(stored) as ConversionState;
    console.debug("[ConversionState] Loaded conversion state", {
      bookId: state.bookId,
      completedChapters: state.completedChapters.length,
      totalChapters: state.chapters.length,
      isPaused: state.isPaused,
    });
    return state;
  } catch (error) {
    console.warn("[ConversionState] Failed to load conversion state:", error);
    return null;
  }
}

/**
 * Clear conversion state
 */
export function clearConversionState(bookId: string): void {
  try {
    const key = `${CONVERSION_STATE_PREFIX}${bookId}`;
    localStorage.removeItem(key);
    console.debug("[ConversionState] Cleared conversion state", { bookId });
  } catch (error) {
    console.warn("[ConversionState] Failed to clear conversion state:", error);
  }
}

/**
 * Mark a chapter as completed in the conversion state
 */
export function markChapterCompleted(bookId: string, chapterIndex: number): void {
  const state = loadConversionState(bookId);
  if (!state) return;
  
  if (!state.completedChapters.includes(chapterIndex)) {
    state.completedChapters.push(chapterIndex);
    state.lastUpdated = Date.now();
    saveConversionState(state);
  }
}

/**
 * Update conversion state to mark as paused
 */
export function pauseConversionState(bookId: string): void {
  const state = loadConversionState(bookId);
  if (!state) return;
  
  state.isPaused = true;
  state.lastUpdated = Date.now();
  saveConversionState(state);
}

/**
 * Update conversion state to mark as resumed
 */
export function resumeConversionState(bookId: string): void {
  const state = loadConversionState(bookId);
  if (!state) return;
  
  state.isPaused = false;
  state.lastUpdated = Date.now();
  saveConversionState(state);
}

