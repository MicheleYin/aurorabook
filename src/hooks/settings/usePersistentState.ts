import { useCallback, useEffect, useRef, useState } from "react";
import { logger } from "../../lib/logger";

type StoreHandle = {
  set: (key: string, value: unknown) => Promise<void>;
  get: <T>(key: string) => Promise<T | null | undefined>;
  save: () => Promise<void>;
};

type PersistedPayload<T> = {
  version: number;
  value: T;
};

export type UsePersistentStateOptions<T> = {
  storePath: string;
  storeKey: string;
  version: number;
  defaultValue: T;
  logPrefix?: string;
};

/**
 * Generic hook for persisting state to Tauri store
 * @param options Configuration for the persistent state
 * @returns State, update functions, and hydration status
 */
export function usePersistentState<T>(options: UsePersistentStateOptions<T>) {
  const { storePath, storeKey, version, defaultValue, logPrefix = "[Persistence]" } = options;
  
  const [state, setState] = useState<T>(defaultValue);
  const [isHydrated, setIsHydrated] = useState(false);
  const storeRef = useRef<StoreHandle | null>(null);

  const ensureStore = useCallback(async (): Promise<StoreHandle | null> => {
    if (storeRef.current) {
      return storeRef.current;
    }

    try {
      const { load } = await import("@tauri-apps/plugin-store");
      const store = await load(storePath);
      storeRef.current = store as StoreHandle;
      return storeRef.current;
    } catch (error) {
      logger.warn(`${logPrefix}: unable to initialize store.`, { error });
      return null;
    }
  }, [storePath, logPrefix]);

  const persistState = useCallback(
    async (value: T) => {
      try {
        const store = await ensureStore();
        if (store) {
          const payload: PersistedPayload<T> = {
            version,
            value,
          };
          await store.set(storeKey, payload);
          await store.save();
          logger.debug(`${logPrefix} persisted via store`, { payload });
        }
      } catch (error) {
        logger.warn(`${logPrefix}: failed to persist state.`, { error });
      }
    },
    [ensureStore, storeKey, version, logPrefix],
  );

  const updateState = useCallback((update: Partial<T>) => {
    setState((prev) => ({
      ...prev,
      ...update,
    }));
  }, []);

  const setStateDirect = useCallback((value: T) => {
    setState(value);
  }, []);

  useEffect(() => {
    if (!isHydrated) return;
    void persistState(state);
  }, [isHydrated, persistState, state]);

  useEffect(() => {
    let cancelled = false;

    const hydrateState = async () => {
      try {
        const store = await ensureStore();
        const payload = await store?.get<PersistedPayload<T>>(storeKey);
        if (payload?.version === version && payload.value) {
          const merged = { ...defaultValue, ...payload.value };
          if (!cancelled) {
            setState(merged);
          }
        }
      } catch (error) {
        logger.warn(`${logPrefix}: failed to load store.`, { error });
      } finally {
        if (!cancelled) {
          setIsHydrated(true);
        }
      }
    };

    void hydrateState();

    return () => {
      cancelled = true;
    };
  }, [ensureStore, storeKey, version, defaultValue, logPrefix]);

  return {
    state,
    setState: setStateDirect,
    updateState,
    isHydrated,
  };
}
