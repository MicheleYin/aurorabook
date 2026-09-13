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
import type { AppSettings } from "../types/settings";
import type { UITheme } from "../types/ui";
import { logger } from "../lib/logger";
import {
  normalizeAppTab,
  normalizeLibraryViewMode,
  normalizeOptionalBookId,
  normalizeTtsSynthesisQuality,
} from "../lib/settings-utils";
import { applyThemeToDocument, isUITheme } from "../lib/theme";

function normalizeAppSettings(appSettings: AppSettings): AppSettings {
  return {
    ...appSettings,
    language: normalizeAppLanguage(appSettings.language),
    ttsLanguage: normalizeTtsLanguage(appSettings.ttsLanguage),
    ttsVoiceId: normalizeVoiceId(appSettings.ttsVoiceId),
    ttsSynthesisQuality: normalizeTtsSynthesisQuality(
      appSettings.ttsSynthesisQuality
    ),
    lastOpenedBookId: normalizeOptionalBookId(appSettings.lastOpenedBookId),
    currentTab: normalizeAppTab(appSettings.currentTab),
    libraryViewMode: normalizeLibraryViewMode(appSettings.libraryViewMode),
    audioPlayerMinimized: appSettings.audioPlayerMinimized ?? false,
    readerHeaderVisible: appSettings.readerHeaderVisible ?? true,
  };
}

const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: "system",
  language: "en",
  ttsLanguage: "en",
  ttsVoiceId: "F1",
  ttsSynthesisQuality: "balanced",
  autoScrollEnabled: true,
  audioPlaybackSpeed: 1.0,
  lastOpenedBookId: null,
  currentTab: "library",
  libraryViewMode: "grid",
  audioPlayerMinimized: false,
  readerHeaderVisible: true,
};

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

export function SettingsProvider({ children }: SettingsProviderProps) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasAppliedThemeRef = useRef(false);
  const settingsRef = useRef<AppSettings | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  // Apply theme to document (system uses last chosen light/dark variant)
  const applyTheme = useCallback((newTheme: UITheme) => {
    applyThemeToDocument(newTheme);
  }, []);

  // Load settings from backend
  const loadSettings = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const appSettings = await invoke<AppSettings>("get_app_settings");
      const normalized = normalizeAppSettings(appSettings);
      settingsRef.current = normalized;
      setSettings(normalized);

      // Apply theme from backend settings (only once on initial load)
      if (!hasAppliedThemeRef.current && appSettings.theme) {
        const theme = isUITheme(appSettings.theme)
          ? appSettings.theme
          : "system";
        applyTheme(theme);
        hasAppliedThemeRef.current = true;
      }
    } catch (err) {
      logger.error("Failed to load settings:", err);
      setError(err instanceof Error ? err.message : "Failed to load settings");
      // Fallback to default settings
      settingsRef.current = DEFAULT_APP_SETTINGS;
      setSettings(DEFAULT_APP_SETTINGS);

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

  // Save settings to backend. Queue + ref merge so rapid partial updates
  // (e.g. lastOpenedBookId then currentTab) cannot overwrite each other.
  const saveSettings = useCallback(
    async (updates: Partial<AppSettings>) => {
      const run = async () => {
        const current = settingsRef.current;
        if (!current) return;

        try {
          setIsSaving(true);
          setError(null);
          const updatedSettings = normalizeAppSettings({
            ...current,
            ...updates,
          });
          // Optimistic merge so the next queued save sees this update.
          settingsRef.current = updatedSettings;
          setSettings(updatedSettings);

          const savedSettings = await invoke<AppSettings>("update_app_settings", {
            settings: updatedSettings,
          });
          const normalized = normalizeAppSettings(savedSettings);
          settingsRef.current = normalized;
          setSettings(normalized);

          if (updates.theme && isUITheme(updates.theme)) {
            applyTheme(updates.theme);
          }
        } catch (err) {
          logger.error("Failed to save settings:", err);
          setError(
            err instanceof Error ? err.message : "Failed to save settings"
          );
        } finally {
          setIsSaving(false);
        }
      };

      const queued = saveQueueRef.current.then(run, run);
      saveQueueRef.current = queued.then(
        () => undefined,
        () => undefined
      );
      await queued;
    },
    [applyTheme]
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
