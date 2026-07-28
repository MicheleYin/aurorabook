/**
 * App UI locales and Supertonic 3 TTS codes share the same 31-language set.
 * Must stay in sync with `AVAILABLE_LANGS` in `src-tauri/src/tts/supertonic/core.rs`
 * and translation files under `src/locales/`.
 */
export const AVAILABLE_LANGS = [
  "en",
  "ko",
  "ja",
  "ar",
  "bg",
  "cs",
  "da",
  "de",
  "el",
  "es",
  "et",
  "fi",
  "fr",
  "hi",
  "hr",
  "hu",
  "id",
  "it",
  "lt",
  "lv",
  "nl",
  "pl",
  "pt",
  "ro",
  "ru",
  "sk",
  "sl",
  "sv",
  "tr",
  "uk",
  "vi",
] as const;

/** @deprecated Prefer AVAILABLE_LANGS — UI and TTS now share the same codes. */
export const UI_LANGS = AVAILABLE_LANGS;

export type AppLanguageCode = (typeof AVAILABLE_LANGS)[number];
export type TtsLanguageCode = AppLanguageCode;

export function isAppLanguageCode(raw: string): raw is AppLanguageCode {
  return (AVAILABLE_LANGS as readonly string[]).includes(raw);
}

export function isTtsLanguageCode(raw: string): raw is TtsLanguageCode {
  return isAppLanguageCode(raw);
}

/** Normalize stored UI locale / detection to a supported code. */
export function normalizeAppLanguage(raw: string | undefined | null): AppLanguageCode {
  if (!raw) return "en";
  const base = raw.split(/[-_]/)[0]!.toLowerCase();
  if (isAppLanguageCode(base)) return base;
  return "en";
}

/** Normalize stored TTS language to a supported Supertonic 3 code. */
export function normalizeTtsLanguage(raw: string | undefined | null): TtsLanguageCode {
  return normalizeAppLanguage(raw);
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

/**
 * Locale string for `humanize-duration` (ETA strings; driven by UI locale).
 * Codes without a dedicated humanize-duration locale fall back to English.
 */
export function humanizeDurationLocale(lang: string): string {
  const supported = new Set([
    "ar",
    "bg",
    "cs",
    "da",
    "de",
    "el",
    "en",
    "es",
    "fi",
    "fr",
    "hr",
    "hu",
    "id",
    "it",
    "ja",
    "ko",
    "lt",
    "lv",
    "nl",
    "pl",
    "pt",
    "ro",
    "ru",
    "sk",
    "sl",
    "sv",
    "tr",
    "uk",
    "vi",
  ]);
  return supported.has(lang) ? lang : "en";
}

/** Native endonyms for the language picker (same in every locale file). */
export const UI_LANG_ENDONYMS: Record<AppLanguageCode, string> = {
  en: "English",
  ko: "한국어",
  ja: "日本語",
  ar: "العربية",
  bg: "Български",
  cs: "Čeština",
  da: "Dansk",
  de: "Deutsch",
  el: "Ελληνικά",
  es: "Español",
  et: "Eesti",
  fi: "Suomi",
  fr: "Français",
  hi: "हिन्दी",
  hr: "Hrvatski",
  hu: "Magyar",
  id: "Bahasa Indonesia",
  it: "Italiano",
  lt: "Lietuvių",
  lv: "Latviešu",
  nl: "Nederlands",
  pl: "Polski",
  pt: "Português",
  ro: "Română",
  ru: "Русский",
  sk: "Slovenčina",
  sl: "Slovenščina",
  sv: "Svenska",
  tr: "Türkçe",
  uk: "Українська",
  vi: "Tiếng Việt",
};
