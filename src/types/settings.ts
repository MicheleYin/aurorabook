import type { AppLanguageCode } from "../constants/languages";

/** UI locales with translation files under `src/locales/` (31 Supertonic languages). */
export type AppLocaleCode = AppLanguageCode;

/** Supertonic synthesis steps: 5 / 10 / 20 — maps to backend `tts_synthesis_quality`. */
export type TtsSynthesisQuality = "fastest" | "balanced" | "quality";

/** Main app pages persisted across launches. */
export type AppTab = "library" | "reader" | "settings";

/** Library layout preference. */
export type LibraryViewMode = "grid" | "list";

export interface AppSettings {
  theme: string; // "light" | "cream" | "dark" | "pitch" | "system"
  language: string;
  ttsVoiceId: string;
  ttsLanguage: string;
  ttsSynthesisQuality?: TtsSynthesisQuality;
  autoScrollEnabled?: boolean;
  audioPlaybackSpeed?: number;
  /** Kindle-style resume: last book opened in the reader. */
  lastOpenedBookId?: string | null;
  /** Last visible page: library | reader | settings. */
  currentTab?: AppTab | string;
  /** Library grid/list preference. */
  libraryViewMode?: LibraryViewMode | string;
  /** Floating audio player minimized chrome. */
  audioPlayerMinimized?: boolean;
  /** Reader header visible (`false` = immersive). */
  readerHeaderVisible?: boolean;
}
