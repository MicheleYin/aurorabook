import { useCallback, useEffect, useRef, useState } from "react";

import type { AppSettings } from "../types/settings";

const DEFAULT_SETTINGS: AppSettings = {
  theme: "system",
};

const WEB_SETTINGS_STORAGE_KEY = "tts-settings-cache-v1";
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

const isTauriEnvironment = () =>
  typeof window !== "undefined" &&
  typeof (window as typeof window & { __TAURI_INTERNALS__?: { invoke?: unknown } })
    .__TAURI_INTERNALS__?.invoke === "function";

export function usePersistentSettings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [isHydrated, setIsHydrated] = useState(false);
  const settingsStoreRef = useRef<StoreHandle | null>(null);

  const ensureSettingsStore = useCallback(async (): Promise<StoreHandle | null> => {
    if (!isTauriEnvironment()) return null;
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
        if (isTauriEnvironment()) {
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
        } else if (typeof window !== "undefined") {
          const payload: PersistedSettingsPayload = {
            version: SETTINGS_STORE_VERSION,
            value,
          };
          window.localStorage.setItem(WEB_SETTINGS_STORAGE_KEY, JSON.stringify(payload));
          console.debug(`${SETTINGS_LOG_PREFIX} persisted via localStorage`, payload);
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
      if (isTauriEnvironment()) {
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
        return;
      }

      if (typeof window !== "undefined") {
        try {
          const serialized = window.localStorage.getItem(WEB_SETTINGS_STORAGE_KEY);
          if (serialized) {
            const parsed = JSON.parse(serialized) as PersistedSettingsPayload;
            if (parsed?.version === SETTINGS_STORE_VERSION && parsed.value && !cancelled) {
              const merged = { ...DEFAULT_SETTINGS, ...parsed.value };
              setSettings(merged);
            }
          }
        } catch (error) {
          console.warn("Settings: failed to parse localStorage cache.", error);
        } finally {
          if (!cancelled) {
            setIsHydrated(true);
          }
        }
        return;
      }

      if (!cancelled) {
        setIsHydrated(true);
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


