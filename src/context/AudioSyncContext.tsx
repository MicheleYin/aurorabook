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

const SYNC_ENABLED_KEY = "audio-sync-enabled";

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
  const [isSyncEnabled, setIsSyncEnabled] = useState(() => {
    // Load from localStorage on mount
    const stored = localStorage.getItem(SYNC_ENABLED_KEY);
    return stored === "true";
  });

  const isInitialMountRef = useRef(true);
  const previousValueRef = useRef(isSyncEnabled);

  // Sync localStorage with state changes
  useEffect(() => {
    localStorage.setItem(SYNC_ENABLED_KEY, String(isSyncEnabled));
  }, [isSyncEnabled]);

  // Show toast when sync state changes (but not on initial mount)
  useEffect(() => {
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
  }, [isSyncEnabled]);

  const toggleSync = useCallback(() => {
    setIsSyncEnabled((prev) => {
      const newValue = !prev;
      console.log("[AudioSync] Sync toggled", {
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
