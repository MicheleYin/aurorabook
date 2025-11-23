import type { Book, Chapter, ReaderPreferences } from "../../types/reader";

export type ChapterSelectionOptions = {
  fragment?: string;
  preserveChrome?: boolean;
  scrollPosition?: "top" | "bottom" | "maintain";
};

export type ChapterProgressSnapshot = {
  chapterId: string;
  pageIndex: number;
  pageCount: number;
  percent: number;
};

export type ReaderPanelBaseProps = {
  activeBook?: Book;
  activeChapter?: Chapter;
  preferences: ReaderPreferences;
  onPreferencesChange: (update: Partial<ReaderPreferences>) => void;
  onSelectChapter: (chapterId: string, options?: ChapterSelectionOptions) => void;
  pendingFragment: string | null;
  onFragmentConsumed: () => void;
  onNavigateLibrary?: () => void;
  onChapterProgress?: (bookId: string, snapshot: ChapterProgressSnapshot) => void;
};
