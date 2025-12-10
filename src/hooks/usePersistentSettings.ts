import { DEFAULT_KOKORO_VOICE_ID } from "../constants/kokoro";
import type { AppSettings } from "../types/settings";
import { usePersistentState } from "./usePersistentState";

const DEFAULT_SETTINGS: AppSettings = {
  theme: "system",
  ttsVoiceId: DEFAULT_KOKORO_VOICE_ID,
  autoScrollEnabled: true,
};

/**
 * Hook for persisting app settings to Tauri store
 */
export function usePersistentSettings() {
  const { state: settings, updateState: updateSettings, isHydrated } = usePersistentState<AppSettings>({
    storePath: "settings.store.json",
    storeKey: "settings",
    version: 1,
    defaultValue: DEFAULT_SETTINGS,
    logPrefix: "[SettingsPersistence]",
  });

  return {
    settings,
    updateSettings,
    isHydrated,
  };
}


