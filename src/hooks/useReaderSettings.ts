import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";

import type { ReaderSettings } from "../components/reader/ReaderSettings";

const defaultSettings: ReaderSettings = {
  theme: "system",
  fontFamily: "merriweather",
  fontSize: "medium",
  contentPadding: "comfortable",
};

export function useReaderSettings() {
  const [readerSettings, setReaderSettings] =
    useState<ReaderSettings>(defaultSettings);

  // Load settings from backend on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const preferences = await invoke<ReaderSettings>(
          "get_reader_preferences"
        );
        setReaderSettings(preferences);
      } catch (err) {
        console.error("Failed to load reader preferences:", err);
        toast.error("Failed to load reader preferences");
      }
    };

    loadSettings();
  }, []);

  const saveSettings = useCallback(async (settings: ReaderSettings) => {
    try {
      setReaderSettings(settings);
      await invoke("update_reader_preferences", {
        preferences: settings,
      });
    } catch (err) {
      console.error("Failed to save reader preferences:", err);
      toast.error("Failed to save reader preferences");
    }
  }, []);

  return { readerSettings, setReaderSettings: saveSettings };
}
