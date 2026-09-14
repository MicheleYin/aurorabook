import { describe, expect, it } from "vitest";

import {
  applyMediaPlaybackRate,
  applyNativePlayerEvent,
  canRestoreSavedTime,
  mimeTypeFromTrackHref,
  shouldMirrorNativeSeek,
  trackDisplayTitle,
} from "./audio-progress-utils";

const idle = {
  nativeTime: null,
  seekWebViewTo: null,
  synthesiseEnded: false,
  shouldPlay: false,
  shouldPause: false,
  durationUpdate: null,
  shouldNext: false,
  shouldPrev: false,
};

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
  it("tracks timeUpdate and syncs the webview clock", () => {
    expect(applyNativePlayerEvent({ type: "timeUpdate", time: 42 }, 40)).toEqual(
      {
        ...idle,
        nativeTime: 42,
        seekWebViewTo: 42,
      }
    );
  });

  it("mirrors seek when webview drift is large", () => {
    expect(applyNativePlayerEvent({ type: "seek", time: 50 }, 10)).toEqual({
      ...idle,
      nativeTime: 50,
      seekWebViewTo: 50,
    });
  });

  it("does not mirror seek when already close", () => {
    expect(applyNativePlayerEvent({ type: "seek", time: 10.2 }, 10)).toEqual({
      ...idle,
      nativeTime: 10.2,
      seekWebViewTo: null,
    });
  });

  it("synthesises ended", () => {
    expect(applyNativePlayerEvent({ type: "ended" }, 99)).toEqual({
      ...idle,
      synthesiseEnded: true,
    });
  });

  it("maps play and pause for Control Center sync", () => {
    expect(applyNativePlayerEvent({ type: "play" }, 1)).toEqual({
      ...idle,
      shouldPlay: true,
    });
    expect(applyNativePlayerEvent({ type: "pause" }, 1)).toEqual({
      ...idle,
      shouldPause: true,
    });
  });

  it("maps next and prev", () => {
    expect(applyNativePlayerEvent({ type: "next" }, 1)).toEqual({
      ...idle,
      shouldNext: true,
    });
    expect(applyNativePlayerEvent({ type: "prev" }, 1)).toEqual({
      ...idle,
      shouldPrev: true,
    });
  });

  it("maps durationUpdate", () => {
    expect(
      applyNativePlayerEvent({ type: "durationUpdate", time: 12.5 }, 1)
    ).toEqual({
      ...idle,
      durationUpdate: 12.5,
    });
  });

  it("ignores unrelated events", () => {
    expect(applyNativePlayerEvent({ type: "unknown" }, 1)).toEqual(idle);
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

describe("applyMediaPlaybackRate", () => {
  it("applies a finite positive rate to both fields", () => {
    const media = { playbackRate: 1, defaultPlaybackRate: 1 };
    expect(applyMediaPlaybackRate(media, 1.5)).toBe(1.5);
    expect(media.playbackRate).toBe(1.5);
    expect(media.defaultPlaybackRate).toBe(1.5);
  });

  it("falls back to 1 for invalid rates", () => {
    const media = { playbackRate: 2, defaultPlaybackRate: 2 };
    expect(applyMediaPlaybackRate(media, Number.NaN)).toBe(1);
    expect(media.playbackRate).toBe(1);
  });
});
