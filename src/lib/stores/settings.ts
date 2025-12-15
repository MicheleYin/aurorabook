import { writable } from "svelte/store";
import { invoke } from "@tauri-apps/api/core";
import { DEFAULT_KOKORO_VOICE_ID } from "../constants/kokoro";
import type { AppSettings } from "../types/settings";

const DEFAULT_SETTINGS: AppSettings = {
  theme: "system",
  ttsVoiceId: DEFAULT_KOKORO_VOICE_ID,
  autoScrollEnabled: true,
  audioPlaybackSpeed: 1.0,
};

function createSettingsStore() {
  const { subscribe, set, update } = writable<AppSettings>(DEFAULT_SETTINGS);
  const { subscribe: subscribeHydrated, set: setHydrated } = writable(false);

  // Load settings from backend
  const loadSettings = async () => {
    try {
      const loadedSettings = await invoke<AppSettings>("get_app_settings");
      set({ ...DEFAULT_SETTINGS, ...loadedSettings });
      setHydrated(true);
    } catch (error) {
      console.warn("[SettingsPersistence]: failed to load settings from backend, using defaults:", error);
      setHydrated(true);
    }
  };

  // Update settings function
  const updateSettings = (updates: Partial<AppSettings>) => {
    update((prev: AppSettings) => {
      const newSettings = { ...prev, ...updates };
      
      // Persist to backend asynchronously
      invoke("update_app_settings", { settings: newSettings }).catch((error) => {
        console.warn("[SettingsPersistence]: failed to persist settings:", error);
      });
      
      return newSettings;
    });
  };

  // Initialize
  loadSettings();

  return {
    subscribe,
    updateSettings,
    hydrated: { subscribe: subscribeHydrated },
  };
}

export const settingsStore = createSettingsStore();

