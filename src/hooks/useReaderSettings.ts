import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";

import type { ReaderSettings } from "../components/reader/ReaderSettings";
import { useSettingsContext } from "../context/SettingsContext";
import { logger } from "../lib/logger";
import {
  DEFAULT_READER_SETTINGS,
  normalizeContentPadding,
  normalizeFontSize,
} from "../lib/reader-settings-utils";
import type { UITheme } from "../types/ui";

export function useReaderSettings() {
  const {
    settings: appSettings,
    saveSettings: saveAppSettings,
    applyTheme,
  } = useSettingsContext();
  const [readerSettings, setReaderSettings] =
    useState<ReaderSettings>(DEFAULT_READER_SETTINGS);
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
          ...DEFAULT_READER_SETTINGS,
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
          applyTheme(normalizedSettings.theme as UITheme);
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
