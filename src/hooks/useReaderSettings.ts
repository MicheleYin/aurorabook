import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";

import type { ReaderSettings } from "../components/reader/ReaderSettings";
import { useSettingsContext } from "../context/SettingsContext";
import { logger } from "../lib/logger";

const defaultSettings: ReaderSettings = {
  theme: "system",
  fontFamily: "merriweather",
  fontSize: "16",
  contentPadding: "24",
};

function normalizeFontSize(value: string | undefined): string {
  switch (value) {
    case "small":
      return "14";
    case "medium":
      return "16";
    case "large":
      return "18";
    case "xlarge":
      return "20";
    default: {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return String(Math.min(28, Math.max(12, Math.round(parsed))));
      }
      return defaultSettings.fontSize;
    }
  }
}

function normalizeContentPadding(value: string | undefined): string {
  switch (value) {
    case "compact":
      return "16";
    case "comfortable":
      return "24";
    case "spacious":
      return "48";
    default: {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return String(Math.min(64, Math.max(8, Math.round(parsed / 2) * 2)));
      }
      return defaultSettings.contentPadding;
    }
  }
}

export function useReaderSettings() {
  const {
    settings: appSettings,
    saveSettings: saveAppSettings,
    applyTheme,
  } = useSettingsContext();
  const [readerSettings, setReaderSettings] =
    useState<ReaderSettings>(defaultSettings);
  const isInitialLoadRef = useRef(true);
  const isSyncingRef = useRef(false);

  // Always point at latest app settings so async reader-prefs load never merges
  // against a stale `appSettings` from the first render (race with SettingsContext).
  const appSettingsRef = useRef(appSettings);
  appSettingsRef.current = appSettings;

  // Load settings from backend on mount
  useEffect(() => {
    const loadSettings = async () => {
      // Prefer live app theme when the invoke returns (fixes ordering vs get_app_settings).
      const mergeTheme = (stored: string | undefined) => {
        const fromApp = appSettingsRef.current?.theme;
        if (fromApp) return fromApp;
        return stored || "system";
      };

      try {
        const preferences = await invoke<ReaderSettings>(
          "get_reader_preferences"
        );
        const syncedPreferences: ReaderSettings = {
          ...preferences,
          theme: mergeTheme(preferences.theme),
          fontSize: normalizeFontSize(preferences.fontSize),
          contentPadding: normalizeContentPadding(preferences.contentPadding),
        };
        setReaderSettings(syncedPreferences);
        isInitialLoadRef.current = false;
      } catch (err) {
        logger.error("Failed to load reader preferences:", err);
        toast.error("Failed to load reader preferences");
        setReaderSettings({
          ...defaultSettings,
          theme: mergeTheme(undefined),
        });
        isInitialLoadRef.current = false;
      }
    };

    loadSettings();
  }, []); // Only run on mount

  // Sync theme when app settings theme changes (after initial load)
  useEffect(() => {
    // Skip sync during initial load or if we're already syncing
    if (
      isInitialLoadRef.current ||
      isSyncingRef.current ||
      !appSettings?.theme
    ) {
      return;
    }

    // Only sync if themes are different
    setReaderSettings((prev) => {
      if (prev.theme === appSettings.theme) {
        return prev; // No change needed
      }

      // Update theme and save to backend
      const updated = { ...prev, theme: appSettings.theme };
      invoke("update_reader_preferences", {
        preferences: updated,
      }).catch((err) => {
        logger.error("Failed to sync theme to reader preferences:", err);
      });

      return updated;
    });
  }, [appSettings?.theme]);

  const saveSettings = useCallback(
    async (settings: ReaderSettings) => {
      try {
        isSyncingRef.current = true;
        const normalizedSettings = {
          ...settings,
          fontSize: normalizeFontSize(settings.fontSize),
          contentPadding: normalizeContentPadding(settings.contentPadding),
        };

        if (
          normalizedSettings.theme &&
          appSettings?.theme !== normalizedSettings.theme
        ) {
          applyTheme(normalizedSettings.theme as "light" | "dark" | "system");
        }

        setReaderSettings(normalizedSettings);
        await invoke("update_reader_preferences", {
          preferences: normalizedSettings,
        });

        // Sync theme change to app settings if it changed
        if (
          normalizedSettings.theme &&
          appSettings?.theme !== normalizedSettings.theme
        ) {
          await saveAppSettings({ theme: normalizedSettings.theme });
        }
      } catch (err) {
        logger.error("Failed to save reader preferences:", err);
        toast.error("Failed to save reader preferences");
      } finally {
        isSyncingRef.current = false;
      }
    },
    [appSettings?.theme, applyTheme, saveAppSettings]
  );

  return { readerSettings, setReaderSettings: saveSettings };
}
