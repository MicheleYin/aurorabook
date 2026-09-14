import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import {
  bindMediaSessionControls,
  clearMediaSession,
  isMediaSessionBound,
  setMediaSessionPlaybackState,
  setMediaSessionPositionState,
  unbindMediaSessionControls,
  MEDIA_SKIP_EVENT,
} from "./mediaSession";

describe("mediaSession controls", () => {
  const handlers = new Map<string, MediaSessionActionHandler | null>();
  let playbackState: MediaSessionPlaybackState = "none";
  let positionState: MediaPositionState | null = null;

  beforeEach(() => {
    handlers.clear();
    playbackState = "none";
    positionState = null;

    Object.defineProperty(navigator, "mediaSession", {
      configurable: true,
      value: {
        get playbackState() {
          return playbackState;
        },
        set playbackState(next: MediaSessionPlaybackState) {
          playbackState = next;
        },
        metadata: null,
        setActionHandler: (
          action: MediaSessionAction,
          handler: MediaSessionActionHandler | null
        ) => {
          handlers.set(action, handler);
        },
        setPositionState: (state?: MediaPositionState) => {
          positionState = state ?? null;
        },
      },
    });
  });

  afterEach(() => {
    clearMediaSession();
  });

  it("binds play/pause/seek/skip handlers", () => {
    const play = vi.fn(async () => undefined);
    const pause = vi.fn();
    const seekTo = vi.fn();

    bindMediaSessionControls({
      play,
      pause,
      seekTo,
      getCurrentTime: () => 12,
      getDuration: () => 100,
      getPlaybackRate: () => 1,
    });

    expect(isMediaSessionBound()).toBe(true);
    expect(handlers.get("play")).toBeTypeOf("function");
    expect(handlers.get("pause")).toBeTypeOf("function");
    expect(handlers.get("seekto")).toBeTypeOf("function");
    expect(handlers.get("nexttrack")).toBeTypeOf("function");

    handlers.get("play")?.({ action: "play" });
    handlers.get("pause")?.({ action: "pause" });
    handlers.get("seekto")?.({ action: "seekto", seekTime: 40 });

    expect(play).toHaveBeenCalled();
    expect(pause).toHaveBeenCalled();
    expect(seekTo).toHaveBeenCalledWith(40);
  });

  it("dispatches skip events for next/prev", () => {
    const onSkip = vi.fn();
    const onLegacy = vi.fn();
    window.addEventListener(MEDIA_SKIP_EVENT, onSkip);
    window.addEventListener("aurora-native-skip", onLegacy);

    bindMediaSessionControls({
      play: () => undefined,
      pause: () => undefined,
      seekTo: () => undefined,
      getCurrentTime: () => 0,
      getDuration: () => 0,
      getPlaybackRate: () => 1,
    });

    handlers.get("nexttrack")?.({ action: "nexttrack" });
    handlers.get("previoustrack")?.({ action: "previoustrack" });

    expect(onSkip).toHaveBeenCalled();
    expect(onLegacy).toHaveBeenCalled();

    window.removeEventListener(MEDIA_SKIP_EVENT, onSkip);
    window.removeEventListener("aurora-native-skip", onLegacy);
  });

  it("updates playback and position state", () => {
    setMediaSessionPlaybackState("playing");
    expect(playbackState).toBe("playing");

    setMediaSessionPositionState({
      duration: 120,
      position: 15,
      playbackRate: 1.25,
    });
    expect(positionState).toEqual({
      duration: 120,
      position: 15,
      playbackRate: 1.25,
    });
  });

  it("unbinds handlers", () => {
    bindMediaSessionControls({
      play: () => undefined,
      pause: () => undefined,
      seekTo: () => undefined,
      getCurrentTime: () => 0,
      getDuration: () => 0,
      getPlaybackRate: () => 1,
    });
    unbindMediaSessionControls();
    expect(isMediaSessionBound()).toBe(false);
    expect(handlers.get("play")).toBeNull();
  });
});
