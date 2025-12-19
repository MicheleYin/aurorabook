import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { DEFAULT_KOKORO_VOICE_ID } from "../../constants/kokoro";
import type { AppSettings } from "../../types/settings";
import { logger } from "../../lib/logger";

const DEFAULT_SETTINGS: AppSettings = {
  theme: "system",
  ttsVoiceId: DEFAULT_KOKORO_VOICE_ID,
  autoScrollEnabled: true,
  audioPlaybackSpeed: 1.0,
};

/**
 * Hook for persisting app settings to backend database
 */
export function usePersistentSettings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [isHydrated, setIsHydrated] = useState(false);

  // Load settings from backend on mount
  useEffect(() => {
    let cancelled = false;

    const loadSettings = async () => {
      // Add timeout to ensure hydration completes even if Tauri command hangs
      const timeoutId = setTimeout(() => {
        if (!cancelled) {
          logger.warn("[SettingsPersistence]: Settings load timeout, using defaults");
          setIsHydrated(true);
        }
      }, 5000); // 5 second timeout

      try {
        const loadedSettings = await invoke<AppSettings>("get_app_settings");
        clearTimeout(timeoutId);
        if (!cancelled) {
          // Merge with defaults to ensure all fields are present
          setSettings({ ...DEFAULT_SETTINGS, ...loadedSettings });
          setIsHydrated(true);
        }
      } catch (error) {
        clearTimeout(timeoutId);
        logger.warn("[SettingsPersistence]: failed to load settings from backend, using defaults:", { error });
        if (!cancelled) {
          setIsHydrated(true);
        }
      }
    };

    void loadSettings();

    return () => {
      cancelled = true;
    };
  }, []);

  // Update settings function
  const updateSettings = useCallback((update: Partial<AppSettings>) => {
    setSettings((prev) => {
      const newSettings = { ...prev, ...update };
      
      // Persist to backend asynchronously
      invoke("update_app_settings", { settings: newSettings }).catch((error) => {
        logger.warn("[SettingsPersistence]: failed to persist settings:", { error });
      });
      
      return newSettings;
    });
  }, []);

  return {
    settings,
    updateSettings,
    isHydrated,
  };
}


