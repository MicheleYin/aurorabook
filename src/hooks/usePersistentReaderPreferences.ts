import { useCallback, useEffect, useRef, useState } from "react";

import type { ReaderPreferences } from "../types/reader";

const DEFAULT_READER_PREFERENCES: ReaderPreferences = {
  theme: "system",
  fontFamily: "merriweather",
  contentPadding: "comfortable",
  fontSize: "medium",
};

const READER_PREFERENCES_STORE_PATH = "reader-preferences.store.json";
const READER_PREFERENCES_STORE_KEY = "readerPreferences";
const READER_PREFERENCES_STORE_VERSION = 1;
const READER_PREFERENCES_LOG_PREFIX = "[ReaderPreferencesPersistence]";

type StoreHandle = {
  set: (key: string, value: unknown) => Promise<void>;
  get: <T>(key: string) => Promise<T | null | undefined>;
  save: () => Promise<void>;
};

type PersistedReaderPreferencesPayload = {
  version: number;
  value: ReaderPreferences;
};

export function usePersistentReaderPreferences() {
  const [preferences, setPreferences] = useState<ReaderPreferences>(DEFAULT_READER_PREFERENCES);
  const [isHydrated, setIsHydrated] = useState(false);
  const preferencesStoreRef = useRef<StoreHandle | null>(null);

  const ensurePreferencesStore = useCallback(async (): Promise<StoreHandle | null> => {
    if (preferencesStoreRef.current) {
      return preferencesStoreRef.current;
    }

    try {
      const { load } = await import("@tauri-apps/plugin-store");
      const store = await load(READER_PREFERENCES_STORE_PATH);
      preferencesStoreRef.current = store as StoreHandle;
      return preferencesStoreRef.current;
    } catch (error) {
      console.warn("ReaderPreferences: unable to initialize store.", error);
      return null;
    }
  }, []);

  const persistPreferences = useCallback(
    async (value: ReaderPreferences) => {
      try {
        const store = await ensurePreferencesStore();
        if (store) {
          const payload: PersistedReaderPreferencesPayload = {
            version: READER_PREFERENCES_STORE_VERSION,
            value,
          };
          await store.set(READER_PREFERENCES_STORE_KEY, payload);
          await store.save();
          console.debug(`${READER_PREFERENCES_LOG_PREFIX} persisted via store`, payload);
        }
      } catch (error) {
        console.warn("ReaderPreferences: failed to persist state.", error);
      }
    },
    [ensurePreferencesStore],
  );

  const updatePreferences = useCallback((update: Partial<ReaderPreferences>) => {
    setPreferences((prev) => ({
      ...prev,
      ...update,
    }));
  }, []);

  const setPreferencesDirect = useCallback((prefs: ReaderPreferences) => {
    setPreferences(prefs);
  }, []);

  useEffect(() => {
    if (!isHydrated) return;
    void persistPreferences(preferences);
  }, [isHydrated, persistPreferences, preferences]);

  useEffect(() => {
    let cancelled = false;

    const hydratePreferences = async () => {
      try {
        const store = await ensurePreferencesStore();
        const payload = await store?.get<PersistedReaderPreferencesPayload>(READER_PREFERENCES_STORE_KEY);
        if (payload?.version === READER_PREFERENCES_STORE_VERSION && payload.value) {
          const merged = { ...DEFAULT_READER_PREFERENCES, ...payload.value };
          if (!cancelled) {
            setPreferences(merged);
          }
        }
      } catch (error) {
        console.warn("ReaderPreferences: failed to load store.", error);
      } finally {
        if (!cancelled) {
          setIsHydrated(true);
        }
      }
    };

    void hydratePreferences();

    return () => {
      cancelled = true;
    };
  }, [ensurePreferencesStore]);

  return {
    preferences,
    setPreferences: setPreferencesDirect,
    updatePreferences,
    isHydrated,
  };
}

