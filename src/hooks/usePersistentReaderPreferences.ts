import type { ReaderPreferences } from "../types/reader";
import { usePersistentState } from "./usePersistentState";

const DEFAULT_READER_PREFERENCES: ReaderPreferences = {
  theme: "system",
  fontFamily: "merriweather",
  contentPadding: "comfortable",
  fontSize: "medium",
};

/**
 * Hook for persisting reader preferences to Tauri store
 */
export function usePersistentReaderPreferences() {
  const { state: preferences, setState: setPreferences, updateState: updatePreferences, isHydrated } = usePersistentState<ReaderPreferences>({
    storePath: "reader-preferences.store.json",
    storeKey: "readerPreferences",
    version: 1,
    defaultValue: DEFAULT_READER_PREFERENCES,
    logPrefix: "[ReaderPreferencesPersistence]",
  });

  return {
    preferences,
    setPreferences,
    updatePreferences,
    isHydrated,
  };
}

