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
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";

import type { AppSettings } from "../types/settings";
import { logger } from "../lib/logger";

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
  const [isSyncEnabled, setIsSyncEnabled] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const isInitialMountRef = useRef(true);
  const previousValueRef = useRef(isSyncEnabled);

  // Load settings from backend on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const settings = await invoke<AppSettings>("get_app_settings");
        setIsSyncEnabled(settings.autoScrollEnabled ?? false);
        previousValueRef.current = settings.autoScrollEnabled ?? false;
      } catch (err) {
        logger.error("Failed to load sync settings:", err);
        // Default to false on error
        setIsSyncEnabled(false);
      } finally {
        setIsLoading(false);
      }
    };
    loadSettings();
  }, []);

  // Save to backend when sync state changes
  useEffect(() => {
    if (isLoading) return; // Don't save on initial load

    const saveSettings = async () => {
      try {
        const currentSettings = await invoke<AppSettings>("get_app_settings");
        const updatedSettings: AppSettings = {
          ...currentSettings,
          autoScrollEnabled: isSyncEnabled,
        };
        await invoke<AppSettings>("update_app_settings", {
          settings: updatedSettings,
        });
      } catch (err) {
        logger.error("Failed to save sync settings:", err);
      }
    };
    saveSettings();
  }, [isSyncEnabled, isLoading]);

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
