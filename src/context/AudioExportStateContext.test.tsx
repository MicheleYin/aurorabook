import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { ReactNode } from "react";

import {
  AudioExportStateProvider,
  useAudioExportState,
  type AudioExportProgressPayload,
} from "./AudioExportStateContext";
import {
  emitTauriEvent,
  invoke,
  listen,
} from "../test/tauri-mocks";

function wrapper({ children }: { children: ReactNode }) {
  return <AudioExportStateProvider>{children}</AudioExportStateProvider>;
}

function progress(
  overrides: Partial<AudioExportProgressPayload> = {}
): AudioExportProgressPayload {
  return {
    bookId: "book-1",
    format: "mp3",
    currentStep: "encoding",
    message: "Working",
    processedTracks: 2,
    totalTracks: 10,
    percent: 20,
    etaMs: null,
    ...overrides,
  };
}

describe("AudioExportStateProvider", () => {
  beforeEach(() => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_audio_export_status") {
        return { inProgress: false, bookId: null, format: null };
      }
      if (cmd === "cancel_audio_export") {
        return true;
      }
      if (cmd === "export_as_mp3" || cmd === "export_as_m4a" || cmd === "export_as_m4b") {
        return undefined;
      }
      throw new Error(`Unexpected invoke: ${cmd}`);
    });
  });

  it("throws outside the provider", () => {
    expect(() => renderHook(() => useAudioExportState())).toThrow(
      /must be used within an AudioExportStateProvider/
    );
  });

  it("syncs idle status on mount", async () => {
    const { result } = renderHook(() => useAudioExportState(), { wrapper });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("get_audio_export_status");
    });
    expect(result.current.isAnyExporting).toBe(false);
    expect(result.current.activeExportBookId).toBeNull();
  });

  it("applies progress events and clears on terminal steps", async () => {
    const { result } = renderHook(() => useAudioExportState(), { wrapper });

    await waitFor(() => {
      expect(listen.mock.calls.some((c) => c[0] === "audio-export-progress")).toBe(
        true
      );
    });

    act(() => {
      emitTauriEvent("audio-export-progress", progress());
    });

    await waitFor(() => {
      expect(result.current.isAnyExporting).toBe(true);
      expect(result.current.activeExportBookId).toBe("book-1");
      expect(result.current.activeExportFormat).toBe("mp3");
      expect(result.current.exportProgress?.processedTracks).toBe(2);
    });

    act(() => {
      emitTauriEvent(
        "audio-export-progress",
        progress({ currentStep: "completed", processedTracks: 10, percent: 100 })
      );
    });

    await waitFor(() => {
      expect(result.current.isAnyExporting).toBe(false);
      expect(result.current.exportProgress).toBeNull();
      expect(result.current.activeExportBookId).toBeNull();
    });
  });

  it("runs an export when no other export is in progress", async () => {
    const { result } = renderHook(() => useAudioExportState(), { wrapper });

    await waitFor(() => {
      expect(result.current.syncAudioExportStatus).toBeTypeOf("function");
    });

    await act(async () => {
      await result.current.runAudioExport("book-1", "mp3", "/tmp/out.mp3");
    });

    expect(invoke).toHaveBeenCalledWith("export_as_mp3", {
      bookId: "book-1",
      outputPath: "/tmp/out.mp3",
    });
  });

  it("rejects when another export is already running", async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_audio_export_status") {
        return { inProgress: true, bookId: "other", format: "m4b" };
      }
      throw new Error(`Unexpected invoke: ${cmd}`);
    });

    const { result } = renderHook(() => useAudioExportState(), { wrapper });

    await waitFor(() => {
      expect(result.current.isAnyExporting).toBe(true);
    });

    await expect(
      result.current.runAudioExport("book-1", "mp3", "/tmp/out.mp3")
    ).rejects.toThrow(/Another export is already in progress/);
  });

  it("cancels an in-progress export", async () => {
    const { result } = renderHook(() => useAudioExportState(), { wrapper });

    await act(async () => {
      await expect(result.current.cancelAudioExport()).resolves.toBe(true);
    });
    expect(invoke).toHaveBeenCalledWith("cancel_audio_export");
  });
});
