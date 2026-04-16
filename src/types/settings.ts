/** Matches `AVAILABLE_LANGS` in `koko/kokoros` / `supertonic/rust` helper. */
export type AppLocaleCode = "en" | "ko" | "es" | "pt" | "fr";

export interface AppSettings {
  theme: string; // "light" | "dark" | "system"
  language: string;
  ttsVoiceId: string;
  ttsLanguage: string;
  autoScrollEnabled?: boolean;
  audioPlaybackSpeed?: number;
}
