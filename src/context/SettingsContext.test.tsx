import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { toast } from "sonner";

import {
  SettingsProvider,
  useSettingsContext,
} from "./SettingsContext";
import { invoke } from "../test/tauri-mocks";

function wrapper({ children }: { children: ReactNode }) {
  return <SettingsProvider>{children}</SettingsProvider>;
}

describe("SettingsProvider", () => {
  beforeEach(() => {
    document.documentElement.className = "";
    invoke.mockImplementation(async (cmd: string, args?: { settings?: unknown }) => {
      if (cmd === "get_app_settings") {
        return {
          theme: "dark",
          language: "en-US",
          ttsLanguage: "it",
          ttsVoiceId: "af_bella",
          ttsSynthesisQuality: "bogus",
          autoScrollEnabled: true,
          audioPlaybackSpeed: 1,
        };
      }
      if (cmd === "update_app_settings") {
        return args?.settings;
      }
      throw new Error(`Unexpected invoke: ${cmd}`);
    });
  });

  it("throws outside the provider", () => {
    expect(() => renderHook(() => useSettingsContext())).toThrow(
      /must be used within SettingsProvider/
    );
  });

  it("normalizes loaded settings and applies theme", async () => {
    const { result } = renderHook(() => useSettingsContext(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.settings).toMatchObject({
        language: "en",
        ttsLanguage: "it",
        ttsVoiceId: "F1",
        ttsSynthesisQuality: "balanced",
        theme: "dark",
      });
    });

    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("falls back to defaults when settings load fails", async () => {
    invoke.mockRejectedValue(new Error("store down"));
    const { result } = renderHook(() => useSettingsContext(), { wrapper });

    await waitFor(() => {
      expect(result.current.settings).toMatchObject({
        theme: "system",
        language: "en",
        ttsVoiceId: "F1",
      });
      expect(result.current.error).toMatch(/store down|Failed to load/);
    });
  });

  it("saves partial updates and applies theme changes", async () => {
    const { result } = renderHook(() => useSettingsContext(), { wrapper });

    await waitFor(() => {
      expect(result.current.settings).not.toBeNull();
    });

    await act(async () => {
      await result.current.saveSettings({ theme: "light" });
    });

    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(result.current.settings?.theme).toBe("light");
  });

  it("applyTheme resolves system preference", () => {
    const { result } = renderHook(() => useSettingsContext(), { wrapper });

    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query.includes("dark"),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
      })),
    });

    act(() => {
      result.current.applyTheme("system");
    });

    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});
