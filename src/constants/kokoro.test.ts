import { describe, expect, it } from "vitest";

import {
  normalizeVoiceId,
  voiceSamplePathsToTry,
} from "./kokoro";

describe("normalizeVoiceId", () => {
  it("keeps valid Supertonic ids", () => {
    expect(normalizeVoiceId("F1")).toBe("F1");
    expect(normalizeVoiceId("M5")).toBe("M5");
  });

  it("maps legacy Kokoro ids", () => {
    expect(normalizeVoiceId("af_bella")).toBe("F1");
    expect(normalizeVoiceId("am_adam")).toBe("M1");
  });

  it("falls back to F1 for unknown ids", () => {
    expect(normalizeVoiceId("unknown_voice")).toBe("F1");
  });
});

describe("voiceSamplePathsToTry", () => {
  it("returns only primary path for English", () => {
    expect(voiceSamplePathsToTry("F1", "en")).toEqual([
      "voice-samples/en/F1.mp3",
    ]);
  });

  it("adds English fallback for other languages", () => {
    expect(voiceSamplePathsToTry("af_heart", "it")).toEqual([
      "voice-samples/it/M1.mp3",
      "voice-samples/en/M1.mp3",
    ]);
  });
});
