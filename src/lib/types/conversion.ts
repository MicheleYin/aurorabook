export type ConversionProgress = {
  currentChapter: number;
  totalChapters: number;
  wordsProcessed: number;
  totalWords: number;
  wordsInCurrentChapter: number;
  currentStep: "initializing" | "generating-audio" | "converting-audio" | "creating-smil" | "saving-epub" | "skipping" | "completed" | "complete";
  message: string;
};

