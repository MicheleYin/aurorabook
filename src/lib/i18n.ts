import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { locale } from "@tauri-apps/plugin-os";

// Supported languages
export type Language = "en" | "es" | "it" | "zh";

// Simple translation store
type Translations = Record<string, string>;

const translations: Record<Language, Translations> = {
  en: {},
  es: {},
  it: {},
  zh: {},
};

// Default language
let currentLanguage: Language = "en";
const listeners: ((lang: Language) => void)[] = [];

/**
 * Maps a BCP-47 locale string to one of our supported Languages.
 * @param tag The locale tag (e.g., "en-US", "zh-CN", "es-ES")
 */
function mapLocaleToLanguage(tag: string | null): Language | null {
  if (!tag) return null;
  
  const base = tag.split("-")[0].toLowerCase();
  if (base === "en") return "en";
  if (base === "es") return "es";
  if (base === "it") return "it";
  if (base === "zh") return "zh";
  
  return null;
}

export function useTranslation() {
  const [lang, setLang] = useState<Language>(currentLanguage);
  const [loading, setLoading] = useState(Object.keys(translations[currentLanguage]).length === 0);

  useEffect(() => {
    const listener = (newLang: Language) => {
      setLang(newLang);
    };
    listeners.push(listener);
    
    // Load translations if not already loaded
    if (Object.keys(translations[lang]).length === 0) {
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
    let text = translations[lang][key] || key;
    if (variables) {
      Object.entries(variables).forEach(([name, value]) => {
        text = text.replace(`{{${name}}}`, String(value));
      });
    }
    return text;
  }, [lang]);

  const changeLanguage = useCallback(async (newLang: Language) => {
    if (Object.keys(translations[newLang]).length === 0) {
      await loadTranslations(newLang);
    }
    currentLanguage = newLang;
    listeners.forEach(l => l(newLang));
  }, []);

  return { t, lang, changeLanguage, loading };
}

async function loadTranslations(lang: Language) {
  try {
    // In a real app, we might fetch these or import them
    // For simplicity, we'll import them dynamically
    const data = await import(`../locales/${lang}.json`);
    translations[lang] = data.default;
  } catch (err) {
    console.error(`Failed to load translations for ${lang}:`, err);
  }
}

// Initial language load with tiered detection
export async function initI18n() {
  try {
    // 1. Try to load from user settings (persistence has highest priority)
    const settings = await invoke<any>("get_app_settings");
    if (settings && settings.language) {
      currentLanguage = settings.language as Language;
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
