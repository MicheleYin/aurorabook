import type { AppLanguageCode } from "../constants/languages";

/** UI locales with translation files under `src/locales/` (31 Supertonic languages). */
export type AppLocaleCode = AppLanguageCode;

/** Supertonic synthesis steps: 5 / 10 / 20 — maps to backend `tts_synthesis_quality`. */
export type TtsSynthesisQuality = "fastest" | "balanced" | "quality";

export interface AppSettings {
  theme: string; // "light" | "dark" | "system"
  language: string;
  ttsVoiceId: string;
  ttsLanguage: string;
  ttsSynthesisQuality?: TtsSynthesisQuality;
  autoScrollEnabled?: boolean;
  audioPlaybackSpeed?: number;
}
