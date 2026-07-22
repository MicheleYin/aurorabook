/** Matches `AVAILABLE_LANGS` in `koko/kokoros` / `supertonic/rust` helper. */
export type AppLocaleCode = "en" | "ko" | "es" | "pt" | "fr";

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
