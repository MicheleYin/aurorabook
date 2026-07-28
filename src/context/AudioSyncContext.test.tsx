import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import { toast } from "sonner";

import {
  AudioSyncProvider,
  useAudioSyncContext,
} from "./AudioSyncContext";
import { invoke } from "../test/tauri-mocks";

function wrapper({ children }: { children: ReactNode }) {
  return <AudioSyncProvider>{children}</AudioSyncProvider>;
}

describe("AudioSyncProvider", () => {
  beforeEach(() => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_app_settings") {
        return { autoScrollEnabled: true };
      }
      if (cmd === "update_app_settings") {
        return { autoScrollEnabled: false };
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

  it("defaults to false when settings load fails", async () => {
    invoke.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useAudioSyncContext(), { wrapper });

    await waitFor(() => {
      expect(result.current.isSyncEnabled).toBe(false);
    });
  });
});
