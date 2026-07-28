import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

import { useReaderSettings } from "./useReaderSettings";
import { invoke } from "../test/tauri-mocks";

const saveAppSettings = vi.fn(async () => undefined);
const applyTheme = vi.fn();

vi.mock("../context/SettingsContext", () => ({
  useSettingsContext: () => ({
    settings: { theme: "dark", language: "en", ttsLanguage: "en", ttsVoiceId: "F1" },
    saveSettings: saveAppSettings,
    applyTheme,
  }),
}));

describe("useReaderSettings", () => {
  beforeEach(() => {
    saveAppSettings.mockClear();
    applyTheme.mockClear();
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_reader_preferences") {
        return {
          theme: "light",
          fontFamily: "merriweather",
          fontSize: "large",
          contentPadding: "compact",
        };
      }
      if (cmd === "update_reader_preferences") {
        return undefined;
      }
      throw new Error(`Unexpected invoke: ${cmd}`);
    });
  });

  it("loads and normalizes reader preferences, preferring app theme", async () => {
    const { result } = renderHook(() => useReaderSettings());

    await waitFor(() => {
      expect(result.current.readerSettings).toMatchObject({
        theme: "dark",
        fontSize: "18",
        contentPadding: "16",
      });
    });
  });

  it("falls back to defaults when preferences fail to load", async () => {
    invoke.mockRejectedValueOnce(new Error("missing"));
    const { result } = renderHook(() => useReaderSettings());

    await waitFor(() => {
      expect(result.current.readerSettings.fontSize).toBe("16");
      expect(toast.error).toHaveBeenCalledWith(
        "Failed to load reader preferences"
      );
    });
  });

  it("saves normalized preferences and syncs theme to app settings", async () => {
    const { result } = renderHook(() => useReaderSettings());

    await waitFor(() => {
      expect(result.current.readerSettings.theme).toBe("dark");
    });

    await act(async () => {
      await result.current.setReaderSettings({
        theme: "light",
        fontFamily: "merriweather",
        fontSize: "xlarge",
        contentPadding: "spacious",
      });
    });

    expect(applyTheme).toHaveBeenCalledWith("light");
    expect(invoke).toHaveBeenCalledWith("update_reader_preferences", {
      preferences: expect.objectContaining({
        theme: "light",
        fontSize: "20",
        contentPadding: "48",
      }),
    });
    expect(saveAppSettings).toHaveBeenCalledWith({ theme: "light" });
  });
});
