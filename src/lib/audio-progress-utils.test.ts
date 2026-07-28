import { describe, expect, it } from "vitest";

import {
  applyNativePlayerEvent,
  canRestoreSavedTime,
  mimeTypeFromTrackHref,
  shouldMirrorNativeSeek,
  trackDisplayTitle,
} from "./audio-progress-utils";

describe("mimeTypeFromTrackHref", () => {
  it("maps known extensions", () => {
    expect(mimeTypeFromTrackHref("a.mp3")).toBe("audio/mpeg");
    expect(mimeTypeFromTrackHref("a.m4a")).toBe("audio/mp4");
    expect(mimeTypeFromTrackHref("a.ogg")).toBe("audio/ogg");
    expect(mimeTypeFromTrackHref("a.wav")).toBe("audio/wav");
  });

  it("defaults to mpeg for unknown or missing href", () => {
    expect(mimeTypeFromTrackHref("a.flac")).toBe("audio/mpeg");
    expect(mimeTypeFromTrackHref(null)).toBe("audio/mpeg");
    expect(mimeTypeFromTrackHref(undefined)).toBe("audio/mpeg");
  });
});

describe("shouldMirrorNativeSeek", () => {
  it("mirrors only when drift exceeds threshold", () => {
    expect(shouldMirrorNativeSeek(10, 10.5)).toBe(false);
    expect(shouldMirrorNativeSeek(10, 11.1)).toBe(true);
    expect(shouldMirrorNativeSeek(10, 10.2, 0.1)).toBe(true);
  });
});

describe("applyNativePlayerEvent", () => {
  it("tracks timeUpdate without seeking the webview", () => {
    expect(applyNativePlayerEvent({ type: "timeUpdate", time: 42 }, 40)).toEqual(
      {
        nativeTime: 42,
        seekWebViewTo: null,
        synthesiseEnded: false,
      }
    );
  });

  it("mirrors seek when webview drift is large", () => {
    expect(applyNativePlayerEvent({ type: "seek", time: 50 }, 10)).toEqual({
      nativeTime: 50,
      seekWebViewTo: 50,
      synthesiseEnded: false,
    });
  });

  it("does not mirror seek when already close", () => {
    expect(applyNativePlayerEvent({ type: "seek", time: 10.2 }, 10)).toEqual({
      nativeTime: 10.2,
      seekWebViewTo: null,
      synthesiseEnded: false,
    });
  });

  it("synthesises ended", () => {
    expect(applyNativePlayerEvent({ type: "ended" }, 99)).toEqual({
      nativeTime: null,
      seekWebViewTo: null,
      synthesiseEnded: true,
    });
  });

  it("ignores unrelated events", () => {
    expect(applyNativePlayerEvent({ type: "play" }, 1)).toEqual({
      nativeTime: null,
      seekWebViewTo: null,
      synthesiseEnded: false,
    });
  });
});

describe("canRestoreSavedTime", () => {
  it("accepts in-range positions", () => {
    expect(canRestoreSavedTime(12, 100)).toBe(true);
    expect(canRestoreSavedTime(0, 100)).toBe(true);
  });

  it("rejects out-of-range or invalid positions", () => {
    expect(canRestoreSavedTime(100, 100)).toBe(false);
    expect(canRestoreSavedTime(-1, 100)).toBe(false);
    expect(canRestoreSavedTime(Number.NaN, 100)).toBe(false);
  });
});

describe("trackDisplayTitle", () => {
  it("prefers explicit title then falls back to order", () => {
    expect(trackDisplayTitle("Intro", 0)).toBe("Intro");
    expect(trackDisplayTitle(null, 2)).toBe("Track 3");
    expect(trackDisplayTitle(undefined, 0)).toBe("Track 1");
  });
});
