import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ReaderPreferences } from "../../types/reader";
import { logger } from "../../lib/logger";

const DEFAULT_READER_PREFERENCES: ReaderPreferences = {
  theme: "system",
  fontFamily: "merriweather",
  contentPadding: "comfortable",
  fontSize: "medium",
};

/**
 * Hook for persisting reader preferences to backend database
 */
export function usePersistentReaderPreferences() {
  const [preferences, setPreferences] = useState<ReaderPreferences>(DEFAULT_READER_PREFERENCES);
  const [isHydrated, setIsHydrated] = useState(false);

  // Load preferences from backend on mount
  useEffect(() => {
    let cancelled = false;

    const loadPreferences = async () => {
      try {
        const loadedPreferences = await invoke<ReaderPreferences>("get_reader_preferences");
        if (!cancelled) {
          // Merge with defaults to ensure all fields are present
          setPreferences({ ...DEFAULT_READER_PREFERENCES, ...loadedPreferences });
          setIsHydrated(true);
        }
      } catch (error) {
        logger.warn("[ReaderPreferencesPersistence]: failed to load preferences from backend, using defaults:", { error });
        if (!cancelled) {
          setIsHydrated(true);
        }
      }
    };

    void loadPreferences();

    return () => {
      cancelled = true;
    };
  }, []);

  // Set preferences function (replaces entire state)
  const setPreferencesDirect = useCallback((newPreferences: ReaderPreferences) => {
    setPreferences(newPreferences);
    
    // Persist to backend asynchronously
    invoke("update_reader_preferences", { preferences: newPreferences }).catch((error) => {
      logger.warn("[ReaderPreferencesPersistence]: failed to persist preferences:", { error });
    });
  }, []);

  // Update preferences function (partial update)
  const updatePreferences = useCallback((update: Partial<ReaderPreferences>) => {
    setPreferences((prev) => {
      const newPreferences = { ...prev, ...update };
      
      // Persist to backend asynchronously
      invoke("update_reader_preferences", { preferences: newPreferences }).catch((error) => {
        logger.warn("[ReaderPreferencesPersistence]: failed to persist preferences:", { error });
      });
      
      return newPreferences;
    });
  }, []);

  return {
    preferences,
    setPreferences: setPreferencesDirect,
    updatePreferences,
    isHydrated,
  };
}

