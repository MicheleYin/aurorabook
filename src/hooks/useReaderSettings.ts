import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";

import type { ReaderSettings } from "../components/reader/ReaderSettings";
import { useSettingsContext } from "../context/SettingsContext";
import { logger } from "../lib/logger";

const defaultSettings: ReaderSettings = {
  theme: "system",
  fontFamily: "merriweather",
  fontSize: "medium",
  contentPadding: "comfortable",
};

export function useReaderSettings() {
  const { settings: appSettings, saveSettings: saveAppSettings } =
    useSettingsContext();
  const [readerSettings, setReaderSettings] =
    useState<ReaderSettings>(defaultSettings);
  const isInitialLoadRef = useRef(true);
  const isSyncingRef = useRef(false);

  // Load settings from backend on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const preferences = await invoke<ReaderSettings>(
          "get_reader_preferences"
        );
        // Sync theme with app settings if available, otherwise use reader preferences theme
        const syncedPreferences: ReaderSettings = {
          ...preferences,
          theme: appSettings?.theme || preferences.theme || "system",
        };
        setReaderSettings(syncedPreferences);
        isInitialLoadRef.current = false;
      } catch (err) {
        logger.error("Failed to load reader preferences:", err);
        toast.error("Failed to load reader preferences");
        // Use app settings theme as fallback
        setReaderSettings({
          ...defaultSettings,
          theme: appSettings?.theme || "system",
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
        setReaderSettings(settings);
        await invoke("update_reader_preferences", {
          preferences: settings,
        });

        // Sync theme change to app settings if it changed
        if (settings.theme && appSettings?.theme !== settings.theme) {
          await saveAppSettings({ theme: settings.theme });
        }
      } catch (err) {
        logger.error("Failed to save reader preferences:", err);
        toast.error("Failed to save reader preferences");
      } finally {
        isSyncingRef.current = false;
      }
    },
    [appSettings?.theme, saveAppSettings]
  );

  return { readerSettings, setReaderSettings: saveSettings };
}
