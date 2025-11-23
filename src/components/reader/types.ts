import type { Book, Chapter, ReaderPreferences } from "../../types/reader";

export type ReaderPanelBaseProps = {
  activeBook?: Book;
  activeChapter?: Chapter;
  preferences: ReaderPreferences;
  onPreferencesChange: (update: Partial<ReaderPreferences>) => void;
  onSelectChapter: (chapterId: string, fragment?: string) => void;
  pendingFragment: string | null;
  onFragmentConsumed: () => void;
};
