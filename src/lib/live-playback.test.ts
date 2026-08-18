import { describe, expect, it } from "vitest";

import {
  shouldHoldLivePlayback,
  shouldResumeLiveAfterHold,
} from "./live-playback";

describe("shouldHoldLivePlayback", () => {
  it("holds while a live chapter is still converting", () => {
    expect(
      shouldHoldLivePlayback({
        isLiveStream: true,
        chapterCompleted: false,
        generatedDuration: 12,
        currentTime: 12,
      })
    ).toBe(true);
  });

  it("does not hold finished non-live tracks", () => {
    expect(
      shouldHoldLivePlayback({
        isLiveStream: false,
        chapterCompleted: false,
        generatedDuration: 12,
        currentTime: 12,
      })
    ).toBe(false);
  });

  it("holds a completed live chapter only when generated audio is still ahead", () => {
    expect(
      shouldHoldLivePlayback({
        isLiveStream: true,
        chapterCompleted: true,
        generatedDuration: 20,
        currentTime: 12,
      })
    ).toBe(true);
    expect(
      shouldHoldLivePlayback({
        isLiveStream: true,
        chapterCompleted: true,
        generatedDuration: 12,
        currentTime: 12,
      })
    ).toBe(false);
  });
});

describe("shouldResumeLiveAfterHold", () => {
  it("resumes once generated audio grows past the held position", () => {
    expect(
      shouldResumeLiveAfterHold({
        generatedDuration: 14,
        heldAtTime: 12,
      })
    ).toBe(true);
    expect(
      shouldResumeLiveAfterHold({
        generatedDuration: 12.1,
        heldAtTime: 12,
      })
    ).toBe(false);
  });
});
