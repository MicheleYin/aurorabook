/**
 * UI and TTS language codes supported by the app.
 * Must stay in sync with `AVAILABLE_LANGS` in `koko/kokoros/src/supertonic_core.rs`
 * and `supertonic/rust/src/helper.rs`.
 */
export const AVAILABLE_LANGS = ["en", "ko", "es", "pt", "fr"] as const;
export type AppLanguageCode = (typeof AVAILABLE_LANGS)[number];

export function isAppLanguageCode(raw: string): raw is AppLanguageCode {
  return (AVAILABLE_LANGS as readonly string[]).includes(raw);
}

/** Normalize stored settings / locale detection to a supported UI/TTS code. */
export function normalizeAppLanguage(raw: string | undefined | null): AppLanguageCode {
  if (raw && isAppLanguageCode(raw)) return raw;
  return "en";
}

/** Voices that apply to every Supertonic TTS language use this tag (see `constants/kokoro.ts`). */
export const MULTILINGUAL_VOICE_TAG = "mul";

export function voiceMatchesTtsLanguage(
  languageTag: string,
  ttsLang: string
): boolean {
  if (languageTag === MULTILINGUAL_VOICE_TAG) return true;
  return languageTag.toLowerCase().startsWith(ttsLang.toLowerCase());
}

/** Locale string for `humanize-duration` (ETA strings). */
export function humanizeDurationLocale(lang: string): string {
  const m: Record<string, string> = {
    en: "en",
    ko: "ko",
    es: "es",
    pt: "pt",
    fr: "fr",
  };
  return m[lang] ?? "en";
}
