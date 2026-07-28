import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { locale } from "@tauri-apps/plugin-os";

import {
  AVAILABLE_LANGS,
  type AppLanguageCode,
  normalizeAppLanguage,
} from "../constants/languages";

/** App UI locale — same 30-language set as Supertonic TTS. */
export type Language = AppLanguageCode;

type Translations = Record<string, string>;

const localeModules = import.meta.glob<{ default: Translations }>("../locales/*.json");

const translations = Object.fromEntries(
  AVAILABLE_LANGS.map((code) => [code, {} as Translations])
) as Record<Language, Translations>;

let currentLanguage: Language = "en";
const listeners: ((lang: Language) => void)[] = [];

/**
 * Maps a BCP-47 locale string to one of our supported Languages.
 * @param tag The locale tag (e.g., "en-US", "zh-CN", "es-ES")
 */
export function mapLocaleToLanguage(tag: string | null): Language | null {
  if (!tag) return null;

  const base = tag.split("-")[0].toLowerCase();
  if ((AVAILABLE_LANGS as readonly string[]).includes(base)) {
    return base as Language;
  }

  return null;
}

export function useTranslation() {
  const [lang, setLang] = useState<Language>(currentLanguage);
  const [loading, setLoading] = useState(
    Object.keys(translations[currentLanguage] ?? {}).length === 0
  );

  useEffect(() => {
    const listener = (newLang: Language) => {
      setLang(newLang);
    };
    listeners.push(listener);

    // Load translations if not already loaded
    if (Object.keys(translations[lang] ?? {}).length === 0) {
      loadTranslations(lang).then(() => setLoading(false));
    } else {
      setLoading(false);
    }

    return () => {
      const index = listeners.indexOf(listener);
      if (index > -1) listeners.splice(index, 1);
    };
  }, [lang]);

  const t = useCallback((key: string, variables?: Record<string, string | number>) => {
    let text = translations[lang]?.[key] || translations.en?.[key] || key;
    if (variables) {
      Object.entries(variables).forEach(([name, value]) => {
        text = text.replace(`{{${name}}}`, String(value));
      });
    }
    return text;
  }, [lang]);

  const changeLanguage = useCallback(async (newLang: Language) => {
    if (Object.keys(translations[newLang] ?? {}).length === 0) {
      await loadTranslations(newLang);
    }
    currentLanguage = newLang;
    listeners.forEach((l) => l(newLang));
  }, []);

  return { t, lang, changeLanguage, loading };
}

async function loadTranslations(
  lang: Language,
  modules: typeof localeModules = localeModules
) {
  try {
    const path = `../locales/${lang}.json`;
    const loader = modules[path];
    if (!loader) {
      console.error(`No locale module for ${lang}`);
      return;
    }
    const data = await loader();
    translations[lang] = data.default;
  } catch (err) {
    console.error(`Failed to load translations for ${lang}:`, err);
  }
}

/** @internal Exported for unit tests that need to force loader failures. */
export async function loadTranslationsWithModules(
  lang: Language,
  modules: typeof localeModules
) {
  await loadTranslations(lang, modules);
}

/** Ensure English is available as fallback for missing keys in other locales. */
async function ensureEnglishFallback() {
  if (Object.keys(translations.en).length === 0) {
    await loadTranslations("en");
  }
}

// Initial language load with tiered detection
export async function initI18n() {
  try {
    await ensureEnglishFallback();

    // 1. Try to load from user settings (persistence has highest priority)
    const settings = await invoke<{ language?: string }>("get_app_settings");
    if (settings?.language) {
      currentLanguage = normalizeAppLanguage(settings.language);
      await loadTranslations(currentLanguage);
      return;
    }

    // 2. Try to detect system locale via Tauri OS plugin
    try {
      const sysLocale = await locale();
      const detectedLang = mapLocaleToLanguage(sysLocale);
      if (detectedLang) {
        currentLanguage = detectedLang;
        await loadTranslations(currentLanguage);
        return;
      }
    } catch (osErr) {
      console.warn("Failed to detect system locale via OS plugin:", osErr);
    }

    // 3. Fallback to browser/navigator language
    const browserLang = mapLocaleToLanguage(navigator.language);
    if (browserLang) {
      currentLanguage = browserLang;
    } else {
      // 4. Ultimate fallback to English
      currentLanguage = "en";
    }

    await loadTranslations(currentLanguage);
  } catch (err) {
    console.error("Failed to initialize i18n:", err);
    currentLanguage = "en";
    await loadTranslations("en");
  }
}
