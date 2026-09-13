import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import { toast } from "sonner";

import {
  AudioSyncProvider,
  useAudioSyncContext,
} from "./AudioSyncContext";
import { SettingsProvider } from "./SettingsContext";
import { invoke } from "../test/tauri-mocks";

function wrapper({ children }: { children: ReactNode }) {
  return (
    <SettingsProvider>
      <AudioSyncProvider>{children}</AudioSyncProvider>
    </SettingsProvider>
  );
}

describe("AudioSyncProvider", () => {
  beforeEach(() => {
    invoke.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "get_app_settings") {
        return {
          theme: "system",
          language: "en",
          ttsLanguage: "en",
          ttsVoiceId: "F1",
          ttsSynthesisQuality: "balanced",
          autoScrollEnabled: true,
          audioPlaybackSpeed: 1,
        };
      }
      if (cmd === "update_app_settings") {
        return (args as { settings?: unknown } | undefined)?.settings;
      }
      throw new Error(`Unexpected invoke: ${cmd}`);
    });
  });

  it("throws outside the provider", () => {
    expect(() => renderHook(() => useAudioSyncContext())).toThrow(
      /must be used within AudioSyncProvider/
    );
  });

  it("loads autoScrollEnabled from settings and toggles with persistence", async () => {
    const { result } = renderHook(() => useAudioSyncContext(), { wrapper });

    await waitFor(() => {
      expect(result.current.isSyncEnabled).toBe(true);
    });

    await act(async () => {
      result.current.toggleSync();
    });

    await waitFor(() => {
      expect(result.current.isSyncEnabled).toBe(false);
      expect(invoke).toHaveBeenCalledWith(
        "update_app_settings",
        expect.objectContaining({
          settings: expect.objectContaining({ autoScrollEnabled: false }),
        })
      );
    });

    expect(toast.info).toHaveBeenCalledWith("Audio-text sync disabled");
  });

  it("uses settings defaults when settings load fails", async () => {
    invoke.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useAudioSyncContext(), { wrapper });

    await waitFor(() => {
      // SettingsProvider falls back to autoScrollEnabled: true
      expect(result.current.isSyncEnabled).toBe(true);
    });
  });
});
