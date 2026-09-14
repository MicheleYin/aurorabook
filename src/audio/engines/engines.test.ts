import { describe, expect, it, vi, beforeEach } from "vitest";

import { createWebviewEngine } from "./webviewEngine";
import { createIosNativeEngine } from "./iosNativeEngine";
import { createAndroidEngine } from "./androidEngine";

const invoke = vi.fn();
const listen = vi.fn(
  async (_event: string, _handler: unknown) => () => undefined
);

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) =>
    args === undefined ? invoke(cmd) : invoke(cmd, args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: (event: string, handler: unknown) => listen(event, handler),
}));

describe("createWebviewEngine", () => {
  beforeEach(() => {
    invoke.mockReset();
    Object.defineProperty(navigator, "mediaSession", {
      configurable: true,
      value: {
        playbackState: "none",
        metadata: null,
        setActionHandler: vi.fn(),
        setPositionState: vi.fn(),
      },
    });
  });

  it("loads a stream URL into the audio element and plays", async () => {
    const audio = document.createElement("audio");
    audio.play = vi.fn(async () => undefined);
    const engine = createWebviewEngine(() => audio);

    await engine.load({
      bookId: "b1",
      trackId: "t1",
      title: "Track",
      artist: "Author",
      duration: 10,
      streamUrl: "http://127.0.0.1:9/audio",
      playbackRate: 1.25,
    });

    expect(audio.src).toContain("http://127.0.0.1:9/audio");
    expect(audio.playbackRate).toBe(1.25);

    await engine.play();
    expect(audio.play).toHaveBeenCalled();
    expect(engine.isPlaying()).toBe(false); // paused until real play event

    engine.destroy();
  });

  it("binds Media Session play/pause handlers to the audio element", async () => {
    const audio = document.createElement("audio");
    audio.play = vi.fn(async () => undefined);
    audio.pause = vi.fn();
    const setActionHandler = vi.fn();
    Object.defineProperty(navigator, "mediaSession", {
      configurable: true,
      value: {
        playbackState: "none",
        metadata: null,
        setActionHandler,
        setPositionState: vi.fn(),
      },
    });

    const engine = createWebviewEngine(() => audio);
    await engine.load({
      bookId: "b1",
      trackId: "t1",
      title: "Track",
      artist: "Author",
      duration: 10,
      streamUrl: "http://127.0.0.1:9/audio",
    });

    expect(setActionHandler).toHaveBeenCalledWith("play", expect.any(Function));
    expect(setActionHandler).toHaveBeenCalledWith("pause", expect.any(Function));

    const playHandler = [...setActionHandler.mock.calls]
      .reverse()
      .find((call) => call[0] === "play" && typeof call[1] === "function")?.[1] as
      | ((details: MediaSessionActionDetails) => void)
      | undefined;
    playHandler?.({ action: "play" });
    await vi.waitFor(() => {
      expect(audio.play).toHaveBeenCalled();
    });

    engine.destroy();
  });
});

describe("createIosNativeEngine", () => {
  beforeEach(() => {
    invoke.mockReset();
    listen.mockClear();
    invoke.mockResolvedValue(undefined);
  });

  it("loads and controls via ios_player_* commands", async () => {
    const engine = createIosNativeEngine();
    await engine.load({
      bookId: "b1",
      trackId: "t1",
      title: "Intro",
      artist: "Author",
      duration: 120,
      coverUrl: null,
      playbackRate: 1.5,
    });

    expect(invoke).toHaveBeenCalledWith(
      "ios_player_load",
      expect.objectContaining({
        options: expect.objectContaining({
          bookId: "b1",
          trackId: "t1",
          title: "Intro",
        }),
      })
    );
    expect(invoke).toHaveBeenCalledWith("ios_player_set_rate", { rate: 1.5 });

    await engine.play();
    expect(invoke).toHaveBeenCalledWith("ios_player_play");
    expect(engine.isPlaying()).toBe(true);
    await engine.pause();
    expect(invoke).toHaveBeenCalledWith("ios_player_pause");
    expect(engine.isPlaying()).toBe(false);
    await engine.seek(33);
    expect(invoke).toHaveBeenCalledWith("ios_player_seek", { seconds: 33 });
    expect(engine.getCurrentTime()).toBe(33);

    engine.destroy();
  });

  it("emits seek so paused UI can update the progress bar", async () => {
    invoke.mockResolvedValue(undefined);
    const engine = createIosNativeEngine();
    const onEvent = vi.fn();
    engine.subscribe(onEvent);

    await engine.seek(42);
    expect(onEvent).toHaveBeenCalledWith({ type: "seek", time: 42 });

    engine.destroy();
  });
});

describe("createAndroidEngine", () => {
  it("reports android kind while using webview behavior", async () => {
    const audio = document.createElement("audio");
    const engine = createAndroidEngine(() => audio);
    expect(engine.kind).toBe("android");
    engine.destroy();
  });
});
