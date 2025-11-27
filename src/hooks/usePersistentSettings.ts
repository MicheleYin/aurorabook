import { useCallback, useEffect, useRef, useState } from "react";

import { DEFAULT_KOKORO_VOICE_ID } from "../constants/kokoro";
import type { AppSettings } from "../types/settings";

const DEFAULT_SETTINGS: AppSettings = {
  theme: "system",
  ttsVoiceId: DEFAULT_KOKORO_VOICE_ID,
  autoScrollEnabled: true,
};

const SETTINGS_STORE_PATH = "settings.store.json";
const SETTINGS_STORE_KEY = "settings";
const SETTINGS_STORE_VERSION = 1;
const SETTINGS_LOG_PREFIX = "[SettingsPersistence]";

type StoreHandle = {
  set: (key: string, value: unknown) => Promise<void>;
  get: <T>(key: string) => Promise<T | null | undefined>;
  save: () => Promise<void>;
};

type PersistedSettingsPayload = {
  version: number;
  value: AppSettings;
};

export function usePersistentSettings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [isHydrated, setIsHydrated] = useState(false);
  const settingsStoreRef = useRef<StoreHandle | null>(null);

  const ensureSettingsStore = useCallback(async (): Promise<StoreHandle | null> => {
    if (settingsStoreRef.current) {
      return settingsStoreRef.current;
    }

    try {
      const { load } = await import("@tauri-apps/plugin-store");
      const store = await load(SETTINGS_STORE_PATH);
      settingsStoreRef.current = store as StoreHandle;
      return settingsStoreRef.current;
    } catch (error) {
      console.warn("Settings: unable to initialize store.", error);
      return null;
    }
  }, []);

  const persistSettings = useCallback(
    async (value: AppSettings) => {
      try {
        const store = await ensureSettingsStore();
        if (store) {
          const payload: PersistedSettingsPayload = {
            version: SETTINGS_STORE_VERSION,
            value,
          };
          await store.set(SETTINGS_STORE_KEY, payload);
          await store.save();
          console.debug(`${SETTINGS_LOG_PREFIX} persisted via store`, payload);
        }
      } catch (error) {
        console.warn("Settings: failed to persist state.", error);
      }
    },
    [ensureSettingsStore],
  );

  const updateSettings = useCallback((update: Partial<AppSettings>) => {
    setSettings((prev) => ({
      ...prev,
      ...update,
    }));
  }, []);

  useEffect(() => {
    if (!isHydrated) return;
    void persistSettings(settings);
  }, [isHydrated, persistSettings, settings]);

  useEffect(() => {
    let cancelled = false;

    const hydrateSettings = async () => {
      try {
        const store = await ensureSettingsStore();
        const payload = await store?.get<PersistedSettingsPayload>(SETTINGS_STORE_KEY);
        if (payload?.version === SETTINGS_STORE_VERSION && payload.value) {
          const merged = { ...DEFAULT_SETTINGS, ...payload.value };
          if (!cancelled) {
            setSettings(merged);
          }
        }
      } catch (error) {
        console.warn("Settings: failed to load store.", error);
      } finally {
        if (!cancelled) {
          setIsHydrated(true);
        }
      }
    };

    void hydrateSettings();

    return () => {
      cancelled = true;
    };
  }, [ensureSettingsStore]);

  return {
    settings,
    updateSettings,
    isHydrated,
  };
}


