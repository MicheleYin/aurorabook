import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";

import { normalizeVoiceId } from "../constants/kokoro";
import { normalizeAppLanguage, normalizeTtsLanguage } from "../constants/languages";
import type { AppSettings, TtsSynthesisQuality } from "../types/settings";
import type { UITheme } from "../types/ui";
import { logger } from "../lib/logger";

export interface SettingsContextType {
  settings: AppSettings | null;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  saveSettings: (updates: Partial<AppSettings>) => Promise<void>;
  reloadSettings: () => Promise<void>;
  applyTheme: (theme: UITheme) => void;
}

export const SettingsContext = createContext<SettingsContextType | undefined>(
  undefined
);

export function useSettingsContext() {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error("useSettingsContext must be used within SettingsProvider");
  }
  return context;
}

interface SettingsProviderProps {
  readonly children: ReactNode;
}

function normalizeTtsSynthesisQuality(value: unknown): TtsSynthesisQuality {
  if (value === "fastest" || value === "balanced" || value === "quality") {
    return value;
  }
  return "balanced";
}

export function SettingsProvider({ children }: SettingsProviderProps) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasAppliedThemeRef = useRef(false);

  // Apply theme to document
  const applyTheme = useCallback((newTheme: UITheme) => {
    const root = document.documentElement;

    if (newTheme === "system") {
      const systemTheme = window.matchMedia("(prefers-color-scheme: dark)")
        .matches
        ? "dark"
        : "light";
      root.classList.remove("light", "dark");
      root.classList.add(systemTheme);
    } else {
      root.classList.remove("light", "dark");
      root.classList.add(newTheme);
    }
  }, []);

  // Load settings from backend
  const loadSettings = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const appSettings = await invoke<AppSettings>("get_app_settings");
      setSettings({
        ...appSettings,
        language: normalizeAppLanguage(appSettings.language),
        ttsLanguage: normalizeTtsLanguage(appSettings.ttsLanguage),
        ttsVoiceId: normalizeVoiceId(appSettings.ttsVoiceId),
        ttsSynthesisQuality: normalizeTtsSynthesisQuality(
          appSettings.ttsSynthesisQuality
        ),
      });

      // Apply theme from backend settings (only once on initial load)
      if (!hasAppliedThemeRef.current && appSettings.theme) {
        applyTheme(appSettings.theme as UITheme);
        hasAppliedThemeRef.current = true;
      }
    } catch (err) {
      logger.error("Failed to load settings:", err);
      setError(err instanceof Error ? err.message : "Failed to load settings");
      // Fallback to default settings
      const defaultSettings: AppSettings = {
        theme: "system",
        language: "en",
        ttsLanguage: "en",
        ttsVoiceId: "F1",
        ttsSynthesisQuality: "balanced",
        autoScrollEnabled: true,
        audioPlaybackSpeed: 1.0,
      };
      setSettings(defaultSettings);

      // Apply default theme
      if (!hasAppliedThemeRef.current) {
        applyTheme("system");
        hasAppliedThemeRef.current = true;
      }
    } finally {
      setIsLoading(false);
    }
  }, [applyTheme]);

  // Load settings on mount
  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // Listen for system theme changes when theme is set to "system"
  useEffect(() => {
    if (!settings || settings.theme !== "system") {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    
    const handleSystemThemeChange = () => {
      applyTheme("system");
    };

    // Modern browsers support addEventListener
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", handleSystemThemeChange);
      return () => {
        mediaQuery.removeEventListener("change", handleSystemThemeChange);
      };
    } else {
      // Fallback for older browsers
      mediaQuery.addListener(handleSystemThemeChange);
      return () => {
        mediaQuery.removeListener(handleSystemThemeChange);
      };
    }
  }, [settings, applyTheme]);

  // Save settings to backend
  const saveSettings = useCallback(
    async (updates: Partial<AppSettings>) => {
      if (!settings) return;

      try {
        setIsSaving(true);
        setError(null);
        const updatedSettings: AppSettings = { ...settings, ...updates };
        const savedSettings = await invoke<AppSettings>("update_app_settings", {
          settings: updatedSettings,
        });
        setSettings(savedSettings);

        // Apply theme if it changed
        if (updates.theme) {
          applyTheme(updates.theme as UITheme);
        }

        // Handle language change if needed (e.g., refresh translations)
        if (updates.language) {
          // You might want to call changeLanguage from useTranslation here
          // but that's a bit circular. Better to let the app respond to settings change.
        }
      } catch (err) {
        logger.error("Failed to save settings:", err);
        setError(
          err instanceof Error ? err.message : "Failed to save settings"
        );
      } finally {
        setIsSaving(false);
      }
    },
    [settings, applyTheme]
  );

  // Reload settings from backend
  const reloadSettings = useCallback(async () => {
    await loadSettings();
  }, [loadSettings]);

  const contextValue = useMemo(
    () => ({
      settings,
      isLoading,
      isSaving,
      error,
      saveSettings,
      reloadSettings,
      applyTheme,
    }),
    [
      settings,
      isLoading,
      isSaving,
      error,
      saveSettings,
      reloadSettings,
      applyTheme,
    ]
  );

  return (
    <SettingsContext.Provider value={contextValue}>
      {children}
    </SettingsContext.Provider>
  );
}
