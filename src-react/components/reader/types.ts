import type { Book, Chapter, ReaderPreferences } from "../../types/reader";

export type ChapterSelectionOptions = {
  fragment?: string;
  preserveChrome?: boolean;
  scrollPosition?: "top" | "bottom" | "maintain";
  isManualSelection?: boolean; // Set to true when user manually selects chapter (e.g., from TOC)
};

export type ChapterProgressSnapshot = {
  chapterId: string;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  percent: number;
  activeElementId: string | null;
  activeElementIndex: number | null;
};

export type AudioProgressSnapshot = {
  trackId: string;
  trackHref: string;
  trackIndex: number;
  currentTimeSeconds: number;
  updatedAt: string;
};

export type ReaderPanelBaseProps = {
  activeBook?: Book;
  activeChapter?: Chapter;
  preferences: ReaderPreferences;
  onPreferencesChange: (update: Partial<ReaderPreferences>) => void;
  onSelectChapter: (chapterId: string, options?: ChapterSelectionOptions) => void;
  onNavigateLibrary?: () => void;
  onChapterProgress?: (bookId: string, snapshot: ChapterProgressSnapshot) => void;
};
