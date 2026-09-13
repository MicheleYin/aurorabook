import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import { logger } from "../lib/logger";
import { useSettingsContext } from "./SettingsContext";

export interface AudioSyncContextType {
  isSyncEnabled: boolean;
  toggleSync: () => void;
}

export const AudioSyncContext = createContext<AudioSyncContextType | undefined>(
  undefined
);

export function useAudioSyncContext() {
  const context = useContext(AudioSyncContext);
  if (!context) {
    throw new Error(
      "useAudioSyncContext must be used within AudioSyncProvider"
    );
  }
  return context;
}

interface AudioSyncProviderProps {
  readonly children: ReactNode;
}

export function AudioSyncProvider({ children }: AudioSyncProviderProps) {
  const { settings, isLoading: isLoadingSettings, saveSettings } =
    useSettingsContext();
  const [isSyncEnabled, setIsSyncEnabled] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const isInitialMountRef = useRef(true);
  const previousValueRef = useRef(isSyncEnabled);
  const hasHydratedRef = useRef(false);
  const skipNextSaveRef = useRef(true);

  // Hydrate from shared app settings once available.
  useEffect(() => {
    if (isLoadingSettings || !settings || hasHydratedRef.current) return;
    hasHydratedRef.current = true;
    const enabled = settings.autoScrollEnabled ?? false;
    setIsSyncEnabled(enabled);
    previousValueRef.current = enabled;
    setIsLoading(false);
  }, [isLoadingSettings, settings]);

  // Save to backend when sync state changes (skip the hydrate write).
  useEffect(() => {
    if (isLoading || !hasHydratedRef.current) return;
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      return;
    }

    void saveSettings({ autoScrollEnabled: isSyncEnabled });
  }, [isSyncEnabled, isLoading, saveSettings]);

  // Show toast when sync state changes (but not on initial mount or during loading)
  useEffect(() => {
    if (isLoading) {
      // Update ref during loading but don't show toast
      previousValueRef.current = isSyncEnabled;
      return;
    }

    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
      previousValueRef.current = isSyncEnabled;
      return;
    }

    // Only show toast if the value actually changed
    if (previousValueRef.current !== isSyncEnabled) {
      if (isSyncEnabled) {
        toast.success("Audio-text sync enabled");
      } else {
        toast.info("Audio-text sync disabled");
      }
      previousValueRef.current = isSyncEnabled;
    }
  }, [isSyncEnabled, isLoading]);

  const toggleSync = useCallback(() => {
    setIsSyncEnabled((prev) => {
      const newValue = !prev;
      logger.log("[AudioSync] Sync toggled", {
        enabled: newValue,
        previousValue: prev,
      });
      return newValue;
    });
  }, []);

  const contextValue = useMemo(
    () => ({
      isSyncEnabled,
      toggleSync,
    }),
    [isSyncEnabled, toggleSync]
  );

  return (
    <AudioSyncContext.Provider value={contextValue}>
      {children}
    </AudioSyncContext.Provider>
  );
}
