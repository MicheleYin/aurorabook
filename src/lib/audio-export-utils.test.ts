import { describe, expect, it } from "vitest";

import {
  isTerminalExportStep,
  linearAudioExportEtaMs,
  normalizeFormat,
} from "./audio-export-utils";

describe("normalizeFormat", () => {
  it("accepts known formats", () => {
    expect(normalizeFormat("mp3")).toBe("mp3");
    expect(normalizeFormat("m4a")).toBe("m4a");
    expect(normalizeFormat("m4b")).toBe("m4b");
  });

  it("rejects unknown or null values", () => {
    expect(normalizeFormat(null)).toBeNull();
    expect(normalizeFormat("wav")).toBeNull();
    expect(normalizeFormat("MP3")).toBeNull();
  });
});

describe("isTerminalExportStep", () => {
  it("treats completed and cancelled as terminal", () => {
    expect(isTerminalExportStep("completed")).toBe(true);
    expect(isTerminalExportStep("cancelled")).toBe(true);
  });

  it("treats in-progress steps as non-terminal", () => {
    expect(isTerminalExportStep("encoding")).toBe(false);
    expect(isTerminalExportStep("error")).toBe(false);
  });
});

describe("linearAudioExportEtaMs", () => {
  it("returns null without enough progress", () => {
    expect(linearAudioExportEtaMs(1000, 0, 10, 2000)).toBeNull();
    expect(linearAudioExportEtaMs(1000, 5, 0, 2000)).toBeNull();
  });

  it("returns 0 when finished", () => {
    expect(linearAudioExportEtaMs(1000, 10, 10, 5000)).toBe(0);
    expect(linearAudioExportEtaMs(1000, 12, 10, 5000)).toBe(0);
  });

  it("estimates remaining time from linear rate", () => {
    // 5 tracks in 1000ms → 5 tracks/sec → 5 remaining → 1000ms ETA
    expect(linearAudioExportEtaMs(0, 5, 10, 1000)).toBe(1000);
  });

  it("returns null when rate is non-finite", () => {
    expect(linearAudioExportEtaMs(1000, 5, 10, Number.NaN)).toBeNull();
  });
});
